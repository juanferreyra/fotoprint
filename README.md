# fotoprint

Aplicación web liviana para subir y explorar imágenes en la nube del propio usuario
(Google Drive, Dropbox o Amazon S3), sin almacenamiento permanente en el servidor
y sin recomprimir ni recodificar las imágenes en ningún punto del flujo.

## Estado actual

- [x] Estructura del proyecto
- [x] Registro / login / logout con sesiones (cookie httpOnly + SQLite)
- [x] Conexión OAuth con Dropbox
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
      routes/connections.js # /api/connections (listar/activar/borrar) + OAuth de Dropbox
      services/users.js     # acceso a la tabla users + bcrypt
      services/crypto.js    # cifrado AES-256-GCM de credenciales de nube
      services/connections.js # acceso a la tabla cloud_connections
      services/dropbox.js   # DropboxAuth, intercambio de code/token, cache de access_token en memoria
    data/                    # SQLite en disco (gitignored)
    .env.example
  public/                    # frontend estático, vanilla JS (sin build step)
    index.html               # dashboard (muestra proveedor activo)
    connect.html              # pantalla "Conectar almacenamiento"
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

## Conexión con Dropbox (OAuth)

Ya está implementado el flujo completo:

- `GET /api/connections/dropbox/start`: genera un `state` random (anti-CSRF),
  lo guarda en la sesión y redirige a Dropbox (`token_access_type=offline`
  para pedir `refresh_token`).
- `GET /api/connections/dropbox/callback`: valida el `state`, intercambia el
  `code` por tokens, obtiene el email de la cuenta de Dropbox, cifra y guarda
  el `refresh_token` en `cloud_connections`, y marca la conexión como activa
  (desactivando cualquier otra que el usuario tuviera). Ante cualquier error
  (usuario cancela, `state` inválido/vencido, falla la llamada a Dropbox)
  redirige a `/connect.html?error=...` con un mensaje legible.
- `services/dropbox.js` cachea el `access_token` en memoria del proceso
  (nunca en disco) y lo refresca con el `refresh_token` cuando falta o está
  por vencer (Dropbox los emite con ~4hs de vida).
- Pantalla `/connect.html`: lista Dropbox / Google Drive / S3, botón
  **Conectar** para Dropbox (Google Drive y S3 muestran "Próximamente" hasta
  el siguiente paso), botón **Usar este** para cambiar cuál conexión está
  activa, y **Desconectar** para borrarla.

**Importante — Redirect URI**: la URI de callback que este servidor usa es
`${BASE_URL}/api/connections/dropbox/callback`. Con la configuración por
defecto (`BASE_URL=http://localhost:3000`) tiene que estar agregada
exactamente como `http://localhost:3000/api/connections/dropbox/callback`
en el Dropbox App Console → **Settings** → **OAuth 2** → **Redirect URIs**,
si no Dropbox va a rechazar el login con `redirect_uri_mismatch`.

### Cómo probarlo

1. `cd backend && npm run dev`
2. Iniciar sesión en `http://localhost:3000/login.html`
3. Ir a `http://localhost:3000/connect.html` y click en **Conectar** (Dropbox)
4. Autorizar en la pantalla de Dropbox
5. Deberías volver a `/connect.html?connected=dropbox` con la card de Dropbox
   en estado "Activo" y tu email de Dropbox como `account_label`

Lo único que no pude probar yo mismo end-to-end es el login real contra
`dropbox.com` (necesita tu cuenta de Dropbox en un navegador). Probé con
Playwright y curl todo lo demás: generación de la URL de autorización,
manejo de `state` inválido/vencido, cancelación del usuario, y la UI de
listar/activar/desconectar conexiones (simulando una conexión guardada
directamente en la base).

## Próximo paso

Navegador de archivos de Dropbox: listar carpetas/archivos, crear carpetas,
navegar con breadcrumbs, y después la subida de imágenes sin compresión con
chequeo de integridad de tamaño.
