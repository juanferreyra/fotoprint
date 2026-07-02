# fotoprint

Aplicación web liviana para subir y explorar imágenes en la nube del propio usuario
(Google Drive, Dropbox o Amazon S3), sin almacenamiento permanente en el servidor
y sin recomprimir ni recodificar las imágenes en ningún punto del flujo.

## Estado actual

- [x] Estructura del proyecto
- [x] Registro / login / logout con sesiones (cookie httpOnly + SQLite)
- [x] Conexión OAuth con Dropbox
- [x] Navegador de archivos (Dropbox)
- [x] Subida de imágenes sin compresión + chequeo de integridad (Dropbox)
- [x] Conexión OAuth + navegador de archivos + subida (Google Drive)
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
      routes/connections.js # /api/connections (listar/activar/borrar) + OAuth de Dropbox y Google Drive
      routes/files.js       # /api/files, /api/files/folders, /api/files/upload
                             # (generico: despacha a services/dropbox.js o services/googleDrive.js
                             # segun cual sea el proveedor activo del usuario)
      services/users.js     # acceso a la tabla users + bcrypt
      services/crypto.js    # cifrado AES-256-GCM de credenciales de nube
      services/connections.js # acceso a la tabla cloud_connections
      services/dropbox.js   # DropboxAuth, cache de access_token, listFolder/createFolder/uploadFile,
                             # mapeo de errores del SDK a mensajes legibles
      services/googleDrive.js # OAuth2 (googleapis), Drive API v3, misma interfaz que dropbox.js
    data/                    # SQLite en disco (gitignored)
    .env.example
  public/                    # frontend estático, vanilla JS (sin build step)
    index.html               # navegador de archivos (o mensaje "conectar" si no hay proveedor activo)
    connect.html              # pantalla "Conectar almacenamiento"
    login.html
    register.html
    css/style.css
    js/api.js                # helper fetch con manejo de errores
    js/explorer.js            # logica del navegador de archivos (breadcrumbs, listar, crear carpeta)
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
- **Multi-proveedor (Dropbox / Google Drive / S3)**: `routes/files.js` no sabe
  nada de Dropbox ni de Drive puntualmente — despacha según
  `connection.provider` a un módulo de `services/` que implementa siempre la
  misma interfaz (`listFolder`, `createFolder`, `uploadFile`, `deleteFile`).
  La API HTTP usa un `ref` opaco por proveedor en vez de un path real: para
  Dropbox el `ref` es literalmente el path (`/Fotos/Playa`), para Drive es el
  `id` del archivo/carpeta (Drive no tiene paths reales — un mismo nombre de
  carpeta puede repetirse, así que solo el `id` identifica un recurso sin
  ambigüedad). La raíz siempre es `ref = ''`.
  El frontend (`js/explorer.js`) tampoco parsea el `ref` como un path: arma
  el breadcrumb como una pila `{ref, name}` en el cliente a medida que el
  usuario entra/sale de carpetas, lo que funciona igual sin importar si el
  `ref` es un path o un id opaco.

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

## Navegador de archivos y subida (Dropbox y Google Drive)

La API es la misma para cualquier proveedor conectado — `routes/files.js`
despacha internamente según `connection.provider`:

- `GET /api/files?parent=<ref>`: lista carpetas y archivos dentro de `parent`
  (`ref` vacío o ausente = raíz). Pagina automáticamente (2000 entradas tope).
- `POST /api/files/folders` (`{ parent, name }`): crea una carpeta dentro de
  `parent`. Valida que `name` no esté vacío, no tenga `/` ni `\`, y no supere
  255 caracteres.
- `POST /api/files/upload` (`multipart/form-data`, campos `parent` y `file`):
  recibe el archivo con `multer` en memoria (nunca se escribe a disco) y
  manda el buffer tal cual al SDK del proveedor — no hay ninguna librería de
  procesamiento de imágenes en el pipeline. Límite de 150MB por archivo
  (devuelve 413 si se supera). **Chequeo de integridad**: se compara el
  `size` que el proveedor confirma haber guardado contra el tamaño del
  archivo original; si no coinciden, se borra el archivo recién subido y se
  devuelve un error pidiendo reintentar — nunca se deja un archivo "creído
  subido" pero corrupto en la nube del usuario.
- Cada proveedor traduce sus propios errores (token vencido, carpeta
  inexistente, nombre duplicado, rate limit, sin espacio, archivo muy
  grande) a mensajes en español con el HTTP status correspondiente
  (`toFriendlyError` en `services/dropbox.js` / `services/googleDrive.js`).
  Un 401 invalida el `access_token` cacheado para forzar un refresh en el
  próximo pedido.
- Frontend (`index.html` + `js/explorer.js`): breadcrumb clickeable (pila
  `{ref, name}` armada en el cliente, no parsea el `ref` como path), ícono
  de carpeta / ícono genérico de imagen (por extensión) / ícono genérico de
  archivo — sin pedir thumbnails a la API para mantenerlo liviano —, tamaño
  formateado (B/KB/MB/GB), botón **Nueva carpeta**, zona de **drag & drop**
  + selector de archivo con barra de progreso real por archivo (vía
  `XMLHttpRequest.upload.onprogress`, ya que `fetch` no expone progreso de
  subida). El folder actual queda reflejado en la URL (`?parent=...`) para
  poder refrescar sin perder del todo la ubicación (se reconstruye un
  breadcrumb de 2 niveles: raíz + carpeta actual).

**Nota sobre las pruebas de este paso**: el entorno donde yo corro no tiene
salida de red hacia `api.dropboxapi.com` ni `www.googleapis.com` (política
de egress del sandbox), así que no pude probar un listado/subida real y
exitoso contra ninguno de los dos proveedores desde acá. Sí probé, con curl
y Playwright, para ambos proveedores:
- Validaciones de `parent`/`name` (nombres con `/`, vacíos, path traversal,
  archivo de 150MB+ devolviendo 413).
- El manejo de errores end-to-end contra las APIs reales (con un
  `refresh_token` inválido, para ambos proveedores) para confirmar que los
  errores se traducen a JSON legible y no explotan como 500 genérico.
- El renderizado completo del explorador (breadcrumbs multi-nivel con
  `ref` opacos tipo id de Drive, íconos, tamaños, navegación ida y vuelta,
  alta de carpeta, subida con progreso, reload tras refrescar la página)
  simulando las respuestas de `/api/files` con datos de prueba vía
  interceptación de red en Playwright.

Como vos ya tenés Dropbox funcionando en tu máquina, para probarlo de punta
a punta: `cd backend && npm run dev`, entrá a `http://localhost:3000/index.html`
logueado, y deberías ver las carpetas/archivos reales. Fijate en particular
que la navegación entre carpetas y "Nueva carpeta" sigan funcionando igual
que antes (este paso tocó el contrato interno de la API, aunque el
comportamiento visible no debería haber cambiado).

## Conexión con Google Drive (OAuth)

Mismo patrón que Dropbox, con `services/googleDrive.js` (usa `googleapis`):

- `GET /api/connections/google_drive/start` → redirige a Google
  (`access_type=offline`, `prompt=consent` para garantizar que siempre
  devuelva `refresh_token`, incluso en reconexiones).
- `GET /api/connections/google_drive/callback` → valida `state`, intercambia
  el `code`, obtiene el email de la cuenta (`oauth2.userinfo.get`), cifra y
  guarda el `refresh_token`, marca la conexión como activa. Si Google no
  manda `refresh_token` (puede pasar si el usuario ya había autorizado antes
  sin `prompt=consent`), se lo avisa con un mensaje pidiendo revocar el
  acceso en `myaccount.google.com/permissions` y reintentar.
- Scope usado: `https://www.googleapis.com/auth/drive` (acceso completo a
  Drive). Es necesario para poder navegar carpetas/archivos que el usuario
  ya tenía antes de conectar la app — el scope restringido `drive.file`
  solo deja ver archivos creados por la propia app, lo cual no cumple con
  "ver el explorador de archivos que ya existen en su nube conectada".
- `google-auth-library` refresca el `access_token` automáticamente; lo
  cacheamos en memoria del proceso (evento `'tokens'` del `OAuth2Client`)
  para no pagar una llamada de refresh en cada request.

### Cómo crear el OAuth Client en Google Cloud (necesito estas credenciales)

1. Entrá a https://console.cloud.google.com/ y creá un proyecto (o usá uno
   existente).
2. **APIs & Services → Library**: buscá "Google Drive API" y clickeá
   **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - **User Type**: `External` (a menos que tengas Google Workspace).
   - Completá nombre de la app, email de soporte, etc.
   - **Scopes**: agregá `.../auth/drive` y `.../auth/userinfo.email`.
   - **Test users**: agregá tu propia cuenta de Gmail. Mientras la app esté
     en modo "Testing" (no verificada por Google), **solo** las cuentas que
     agregues acá van a poder conectarse — para desarrollo/uso personal esto
     alcanza y evita el proceso de verificación de Google (que aplica para
     apps públicas con scopes sensibles como `drive` completo).
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - **Application type**: `Web application`.
   - **Authorized redirect URIs**: agregá exactamente
     `http://localhost:3000/api/connections/google_drive/callback`
     (o el equivalente si cambiaste `BASE_URL`).
5. Copiá el **Client ID** y el **Client Secret**, y cargalos en
   `backend/.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) — nunca se
   commitean al repo.

### Cómo probarlo

1. `cd backend && npm run dev`
2. Logueado, andá a `http://localhost:3000/connect.html`
3. Click en **Conectar** (Google Drive), autorizá con la cuenta de Gmail que
   agregaste como test user
4. Deberías volver a `/connect.html?connected=google_drive` con la card en
   estado "Activo" y tu email de Gmail como `account_label`
5. Andá a `http://localhost:3000/index.html` — deberías ver el navegador de
   archivos apuntando a "Mi Drive" con tus carpetas/archivos reales

Al igual que con Dropbox, no pude probar el login real contra
`accounts.google.com` desde este sandbox (sin salida de red). Sí probé con
curl: que `/start` arma la URL de autorización con los parámetros correctos
(`scope`, `access_type=offline`, `prompt=consent`, `redirect_uri`), y el
manejo de `state` inválido/cancelación de usuario. Con Playwright probé que
el botón "Conectar" ya aparece habilitado en `/connect.html` para Google
Drive (dejó de mostrar "Próximamente").

## Próximo paso

Sumar Amazon S3, que a diferencia de Dropbox/Drive no usa OAuth sino un
formulario de credenciales (access key, secret key, bucket, región) — va a
necesitar una pantalla distinta en `connect.html` para cargar esos datos en
vez de un botón "Conectar" que redirige. La lógica de `routes/files.js` no
debería necesitar cambios: solo hace falta un `services/s3.js` que
implemente la misma interfaz (`listFolder`, `createFolder`, `uploadFile`,
`deleteFile`) usando `@aws-sdk/client-s3`, sabiendo que S3 tampoco tiene
carpetas reales — se simulan con objetos "carpeta" que terminan en `/` o
inferencia por prefijo de key.
