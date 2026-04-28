# Acceso a API de Conversaciones - Maquina Motors

## URL de acceso

- Documentación Swagger: `https://TU-PROYECTO.vercel.app/docs`
- API Base: `https://TU-PROYECTO.vercel.app`

## Cómo usar la API

### 1. Acceder a la documentación

Abre en tu navegador: `https://TU-PROYECTO.vercel.app/docs`

### 2. Autorizarte

1. En la esquina superior derecha de Swagger, haz clic en el botón **Authorize** (candado).
2. Pega tu clave de acceso (API Key proporcionada por separado).
3. Haz clic en **Authorize** y luego **Close**.

### 3. Probar endpoints

Ya puedes expandir cualquier endpoint y hacer clic en **Try it out** para probarlo.

## Endpoints disponibles

### `GET /api/health`
Estado del servicio (no requiere autenticación).

### `GET /api/conversaciones`
Lista todas las sesiones de conversación.

**Parámetros opcionales:**
- `limit` (número): Máximo de sesiones a devolver (1-200, por defecto 50)
- `offset` (número): Desplazamiento para paginación
- `from` (fecha ISO): Filtra mensajes desde esta fecha (ej: `2026-04-01T00:00:00Z`)
- `to` (fecha ISO): Filtra mensajes hasta esta fecha (ej: `2026-04-30T23:59:59Z`)
- `q` (texto): Busca texto en el contenido de mensajes

**Ejemplo:**
```
GET /api/conversaciones?limit=20&offset=0&from=2026-04-01T00:00:00Z&q=precio
```

### `GET /api/conversaciones/{sessionId}`
Obtiene todos los mensajes de una sesión específica.

**Parámetros opcionales:**
- `from` (fecha ISO): Filtra mensajes desde esta fecha
- `to` (fecha ISO): Filtra mensajes hasta esta fecha

**Ejemplo:**
```
GET /api/conversaciones/abc123?from=2026-04-01T00:00:00Z
```

## Uso programático (curl, Postman, código)

Para usar la API desde tu aplicación, incluye el header de autenticación:

```bash
curl -H "x-api-key: TU_CLAVE_AQUI" "https://TU-PROYECTO.vercel.app/api/conversaciones?limit=10"
```

### Ejemplo en JavaScript

```javascript
const response = await fetch('https://TU-PROYECTO.vercel.app/api/conversaciones', {
  headers: {
    'x-api-key': 'TU_CLAVE_AQUI'
  }
});
const data = await response.json();
console.log(data);
```

### Ejemplo en Python

```python
import requests

headers = {'x-api-key': 'TU_CLAVE_AQUI'}
response = requests.get('https://TU-PROYECTO.vercel.app/api/conversaciones', headers=headers)
data = response.json()
print(data)
```

## Soporte

Para cualquier duda o problema con la API, contacta con: [tu email o contacto]

---

**Importante:** Mantén tu API Key segura y no la compartas públicamente.
