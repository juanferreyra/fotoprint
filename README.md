# fotoprint

Aplicación web liviana para subir y explorar imágenes en la nube del propio usuario
(Google Drive, Dropbox o Amazon S3), sin almacenamiento permanente en el servidor
y sin recomprimir ni recodificar las imágenes en ningún punto del flujo.

## Estado actual

- [x] Estructura del proyecto
- [x] Registro / login / logout con sesiones (cookie httpOnly + SQLite)
- [ ] Conexión OAuth con Dropbox
- [ ] Navegador de archivos (Dropbox)
- [ ] Subida de imágenes sin compresión + chequeo de integridad (Dropbox)
- [ ] Google Drive
- [ ] Amazon S3

## Arquitectura

```
fotoprint/
  backend/
    src/
      index.js            # entrypoint Express: sesiones, estáticos, rutas
      config.js            # carga y valida variables de entorno
      db.js                 # conexión SQLite (better-sqlite3) + migración de schema
      db/schema.sql         # definición de tablas
      middleware/auth.js    # requireAuth (guard de sesión)
      routes/auth.js        # /api/auth/register, /login, /logout, /me
      services/users.js     # acceso a la tabla users + bcrypt
      services/crypto.js    # cifrado AES-256-GCM de credenciales de nube
    data/                    # SQLite en disco (gitignored)
    .env.example
  public/                    # frontend estático, vanilla JS (sin build step)
    index.html               # dashboard (placeholder de explorador de archivos)
    login.html
    register.html
    css/style.css
    js/api.js                # helper fetch con manejo de errores
```

### Decisiones de arquitectura

- **Backend**: Node.js + Express. Un solo proceso, sin build step.
- **Frontend**: HTML + JS vanilla (ES modules), servido como estático por Express
  desde `public/`. Sin bundler ni framework, para mantener el proyecto liviano.
- **Autenticación**: sesiones de servidor (`express-session`) con cookie
  `httpOnly`, `sameSite=lax` y `secure` cuando `BASE_URL` es https. La sesión se
  persiste en la misma base SQLite (tabla `sessions`, creada automáticamente por
  `better-sqlite3-session-store`). Se eligió por sobre JWT porque frontend y
  backend viven en el mismo origen y evita el riesgo de robo de token vía XSS.
- **Base de datos**: SQLite vía `better-sqlite3` (síncrono, sin overhead de
  proceso aparte). Tablas: `users` y `cloud_connections` (una fila por
  proveedor configurado por usuario; `is_active` marca cuál se usa).
- **Credenciales de nube**: se guardan cifradas con AES-256-GCM
  (`TOKEN_ENCRYPTION_KEY`) antes de escribirse en `cloud_connections.encrypted_credentials`.
  Nunca se guardan en texto plano ni se loguean.
- **Subida de imágenes**: se van a recibir con `multer` en memoria (buffer en
  RAM, nunca se escribe a disco) y se van a mandar tal cual al SDK del
  proveedor. No hay ninguna librería de procesamiento de imágenes (sharp, jimp,
  canvas) en el proyecto.

## Cómo correr el backend localmente

```bash
cd backend
cp .env.example .env
# completar SESSION_SECRET y TOKEN_ENCRYPTION_KEY:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# (correr dos veces, una para cada variable)

npm install
npm run dev   # o: npm start
```

El servidor sirve el frontend estático y la API en `http://localhost:3000`.

## Próximo paso: crear una app de Dropbox para probar OAuth

Para el siguiente paso (conectar Dropbox) hace falta una app registrada en el
Dropbox App Console. Pasos:

1. Entrar a https://www.dropbox.com/developers/apps y crear una cuenta de
   desarrollador si no tenés una.
2. **Create app**:
   - **Choose an API**: `Scoped access`
   - **Access type**: `App folder` (la app solo ve una carpeta propia dentro de
     `Apps/`, más simple y seguro para probar) o `Full Dropbox` si querés que
     el usuario navegue todo su Dropbox. Para el explorador de archivos que
     describiste (navegar carpetas existentes) conviene `Full Dropbox`.
   - **Name**: cualquiera, ej. `fotoprint-dev`.
3. En la pestaña **Permissions** de la app, activar (mínimo):
   - `files.metadata.read`
   - `files.metadata.write` (para crear carpetas)
   - `files.content.read`
   - `files.content.write`
   - Guardar (`Submit`).
4. En la pestaña **Settings**:
   - Copiar **App key** y **App secret**.
   - En **OAuth 2** → **Redirect URIs**, agregar la URL de callback que vamos a
     usar, por ejemplo `http://localhost:3000/api/connections/dropbox/callback`
     (se define en el siguiente paso de implementación).
5. Pasarme el **App key** y **App secret** para cargarlos en
   `backend/.env` (`DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`) — nunca se
   commitean al repo.

Con eso puedo implementar y probar el flujo de conexión OAuth de punta a
punta en el siguiente paso.
