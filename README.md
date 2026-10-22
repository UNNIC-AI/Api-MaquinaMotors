# Panel de conversaciones · Máquina Motors

API y panel web para revisar y auditar las conversaciones del agente de WhatsApp de Máquina Motors.

Lee directamente del Postgres donde n8n guarda las conversaciones (cifradas con `pgp_sym_encrypt`), las descifra en la propia base de datos y las muestra sin exponer las credenciales de la base de datos a quien usa el panel.

Este es el repositorio del **código**. Al cliente no se le entrega: se le entrega un build minificado (ver "Generar el entregable") que se instala con el repositorio **maquinamotors_deploy**, donde está la guía de instalación y la de uso.

## Qué hace

- Listado de conversaciones agrupadas por teléfono, con vista previa del último mensaje del cliente y "Cargar más".
- Búsqueda por texto en todos los mensajes o por teléfono (con o sin `+34`, con espacios…).
- Filtros por fechas (en la hora local del navegador) y detalle de cada conversación completa.
- Resumen con IA de los últimos mensajes de una conversación y análisis semanal guardable (opcional, con OpenAI).
- Documentación interactiva de la API en `/docs` (Swagger).
- Acceso con API key, cabeceras de seguridad (Helmet) y límite de 120 peticiones por minuto.

## Desarrollo en local

Requisitos: Node.js 20 o superior y acceso a un Postgres con la tabla `conversaciones` de n8n (o una copia de prueba).

```bash
npm install
cp .env.example .env     # rellena DATABASE_URL, ENCRYPTION_KEY y API_ACCESS_KEY
npm run dev              # http://localhost:3000 · Swagger en /docs
```

La base de datos necesita la tabla `conversaciones` de n8n, la función `try_decrypt(bytea, text[])` y la tabla `resumenes_semanales` (en la base de datos de Máquina Motors ya existen).

## Generar el entregable

```bash
npm run release          # → release/panel-maquinamotors-<versión>.zip
```

Genera `dist/` y lo comprime. Dentro va:

- `src/server.js`: el servidor (`src/*.js`) empaquetado en un solo fichero y minificado, sin comentarios.
- `src/swagger.json`: la documentación de la API, generada en el build (los comentarios `@openapi` no sobreviven al minificado).
- `public/`: el panel con el JS y el CSS minificados.
- `package.json`, `package-lock.json`, `Dockerfile`: para que Docker instale las dependencias y lo arranque.

Antes de una entrega nueva, sube `version` en `package.json` para que el zip lleve otro número. `npm run build` genera solo `dist/`, sin comprimir.

## Variables de entorno

| Variable | Obligatoria | Para qué |
|---|---|---|
| `DATABASE_URL` | Sí | Conexión al Postgres de n8n. |
| `ENCRYPTION_KEY` | Sí | Clave (o claves separadas por comas) con la que n8n cifra los mensajes. |
| `API_ACCESS_KEY` | Sí | Clave para entrar al panel y usar la API. |
| `DATABASE_SSL` | No | `true` si Postgres exige conexión cifrada. |
| `DATABASE_POOL_MAX` | No | Conexiones simultáneas a Postgres (por defecto 5). |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL` | No | Resúmenes con IA. Envía el texto de las conversaciones a OpenAI. |
| `CORS_ORIGINS` | No | Solo si otra web distinta del panel llama a la API. |
| `TRUST_PROXY` | No | `1` detrás de un proxy inverso. |
| `PORT`, `NODE_ENV` | No | Puerto (3000) y modo. En `production` no se devuelven al navegador los detalles de los errores de Postgres. |

## Estructura

```
src/
  app.js      API (Express) y consultas
  db.js       Conexión a Postgres
  server.js   Arranque
public/       Panel web (HTML, CSS y JS sin dependencias)
scripts/
  build.js    Genera dist/ (build minificado)
  release.js  Genera el zip del entregable
Dockerfile    El mismo para desarrollo y para el build
```

## Seguridad

- Solo quien tenga `API_ACCESS_KEY` puede leer conversaciones. La clave se compara en tiempo constante y el panel la guarda en `sessionStorage` (se borra al cerrar la pestaña).
- Las credenciales de la base de datos y la clave de cifrado solo están en el servidor.
- El panel debe quedar accesible solo por la red interna o la VPN: muestra datos personales de clientes.
- Con un usuario de base de datos propio (ver la guía de maquinamotors_deploy), el panel solo puede leer `conversaciones` y gestionar `resumenes_semanales`.
