-- ====================================================
-- Tabla para guardar los análisis semanales generados
-- ====================================================
-- Ejecuta este script en el SQL Editor de Supabase (proyecto nuevo).
-- Permite guardar varios análisis por la misma semana (historial).
-- El acceso se hace con la service_role de la API (bypassa RLS).
-- ====================================================

CREATE TABLE IF NOT EXISTS resumenes_semanales (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  semana_from  timestamptz NOT NULL,
  semana_to    timestamptz NOT NULL,
  stats        jsonb,
  resumen      text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Búsqueda rápida por semana y orden por fecha de creación
CREATE INDEX IF NOT EXISTS idx_resumenes_semana
  ON resumenes_semanales (semana_from, semana_to, created_at DESC);
