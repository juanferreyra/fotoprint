# KodakTienda

Aplicación web liviana para subir y explorar imágenes en la nube del propio usuario
(Google Drive, Dropbox, Amazon S3 o un servidor FTP propio) o en una carpeta local
dentro del propio proyecto, sin almacenamiento permanente adicional en el servidor
(salvo la carpeta local, si se elige esa opción) y sin recomprimir ni recodificar
las imágenes en ningún punto del flujo.

## Estado actual

- [x] Estructura del proyecto
- [x] Registro / login / logout con sesiones (cookie httpOnly + SQLite)
- [x] Conexión OAuth con Dropbox
- [x] Navegador de archivos (Dropbox)
- [x] Subida de imágenes sin compresión + chequeo de integridad (Dropbox)
- [x] Conexión OAuth + navegador de archivos + subida (Google Drive)
- [x] Amazon S3 — scaffold completo (formulario de credenciales, listar,
      crear carpeta, subir con integridad), sin probar contra un bucket
      real (ver sección [Amazon S3](#conexión-con-amazon-s3-sin-oauth))
- [x] Conexión + navegador de archivos + subida (FTP) — probado y
      funcionando contra un servidor real
- [x] Carpeta local del proyecto (`media/`) como proveedor sin credenciales —
      probado de punta a punta (ver [Carpeta local del proyecto](#carpeta-local-del-proyecto-sin-credenciales))
- [x] Descargar archivos desde el explorador (ver [Descargar archivos](#descargar-archivos))
- [x] Fondos variados en el login/registro (ver [Fondos variados en el login](#fondos-variados-en-el-login))
- [x] Cuenta administradora: lista de usuarios, reseteo de contraseñas y
      acceso a la carpeta local de todos los usuarios (ver
      [Cuenta administradora](#cuenta-administradora))
- [x] Miniaturas + vista ampliada de imágenes, y permisos de borrado
      diferenciados para admin/usuario regular (ver
      [Miniaturas, vista ampliada y borrado](#miniaturas-vista-ampliada-y-borrado))
- [x] Mostrar/ocultar contraseña en los campos de password (ver
      [Mostrar/ocultar contraseña](#mostrarocultar-contraseña))
- [x] Descarga zipeada de varios archivos o de una carpeta entera, para el
      admin (ver [Descarga zipeada (admin)](#descarga-zipeada-admin))
- [x] Configuración lista para desplegar en Render.com (ver [DEPLOY.md](./DEPLOY.md))

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
      middleware/requireAdmin.js # requireAdmin (guard de cuenta admin, va despues de requireAuth)
      routes/auth.js        # /api/auth/register, /login, /logout, /me
      routes/connections.js # /api/connections (listar/activar/borrar) + OAuth de Dropbox y Google Drive
      routes/files.js       # /api/files, /api/files/folders, /api/files/upload, /api/files/download
                             # (generico: despacha a services/dropbox.js o services/googleDrive.js
                             # segun cual sea el proveedor activo del usuario)
      routes/loginBackground.js # /api/login-background (publica, sin auth): elige una foto al azar
                             # de public/img/login-bg/ para el fondo de login/registro
      routes/admin.js        # /api/admin/users (listar) y /api/admin/users/:id/reset-password
      services/users.js     # acceso a la tabla users + bcrypt
      services/crypto.js    # cifrado AES-256-GCM de credenciales de nube
      services/connections.js # acceso a la tabla cloud_connections
      services/dropbox.js   # DropboxAuth, cache de access_token, listFolder/createFolder/uploadFile,
                             # mapeo de errores del SDK a mensajes legibles
      services/googleDrive.js # OAuth2 (googleapis), Drive API v3, misma interfaz que dropbox.js
      services/s3.js         # @aws-sdk/client-s3, misma interfaz, sin OAuth (credenciales de larga duracion)
      services/ftp.js        # basic-ftp, misma interfaz, sin cachear conexion (una nueva por operacion)
      services/local.js      # fs/promises, misma interfaz, sin credenciales (guarda en config.mediaDir)
    data/                    # SQLite en disco (gitignored)
    .env.example
  media/                     # carpeta usada por el proveedor "local" (gitignored, una subcarpeta por usuario)
  public/                    # frontend estático, vanilla JS (sin build step)
    home.html                # navegador de archivos (o mensaje "conectar" si no hay proveedor activo)
                             # se llama home.html (no index.html) para no chocar con el index.html
                             # propio que algunos paneles de hosting (ej. Hestia) sirven por delante
                             # del proxy en la raiz del dominio
    connect.html              # pantalla "Conectar almacenamiento"
    admin.html                # pantalla de administracion (solo visible para la cuenta admin)
    login.html
    register.html
    css/style.css
    img/login-bg/             # fotos de fondo para login/registro (opcional, ver mas abajo)
    js/api.js                # helper fetch con manejo de errores
    js/authBg.js               # pide /api/login-background y setea el fondo si hay alguna foto
    js/explorer.js            # logica del navegador de archivos (breadcrumbs, listar, crear carpeta, descargar)
```

### Decisiones de arquitectura

- **Backend**: Node.js + Express. Un solo proceso, sin build step.
- **Frontend**: HTML + JS vanilla (ES modules), servido como estático por Express
  desde `public/`. Sin bundler ni framework, para mantener el proyecto liviano.
- **Autenticación**: sesiones de servidor (`express-session`) con cookie
  `httpOnly`, `sameSite=lax` y `secure: 'auto'` (usa `req.secure` por request,
  que respeta `trust proxy` + el header `X-Forwarded-Proto` — con un booleano
  fijo, un proxy que no mande ese header hace que la cookie de sesion
  directamente no se mande y el login "rebote"). La sesión se persiste en la
  misma base SQLite (tabla `sessions`, creada automáticamente por
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
- **Multi-proveedor (Dropbox / Google Drive / S3 / FTP / local)**:
  `routes/files.js` no sabe nada de ningún proveedor puntual — despacha
  según `connection.provider` a un módulo de `services/` que implementa
  siempre la misma interfaz (`listFolder`, `createFolder`, `uploadFile`,
  `deleteFile`). La API HTTP usa un `ref` opaco por proveedor en vez de un
  path real: para Dropbox, FTP y local el `ref` es literalmente el path
  (`/Fotos/Playa`, los tres tienen carpetas reales), para Drive es el `id`
  del archivo/carpeta (Drive no tiene paths reales — un mismo nombre de
  carpeta puede repetirse, así que solo el `id` identifica un recurso sin
  ambigüedad), y para S3 es la key/prefix del objeto (S3 tampoco tiene
  carpetas reales — se simulan con objetos vacíos cuya key termina en `/`,
  y se listan con `Delimiter: '/'` para separar "carpetas" de "archivos").
  La raíz siempre es `ref = ''`.
  La columna `cloud_connections.provider` no tiene un `CHECK` con la lista
  de proveedores válidos (se validan en la capa de aplicación) — así,
  agregar un proveedor nuevo no necesita una migración de base de datos.
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

Para desplegarlo en producción (probado con Render.com, que soporta un
servidor Node.js persistente como este a diferencia del hosting compartido
tradicional tipo DirectAdmin/cPanel pensado para PHP/estático), ver
[DEPLOY.md](./DEPLOY.md).

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
- Frontend (`home.html` + `js/explorer.js`): breadcrumb clickeable (pila
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
a punta: `cd backend && npm run dev`, entrá a `http://localhost:3000/home.html`
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
5. Andá a `http://localhost:3000/home.html` — deberías ver el navegador de
   archivos apuntando a "Mi Drive" con tus carpetas/archivos reales

Al igual que con Dropbox, no pude probar el login real contra
`accounts.google.com` desde este sandbox (sin salida de red). Sí probé con
curl: que `/start` arma la URL de autorización con los parámetros correctos
(`scope`, `access_type=offline`, `prompt=consent`, `redirect_uri`), y el
manejo de `state` inválido/cancelación de usuario. Con Playwright probé que
el botón "Conectar" ya aparece habilitado en `/connect.html` para Google
Drive (dejó de mostrar "Próximamente").

## Conexión con Amazon S3 (sin OAuth)

A diferencia de Dropbox/Drive, S3 no usa OAuth: el usuario carga
directamente un **Access Key ID**, **Secret Access Key**, **bucket** y
**región** de un usuario IAM. `services/s3.js` implementa la misma interfaz
que los otros dos (`listFolder`, `createFolder`, `uploadFile`, `deleteFile`)
usando `@aws-sdk/client-s3`.

- `POST /api/connections/s3` (`{ accessKeyId, secretAccessKey, bucket, region }`):
  antes de guardar nada, prueba las credenciales con un `HeadBucketCommand`
  real contra AWS — si fallan (typo, bucket inexistente, sin permisos), se
  devuelve el error sin guardar la conexión. Si funciona, se cifran y
  guardan igual que los tokens de Dropbox/Drive, y la conexión queda activa.
- Como las credenciales de IAM no vencen (a diferencia de un `access_token`
  OAuth), no hace falta refrescar nada — `services/s3.js` solo cachea el
  `S3Client` en memoria por conexión para no reconstruirlo en cada request.
- **"Carpetas" en S3**: S3 es un almacenamiento plano de objetos (key →
  contenido), no tiene jerarquía real. Se simula con la convención clásica:
  una carpeta es un objeto vacío cuya key termina en `/`
  (ej. `Vacaciones/`), y `listFolder` usa `ListObjectsV2` con
  `Delimiter: '/'` para separar "subcarpetas" (`CommonPrefixes`) de
  "archivos" (`Contents`) dentro de un prefijo. El chequeo de integridad de
  la subida usa un `HeadObjectCommand` después del `PutObjectCommand`
  porque `PutObject` no devuelve el tamaño guardado en su respuesta.
- Frontend: en `/connect.html`, el botón **Conectar** de Amazon S3 despliega
  un formulario inline (en vez de redirigir, como Dropbox/Drive) con los
  4 campos. Errores de credenciales se muestran en el mismo `error-box` de
  la página; el formulario queda abierto para corregir si falla.
- **Fix de paso**: al reconectar un proveedor que ya estaba conectado
  (Dropbox, Drive o S3) con credenciales nuevas, la fila de
  `cloud_connections` se actualiza (mismo `id`) en vez de crear una nueva.
  Sin invalidar el cliente/token cacheado para ese `id`, el servidor podía
  seguir usando las credenciales viejas hasta que el proceso se reiniciara
  (para S3, que no vence nunca, indefinidamente). Ahora las tres rutas de
  conexión invalidan el caché del proveedor correspondiente al guardar
  credenciales nuevas sobre una conexión existente.

### Cómo crear el usuario IAM (necesito estas credenciales, o las cargás vos directo en tu `.env`)

Ya que no tenés todavía un bucket real, dejo la guía para cuando lo tengas:

1. Andá a https://console.aws.amazon.com/s3/ y creá un bucket (o usá uno
   existente). No hace falta configurar CORS ni hacerlo público: las
   imágenes nunca viajan directo entre el navegador y S3, siempre pasan por
   este backend, que es el único que le habla a S3.
2. Andá a **IAM → Users → Create user**. No le des acceso a la consola,
   solo **Access key - Programmatic access**.
3. **Permissions → Attach policies directly → Create policy** (JSON), con
   permisos acotados solo a ese bucket:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["s3:ListBucket"],
         "Resource": "arn:aws:s3:::TU-BUCKET"
       },
       {
         "Effect": "Allow",
         "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
         "Resource": "arn:aws:s3:::TU-BUCKET/*"
       }
     ]
   }
   ```
   Evitá usar las access keys de tu usuario root de AWS o un usuario con
   permisos amplios — con esta policy, aunque se filtren las keys, el daño
   queda acotado a ese bucket.
4. Generá un **Access key** para ese usuario (IAM → Users → tu usuario →
   **Security credentials → Create access key**, caso de uso "Application
   running outside AWS"). Copiá el **Access Key ID** y el **Secret Access
   Key** — el secret solo se muestra una vez.
5. Cargalos en el formulario de `/connect.html`, o directo en
   `backend/.env` si preferís no escribirlos en el navegador (no hay
   variables de entorno para S3 porque las credenciales son por usuario,
   no de la app — se cargan siempre por el formulario).

### Cómo probarlo

1. `cd backend && npm run dev`
2. Logueado, andá a `http://localhost:3000/connect.html`
3. Click en **Conectar** (Amazon S3), completá el formulario con el Access
   Key/Secret/bucket/región del paso anterior, click en **Conectar**
4. Si las credenciales son válidas vas a ver la card en estado "Activo"
   inmediatamente (no hay redirect de por medio)
5. Andá a `http://localhost:3000/home.html` — deberías ver el navegador de
   archivos apuntando al bucket

**Nota sobre las pruebas de este paso**: a diferencia de Dropbox y Google
Drive, este sandbox **sí tiene salida de red hacia AWS S3** (lo confirmé
con un `curl` directo a `s3.us-east-1.amazonaws.com`, que respondió
normalmente, mientras que Dropbox/Google siguen bloqueados). Aproveché eso
para probar más de lo que pude con los otros dos proveedores:
- Validación de campos faltantes en el formulario (400).
- Una llamada real a AWS con credenciales inventadas: `HeadBucketCommand`
  devolvió un 403 real de AWS, traducido a "no tenés permiso... revisa la
  política IAM".
- Con una conexión S3 guardada (credenciales inventadas), `GET /api/files`
  y `POST /api/files/folders` reales dispararon `ListObjectsV2`/`PutObject`
  contra AWS de verdad, que devolvió `InvalidAccessKeyId`, traducido
  correctamente a 401 "El Access Key o el Secret Key de S3 son invalidos" —
  confirma que el despacho genérico en `routes/files.js` y el manejo de
  errores de `services/s3.js` funcionan contra la API real, no solo en teoría.
- El formulario completo en el navegador con Playwright: abrir/cancelar,
  envío con credenciales falsas mostrando el error y dejando el formulario
  abierto para corregir, y la card pasando a estado "Activo" con el nombre
  del bucket.

Lo único que **no** pude probar es una operación exitosa (listar un bucket
real, crear una carpeta, subir una imagen) porque no tengo — ni vos todavía
tenés — un bucket con credenciales válidas. Cuando tengas uno, probalo con
los pasos de arriba y contame si algo no anda como esperás.

## Conexión con FTP (sin OAuth)

Mismo patrón que S3 (formulario de credenciales, sin OAuth), con
`services/ftp.js` (usa `basic-ftp`).

- `POST /api/connections/ftp` (`{ host, port, user, password, secure }`):
  antes de guardar, prueba las credenciales conectándose de verdad al
  servidor y listando la raíz — si falla, no se guarda nada. `port` es
  opcional (default `21`). `secure` activa FTPS (TLS explícito).
- **Diferencia clave con Dropbox/Drive/S3**: acá **no se cachea ninguna
  conexión** entre requests. Los otros proveedores guardan un token/cliente
  en memoria para reusar en el próximo pedido, pero FTP es un protocolo con
  estado (conexión + sesión de login persistente), y muchos hostings
  compartidos limitan la cantidad de conexiones FTP simultáneas — abrir una
  conexión nueva por operación y cerrarla enseguida es más simple y más
  robusto. Como efecto secundario, esto también evita el bug de caché
  desactualizada que hubo que arreglar para los otros tres proveedores (acá
  ni siquiera puede pasar).
- Se agregó un **timeout de 15 segundos** (`new Client(15000)` de
  `basic-ftp`) a toda conexión: si el host no responde (caído, mal
  escrito, firewall de por medio), el pedido falla con un mensaje claro en
  vez de quedar colgado indefinidamente.
- **"Carpetas" en FTP**: a diferencia de S3/Drive, FTP sí tiene carpetas
  reales (como Dropbox), así que el `ref` es directamente el path completo
  (ej. `/Vacaciones/2025`), y la raíz es `''` (se traduce a `/` al hablar
  con el servidor).
- El chequeo de integridad de la subida usa el comando `SIZE` (`client.size(ref)`)
  después de subir, porque el comando de subida en sí no devuelve el
  tamaño guardado.
- **Cambio de arquitectura de la base de datos**: la columna
  `cloud_connections.provider` tenía un `CHECK (provider IN ('dropbox',
  'google_drive', 's3'))` hardcodeado — agregar FTP hubiese necesitado
  modificar ese `CHECK`, y SQLite no permite alterar un `CHECK` existente
  sin recrear la tabla. Se sacó el `CHECK` (la validación de qué
  proveedores son válidos ya vive en la capa de aplicación, en
  `routes/connections.js` y `routes/files.js`, que es donde tiene que
  estar de cualquier forma) para no tener que repetir esta migración cada
  vez que se agregue un proveedor nuevo. `db.js` migra solo, al arrancar,
  cualquier base de datos existente que todavía tenga el `CHECK` viejo
  (recrea la tabla y copia los datos, sin perder nada).
- Frontend: mismo patrón de formulario inline que S3 en `/connect.html`,
  con un checkbox para FTPS. Abrir el formulario de un proveedor cierra el
  del otro si estaba abierto (mutuamente excluyentes).

### Cómo probarlo

1. `cd backend && npm run dev`
2. Logueado, andá a `http://localhost:3000/connect.html`
3. Click en **Conectar** (FTP), completá host/puerto/usuario/contraseña
   (y marcá FTPS si tu hosting lo soporta)
4. Si las credenciales son válidas vas a ver la card en estado "Activo"
   inmediatamente
5. Andá a `http://localhost:3000/home.html` — deberías ver el navegador
   de archivos apuntando a la raíz de tu cuenta FTP

**Nota sobre las pruebas de este paso**: este sandbox **no tiene salida de
red para FTP en absoluto** (ni siquiera hacia un servidor de test público
como `test.rebex.net` — el intento de conexión se queda colgado sin
ninguna respuesta, a diferencia de Dropbox/Google que al menos devuelven
un 403 explícito, o S3 que funciona completo), así que yo no pude probar
ni un solo intento de conexión real. Sí probé:
- Validaciones de campos faltantes y puerto inválido (400).
- El mecanismo de timeout: con un host real pero inalcanzable desde acá
  (`test.rebex.net`), la conexión falla prolijamente a los 15 segundos con
  el mensaje "Tiempo de espera agotado..." en vez de colgar el pedido para
  siempre.
- El despacho genérico: con una conexión FTP guardada (credenciales
  inventadas), `GET /api/files` llega hasta `services/ftp.js` y falla con
  el mismo timeout prolijo — confirma que el wiring en `routes/files.js`
  está bien.
- La migración de la base: corrí la migración contra mi base de datos
  local (que ya tenía conexiones de Dropbox/Drive/S3 de pruebas
  anteriores, guardadas con el `CHECK` viejo) y confirmé que se preservan
  todas las filas existentes.
- El formulario completo en el navegador con Playwright: abrir/cancelar,
  exclusión mutua con el formulario de S3, envío mostrando el error de
  timeout y dejando el formulario abierto para corregir.

**Confirmado por el usuario contra un servidor FTP real**: conexión,
listado de la carpeta raíz, y el flujo funcionando de punta a punta.

## Carpeta local del proyecto (sin credenciales)

A pedido tuyo, se agregó un quinto proveedor para guardar las fotos
directamente en disco, en una carpeta `media/` dentro del proyecto, sin
necesidad de configurar ninguna cuenta de nube. Pensado como opción por
defecto simple para correr la app localmente o en un servidor propio sin
depender de terceros.

- `services/local.js` implementa la misma interfaz que los demás
  proveedores (`listFolder`, `createFolder`, `uploadFile`, `deleteFile`)
  usando `fs/promises` en vez de un SDK externo. No hay credenciales que
  guardar: la conexión se crea con `encrypted_credentials = '{}'` cifrado,
  solo para poder reusar la misma tabla `cloud_connections` sin agregar una
  columna nullable.
- **Carpeta base configurable**: `config.mediaDir` (`MEDIA_DIR` en
  `backend/.env`, default `../media` = `media/` en la raíz del proyecto,
  no dentro de `backend/`, para que quede claro que es contenido del
  usuario y no parte del código del servidor). Se crea sola con
  `fs.mkdir(..., { recursive: true })` la primera vez que se usa, igual que
  `backend/data/` para la base SQLite. Está en `.gitignore` (`/media/`).
- **Aislamiento por usuario**: dentro de `mediaDir`, cada usuario tiene su
  propia subcarpeta `user-<id>`, para que si dos usuarios distintos usan
  "local" en el mismo despliegue no compartan ni pisen archivos entre sí.
- **Path traversal**: `routes/files.js` ya rechaza cualquier `ref` que
  contenga `..` antes de que llegue a ningún proveedor. `services/local.js`
  agrega una segunda barrera propia (resuelve el path absoluto y verifica
  que siga adentro de la carpeta del usuario) por si el módulo se llega a
  usar desde otro lado sin pasar por esa validación.
- `POST /api/connections/local`: no pide ningún campo (a diferencia de
  S3/FTP). Solo confirma que se puede crear `mediaDir` en disco (permisos
  del filesystem) y activa la conexión, igual que los demás proveedores
  (desactiva cualquier otra conexión activa del usuario).
- Frontend: en `/connect.html`, la card de "Carpeta local (media/ del
  proyecto)" no abre ningún formulario — el botón **Usar carpeta local**
  llama directo a `POST /api/connections/local` y refresca el estado.

### Cómo probarlo

1. `cd backend && npm run dev`
2. Logueado, andá a `http://localhost:3000/connect.html`
3. Click en **Usar carpeta local** — la card pasa a "Activo" al instante
   (no hay credenciales que completar)
4. Andá a `http://localhost:3000/home.html` — el navegador de archivos
   arranca vacío apuntando a tu carpeta (`backend/../media/user-<tu-id>/`)
5. Probá **Nueva carpeta** y subir una imagen: deberían aparecer de
   inmediato en el explorador y en disco, en `media/user-<tu-id>/`

A diferencia de los otros cuatro proveedores, esto corre enteramente en el
mismo filesystem del sandbox, así que pude probarlo de punta a punta yo
mismo (sin las limitaciones de red que sí afectaron a Dropbox/Drive/FTP):
crear carpetas anidadas, subir un archivo y confirmar que el chequeo de
integridad de `routes/files.js` compara bien el tamaño, listar y borrar, y
que un `ref` con `..` se rechaza con 400 antes de tocar el disco.

## Descargar archivos

Cada archivo listado en el explorador (`home.html`) tiene un botón de
descarga (⬇) al lado del tamaño.

- `GET /api/files/download?ref=<ref>&name=<name>`: descarga el archivo tal
  cual esta guardado, sin ningun procesamiento. `ref` es el mismo
  identificador opaco que ya devuelve `GET /api/files` (path para
  Dropbox/FTP/local, id para Drive, key para S3); `name` lo manda el
  frontend (ya lo tiene del listado) y se usa solo para el nombre del
  archivo descargado, no para ubicarlo.
- Cada proveedor implementa `downloadFile(userId, ref) -> Buffer`, siguiendo
  la misma convencion que `uploadFile` (buffer completo en memoria, sin
  streaming) para mantener los cinco `services/*.js` con la misma forma.
  Para FTP (que solo permite descargar hacia un stream de escritura, no
  devuelve un buffer directo) se acumulan los chunks en memoria mientras la
  conexion sigue abierta, y recien se devuelve el buffer completo. Para S3
  se usa `response.Body.transformToByteArray()`, y para Drive
  `alt: 'media'` con `responseType: 'arraybuffer'`.
- La respuesta siempre se manda con `Content-Type: application/octet-stream`
  y `Content-Disposition: attachment` (con `filename` + `filename*` RFC 5987
  para que los nombres con acentos/espacios se guarden bien), asi que el
  navegador siempre lo baja como archivo en vez de intentar mostrarlo
  inline, sin importar el tipo real de la imagen.
- Probado de punta a punta con el proveedor local: subida de un archivo
  binario de prueba, descarga, y comparacion de checksum MD5 contra el
  original (coinciden exactamente).

## Fondos variados en el login

Las pantallas de login y registro pueden mostrar una foto de fondo elegida
al azar en cada carga, poniendo imagenes en `public/img/login-bg/` (ver el
`README.md` de esa carpeta).

- `GET /api/login-background` (ruta publica, sin `requireAuth` — se usa
  antes de que exista sesion): lee `public/img/login-bg/`, filtra por
  extension (`.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`) y devuelve
  `{ url }` con una elegida al azar, o `{ url: null }` si la carpeta esta
  vacia o no existe.
- `public/js/authBg.js` (`initAuthBackground()`, usado por `login.html` y
  `register.html`): pide esa URL y, si hay alguna, la setea como
  `background-image` de un `div#login-bg` fijo a pantalla completa, con un
  velo semitransparente (`rgba(245, 245, 247, 0.55)`) encima para que la
  tarjeta de login seguir siendo legible sin importar la foto. Si no hay
  ninguna imagen, no pasa nada y queda el fondo solido de siempre.
- **Detalle de CSS a tener en cuenta**: `#login-bg` no lleva `z-index`
  negativo a proposito. El fondo del `<body>` se "promueve" al canvas de la
  pagina (por no tener `background` seteado en `<html>`), y ese canvas se
  pinta por debajo de cualquier elemento con z-index negativo — un
  `z-index: -1` ahi dejaria la foto siempre invisible aunque el
  `background-image` este bien seteado. Alcanza con que el div quede
  primero en el DOM (antes de `.page-center`) para pintarse detras sin
  necesidad de z-index.
- Probado con Playwright: pantalla en blanco (carpeta vacia) sin romper
  nada, y con una imagen de prueba cargada se ve de fondo con el velo
  encima y la tarjeta de login perfectamente legible.

## Cuenta administradora

Hay una cuenta con permisos extra para ver la lista de usuarios y
administrar sus cuentas, con dos capacidades: ver la carpeta local de
cualquier usuario (no solo la propia) y resetear la contraseña de
cualquier cuenta.

- **Como se designa el admin**: variable de entorno `ADMIN_EMAIL` en
  `backend/.env`. Cualquier cuenta que se registre o inicie sesión con ese
  email exacto queda marcada como admin automáticamente (columna
  `users.is_admin`), sea una cuenta nueva o una que ya existía antes de
  configurar la variable. Sin `ADMIN_EMAIL`, no hay ninguna cuenta admin y
  `/admin.html` y `/api/admin/*` quedan inaccesibles para todos (403).
  Se descartó "el primer usuario registrado se vuelve admin solo" porque no
  sirve para elegir un admin específico en una instalación que ya tiene
  usuarios (quedaría admin el más viejo por id, no necesariamente el que
  se quiere).
- `middleware/requireAdmin.js`: se monta después de `requireAuth` en
  `routes/admin.js`, devuelve 403 si la cuenta autenticada no tiene
  `is_admin`.
- **La pantalla "Conectar almacenamiento" también es solo para el admin**:
  un usuario regular ya tiene su carpeta local asignada sola al
  registrarse (ver [Carpeta local del proyecto](#carpeta-local-del-proyecto-sin-credenciales))
  y no necesita elegir ni cambiar de proveedor. En `routes/connections.js`,
  `requireAdmin` se monta *después* de `GET /` (que sigue disponible para
  cualquier usuario autenticado, porque el topbar y el explorador la usan
  para saber cuál es la conexión activa — ya viene scopeada a
  `req.session.userId`, no expone conexiones de otras cuentas) pero *antes*
  de activar/borrar/crear conexiones y de los flujos OAuth. En el frontend,
  `/connect.html` redirige a `/home.html` si el usuario logueado no es
  admin, y el link "Conectar almacenamiento" del topbar (`js/nav.js`,
  `applyAdminNavVisibility`) se oculta para cuentas no-admin, igual que
  "Administrador".
- `GET /api/admin/users`: lista todas las cuentas (email, `is_admin`,
  fecha de alta). Nunca se manda `password_hash`.
- `POST /api/admin/users/:id/reset-password`: genera una contraseña
  temporal al azar (`crypto.randomBytes`, 12 caracteres en base64url), la
  guarda ya hasheada, y la devuelve en texto plano **una sola vez** en la
  respuesta — la app no manda emails, así que el admin se la tiene que
  pasar al usuario por otro medio. En `admin.html` se muestra en un cartel
  verde con instrucciones de copiarla en el momento.
- **Acceso a la raíz del almacenamiento local (`media/`)**: `services/local.js`
  ahora usa el email del usuario (saneado) como nombre de carpeta en vez
  de `user-<id>`, para poder identificar de quién es cada carpeta con solo
  mirar el filesystem. Para una cuenta admin, la raíz (`ref = ''`) deja de
  ser su propia carpeta y pasa a ser `config.mediaDir` directamente — o sea
  que al entrar al explorador con "Carpeta local" activa, el admin ve una
  carpeta por cada usuario que la haya usado, y puede entrar a cualquiera
  para listar, descargar, subir o borrar archivos ahí, con la misma
  interfaz genérica de `routes/files.js` (no hizo falta ningún endpoint
  nuevo para esto). Un usuario normal sigue completamente aislado en su
  propia carpeta, sin poder salir de ahí (mismo chequeo de path traversal
  de siempre).
- **Migración de carpetas viejas**: las instalaciones que ya tenían
  archivos guardados en `media/user-<id>/` (de antes de este cambio) se
  migran solas: la primera vez que el usuario vuelve a usar la carpeta
  local después de este deploy, si existe la carpeta vieja `user-<id>` y
  todavía no existe la nueva con su email, se renombra automáticamente sin
  perder nada.
- Probado de punta a punta: cuenta regular + cuenta admin, el admin ve la
  carpeta de la cuenta regular en la raíz y descarga un archivo suyo
  (checksum MD5 idéntico), un usuario regular no puede escaparse de su
  carpeta (400), `/api/admin/users` da 403 para una cuenta no-admin,
  reseteo de contraseña seguido de login con la contraseña nueva
  (funciona) y con la vieja (falla), y migración de una carpeta
  `user-<id>` simulada a la carpeta nueva por email.

## Miniaturas, vista ampliada y borrado

En el explorador, cada imagen se muestra con una miniatura en vez del
ícono genérico, y un click la abre en grande (lightbox). También se puede
borrar archivos y (según el rol) carpetas y cuentas de usuario.

- **Miniatura + lightbox**: reutiliza el mismo endpoint de descarga
  (`GET /api/files/download`) agregando `inline=1`, en vez de crear una
  ruta aparte. Con `inline=1`, si el nombre tiene una extensión de imagen
  conocida (`routes/files.js`, mapa `IMAGE_MIME_TYPES`), la respuesta usa
  el `Content-Type` real (`image/jpeg`, `image/png`, etc.) y
  `Content-Disposition: inline` en vez de `attachment`, para que el
  navegador la muestre en la página en lugar de forzar la descarga. Sin
  `inline=1` (o para un archivo que no es imagen), el comportamiento es
  exactamente el de antes. No hay ninguna librería de procesamiento de
  imágenes de por medio — la miniatura es la imagen completa mostrada
  chica por CSS (`object-fit: cover`, 40×40px) con `loading="lazy"` para no
  pedir todas las imágenes de una carpeta de una sola vez, solo las que
  entran en pantalla. El lightbox (`public/js/explorer.js`) es un overlay
  simple hecho a mano (sin librería): se cierra clickeando el fondo, el
  botón ✕, o con Escape.
- **Borrar archivos**: `DELETE /api/files?ref=` (requiere sesión, sin
  restricción de rol adicional — ver más abajo por qué alcanza con eso).
  Botón 🗑 al lado de cada archivo, con confirmación (`window.confirm`)
  antes de mandar el pedido.
- **Borrar carpetas — solo admin**: `DELETE /api/files/folders?ref=`, con
  `requireAdmin` además de `requireAuth`. Se agregó `deleteFolder(userId, ref)`
  a los cinco `services/*.js`: en Dropbox y Google Drive es literalmente el
  mismo `deleteFile`/`filesDeleteV2`/`files.delete` (esas APIs no
  distinguen archivo de carpeta para borrar), en FTP es
  `client.removeDir(ref)` (recursivo, de `basic-ftp`), en S3 hay que listar
  todos los objetos con ese prefijo (sin `Delimiter`, a cualquier
  profundidad) y borrarlos en lote con `DeleteObjectsCommand`, y en local
  es `fs.rm(dir, { recursive: true, force: true })`. La ruta rechaza con
  400 un intento de borrar la raíz (`ref` vacío) para no poder vaciar de un
  clic toda una cuenta de nube o, en el caso del admin en local,
  `config.mediaDir` entero. El botón 🗑 de una carpeta solo se renderiza en
  el frontend si `user.is_admin`, pero el control real está en el backend.
- **Por qué borrar archivos no necesita chequeo de rol aparte**: para
  Dropbox/Drive/S3/FTP cada conexión es la cuenta de nube de un único
  usuario — no hay forma de que un usuario le pase a la API un `ref` de
  "la nube de otro", esa noción no existe para esos cuatro proveedores.
  Para local, el aislamiento ya lo resuelve `resolveContext` /
  `resolveWithinRoot` (ver [Cuenta administradora](#cuenta-administradora)):
  la raíz de un usuario regular es su propia carpeta (no puede
  construir un `ref` que apunte afuera, tira 400), y la del admin es
  `config.mediaDir` completo. O sea que "admin puede borrar cualquier
  imagen, un usuario regular solo las de su propia carpeta" ya sale gratis
  de la misma resolución de rutas que se usa para listar/subir/descargar,
  sin lógica nueva.
- **Eliminar usuarios — solo admin**: `DELETE /api/admin/users/:id` en
  `admin.html`, con confirmación. Borra la fila de `users` (`cloud_connections`
  se borra sola por el `ON DELETE CASCADE` de la FK) y, mejor esfuerzo, la
  carpeta local del usuario en disco (`local.deleteUserFolder(email)`) — si
  falla esto último no se cancela el borrado de la cuenta. No se puede
  eliminar la propia cuenta logueada (400 en el backend, y el botón
  "Eliminar" directamente no aparece en esa fila en `admin.html`).
- **Endurecido `requireAuth`**: ahora también confirma que el usuario de
  `req.session.userId` siga existiendo (antes solo chequeaba que la sesión
  tuviera un `userId` seteado). Sin esto, la sesión de una cuenta recién
  eliminada seguía "autenticada" hasta que expirara sola, y podía terminar
  en errores confusos más adentro en vez de un 401 limpio apenas se borra
  la cuenta.
- Probado de punta a punta: miniatura e inline (`Content-Type: image/jpeg`,
  `Content-Disposition: inline`) vs. descarga normal (`octet-stream`,
  `attachment`) para el mismo archivo; usuario regular borra su propio
  archivo (204) pero no puede borrar ninguna carpeta (403); admin borra una
  carpeta de otro usuario y no puede borrar la raíz (400); admin elimina
  una cuenta (204), confirma que su carpeta desaparece del disco, y que la
  sesión vieja de esa cuenta ya no sirve (401); admin no puede eliminarse a
  sí mismo (400, y sin botón en la UI). Con Playwright: miniatura visible
  en la lista, click abre el lightbox con la imagen grande, botón ✕ la
  cierra, y el diálogo de confirmación de borrado con su mensaje.

## Mostrar/ocultar contraseña

Los 4 campos de contraseña de la app (login, registro, y las credenciales
de S3 y FTP en "Conectar almacenamiento") tienen un botón "ojito" para ver
lo que se esta escribiendo.

- `public/js/passwordToggle.js` (`initPasswordToggles()`): busca todos los
  botones `.password-toggle` en la página y alterna el `type` del input
  asociado (por `data-target`, el `id` del input) entre `password` y
  `text`, cambiando el emoji (👁 / 🙈) y el `aria-label` acorde.
  Reutilizable: cada campo solo necesita envolverse en un
  `<div class="password-field">` con el input y el botón adentro, sin
  lógica nueva por campo.

## Descarga zipeada (admin)

El admin puede seleccionar varios archivos y/o carpetas del explorador y
bajarlos todos juntos en un `.zip`, o bajar el contenido completo de una
carpeta con un solo click — sin tener que descargar imagen por imagen.

- **Selección múltiple**: con la cuenta admin aparece un checkbox al lado
  de cada archivo/carpeta y un checkbox "Seleccionar todo" en la barra de
  herramientas. Al marcar algo aparece el botón "Descargar seleccion (N)".
  La selección es solo de la carpeta actual (se vacía sola al navegar a
  otra) — mezclar selecciones de carpetas distintas en un mismo zip no
  valía la complejidad extra.
- **Carpeta entera de un click**: cada carpeta tiene un botón 📦 aparte del
  de borrar, que arma un zip con todo su contenido (subcarpetas incluidas)
  sin necesidad de seleccionar nada primero.
- `POST /api/files/download-zip` (`requireAdmin`, body `{ items: [{ref,
  name, type}, ...] }`): arma el zip en el servidor con
  [`archiver`](https://www.npmjs.com/package/archiver) (única dependencia
  nueva agregada para esto — Node no tiene una forma nativa de armar el
  *formato* ZIP, a diferencia de gzip que sí trae `node:zlib`) y lo
  transmite en streaming directo a la respuesta (`archive.pipe(res)`), sin
  buffer­ear el zip completo en memoria del lado del servidor antes de
  mandarlo. El frontend (`downloadZip` en `explorer.js`) hace un `fetch`
  con el body y guarda el `blob` de la respuesta como descarga.
- **No hizo falta ningún método nuevo por proveedor**: arma el zip
  recorriendo recursivamente las carpetas con `listFolder` +
  `downloadFile`, que los cinco `services/*.js` ya implementan — mismo
  criterio de reuso que en
  [Descargar archivos](#descargar-archivos). Un item de tipo `folder`
  dispara una recorrida recursiva (`addFolderToArchive`) que reconstruye
  la estructura de subcarpetas dentro del zip; un item de tipo `file` se
  agrega directo.
  Un archivo que falla a mitad de camino (borrado mientras tanto, error de
  red) se salta y loguea en el servidor en vez de arruinar el zip entero.
- Admin-only, mismo criterio que borrar carpetas/cuentas: la ruta tiene
  `requireAdmin` ademas de `requireAuth`, y los checkboxes + botones 📦 /
  "Descargar seleccion" solo se renderizan en el frontend si
  `user.is_admin`.
- Probado de punta a punta: zip con selección mixta (2 archivos sueltos +
  1 carpeta con subcarpeta) conserva la estructura de carpetas adentro del
  zip y el contenido coincide byte a byte con el original (checksum MD5);
  zip de una sola carpeta con un click; 403 para una cuenta no-admin; 400
  si no se selecciona nada; y con Playwright, el flujo completo en
  navegador (seleccionar todo → click en "Descargar seleccion" → evento de
  descarga real del navegador).

## Estado del proyecto

Con esto quedan cinco proveedores andando: Dropbox, Google Drive y FTP
probados de punta a punta por vos contra cuentas/servidores reales; S3 con
el scaffold completo listo para cuando tengas un bucket para probar; y la
carpeta local del proyecto, probada de punta a punta sin depender de
ninguna cuenta externa. El flujo end-to-end completo — registro, conectar
almacenamiento, navegar/crear carpetas, subir imágenes sin compresión con
chequeo de integridad — funciona igual sin importar cuál de los cinco esté
activo, gracias al despacho genérico en `routes/files.js` y a que los
cinco `services/*.js` implementan la misma interfaz.

Además, la configuración para desplegar en Render.com ya está lista (ver
[DEPLOY.md](./DEPLOY.md)).
