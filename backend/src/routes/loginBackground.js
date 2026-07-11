import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const loginBackgroundRouter = Router();

const backendRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const loginBgDir = path.resolve(backendRoot, '..', 'public', 'img', 'login-bg');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

// Publica (sin requireAuth): las pantallas de login/registro la usan antes
// de que exista ninguna sesion.
loginBackgroundRouter.get('/', async (req, res) => {
  let files;
  try {
    files = await fs.readdir(loginBgDir);
  } catch {
    return res.json({ url: null });
  }

  const images = files.filter((name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()));
  if (images.length === 0) {
    return res.json({ url: null });
  }

  const chosen = images[Math.floor(Math.random() * images.length)];
  res.json({ url: `/img/login-bg/${encodeURIComponent(chosen)}` });
});
