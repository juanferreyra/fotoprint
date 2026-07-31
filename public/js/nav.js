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

// La insignia indica en que almacenamiento estan guardados los archivos.
// Eso es informacion de configuracion que solo le importa al admin; un
// usuario regular no necesita (ni deberia) ver a donde esta conectado el
// almacenamiento, asi que para clientes se oculta directamente.
export async function renderProviderBadge(isAdmin) {
  const badge = document.getElementById('provider-badge');
  if (!badge) return;
  if (!isAdmin) {
    badge.style.display = 'none';
    return;
  }
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

// "Explorador", "Conectar almacenamiento" y "Administrador" en la barra de
// navegacion son solo para la cuenta admin, que es la unica que alterna
// entre varias secciones. Un usuario regular solo tiene el explorador (su
// carpeta), asi que el link "Explorador" le queda de mas: se le ocultan
// todos y su barra de navegacion queda vacia.
export function applyAdminNavVisibility(isAdmin) {
  const explorerLink = document.getElementById('explorer-nav-link');
  if (explorerLink) explorerLink.style.display = isAdmin ? '' : 'none';

  const adminLink = document.getElementById('admin-nav-link');
  if (adminLink) adminLink.style.display = isAdmin ? '' : 'none';

  const connectLink = document.getElementById('connect-nav-link');
  if (connectLink) connectLink.style.display = isAdmin ? '' : 'none';
}

export function initTopbar(isAdmin) {
  highlightActiveNavLink();
  renderProviderBadge(isAdmin);
  applyAdminNavVisibility(isAdmin);
}
