require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const swaggerUi = require("swagger-ui-express");
const swaggerJSDoc = require("swagger-jsdoc");
const { createClient } = require("@supabase/supabase-js");

const app = express();

const requiredEnv = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "API_ACCESS_KEY"];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Falta variable de entorno requerida: ${key}`);
  }
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const corsOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("combined"));
app.use(
  corsOrigins.length
    ? cors({ origin: corsOrigins })
    : cors()
);

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

app.use(limiter);

function requireApiKey(req, res, next) {
  const incoming = req.header("x-api-key");
  
  if (!incoming) {
    return res.status(401).json({ 
      error: "No autorizado", 
      message: "Falta el header 'x-api-key'. Por favor, proporciona tu API key." 
    });
  }
  
  if (incoming !== process.env.API_ACCESS_KEY) {
    return res.status(401).json({ 
      error: "No autorizado", 
      message: "La API key proporcionada es incorrecta. Verifica que sea la correcta." 
    });
  }
  
  next();
}

function buildPreview(messageField) {
  try {
    const parsed = typeof messageField === "string" ? JSON.parse(messageField) : messageField;
    if (parsed?.type === "human" && typeof parsed?.content === "string") {
      return parsed.content.slice(0, 120);
    }
    return "";
  } catch {
    return "";
  }
}

function parseMessage(messageField) {
  try {
    return typeof messageField === "string" ? JSON.parse(messageField) : messageField;
  } catch {
    return { type: "unknown", content: String(messageField) };
  }
}

function isValidDateInput(value) {
  if (!value || typeof value !== "string") return false;
  return !Number.isNaN(new Date(value).getTime());
}

/**
 * @openapi
 * /api/health:
 *   get:
 *     tags: [Sistema]
 *     summary: Estado del servicio
 *     responses:
 *       200:
 *         description: Servicio operativo
 */
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "api-maquinamotors" });
});

/**
 * @openapi
 * /api/validate:
 *   get:
 *     tags: [Sistema]
 *     summary: Valida la API key
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: API key valida
 *       401:
 *         description: API key invalida o faltante
 */
app.get("/api/validate", requireApiKey, (_req, res) => {
  res.json({ ok: true, message: "API key valida" });
});

/**
 * @openapi
 * /api/conversaciones:
 *   get:
 *     tags: [Conversaciones]
 *     summary: Lista sesiones agrupadas
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 200
 *         description: Maximo de sesiones a devolver
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *         description: Desplazamiento para paginacion
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filtra mensajes creados desde esta fecha ISO
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filtra mensajes creados hasta esta fecha ISO
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Busca texto en el contenido de mensajes humanos para el preview de sesion
 *     responses:
 *       200:
 *         description: Lista de sesiones
 *       401:
 *         description: No autorizado
 */
app.get("/api/conversaciones", requireApiKey, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const from = req.query.from;
  const to = req.query.to;
  const queryText = (req.query.q || "").toString().trim().toLowerCase();
  const fetchSize = Math.min(offset + limit, 5000);

  if (from && !isValidDateInput(from)) {
    return res.status(400).json({ error: "Parametro 'from' invalido. Usa formato ISO 8601." });
  }
  if (to && !isValidDateInput(to)) {
    return res.status(400).json({ error: "Parametro 'to' invalido. Usa formato ISO 8601." });
  }
  if (from && to && new Date(from) > new Date(to)) {
    return res.status(400).json({ error: "El parametro 'from' no puede ser mayor que 'to'." });
  }

  let dbQuery = supabase
    .from("conversaciones")
    .select("*")
    .order("timestamp", { ascending: false })
    .limit(fetchSize);
  if (from) dbQuery = dbQuery.gte("timestamp", from);
  if (to) dbQuery = dbQuery.lte("timestamp", to);

  const { data, error } = await dbQuery;

  if (error) {
    return res.status(500).json({ error: "Error consultando base de datos", detail: error.message });
  }

  const grouped = new Map();
  for (const row of data || []) {
    const sessionKey = row.phone || row.user || 'unknown';
    
    if (!grouped.has(sessionKey)) {
      grouped.set(sessionKey, {
        phone: row.phone,
        user: row.user,
        first_message_at: row.timestamp,
        last_message_at: row.timestamp,
        message_count: 0,
        preview: "",
      });
    }

    const session = grouped.get(sessionKey);
    session.message_count += 1;

    if (row.timestamp < session.first_message_at) {
      session.first_message_at = row.timestamp;
    }
    if (row.timestamp > session.last_message_at) {
      session.last_message_at = row.timestamp;
    }

    if (!session.preview && row.role === 'user') {
      session.preview = typeof row.message === 'string' ? row.message.slice(0, 120) : '';
    }
  }

  const filteredSessions = [...grouped.values()].filter((session) => {
      if (!queryText) return true;
      return session.preview.toLowerCase().includes(queryText);
    });

  const sessions = filteredSessions
    .sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at))
    .slice(offset, offset + limit)
    .map((session) => ({
      ...session,
      date_range: {
        from: session.first_message_at,
        to: session.last_message_at,
      },
    }));

  return res.json({
    total: filteredSessions.length,
    limit,
    offset,
    filters: {
      from: from || null,
      to: to || null,
      q: queryText || null,
    },
    data: sessions,
  });
});

/**
 * @openapi
 * /api/conversaciones/{phone}:
 *   get:
 *     tags: [Conversaciones]
 *     summary: Mensajes de un telefono
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: phone
 *         required: true
 *         schema:
 *           type: string
 *         description: Numero de telefono
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filtra mensajes desde esta fecha ISO
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filtra mensajes hasta esta fecha ISO
 *     responses:
 *       200:
 *         description: Mensajes del telefono
 *       401:
 *         description: No autorizado
 */
app.get("/api/conversaciones/:phone", requireApiKey, async (req, res) => {
  const { phone } = req.params;
  const from = req.query.from;
  const to = req.query.to;

  if (from && !isValidDateInput(from)) {
    return res.status(400).json({ error: "Parametro 'from' invalido. Usa formato ISO 8601." });
  }
  if (to && !isValidDateInput(to)) {
    return res.status(400).json({ error: "Parametro 'to' invalido. Usa formato ISO 8601." });
  }
  if (from && to && new Date(from) > new Date(to)) {
    return res.status(400).json({ error: "El parametro 'from' no puede ser mayor que 'to'." });
  }

  let dbQuery = supabase
    .from("conversaciones")
    .select("*")
    .eq("phone", phone)
    .order("timestamp", { ascending: true })
    .limit(5000);
  if (from) dbQuery = dbQuery.gte("timestamp", from);
  if (to) dbQuery = dbQuery.lte("timestamp", to);

  const { data, error } = await dbQuery;

  if (error) {
    return res.status(500).json({ error: "Error consultando base de datos", detail: error.message });
  }

  return res.json({
    phone: phone,
    message_count: (data || []).length,
    filters: {
      from: from || null,
      to: to || null,
    },
    messages: (data || []).map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      role: row.role,
      user: row.user,
      message: row.message,
      procesado: row.procesado,
    })),
  });
});

const swaggerSpec = swaggerJSDoc({
  definition: {
    openapi: "3.0.3",
    info: {
      title: "API Maquina Motors",
      version: "1.0.0",
      description: "API para consultar conversaciones del agente sin exponer credenciales de la base de datos.",
    },
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "x-api-key",
        },
      },
    },
  },
  apis: [__filename],
});

app.use(
  "/docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  })
);

app.use((req, res) => {
  res.status(404).json({ error: "Ruta no encontrada" });
});

module.exports = app;
