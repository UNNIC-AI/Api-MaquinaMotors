# API Maquina Motors

API REST para consultar conversaciones del agente comercial de manera segura, sin exponer credenciales de base de datos.

## 🚀 Características

- Listado de conversaciones agrupadas por teléfono
- Detalle completo de mensajes por conversación
- Filtros por fecha y búsqueda de texto
- Autenticación segura con API key
- Documentación interactiva con Swagger
- Rate limiting y seguridad CORS

## 📋 Requisitos

- Node.js 20+
- Cuenta de Supabase con tabla `conversaciones`

## 🔧 Instalación

```bash
# Clonar repositorio
git clone https://github.com/TU-USUARIO/Api-MaquinaMotors.git
cd Api-MaquinaMotors

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Edita .env con tus credenciales
```

## ⚙️ Configuración

Completa el archivo `.env` con:

```env
PORT=3000
SUPABASE_URL=tu_url_de_supabase
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
API_ACCESS_KEY=genera_una_clave_segura
CORS_ORIGINS=http://localhost:3000

# Opcional: para endpoint de resumen con IA
OPENAI_API_KEY=sk-tu-clave-openai
OPENAI_MODEL=gpt-4o-mini
```

## 🏃 Ejecución

```bash
# Desarrollo (con hot reload)
npm run dev

# Producción
npm start
```

La API estará disponible en `http://localhost:3000`

## 📚 Documentación

Accede a Swagger UI en: `http://localhost:3000/docs`

### Endpoints principales

#### `GET /api/health`
Estado del servicio (público)

#### `GET /api/conversaciones`
Lista conversaciones agrupadas por teléfono

**Parámetros opcionales:**
- `limit` - Máximo de resultados (1-200, default: 50)
- `offset` - Desplazamiento para paginación
- `from` - Fecha inicio (ISO 8601)
- `to` - Fecha fin (ISO 8601)
- `q` - Búsqueda de texto

**Ejemplo:**
```bash
curl -H "x-api-key: TU_CLAVE" \
  "http://localhost:3000/api/conversaciones?limit=20&q=precio"
```

#### `GET /api/conversaciones/:phone`
Detalle de mensajes de un teléfono específico

**Parámetros opcionales:**
- `from` - Fecha inicio
- `to` - Fecha fin

**Ejemplo:**
```bash
curl -H "x-api-key: TU_CLAVE" \
  "http://localhost:3000/api/conversaciones/34612345678"
```

#### `POST /api/conversaciones/:phone/resumen`
Genera un resumen automático de la conversación con IA

**Body opcional (JSON):**
```json
{
  "from": "2026-04-01T00:00:00Z",
  "to": "2026-04-30T23:59:59Z",
  "max_messages": 100
}
```

**Ejemplos:**

Sin body (usa defaults, trae últimos 100 mensajes):
```bash
curl -X POST \
  -H "x-api-key: TU_CLAVE" \
  -H "Content-Type: application/json" \
  -d '{}' \
  "http://localhost:3000/api/conversaciones/34612345678/resumen"
```

Con parámetros en el body:
```bash
curl -X POST \
  -H "x-api-key: TU_CLAVE" \
  -H "Content-Type: application/json" \
  -d '{"max_messages": 50}' \
  "http://localhost:3000/api/conversaciones/34612345678/resumen"
```

O con query string (sin body):
```bash
curl -X POST \
  -H "x-api-key: TU_CLAVE" \
  "http://localhost:3000/api/conversaciones/34612345678/resumen?max_messages=50"
```

**Nota:** Requiere `OPENAI_API_KEY` configurada en variables de entorno.

## 🔐 Autenticación

Todos los endpoints (excepto `/api/health`) requieren el header:

```http
x-api-key: TU_API_ACCESS_KEY
```

En Swagger, usa el botón **Authorize** para configurar tu clave.

## 🚢 Deploy en Vercel

1. Importa el proyecto en [Vercel](https://vercel.com)
2. Configura las variables de entorno
3. Deploy automático

Ver guía completa en [DEPLOY_VERCEL.md](./DEPLOY_VERCEL.md)

## 📁 Estructura del proyecto

```
Api-MaquinaMotors/
├── api/
│   └── index.js          # Entry point serverless (Vercel)
├── src/
│   ├── app.js            # Configuración de Express
│   └── server.js         # Servidor local
├── .env.example          # Template de variables
├── vercel.json           # Config de Vercel
└── package.json
```

## 🛡️ Seguridad

- ✅ Helmet para headers seguros
- ✅ Rate limiting (120 req/min)
- ✅ CORS configurable
- ✅ API key en servidor (nunca expuesta)
- ✅ Validación de parámetros

## 📝 Licencia

ISC

## 🤝 Soporte

Para dudas o problemas, abre un issue en este repositorio.

---

**Importante:** Nunca compartas tu `SUPABASE_SERVICE_ROLE_KEY` públicamente. Solo comparte `API_ACCESS_KEY` con clientes autorizados.
