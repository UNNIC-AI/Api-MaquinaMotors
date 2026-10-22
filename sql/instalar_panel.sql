-- ============================================================================
--  Panel de conversaciones de Máquina Motors: lo que necesita en la base de
--  datos donde n8n guarda las conversaciones.
--
--  Se puede lanzar varias veces sin romper nada y NO modifica ninguna tabla ni
--  función que use el agente de n8n (conversaciones, clientes, memoria_chat,
--  guardar_conversacion, guardar_cliente, procesar_mensajes_pendientes…).
--
--  Ejecútalo con un usuario con permisos de administrador sobre la base de datos.
-- ============================================================================


-- 1. Cifrado. Ya debería estar instalado, porque n8n lo usa para cifrar los mensajes.
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- 2. try_decrypt(mensaje, claves[]): descifra un mensaje probando cada clave.
--    n8n ya la usa, así que normalmente existe. Solo se crea si falta, para no
--    sustituir la versión que está funcionando.
DO $crear_try_decrypt$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'try_decrypt'
       AND pg_get_function_identity_arguments(p.oid) = 'data bytea, keys text[]'
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION public.try_decrypt(data bytea, keys text[])
      RETURNS text
      LANGUAGE plpgsql
      IMMUTABLE
      AS $body$
      DECLARE
        k text;
      BEGIN
        FOREACH k IN ARRAY keys LOOP
          BEGIN
            RETURN pgp_sym_decrypt(data, k);
          EXCEPTION WHEN OTHERS THEN
            NULL; -- esta clave no vale, se prueba la siguiente
          END;
        END LOOP;
        RETURN '[mensaje no descifrable]';
      END;
      $body$
    $fn$;
  END IF;
END
$crear_try_decrypt$;


-- 3. Tabla donde el panel guarda los análisis semanales (es la única en la que escribe).
CREATE TABLE IF NOT EXISTS public.resumenes_semanales (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  semana_from  timestamptz NOT NULL,
  semana_to    timestamptz NOT NULL,
  stats        jsonb,
  resumen      text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resumenes_semana
  ON public.resumenes_semanales (semana_from, semana_to, created_at DESC);

-- Índice para que el listado del panel vaya rápido. No cambia nada para n8n.
CREATE INDEX IF NOT EXISTS idx_conversaciones_phone_ts
  ON public.conversaciones (phone, "timestamp" DESC);


-- 4. Usuario propio para el panel, con lo mínimo: leer conversaciones y
--    gestionar sus análisis. Quita los dos guiones de cada línea, cambia la
--    contraseña y usa este usuario en DATABASE_URL.
--
-- CREATE ROLE panel_conversaciones LOGIN PASSWORD 'CAMBIA_ESTA_CONTRASEÑA';
-- GRANT CONNECT ON DATABASE unnic TO panel_conversaciones;  -- "unnic" es la base de datos de n8n; cámbialo si es otra
-- GRANT USAGE ON SCHEMA public TO panel_conversaciones;
-- GRANT SELECT ON public.conversaciones TO panel_conversaciones;
-- GRANT SELECT, INSERT, DELETE ON public.resumenes_semanales TO panel_conversaciones;
-- GRANT EXECUTE ON FUNCTION public.try_decrypt(bytea, text[]) TO panel_conversaciones;


-- 5. Comprobación: tienen que salir 'try_decrypt' y 'resumenes_semanales'.
SELECT 'funcion' AS tipo, p.proname AS nombre
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'try_decrypt'
UNION ALL
SELECT 'tabla', tablename
  FROM pg_tables
 WHERE schemaname = 'public' AND tablename = 'resumenes_semanales';
