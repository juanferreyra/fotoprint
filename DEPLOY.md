# Desplegar fotoprint en Render.com

Este proyecto necesita un servidor Node.js corriendo todo el tiempo (no es un
sitio estático ni PHP), así que hace falta un hosting que soporte eso.
[Render](https://render.com) tiene un plan free que alcanza para probar la
app, y se conecta directo al repo de GitHub sin usar terminal.

## Antes de empezar: la limitación del plan free

El plan **free** de Render no incluye disco persistente: cada vez que el
servicio se reinicia (con cada deploy, o cuando Render lo "duerme" por
inactividad y lo despierta de nuevo) se pierde el archivo SQLite completo —
o sea, todos los usuarios registrados y las conexiones de nube guardadas.
Para un uso real (no solo para probar) hace falta el plan **Starter**
(pago) con un disco persistente agregado. Lo dejamos anotado más abajo para
cuando llegue ese momento; para arrancar y probar la app, el free alcanza.

También en el plan free el servicio "se duerme" después de ~15 minutos sin
tráfico, y el primer pedido después de eso tarda unos 30-50 segundos en
responder mientras arranca de nuevo. Es normal, no es que algo esté roto.

## Paso 1: crear la cuenta y conectar el repo

1. Entrá a https://render.com y creá una cuenta (podés usar tu cuenta de
   GitHub para loguearte, así Render ya tiene permiso para leer tus repos).
2. **New +** → **Blueprint**.
3. Elegí el repo `juanferreyra/fotoprint`. Render va a detectar el archivo
   `render.yaml` de la raíz del repo automáticamente y proponerte crear el
   servicio `fotoprint` con la configuración de ahí (root directory
   `backend`, build `npm install`, start `npm start`).
4. Elegí qué rama desplegar. Si ya mergeaste el PR a `main`, usá `main`;
   si todavía no, podés apuntar a la rama del PR por ahora y cambiarla
   después.
5. Confirmá la creación. Render va a hacer un primer deploy — **va a
   fallar o arrancar mal**, porque todavía faltan variables de entorno
   obligatorias (paso 2). Es esperable, seguí al paso 2.

## Paso 2: completar las variables de entorno

En el servicio creado, andá a **Environment** y completá las que el
`render.yaml` dejó marcadas como "hay que cargarlas a mano":

- `TOKEN_ENCRYPTION_KEY`: generala con este comando (en tu compu, con
  Node instalado) y pegá el resultado:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- `BASE_URL`: la URL que te asignó Render para este servicio, algo como
  `https://fotoprint.onrender.com` (la ves arriba del todo en el dashboard
  del servicio, apenas se crea, incluso antes de que el primer deploy
  termine bien).
- `DROPBOX_APP_KEY` / `DROPBOX_APP_SECRET`: los mismos que tenés en tu
  `backend/.env` local (de tu app en el Dropbox App Console).
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`: los mismos que tenés en tu
  `backend/.env` local (de tu OAuth Client en Google Cloud Console).

`SESSION_SECRET` ya se generó sola (Render lo hace automáticamente por el
`generateValue: true` del `render.yaml`), no hace falta tocarla.

Guardá los cambios — Render va a redeployar solo.

## Paso 3: actualizar los redirect URI en Dropbox y Google

Ahora que la app tiene una URL pública, Dropbox y Google tienen que saber
que pueden redirigir ahí después del login. **No borres** las URIs de
`localhost` que ya tenés — agregá estas además, para poder seguir probando
en tu compu:

- **Dropbox App Console** → tu app → **Settings** → **OAuth 2** →
  **Redirect URIs** → agregar:
  `https://TU-SERVICIO.onrender.com/api/connections/dropbox/callback`
- **Google Cloud Console** → **APIs & Services** → **Credentials** → tu
  OAuth Client → **Authorized redirect URIs** → agregar:
  `https://TU-SERVICIO.onrender.com/api/connections/google_drive/callback`

(reemplazá `TU-SERVICIO.onrender.com` por el `BASE_URL` real del paso 2).

## Paso 4: probar

Entrá a tu URL de Render (`https://TU-SERVICIO.onrender.com`), registrate,
conectá Dropbox o Google Drive, y probá navegar/subir una imagen. Si algo
falla, **Logs** en el dashboard de Render te muestra la consola del
servidor en vivo.

## Más adelante: persistencia real (disco pago)

Cuando quieras que los datos no se pierdan en cada reinicio:

1. Cambiá el servicio del plan **Free** al **Starter** (u otro pago).
2. En el servicio, **Disks** → **Add Disk**: montalo por ejemplo en
   `/var/data`, con el tamaño que necesites (1GB alcanza de sobra para
   este uso — solo guardamos usuarios/sesiones/conexiones, no las
   imágenes en sí, que viven en la nube del usuario).
3. Cambiá la variable de entorno `DATABASE_FILE` a
   `/var/data/fotoprint.sqlite` (la ruta absoluta del disco montado) y
   redeployá.

## Dominio propio

Cuando decidas el dominio/subdominio para fotoprint, Render lo soporta
desde **Settings → Custom Domains** del servicio (te da un CNAME/registro
para configurar en tu DNS). Si terminás usando ese dominio en vez del
`.onrender.com`, actualizá `BASE_URL` y los redirect URIs de Dropbox/Google
otra vez para que apunten al dominio nuevo.
