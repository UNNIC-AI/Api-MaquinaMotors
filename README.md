# Panel de conversaciones · Máquina Motors

API y panel web para revisar y auditar las conversaciones del agente de WhatsApp de Máquina Motors.

Lee directamente del Postgres donde n8n guarda las conversaciones (cifradas con `pgp_sym_encrypt`), las descifra en la propia base de datos y las muestra sin exponer las credenciales de la base de datos a quien usa el panel.

## Qué hace

- Listado de conversaciones agrupadas por teléfono, con vista previa del último mensaje del cliente.
- Búsqueda por texto en todos los mensajes o por teléfono (con o sin `+34`, con espacios…).
- Filtros por fechas y paginación.
- Detalle de cada conversación.
- Resumen con IA de una conversación y análisis semanal guardable (opcional, con OpenAI).
- Documentación interactiva de la API en `/docs` (Swagger).
- Acceso con API key, cabeceras de seguridad (Helmet) y límite de 120 peticiones por minuto.

## Instalación en el servidor

Ver [INSTALACION.md](./INSTALACION.md): base de datos, variables, Docker y cómo dejarlo accesible solo por la VPN.

Uso del panel y de la API: [INSTRUCCIONES_CLIENTE.md](./INSTRUCCIONES_CLIENTE.md).

## Desarrollo en local

Requisitos: Node.js 20 o superior y acceso a un Postgres con la tabla `conversaciones` de n8n (o una copia de prueba).

```bash
npm install
cp .env.example .env     # rellena DATABASE_URL, ENCRYPTION_KEY y API_ACCESS_KEY
npm run dev              # http://localhost:3000 · Swagger en /docs
```

La base de datos necesita lo que crea `sql/instalar_panel.sql` (ver INSTALACION.md).

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
sql/
  instalar_panel.sql   Lo que necesita el panel en la base de datos de n8n
Dockerfile
docker-compose.example.yml
```

## Seguridad

- Solo quien tenga `API_ACCESS_KEY` puede leer conversaciones. La clave se compara en tiempo constante y el panel la guarda en `sessionStorage` (se borra al cerrar la pestaña).
- Las credenciales de la base de datos y la clave de cifrado solo están en el servidor.
- El panel debe quedar accesible solo por la red interna o la VPN: muestra datos personales de clientes.
- Con un usuario de base de datos propio (ver `sql/instalar_panel.sql`), el panel solo puede leer `conversaciones` y gestionar `resumenes_semanales`.
