import { apiFetch } from './api.js';

const PROVIDER_LABELS = {
  dropbox: 'Dropbox',
  google_drive: 'Google Drive',
  s3: 'Amazon S3',
  ftp: 'FTP',
  local: 'Carpeta local',
};

export function highlightActiveNavLink() {
  const path = window.location.pathname;
  document.querySelectorAll('.nav-links a').forEach((link) => {
    link.classList.toggle('active', new URL(link.href).pathname === path);
  });
}

export async function renderProviderBadge() {
  const badge = document.getElementById('provider-badge');
  if (!badge) return;
  try {
    const { connections } = await apiFetch('/api/connections');
    const active = connections.find((c) => c.is_active);
    if (active) {
      badge.textContent = `☁ ${PROVIDER_LABELS[active.provider] || active.provider}`;
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  } catch {
    badge.style.display = 'none';
  }
}

// "Conectar almacenamiento" y "Administrador" son solo para la cuenta
// admin: un usuario regular ya tiene su carpeta local asignada sola al
// registrarse y no necesita (ni puede) tocar la configuracion de
// almacenamiento.
export function applyAdminNavVisibility(isAdmin) {
  const adminLink = document.getElementById('admin-nav-link');
  if (adminLink) adminLink.style.display = isAdmin ? '' : 'none';

  const connectLink = document.getElementById('connect-nav-link');
  if (connectLink) connectLink.style.display = isAdmin ? '' : 'none';
}

export function initTopbar(isAdmin) {
  highlightActiveNavLink();
  renderProviderBadge();
  applyAdminNavVisibility(isAdmin);
}
