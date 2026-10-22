require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const swaggerUi = require("swagger-ui-express");
const swaggerJSDoc = require("swagger-jsdoc");
const crypto = require("crypto");
const { query } = require("./db");

const app = express();

const requiredEnv = ["DATABASE_URL", "API_ACCESS_KEY", "ENCRYPTION_KEY"];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Falta variable de entorno requerida: ${key}`);
  }
}

// Claves con las que n8n cifra conversaciones.message (pgp_sym_encrypt).
// Puede haber varias separadas por comas: se prueban en orden.
const ENCRYPTION_KEYS = process.env.ENCRYPTION_KEY.split(",").map((k) => k.trim()).filter(Boolean);

const corsOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

// Detrás de un proxy inverso (nginx, Traefik…) hace falta para que el límite
// de peticiones vea la IP real del usuario y no la del proxy.
if (process.env.TRUST_PROXY) {
  app.set("trust proxy", Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
}

app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("combined"));
// El panel se sirve desde el mismo origen que la API, así que por defecto no
// se abre CORS. Solo hace falta si otra web va a llamar a la API.
if (corsOrigins.length) {
  app.use(cors({ origin: corsOrigins }));
}

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

app.use(limiter);

// Panel web (frontend estático). Los ficheros de /public no requieren API key;
// el propio panel pide la clave al usuario y la envia en cada peticion a /api.
app.use(express.static(path.join(__dirname, "..", "public")));

function requireApiKey(req, res, next) {
  const incoming = req.header("x-api-key");
  
  if (!incoming) {
    return res.status(401).json({ 
      error: "No autorizado", 
      message: "Falta el header 'x-api-key'. Por favor, proporciona tu API key." 
    });
  }
  
  if (!sameSecret(incoming, process.env.API_ACCESS_KEY)) {
    return res.status(401).json({
      error: "No autorizado",
      message: "La API key proporcionada es incorrecta. Verifica que sea la correcta."
    });
  }

  next();
}

// Compara en tiempo constante para no dar pistas sobre la clave por lo que tarda.
function sameSecret(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// En producción no se devuelve al navegador el texto de los errores de Postgres
// ni de conexión (llevan tablas, host y puerto). Se reconocen porque traen
// `code`; los errores propios del panel (p. ej. falta OPENAI_API_KEY) no.
function errorDetail(err) {
  console.error(err);
  if (process.env.NODE_ENV === "production" && err && err.code) return undefined;
  return err.message || String(err);
}

function isValidDateInput(value) {
  if (!value || typeof value !== "string") return false;
  return !Number.isNaN(new Date(value).getTime());
}

// Mensajes descifrados de conversaciones, filtrados por teléfono y fechas.
async function queryConversacionesDesencriptadas({ phone, from, to, orderAsc, limit }) {
  return query(
    `SELECT c.id, c.phone, c.role, public.try_decrypt(c.message, $1::text[]) AS message,
            c.procesado, c."timestamp"
       FROM public.conversaciones c
      WHERE ($2::text IS NULL OR c.phone = $2)
        AND ($3::timestamptz IS NULL OR c."timestamp" >= $3)
        AND ($4::timestamptz IS NULL OR c."timestamp" <= $4)
      ORDER BY c."timestamp" ${orderAsc ? "ASC" : "DESC"}
      LIMIT $5`,
    [ENCRYPTION_KEYS, phone || null, from || null, to || null, limit ?? 5000]
  );
}

// Una fila por teléfono. Se agrupa en Postgres y solo se descifra el último
// mensaje del cliente (para la vista previa); si hay búsqueda de texto, se
// descifra lo necesario para buscar en todos los mensajes del rango.
async function queryListadoConversaciones({ from, to, q, limit, offset }) {
  const texto = q || null;
  const digitos = q ? q.replace(/\D/g, "").replace(/^34/, "") : "";
  return query(
    `WITH rango AS (
       SELECT id, phone, role, "timestamp"
         FROM public.conversaciones
        WHERE ($2::timestamptz IS NULL OR "timestamp" >= $2)
          AND ($3::timestamptz IS NULL OR "timestamp" <= $3)
     ),
     sesiones AS (
       SELECT phone, min("timestamp") AS first_message_at, max("timestamp") AS last_message_at,
              count(*)::int AS message_count
         FROM rango
        GROUP BY phone
     ),
     coincidencias AS (
       SELECT DISTINCT r.phone
         FROM rango r
         JOIN public.conversaciones c ON c.id = r.id
        WHERE $4::text IS NOT NULL
          AND public.try_decrypt(c.message, $1::text[]) ILIKE '%' || $4 || '%'
     ),
     filtradas AS (
       SELECT s.*
         FROM sesiones s
        WHERE $4::text IS NULL
           OR s.phone IN (SELECT phone FROM coincidencias)
           OR (length($5) >= 3 AND regexp_replace(s.phone, '\\D', '', 'g') LIKE '%' || $5 || '%')
     ),
     pagina AS (
       SELECT f.*, count(*) OVER ()::int AS total
         FROM filtradas f
        ORDER BY f.last_message_at DESC
        LIMIT $6 OFFSET $7
     ),
     ultimo_cliente AS (
       SELECT DISTINCT ON (r.phone) r.phone, r.id
         FROM rango r
        WHERE r.role = 'user' AND r.phone IN (SELECT phone FROM pagina)
        ORDER BY r.phone, r."timestamp" DESC
     )
     SELECT p.phone, p.first_message_at, p.last_message_at, p.message_count, p.total,
            left(public.try_decrypt(c.message, $1::text[]), 120) AS preview
       FROM pagina p
       LEFT JOIN ultimo_cliente u ON u.phone = p.phone
       LEFT JOIN public.conversaciones c ON c.id = u.id
      ORDER BY p.last_message_at DESC`,
    [ENCRYPTION_KEYS, from || null, to || null, texto, digitos, limit, offset]
  );
}

const SYSTEM_RESUMEN_CONVERSACION =
  "Eres un asistente que resume conversaciones comerciales por WhatsApp/chat. Responde SIEMPRE en español. " +
  "Devuelve un resumen breve (5-10 frases máximo): intención del cliente, datos relevantes (modelo, precio, urgencia), " +
  "acuerdos o siguientes pasos, y tono general. No inventes datos que no aparezcan en el texto.";

const SYSTEM_RESUMEN_SEMANAL =
  "Eres un analista senior de calidad y experiencia de cliente de un concesionario de motos. Revisas TODAS las " +
  "conversaciones de una semana entre los clientes y el agente automático (WhatsApp/chat) y redactas un informe " +
  "profesional y ejecutivo para el responsable del negocio.\n\n" +
  "Objetivo: explicar en conjunto cómo han ido las conversaciones de la semana e identificar qué situaciones se " +
  "repiten (el clásico \"esto ha pasado a menudo\"), entender por qué ocurren, y distinguir qué conviene PROTEGER " +
  "(lo que funciona bien) de qué conviene MEJORAR (lo que falla o frustra al cliente).\n\n" +
  "FORMATO (muy importante):\n" +
  "- Escribe en español, en prosa profesional, clara y directa, como un informe redactado por una persona.\n" +
  "- PROHIBIDO usar Markdown o símbolos: nada de #, ##, *, **, comillas triples, backticks, emojis ni viñetas con guiones.\n" +
  "- Organiza el informe en apartados. Cada apartado empieza con su título en una línea, en MAYÚSCULAS y sin símbolos, " +
  "y debajo el contenido en frases completas. Si necesitas enumerar, usa frases separadas por punto y aparte.\n\n" +
  "Apartados, en este orden:\n" +
  "RESUMEN DE LA SEMANA\n" +
  "Un párrafo sobre el volumen de conversaciones, el tipo de clientes y el tono general: cómo han ido en conjunto.\n\n" +
  "LO QUE MAS SE REPITE\n" +
  "Describe las situaciones recurrentes (consultas, objeciones, peticiones, puntos donde el cliente se atasca o el " +
  "agente no resuelve). Para cada una indica con qué frecuencia aproximada aparece y por qué crees que ocurre.\n\n" +
  "QUE CONVIENE PROTEGER\n" +
  "Lo que el agente hace bien y da buenos resultados, que no habría que tocar.\n\n" +
  "QUE CONVIENE MEJORAR\n" +
  "Recomendaciones concretas y accionables, ordenadas por impacto, para mejorar el agente y el proceso comercial.\n\n" +
  "Cuantifica cuando puedas (número de veces o de clientes). No inventes nada que no aparezca en las conversaciones.";

async function generarResumenConOpenAI(transcript, opts = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY no configurada");
  }
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const system = opts.system || SYSTEM_RESUMEN_CONVERSACION;
  const maxTokens = opts.maxTokens || 700;

  const r = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
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
  return limpiarMarkdown(text);
}

// Quita restos de Markdown/símbolos por si el modelo los cuela
function limpiarMarkdown(t) {
  return String(t || "")
    .replace(/^#{1,6}\s*/gm, "")        // encabezados ###
    .replace(/\*\*(.*?)\*\*/g, "$1")    // **negrita**
    .replace(/__(.*?)__/g, "$1")        // __negrita__
    .replace(/`+/g, "")                 // backticks
    .replace(/^\s*[-*•]\s+/gm, "")      // viñetas al inicio de línea
    .replace(/\*/g, "")                 // asteriscos sueltos
    .replace(/\n{3,}/g, "\n\n")         // exceso de saltos de línea
    .trim();
}

/**
 * @openapi
 * /api/health:
 *   get:
 *     tags: [Sistema]
 *     summary: Estado del servicio y de la conexión con la base de datos
 *     responses:
 *       200:
 *         description: Servicio operativo
 *       503:
 *         description: Sin conexión con Postgres
 */
app.get("/api/health", async (_req, res) => {
  try {
    await query("SELECT 1");
    res.json({ ok: true, service: "api-maquinamotors", database: "ok" });
  } catch (err) {
    console.error("Health: sin conexión con Postgres:", err.message);
    res.status(503).json({ ok: false, service: "api-maquinamotors", database: "sin conexión" });
  }
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
  const queryText = (req.query.q || "").toString().trim().slice(0, 100);

  if (from && !isValidDateInput(from)) {
    return res.status(400).json({ error: "Parametro 'from' invalido. Usa formato ISO 8601." });
  }
  if (to && !isValidDateInput(to)) {
    return res.status(400).json({ error: "Parametro 'to' invalido. Usa formato ISO 8601." });
  }
  if (from && to && new Date(from) > new Date(to)) {
    return res.status(400).json({ error: "El parametro 'from' no puede ser mayor que 'to'." });
  }

  let rows;
  try {
    rows = await queryListadoConversaciones({ from, to, q: queryText, limit, offset });
  } catch (err) {
    return res.status(500).json({ error: "Error consultando base de datos", detail: errorDetail(err) });
  }

  const sessions = rows.map(({ total, ...session }) => ({
    ...session,
    preview: session.preview || "",
    date_range: {
      from: session.first_message_at,
      to: session.last_message_at,
    },
  }));

  return res.json({
    total: rows[0]?.total ?? 0,
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

  let data;
  try {
    data = await queryConversacionesDesencriptadas({ phone, from, to, orderAsc: true, limit: 5000 });
  } catch (err) {
    return res.status(500).json({ error: "Error consultando base de datos", detail: errorDetail(err) });
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
 *     description: Genera un resumen automatico de los ultimos mensajes de la conversacion usando OpenAI. El body es opcional, tambien puedes pasar parametros por query string.
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
    // Los ÚLTIMOS max_messages mensajes (lo más reciente es lo que importa),
    // puestos luego en orden cronológico para la IA.
    const data = (await queryConversacionesDesencriptadas({
      phone,
      from,
      to,
      orderAsc: false,
      limit: maxMessages,
    })).reverse();

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
    return res.status(500).json({
      error: "Error generando resumen",
      detail: errorDetail(err),
    });
  }
});

// Genera el análisis de una semana: estadísticas + texto IA. No guarda nada.
async function generarAnalisisSemanal({ from, to }) {
  // Las cifras se cuentan en Postgres sobre toda la semana; a la IA solo le
  // llegan los primeros MAX_MSGS mensajes.
  const [stats] = await query(
    `SELECT count(DISTINCT phone)::int AS conversaciones,
            count(*)::int AS mensajes,
            count(*) FILTER (WHERE role = 'user')::int AS mensajes_cliente,
            count(*) FILTER (WHERE role = 'assistant')::int AS mensajes_agente
       FROM public.conversaciones
      WHERE "timestamp" >= $1 AND "timestamp" <= $2`,
    [from, to]
  );
  if (!stats.mensajes) return { stats, resumen: null, truncado: false };

  const MAX_MSGS = 400;
  const usados = await queryConversacionesDesencriptadas({
    phone: null,
    from,
    to,
    orderAsc: true,
    limit: MAX_MSGS,
  });
  const porTelefono = new Map();
  for (const row of usados) {
    const key = row.phone || "desconocido";
    if (!porTelefono.has(key)) porTelefono.set(key, []);
    const roleName = row.role === "user" ? "Cliente" : row.role === "assistant" ? "Agente" : row.role;
    const msg = typeof row.message === "string" ? row.message : JSON.stringify(row.message);
    porTelefono.get(key).push(`[${roleName}]: ${msg}`);
  }
  const transcript = [...porTelefono.entries()]
    .map(([tel, msgs]) => `=== Conversación ${tel} ===\n${msgs.join("\n")}`)
    .join("\n\n");

  const contexto =
    `DATOS EXACTOS DE LA SEMANA (usa estas cifras, no las estimes):\n` +
    `- Conversaciones distintas: ${stats.conversaciones}\n` +
    `- Mensajes totales: ${stats.mensajes} (del cliente: ${stats.mensajes_cliente}, del agente: ${stats.mensajes_agente})\n\n` +
    `CONVERSACIONES DE LA SEMANA:\n${transcript}`;

  const resumen = await generarResumenConOpenAI(contexto, {
    system: SYSTEM_RESUMEN_SEMANAL,
    maxTokens: 1400,
  });
  return { stats, resumen, truncado: stats.mensajes > MAX_MSGS };
}

/**
 * @openapi
 * /api/resumenes-semanales:
 *   get:
 *     tags: [Resúmenes]
 *     summary: Lista los análisis guardados de una semana
 *     security: [{ ApiKeyAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date-time } }
 *       - { in: query, name: to, schema: { type: string, format: date-time } }
 *   post:
 *     tags: [Resúmenes]
 *     summary: Genera y GUARDA un análisis de la semana (permite varios por semana)
 *     description: Requiere OPENAI_API_KEY. Envía a OpenAI el texto de las conversaciones de esa semana.
 *     security: [{ ApiKeyAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [from, to]
 *             properties:
 *               from: { type: string, format: date-time, example: "2026-10-18T22:00:00.000Z" }
 *               to: { type: string, format: date-time, example: "2026-10-25T21:59:59.999Z" }
 *     responses:
 *       200: { description: Análisis generado y guardado }
 *       404: { description: Sin actividad esa semana (no se guarda nada) }
 * /api/resumenes-semanales/{id}:
 *   delete:
 *     tags: [Resúmenes]
 *     summary: Borra un análisis guardado
 *     security: [{ ApiKeyAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Borrado }
 */
app.get("/api/resumenes-semanales", requireApiKey, async (req, res) => {
  const { from, to } = req.query;
  if (from && !isValidDateInput(from)) return res.status(400).json({ error: "Parametro 'from' invalido." });
  if (to && !isValidDateInput(to)) return res.status(400).json({ error: "Parametro 'to' invalido." });

  let data;
  try {
    // Se busca la semana con margen de unas horas y no por igualdad exacta:
    // los análisis antiguos se guardaron con la semana en UTC y los nuevos en
    // hora local, así que el lunes 00:00 puede ser 22:00 o 23:00 del domingo.
    data = await query(
      `SELECT id, semana_from, semana_to, stats, resumen, created_at
         FROM public.resumenes_semanales
        WHERE ($1::timestamptz IS NULL OR semana_from BETWEEN $1::timestamptz - interval '14 hours' AND $1::timestamptz + interval '14 hours')
          AND ($2::timestamptz IS NULL OR semana_to BETWEEN $2::timestamptz - interval '14 hours' AND $2::timestamptz + interval '14 hours')
        ORDER BY created_at DESC`,
      [from || null, to || null]
    );
  } catch (err) {
    return res.status(500).json({ error: "Error consultando análisis guardados", detail: errorDetail(err) });
  }
  return res.json({ data, filters: { from: from || null, to: to || null } });
});

app.post("/api/resumenes-semanales", requireApiKey, async (req, res) => {
  const from = req.body?.from || req.query.from;
  const to = req.body?.to || req.query.to;
  if (!from || !isValidDateInput(from) || !to || !isValidDateInput(to)) {
    return res.status(400).json({ error: "Faltan 'from'/'to' válidos (ISO 8601) para la semana." });
  }

  try {
    const analisis = await generarAnalisisSemanal({ from, to });
    if (!analisis.resumen) {
      return res.status(404).json({ error: "No hubo actividad esa semana, no se ha guardado nada.", stats: analisis.stats });
    }

    const [data] = await query(
      `INSERT INTO public.resumenes_semanales (semana_from, semana_to, stats, resumen)
       VALUES ($1, $2, $3, $4)
       RETURNING id, semana_from, semana_to, stats, resumen, created_at`,
      [from, to, analisis.stats, analisis.resumen]
    );
    return res.json({ ...data, truncado: analisis.truncado });
  } catch (err) {
    return res.status(500).json({ error: "Error generando análisis semanal", detail: errorDetail(err) });
  }
});

app.delete("/api/resumenes-semanales/:id", requireApiKey, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "id inválido" });
  try {
    await query("DELETE FROM public.resumenes_semanales WHERE id = $1", [id]);
  } catch (err) {
    return res.status(500).json({ error: "Error borrando", detail: errorDetail(err) });
  }
  return res.json({ ok: true });
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
