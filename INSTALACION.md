# Instalación del panel de conversaciones

Guía para instalar el panel en el servidor de Máquina Motors, junto al n8n del agente de WhatsApp. El panel lee las conversaciones del mismo Postgres donde las guarda n8n, así que no hay que copiar ni sincronizar datos.

Requisitos:

- Docker con Docker Compose en el servidor.
- Acceso de administrador al Postgres de n8n, para el paso 1.
- La clave con la que n8n cifra los mensajes (es la que usa la función `guardar_conversacion`).

## 1. Preparar la base de datos

Lanza `sql/instalar_panel.sql` sobre la base de datos de n8n con un usuario administrador. Por ejemplo:

```bash
psql "postgres://ADMIN:CONTRASEÑA@HOST:5432/unnic" -f sql/instalar_panel.sql
```

El script se puede lanzar varias veces y **no modifica nada de lo que usa el agente**. Solo:

- comprueba que existe la función `try_decrypt` (n8n ya la tiene; si faltara, la crea);
- crea la tabla `resumenes_semanales`, donde el panel guarda sus análisis;
- añade un índice para que el listado vaya rápido.

Al final muestra una comprobación: tienen que salir `try_decrypt` y `resumenes_semanales`. En vuestra base de datos `unnic` ya existe todo (comprobado el 22-oct-2026), así que el script no creará nada: sirve para confirmarlo y para crear el usuario del panel.

> No lances los otros SQL antiguos que pueda haber en `sql/` (por ejemplo `migracion_desde_n8n.sql`): redefinen funciones del agente y lo romperían.

### Usuario de base de datos para el panel (recomendado)

En el bloque 4 del script hay las líneas para crear un usuario `panel_conversaciones` que solo puede leer las conversaciones y gestionar sus análisis. Quita los `--`, cambia la contraseña y lánzalas con un usuario que pueda crear roles. Usa ese usuario en `DATABASE_URL`, no el administrador.

### Dejar entrar al panel en Postgres

Postgres está instalado directamente en el servidor (versión 14), no en Docker. El contenedor del panel se conecta desde la red de Docker, así que Postgres tiene que aceptarla:

- En `postgresql.conf`, `listen_addresses` tiene que incluir la IP interna (`10.210.19.220`). Ya debería estar así, porque n8n se conecta por ella.
- En `pg_hba.conf`, añade una línea para el usuario del panel desde la red de Docker. Mira su rango con `docker network inspect bridge` (suele ser `172.17.0.0/16`):

  ```
  host  unnic  panel_conversaciones  172.17.0.0/16  scram-sha-256
  ```

  Si usáis `docker compose`, la red del proyecto puede tener otro rango (`docker network inspect <proyecto>_default`).
- Recarga Postgres: `sudo systemctl reload postgresql`.

### La clave de cifrado

Es la que usa n8n en la función `guardar_conversacion`. Un administrador la puede ver así:

```sql
SELECT substring(pg_get_functiondef('public.guardar_conversacion(text,text,text,boolean)'::regprocedure)
                 FROM 'pgp_sym_encrypt\(p_message, ''([^'']+)''');
```

Con esa clave se descifran todos los mensajes que hay ahora (comprobado el 22-oct-2026).

## 2. Configurar

```bash
cp .env.example .env
```

Rellena el `.env`:

| Variable | Qué poner |
|---|---|
| `DATABASE_URL` | `postgres://panel_conversaciones:CONTRASEÑA@10.210.19.220:5432/unnic` (Postgres está en el propio servidor; se usa su IP interna). |
| `ENCRYPTION_KEY` | La clave con la que n8n cifra los mensajes (ver "La clave de cifrado" en el paso 1). |
| `API_ACCESS_KEY` | La clave para entrar al panel. Genera una larga: `openssl rand -hex 32`. |
| `OPENAI_API_KEY` | Opcional. Solo si queréis los resúmenes con IA. **Activarlo envía el texto de las conversaciones a OpenAI.** Si se deja vacío, el panel funciona igual y solo fallan los botones de resumen. |
| `TRUST_PROXY` | Pon `1` si el panel queda detrás de un proxy inverso (nginx, Traefik…). |

El `.env` contiene secretos: no lo subáis a ningún repositorio y dejadlo legible solo por quien administre el servidor (`chmod 600 .env`).

## 3. Arrancar

```bash
cp docker-compose.example.yml docker-compose.yml
docker compose up -d --build
```

En `docker-compose.yml` revisa la línea de `ports`. Por defecto publica el panel solo en la IP interna del servidor (`10.210.19.220:3000`), es decir, **accesible únicamente por la VPN**, igual que el editor de n8n. El panel muestra conversaciones de clientes: no lo publiquéis en internet.

Comprueba que está bien:

```bash
docker compose ps                          # tiene que salir "healthy"
curl http://10.210.19.220:3000/api/health  # {"ok":true,...,"database":"ok"}
```

Si sale `"database":"sin conexión"`, mira el log con `docker compose logs panel-conversaciones`:

- `no pg_hba.conf entry for host "172.x.x.x"`: falta la línea de `pg_hba.conf` del paso 1 (con ese rango).
- `password authentication failed`: usuario o contraseña de `DATABASE_URL`.
- `ECONNREFUSED` o `timeout`: Postgres no escucha en la IP interna (`listen_addresses`) o hay un cortafuegos entre Docker y Postgres.

## 4. Usar

- Panel: `http://10.210.19.220:3000` (con la VPN conectada). Pide la `API_ACCESS_KEY`.
- Documentación de la API: `http://10.210.19.220:3000/docs`.

Cómo se usa el panel y la API: `INSTRUCCIONES_CLIENTE.md`.

## Actualizar a una versión nueva

```bash
git pull
docker compose up -d --build
```

## Cambiar la clave del panel

Cambia `API_ACCESS_KEY` en el `.env` y reinicia: `docker compose up -d`. Quien tenga la clave antigua dejará de poder entrar.
