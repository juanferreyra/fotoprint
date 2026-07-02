import { apiFetch } from './api.js';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tiff', 'tif', 'svg']);

let currentPath = '';

const els = {
  noConnection: document.getElementById('no-connection'),
  explorer: document.getElementById('explorer'),
  breadcrumb: document.getElementById('breadcrumb'),
  entryList: document.getElementById('entry-list'),
  errorBox: document.getElementById('error-box'),
  newFolderBtn: document.getElementById('new-folder-btn'),
  newFolderForm: document.getElementById('new-folder-form'),
  newFolderName: document.getElementById('new-folder-name'),
  newFolderCancel: document.getElementById('new-folder-cancel'),
};

function showError(message) {
  els.errorBox.textContent = message;
  els.errorBox.classList.add('visible');
}

function clearError() {
  els.errorBox.classList.remove('visible');
  els.errorBox.textContent = '';
}

function fileIcon(name) {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  return IMAGE_EXTENSIONS.has(ext) ? '\u{1F5BC}️' : '\u{1F4C4}';
}

function formatSize(bytes) {
  if (bytes === undefined || bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex++;
  } while (value >= 1024 && unitIndex < units.length - 1);
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function renderBreadcrumb(path) {
  els.breadcrumb.innerHTML = '';

  const rootBtn = document.createElement('button');
  rootBtn.type = 'button';
  rootBtn.textContent = 'Mi Dropbox';
  if (path === '') rootBtn.disabled = true;
  rootBtn.addEventListener('click', () => loadFolder(''));
  els.breadcrumb.appendChild(rootBtn);

  if (path === '') return;

  const segments = path.split('/').filter(Boolean);
  let accum = '';
  segments.forEach((segment, index) => {
    const sep = document.createElement('span');
    sep.className = 'sep';
    sep.textContent = '/';
    els.breadcrumb.appendChild(sep);

    accum += `/${segment}`;
    const targetPath = accum;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = segment;
    if (index === segments.length - 1) btn.disabled = true;
    btn.addEventListener('click', () => loadFolder(targetPath));
    els.breadcrumb.appendChild(btn);
  });
}

function renderEntries(entries) {
  els.entryList.innerHTML = '';

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Esta carpeta esta vacia.';
    els.entryList.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = entry.type === 'folder' ? 'entry-row is-folder' : 'entry-row';

    const icon = document.createElement('span');
    icon.className = 'entry-icon';
    icon.textContent = entry.type === 'folder' ? '\u{1F4C1}' : fileIcon(entry.name);
    row.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'entry-name';
    name.textContent = entry.name;
    row.appendChild(name);

    if (entry.type === 'file') {
      const size = document.createElement('span');
      size.className = 'entry-size';
      size.textContent = formatSize(entry.size);
      row.appendChild(size);
    }

    if (entry.type === 'folder') {
      row.addEventListener('click', () => loadFolder(entry.path));
    }

    els.entryList.appendChild(row);
  }
}

async function loadFolder(path) {
  clearError();
  els.entryList.innerHTML = '<div class="empty-state">Cargando...</div>';
  try {
    const { entries } = await apiFetch(`/api/files?path=${encodeURIComponent(path)}`);
    currentPath = path;
    renderBreadcrumb(path);
    renderEntries(entries);

    const url = new URL(window.location.href);
    if (path) url.searchParams.set('path', path);
    else url.searchParams.delete('path');
    window.history.replaceState({}, '', url);
  } catch (err) {
    els.entryList.innerHTML = '';
    showError(err.message);
  }
}

els.newFolderBtn.addEventListener('click', () => {
  els.newFolderForm.style.display = 'flex';
  els.newFolderBtn.style.display = 'none';
  els.newFolderName.value = '';
  els.newFolderName.focus();
});

els.newFolderCancel.addEventListener('click', () => {
  els.newFolderForm.style.display = 'none';
  els.newFolderBtn.style.display = '';
});

els.newFolderForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();
  const name = els.newFolderName.value.trim();
  if (!name) return;

  try {
    await apiFetch('/api/files/folders', {
      method: 'POST',
      body: JSON.stringify({ path: currentPath, name }),
    });
    els.newFolderForm.style.display = 'none';
    els.newFolderBtn.style.display = '';
    await loadFolder(currentPath);
  } catch (err) {
    showError(err.message);
  }
});

async function loadConnectionStatus() {
  const { connections } = await apiFetch('/api/connections');
  const active = connections.find((c) => c.is_active);

  if (!active || active.provider !== 'dropbox') {
    els.noConnection.style.display = 'block';
    els.explorer.style.display = 'none';
    return;
  }

  els.noConnection.style.display = 'none';
  els.explorer.style.display = 'block';
  const params = new URLSearchParams(window.location.search);
  await loadFolder(params.get('path') || '');
}

async function init() {
  try {
    const { user } = await apiFetch('/api/auth/me');
    document.getElementById('user-email').textContent = user.email;
  } catch {
    window.location.href = '/login.html';
    return;
  }
  await loadConnectionStatus();
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  await apiFetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

init();
