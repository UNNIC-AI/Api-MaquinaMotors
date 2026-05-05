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

const requiredEnv = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "API_ACCESS_KEY", "ENCRYPTION_KEY"];
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

function isValidDateInput(value) {
  if (!value || typeof value !== "string") return false;
  return !Number.isNaN(new Date(value).getTime());
}

async function queryConversacionesDesencriptadas({ phone, from, to, orderAsc, limit }) {
  const { data, error } = await supabase.rpc("get_conversaciones_decrypted", {
    filter_phone: phone || null,
    filter_from: from || null,
    filter_to: to || null,
    order_asc: orderAsc ?? false,
    limit_count: limit ?? 5000,
  });
  return { data, error };
}

async function generarResumenConOpenAI(transcript) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY no configurada");
  }
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const r = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 700,
      messages: [
        {
          role: "system",
          content:
            "Eres un asistente que resume conversaciones comerciales por WhatsApp/chat. Responde SIEMPRE en español. " +
            "Devuelve un resumen breve (5-10 frases máximo): intención del cliente, datos relevantes (modelo, precio, urgencia), " +
            "acuerdos o siguientes pasos, y tono general. No inventes datos que no aparezcan en el texto.",
        },
        { role: "user", content: transcript },
      ],
    }),
  });

  const raw = await r.text();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Respuesta invalida del proveedor de resumen: ${raw.slice(0, 200)}`);
  }

  if (!r.ok) {
    const msg = parsed?.error?.message || raw.slice(0, 300);
    throw new Error(msg || `Error HTTP ${r.status}`);
  }

  const text = parsed?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("El modelo no devolvio texto de resumen");
  }
  return text;
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

  const { data, error } = await queryConversacionesDesencriptadas({
    phone: null,
    from,
    to,
    orderAsc: false,
    limit: fetchSize,
  });

  if (error) {
    return res.status(500).json({ error: "Error consultando base de datos", detail: error.message });
  }

  const grouped = new Map();
  for (const row of data || []) {
    const sessionKey = row.phone || 'unknown';
    
    if (!grouped.has(sessionKey)) {
      grouped.set(sessionKey, {
        phone: row.phone,
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

  const { data, error } = await queryConversacionesDesencriptadas({
    phone,
    from,
    to,
    orderAsc: true,
    limit: 5000,
  });

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
      phone: row.phone,
      message: row.message,
      procesado: row.procesado,
    })),
  });
});

/**
 * @openapi
 * /api/conversaciones/{phone}/resumen:
 *   post:
 *     tags: [Conversaciones]
 *     summary: Genera resumen de conversacion por telefono con IA
 *     description: Genera un resumen automatico de la conversacion usando OpenAI. El body es opcional, tambien puedes pasar parametros por query string.
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
 *         description: Filtra mensajes desde esta fecha ISO (alternativa al body)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filtra mensajes hasta esta fecha ISO (alternativa al body)
 *       - in: query
 *         name: max_messages
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 500
 *           default: 100
 *         description: Maximo de mensajes a considerar (alternativa al body)
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             example: {}
 *             properties:
 *               from:
 *                 type: string
 *                 format: date-time
 *                 description: Filtra mensajes desde esta fecha ISO (opcional)
 *               to:
 *                 type: string
 *                 format: date-time
 *                 description: Filtra mensajes hasta esta fecha ISO (opcional)
 *               max_messages:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 500
 *                 default: 100
 *                 description: Maximo de mensajes a considerar (opcional, default 100)
 *     responses:
 *       200:
 *         description: Resumen generado correctamente
 *       400:
 *         description: Parametros invalidos
 *       401:
 *         description: No autorizado
 *       500:
 *         description: Error generando resumen
 */
app.post("/api/conversaciones/:phone/resumen", requireApiKey, async (req, res) => {
  const { phone } = req.params;
  let from = req.body?.from || req.query.from;
  let to = req.body?.to || req.query.to;
  const maxMessages = Math.min(Math.max(Number(req.body?.max_messages || req.query.max_messages) || 100, 1), 500);

  const now = new Date();
  
  if (from && !isValidDateInput(from)) {
    from = null;
  }
  if (to && !isValidDateInput(to)) {
    to = null;
  }
  
  if (from && new Date(from) > now) {
    from = null;
  }
  if (to && new Date(to) > now) {
    to = null;
  }
  
  if (from && to && new Date(from) > new Date(to)) {
    from = null;
    to = null;
  }

  try {
    const { data, error } = await queryConversacionesDesencriptadas({
      phone,
      from,
      to,
      orderAsc: true,
      limit: maxMessages,
    });

    if (error) {
      return res.status(500).json({ error: "Error consultando base de datos", detail: error.message });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ 
        error: "No se encontraron mensajes para este telefono"
      });
    }

    const transcript = data
      .map((row) => {
        const roleName = row.role === "user" ? "Cliente" : row.role === "assistant" ? "Agente" : row.role;
        const msg = typeof row.message === "string" ? row.message : JSON.stringify(row.message);
        return `[${roleName}]: ${msg}`;
      })
      .join("\n\n");

    const resumen = await generarResumenConOpenAI(transcript);

    return res.json({
      phone,
      message_count: data.length,
      filters: {
        from: from || null,
        to: to || null,
        max_messages: maxMessages,
      },
      resumen,
    });
  } catch (err) {
    console.error("Error generando resumen:", err);
    return res.status(500).json({
      error: "Error generando resumen",
      detail: err.message || String(err),
    });
  }
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
