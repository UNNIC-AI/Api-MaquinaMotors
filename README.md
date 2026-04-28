# API Maquina Motors

API para exponer conversaciones del agente almacenadas en Supabase sin compartir la API key de base de datos con clientes externos.

## Requisitos

- Node.js 20+
- Tabla `conversaciones` en Supabase con columnas:
  - `session_id`
  - `timestamp`
  - `message`
  - `role`

## Configuracion local

1. Copia variables:

```bash
cp .env.example .env
```

2. Completa en `.env`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `API_ACCESS_KEY` (clave que compartiras con tu cliente para consumir esta API)

## Ejecucion local

```bash
npm install
npm run dev
```

API: `http://localhost:3000`  
Swagger: `http://localhost:3000/docs`

## Deploy en Vercel

### 1. Sube el proyecto a GitHub

```bash
git init
git add .
git commit -m "Initial commit - API Maquina Motors"
git remote add origin https://github.com/TU-USUARIO/Api-MaquinaMotors.git
git push -u origin main
```

### 2. Importa en Vercel

1. Ve a [vercel.com](https://vercel.com) y conecta con GitHub.
2. Importa el repositorio `Api-MaquinaMotors`.
3. Framework Preset: **Other**
4. No cambies Build/Install Commands (usa defaults).

### 3. Configura Variables de Entorno

En el panel de Vercel (Settings → Environment Variables), añade:

- `SUPABASE_URL` → tu URL de Supabase
- `SUPABASE_SERVICE_ROLE_KEY` → tu service role key (NUNCA la compartas con cliente)
- `API_ACCESS_KEY` → clave larga y aleatoria que darás al cliente
- `CORS_ORIGINS` (opcional) → `https://dominio-cliente.com`

### 4. Deploy

Haz clic en **Deploy** y espera a que termine.

Tu API estará disponible en:
- `https://tu-proyecto.vercel.app/docs`
- `https://tu-proyecto.vercel.app/api/conversaciones`

### 5. Acceso para tu cliente

Comparte con tu cliente:
- URL: `https://tu-proyecto.vercel.app/docs`
- Instrucciones:
  1. Abre `/docs`
  2. Clic en botón **Authorize**
  3. Pega tu `API_ACCESS_KEY`
  4. Ya puede probar endpoints

## Autenticacion

Todos los endpoints de `/api/*` (excepto `GET /api/health`) requieren header:

```http
x-api-key: <API_ACCESS_KEY>
```

En Swagger, usa el boton **Authorize** para cargar tu `x-api-key` y probar endpoints protegidos.

## Endpoints

- `GET /api/health`
- `GET /api/conversaciones?limit=50&offset=0`
- `GET /api/conversaciones/:sessionId`

## Filtros y busqueda

### Listado de conversaciones

`GET /api/conversaciones`

Query params disponibles:
- `limit` y `offset` para paginacion
- `from` y `to` en formato ISO 8601 para filtrar por fecha
- `q` para buscar texto en previews de mensajes humanos

Ejemplo:

```bash
curl -H "x-api-key: <API_ACCESS_KEY>" "http://localhost:3000/api/conversaciones?limit=20&offset=0&from=2026-04-01T00:00:00Z&to=2026-04-30T23:59:59Z&q=precio"
```

### Detalle de una sesion

`GET /api/conversaciones/:sessionId`

Tambien admite:
- `from`
- `to`

Ejemplo:

```bash
curl -H "x-api-key: <API_ACCESS_KEY>" "http://localhost:3000/api/conversaciones/SESSION_ID?from=2026-04-01T00:00:00Z&to=2026-04-30T23:59:59Z"
```
