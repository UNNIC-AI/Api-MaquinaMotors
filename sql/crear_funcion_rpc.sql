-- ====================================================
-- Función RPC para obtener conversaciones desencriptadas
-- ====================================================
-- Ejecuta este script en el SQL Editor de Supabase (proyecto nuevo).
--
-- Novedades importantes:
--  * La clave de descifrado NO va escrita aquí: la envía la API como
--    parámetro (variable ENCRYPTION_KEY del .env).
--  * Soporta VARIAS claves separadas por comas. Los mensajes del cliente
--    (user) y los del agente (assistant) están cifrados con claves
--    distintas, así que ENCRYPTION_KEY puede ser "claveUser,claveAgente".
--  * Si una fila no descifra con ninguna clave, devuelve un texto de aviso
--    en lugar de romper toda la consulta.
-- ====================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Quitar versiones previas que dependan del helper
DROP FUNCTION IF EXISTS get_conversaciones_decrypted(text, text, text, text, boolean, integer);
DROP FUNCTION IF EXISTS try_decrypt(bytea, text);

-- Helper: prueba una lista de claves; nunca lanza error
CREATE OR REPLACE FUNCTION try_decrypt(data bytea, keys text[])
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  k text;
BEGIN
  FOREACH k IN ARRAY keys LOOP
    BEGIN
      RETURN pgp_sym_decrypt(data, k);
    EXCEPTION WHEN OTHERS THEN
      -- esta clave no vale, probar la siguiente
    END;
  END LOOP;
  RETURN '[mensaje no descifrable]';
END;
$$;

CREATE FUNCTION get_conversaciones_decrypted(
  enc_key text,
  filter_phone text DEFAULT NULL,
  filter_from text DEFAULT NULL,
  filter_to text DEFAULT NULL,
  order_asc boolean DEFAULT false,
  limit_count integer DEFAULT 5000
)
RETURNS TABLE (
  id bigint,
  phone text,
  role text,
  message text,
  procesado boolean,
  "timestamp" timestamptz
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    c.id,
    c.phone,
    c.role,
    try_decrypt(c.message, string_to_array(enc_key, ',')) AS message,
    c.procesado,
    c."timestamp"
  FROM conversaciones c
  WHERE
    (filter_phone IS NULL OR c.phone = filter_phone)
    AND (filter_from IS NULL OR c."timestamp" >= filter_from::timestamptz)
    AND (filter_to IS NULL OR c."timestamp" <= filter_to::timestamptz)
  ORDER BY
    CASE WHEN order_asc THEN c."timestamp" END ASC,
    CASE WHEN NOT order_asc THEN c."timestamp" END DESC
  LIMIT limit_count;
$$;

GRANT EXECUTE ON FUNCTION try_decrypt(bytea, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION get_conversaciones_decrypted(text, text, text, text, boolean, integer) TO service_role;
