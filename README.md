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
      routes/files.js       # /api/files (listar) y /api/files/folders (crear carpeta)
      services/users.js     # acceso a la tabla users + bcrypt
      services/crypto.js    # cifrado AES-256-GCM de credenciales de nube
      services/connections.js # acceso a la tabla cloud_connections
      services/dropbox.js   # DropboxAuth, cache de access_token, listFolder/createFolder,
                             # mapeo de errores del SDK a mensajes legibles
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

## Navegador de archivos (Dropbox)

- `GET /api/files?path=/Carpeta`: lista carpetas y archivos de esa ruta
  (`path` vacío o ausente = raíz de Dropbox). Pagina automáticamente con
  `filesListFolderContinue` hasta 2000 entradas.
- `POST /api/files/folders` (`{ path, name }`): crea una carpeta dentro de
  `path`. Valida que `name` no esté vacío, no tenga `/` ni `\`, y no supere
  255 caracteres.
- Los errores del SDK de Dropbox (token vencido, carpeta inexistente, nombre
  duplicado, rate limit, sin espacio) se traducen a mensajes en español con
  el HTTP status correspondiente en `services/dropbox.js` (`toFriendlyError`).
  Un 401 de Dropbox invalida el `access_token` cacheado para forzar un
  refresh en el próximo pedido.
- Frontend (`index.html` + `js/explorer.js`): breadcrumb clickeable, listado
  con ícono de carpeta / ícono genérico de imagen (por extensión) / ícono
  genérico de archivo — sin pedir thumbnails a la API para mantenerlo
  liviano —, tamaño formateado (B/KB/MB/GB), botón **Nueva carpeta** con
  formulario inline, y estado vacío cuando la carpeta no tiene contenido.
  El path actual queda reflejado en la URL (`?path=...`) para poder
  refrescar sin perder la ubicación.

**Nota sobre las pruebas de este paso**: el entorno donde yo corro no tiene
salida de red hacia `api.dropboxapi.com` (política de egress del sandbox),
así que no pude probar una llamada real y exitosa a la API de Dropbox desde
acá. Sí probé, con curl y Playwright:
- Validaciones de `path` y `name` (nombres con `/`, vacíos, path traversal).
- El manejo de errores end-to-end contra la Dropbox API real (con un
  `refresh_token` inválido) para confirmar que los errores se traducen a
  JSON legible y no explotan como 500 genérico.
- El renderizado completo del explorador (breadcrumbs, íconos, tamaños,
  navegación ida y vuelta, alta de carpeta) simulando las respuestas de
  `/api/files` con datos de prueba vía interceptación de red en Playwright.

Como vos ya tenés la conexión real funcionando en tu máquina, para probarlo
de punta a punta: `cd backend && npm run dev`, entrá a
`http://localhost:3000/index.html` logueado, y deberías ver las
carpetas/archivos reales de tu Dropbox. Contame si ves algo raro (por
ejemplo, carpetas con muchísimos archivos, nombres con caracteres
especiales, etc.).

## Subida de imágenes (Dropbox)

- `POST /api/files/upload` (`multipart/form-data`, campos `path` y `file`):
  recibe el archivo con `multer` en memoria (`memoryStorage`, nunca se
  escribe a disco) y manda el buffer tal cual al SDK de Dropbox
  (`filesUpload`) — no hay ninguna libreria de procesamiento de imagenes en
  el pipeline, el binario que llega a Dropbox es identico al que subio el
  usuario.
- **Chequeo de integridad**: despues de subir, se compara el `size` que
  Dropbox confirma haber guardado contra `req.file.size` (tamaño exacto del
  buffer recibido). Si no coinciden, se borra el archivo recien subido
  (`filesDeleteV2`) y se devuelve un error 502 pidiendo reintentar — nunca
  se deja un archivo "creido subido" pero corrupto en la nube del usuario.
- Limite de 150MB por archivo (limite de Dropbox para `filesUpload` en un
  solo request; archivos mas grandes necesitarian "upload sessions"
  chunkeadas, que quedan fuera de alcance de este paso). Se devuelve 413 con
  mensaje claro si se supera.
- `autorename: true` evita pisar un archivo existente con el mismo nombre
  (Dropbox le agrega automaticamente un sufijo tipo `foto (1).jpg`).
- Frontend: zona de **drag & drop** sobre el explorador + selector de
  archivo (`accept="image/*"` como filtro, no como restriccion dura), cola
  de subida con barra de progreso real por archivo (via
  `XMLHttpRequest.upload.onprogress`, ya que `fetch` no expone progreso de
  subida), y mensaje de error visible por archivo si algo falla (token
  vencido, archivo muy grande, etc.). Al terminar, la carpeta se recarga
  para mostrar el archivo nuevo.

**Nota sobre las pruebas de este paso**: igual que con el navegador de
archivos, este sandbox no tiene salida de red hacia `api.dropboxapi.com`,
asi que no pude subir un archivo real a Dropbox desde aca. Sí probé:
- Validaciones (sin archivo, sin conexion activa, sin autenticacion,
  archivo de 150MB+ devolviendo 413) con curl contra el servidor real.
- El manejo de errores end-to-end contra la Dropbox API real (con un
  `refresh_token` invalido) para confirmar que la subida falla con un
  mensaje claro (502) en vez de romperse.
- El flujo completo del frontend con Playwright, interceptando la red:
  drag-over visual, subida via el selector de archivo con los campos
  correctos en el `multipart/form-data`, barra de progreso llegando a
  "Listo" y desapareciendo, recarga de la carpeta mostrando el archivo
  subido, y el caso de error (token vencido) mostrando el mensaje en rojo
  sin autoeliminarse.

Para probarlo en tu maquina con tu Dropbox real: `cd backend && npm run dev`,
entra a `http://localhost:3000/index.html`, y arrastra una imagen (o
varias) a la zona de subida. Fijate que:
1. La barra de progreso avance.
2. El archivo aparezca en la carpeta actual al terminar.
3. El tamaño en Dropbox coincida con el archivo original (podes compararlo
   a ojo, o confiar en que si no coincidiera el sistema lo habria borrado y
   mostrado un error).

Con esto queda cerrado el flujo completo end-to-end para Dropbox: login →
conectar cuenta → navegar carpetas → crear carpetas → subir imagenes sin
compresion con chequeo de integridad.

## Próximo paso

Sumar Google Drive y Amazon S3 siguiendo el mismo patron: cada uno con su
propio modulo en `services/`, reutilizando `routes/connections.js` y
`routes/files.js` (que hoy asumen Dropbox como unico proveedor activo, va a
haber que generalizarlos para despachar segun `connection.provider`).
