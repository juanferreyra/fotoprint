import express from 'express';
import session from 'express-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { db } from './db.js';
import { authRouter } from './routes/auth.js';
import { connectionsRouter } from './routes/connections.js';
import { filesRouter } from './routes/files.js';
import { loginBackgroundRouter } from './routes/loginBackground.js';
import { adminRouter } from './routes/admin.js';

const SqliteStore = (await import('better-sqlite3-session-store')).default(session);

const app = express();
const backendRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const publicDir = path.resolve(backendRoot, '..', 'public');

app.disable('x-powered-by');
// Necesario detras de un proxy que termina TLS (Render, nginx, etc.) para
// que Express calcule bien req.protocol/req.ip.
app.set('trust proxy', 1);
app.use(express.json());

app.use(
  session({
    name: 'kodaktienda.sid',
    store: new SqliteStore({
      client: db,
      expired: { clear: true, intervalMs: 900000 },
    }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // 'auto' (en vez de un booleano fijo segun config.baseUrl) hace que
      // express-session decida por request usando req.secure, que a su vez
      // respeta "trust proxy" + el header X-Forwarded-Proto. Con un booleano
      // fijo en true, si el proxy no manda ese header (o Express no llega a
      // verlo como secure por algun motivo puntual), el cookie de sesion
      // directamente no se manda al navegador y el login queda pisado
      // (entra, pero la siguiente pagina no ve la sesion y rebota a login).
      secure: 'auto',
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 dias
    },
  })
);

app.use('/api/auth', authRouter);
app.use('/api/connections', connectionsRouter);
app.use('/api/files', filesRouter);
app.use('/api/login-background', loginBackgroundRouter);
app.use('/api/admin', adminRouter);

// La pagina principal se sirve como home.html (no index.html) para que no
// choque con el index.html propio que algunos paneles de hosting (ej.
// Hestia) sirven por delante del proxy en la raiz del dominio.
app.get('/', (req, res) => res.redirect('/home.html'));

app.use(express.static(publicDir));

app.use((req, res) => {
  res.status(404).json({ error: 'No encontrado.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

app.listen(config.port, () => {
  console.log(`KodakTienda backend escuchando en ${config.baseUrl}`);
});
