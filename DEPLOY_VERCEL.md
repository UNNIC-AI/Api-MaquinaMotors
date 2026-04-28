# Checklist de Deploy en Vercel

## ✅ Archivos preparados

- `src/app.js` - Lógica de Express exportable
- `api/index.js` - Entry point serverless para Vercel
- `src/server.js` - Para desarrollo local (npm run dev)
- `vercel.json` - Configuración de Vercel
- `.gitignore` - Actualizado con `.vercel`
- `README.md` - Instrucciones completas
- `INSTRUCCIONES_CLIENTE.md` - Para compartir con tu cliente

## 📋 Pasos para deploy

### 1. Preparar repositorio Git

```bash
cd Api-MaquinaMotors

# Si aún no has inicializado git:
git init

# Si ya existe el repo remoto, úsalo; si no, créalo en GitHub primero
git add .
git commit -m "Preparar API para deploy en Vercel"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/Api-MaquinaMotors.git
git push -u origin main
```

### 2. Deploy en Vercel

1. Ve a [vercel.com](https://vercel.com)
2. Haz login con GitHub
3. Click en **Add New** → **Project**
4. Importa el repositorio `Api-MaquinaMotors`
5. Configuración:
   - **Framework Preset:** Other
   - **Root Directory:** `./` (dejar por defecto)
   - **Build Command:** `npm install` (automático)
   - **Output Directory:** dejar vacío
6. **Environment Variables** (añade estas):
   ```
   SUPABASE_URL=https://auawoixxesloqgdilxeq.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key_real
   API_ACCESS_KEY=genera_una_clave_larga_aleatoria
   CORS_ORIGINS=https://dominio-cliente.com (opcional)
   ```
7. Click en **Deploy**

### 3. Verificar deploy

Una vez completado:
- URL de producción: `https://tu-proyecto.vercel.app`
- Prueba: `https://tu-proyecto.vercel.app/api/health`
- Swagger: `https://tu-proyecto.vercel.app/docs`

### 4. Compartir con cliente

1. Genera una `API_ACCESS_KEY` segura (ej: usando `openssl rand -hex 32`)
2. Edita `INSTRUCCIONES_CLIENTE.md`:
   - Reemplaza `TU-PROYECTO.vercel.app` con tu URL real
   - Añade tu contacto
3. Envía al cliente:
   - `INSTRUCCIONES_CLIENTE.md`
   - Su `API_ACCESS_KEY` por canal seguro (Slack, email cifrado, etc)

## 🔧 Comandos útiles

### Local
```bash
npm run dev    # Desarrollo con hot reload
npm start      # Producción local
```

### Actualizar en Vercel
```bash
git add .
git commit -m "Actualización de API"
git push
# Vercel hace deploy automático
```

## 🔐 Seguridad

- ✅ `SUPABASE_SERVICE_ROLE_KEY` solo en variables de entorno de Vercel
- ✅ `.env` en `.gitignore` (nunca subir al repo)
- ✅ `API_ACCESS_KEY` compartida solo con cliente autorizado
- ✅ CORS configurado si es necesario
- ✅ Rate limiting activado (120 req/min)

## 📊 Monitoreo

En el panel de Vercel puedes ver:
- Logs en tiempo real
- Métricas de uso
- Errores
- Variables de entorno

## 🚀 Siguiente nivel (opcional)

- Añadir dominio personalizado en Vercel
- Implementar JWT en lugar de API key simple
- Añadir logs estructurados (Winston, Pino)
- Métricas con Vercel Analytics
