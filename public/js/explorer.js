import { apiFetch } from './api.js';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tiff', 'tif', 'svg']);

const ROOT_LABELS = {
  dropbox: 'Mi Dropbox',
  google_drive: 'Mi Drive',
};

// "ref" es opaco por proveedor (path para Dropbox, id de archivo para
// Drive), asi que la navegacion no se puede reconstruir parseando un
// string: se mantiene como una pila de {ref, name} armada en el cliente a
// medida que el usuario entra/sale de carpetas.
let breadcrumbStack = [{ ref: '', name: 'Raiz' }];
let currentRef = '';

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
  uploadZone: document.getElementById('upload-zone'),
  uploadInput: document.getElementById('upload-input'),
  uploadSelectBtn: document.getElementById('upload-select-btn'),
  uploadQueue: document.getElementById('upload-queue'),
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

function renderBreadcrumb(stack) {
  els.breadcrumb.innerHTML = '';

  stack.forEach((segment, index) => {
    if (index > 0) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '/';
      els.breadcrumb.appendChild(sep);
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = segment.name;
    if (index === stack.length - 1) btn.disabled = true;
    btn.addEventListener('click', () => {
      breadcrumbStack = stack.slice(0, index + 1);
      loadFolder(breadcrumbStack[breadcrumbStack.length - 1].ref, breadcrumbStack);
    });
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
      row.addEventListener('click', () => {
        const newStack = [...breadcrumbStack, { ref: entry.ref, name: entry.name }];
        loadFolder(entry.ref, newStack);
      });
    }

    els.entryList.appendChild(row);
  }
}

// stack es opcional: si no se pasa, se recarga currentRef sin tocar el
// breadcrumb (util despues de crear una carpeta o subir un archivo).
async function loadFolder(ref, stack) {
  clearError();
  els.entryList.innerHTML = '<div class="empty-state">Cargando...</div>';
  try {
    const { entries } = await apiFetch(`/api/files?parent=${encodeURIComponent(ref)}`);
    currentRef = ref;
    if (stack) breadcrumbStack = stack;
    renderBreadcrumb(breadcrumbStack);
    renderEntries(entries);

    const url = new URL(window.location.href);
    const leaf = breadcrumbStack[breadcrumbStack.length - 1];
    if (leaf.ref) {
      url.searchParams.set('parent', leaf.ref);
      url.searchParams.set('parentName', leaf.name);
    } else {
      url.searchParams.delete('parent');
      url.searchParams.delete('parentName');
    }
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
      body: JSON.stringify({ parent: currentRef, name }),
    });
    els.newFolderForm.style.display = 'none';
    els.newFolderBtn.style.display = '';
    await loadFolder(currentRef);
  } catch (err) {
    showError(err.message);
  }
});

// Sube con XMLHttpRequest (en vez de fetch) para poder mostrar progreso real
// de subida via xhr.upload.onprogress.
function uploadFileXHR(file, parent, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('parent', parent);
    formData.append('file', file, file.name);

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });

    xhr.addEventListener('load', () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
      } else {
        reject(new Error((data && data.error) || `Error ${xhr.status}`));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Error de red durante la subida.')));

    xhr.open('POST', '/api/files/upload');
    xhr.withCredentials = true;
    xhr.send(formData);
  });
}

function createUploadQueueItem(name) {
  const row = document.createElement('div');
  row.className = 'upload-item';

  const nameEl = document.createElement('span');
  nameEl.className = 'upload-item-name';
  nameEl.textContent = name;
  row.appendChild(nameEl);

  const bar = document.createElement('div');
  bar.className = 'upload-item-bar';
  const barFill = document.createElement('div');
  barFill.className = 'upload-item-bar-fill';
  bar.appendChild(barFill);
  row.appendChild(bar);

  const status = document.createElement('span');
  status.className = 'upload-item-status';
  status.textContent = 'Subiendo...';
  row.appendChild(status);

  els.uploadQueue.appendChild(row);
  return { row, barFill, status };
}

async function handleFiles(fileList) {
  const files = Array.from(fileList);
  const parent = currentRef;

  for (const file of files) {
    const item = createUploadQueueItem(file.name);
    try {
      await uploadFileXHR(file, parent, (fraction) => {
        item.barFill.style.width = `${Math.round(fraction * 100)}%`;
      });
      item.barFill.style.width = '100%';
      item.status.textContent = 'Listo';
      item.row.classList.add('is-done');
      setTimeout(() => item.row.remove(), 2500);
    } catch (err) {
      item.status.textContent = err.message;
      item.row.classList.add('is-error');
    }
  }

  if (parent === currentRef) {
    await loadFolder(currentRef);
  }
}

els.uploadSelectBtn.addEventListener('click', () => els.uploadInput.click());

els.uploadInput.addEventListener('change', () => {
  if (els.uploadInput.files.length) handleFiles(els.uploadInput.files);
  els.uploadInput.value = '';
});

['dragenter', 'dragover'].forEach((eventName) => {
  els.uploadZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.uploadZone.classList.add('drag-over');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  els.uploadZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.uploadZone.classList.remove('drag-over');
  });
});

els.uploadZone.addEventListener('drop', (event) => {
  if (event.dataTransfer?.files?.length) handleFiles(event.dataTransfer.files);
});

async function loadConnectionStatus() {
  const { connections } = await apiFetch('/api/connections');
  const active = connections.find((c) => c.is_active);

  if (!active || !ROOT_LABELS[active.provider]) {
    els.noConnection.style.display = 'block';
    els.explorer.style.display = 'none';
    return;
  }

  els.noConnection.style.display = 'none';
  els.explorer.style.display = 'block';

  const rootLabel = ROOT_LABELS[active.provider];
  const params = new URLSearchParams(window.location.search);
  const parentRef = params.get('parent') || '';
  const parentName = params.get('parentName');

  breadcrumbStack =
    parentRef && parentName
      ? [{ ref: '', name: rootLabel }, { ref: parentRef, name: parentName }]
      : [{ ref: '', name: rootLabel }];

  await loadFolder(parentRef, breadcrumbStack);
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
