const { Pool } = require("pg");

// Conexión directa al Postgres donde n8n guarda las conversaciones.
// DATABASE_URL: postgres://usuario:contraseña@host:5432/basededatos
// DATABASE_SSL=true solo si el servidor de Postgres lo exige.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
  max: Number(process.env.DATABASE_POOL_MAX) || 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (err) => {
  console.error("Error inesperado en la conexión con Postgres:", err.message);
});

async function query(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

module.exports = { pool, query };
