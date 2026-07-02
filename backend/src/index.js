import express from 'express';
import session from 'express-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { db } from './db.js';
import { authRouter } from './routes/auth.js';
import { connectionsRouter } from './routes/connections.js';

const SqliteStore = (await import('better-sqlite3-session-store')).default(session);

const app = express();
const backendRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const publicDir = path.resolve(backendRoot, '..', 'public');

app.disable('x-powered-by');
app.use(express.json());

app.use(
  session({
    name: 'fotoprint.sid',
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
      secure: config.baseUrl.startsWith('https://'),
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 dias
    },
  })
);

app.use('/api/auth', authRouter);
app.use('/api/connections', connectionsRouter);

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
  console.log(`fotoprint backend escuchando en ${config.baseUrl}`);
});
