'use strict';

const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, protocol, session, dialog, shell, powerMonitor, Menu } = require('electron');
const { Vault } = require('./vault/vault');
const updater = require('./updater');

// In-memory browser session: nothing the window loads (including decrypted
// photos/videos) is ever written to Chromium's disk cache.
const PARTITION = 'vlt-secure';
const RENDERER_HTML = path.join(__dirname, '..', 'renderer', 'index.html');
const RENDERER_URL = pathToFileURL(RENDERER_HTML).href;
// Stable location that installs/updates never touch. (VLT_DEV_DATA_DIR is for development/testing only.)
const VAULT_DIR =
  !app.isPackaged && process.env.VLT_DEV_DATA_DIR
    ? path.join(process.env.VLT_DEV_DATA_DIR, 'vault')
    : path.join(app.getPath('appData'), 'VLT', 'vault');
const TEMP_PREFIX = 'VLT-open-';
const TEXT_PREVIEW_MAX = 10 * 1024 * 1024;
const DOCX_PREVIEW_MAX = 60 * 1024 * 1024;

protocol.registerSchemesAsPrivileged([
  { scheme: 'vlt', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
]);

const vault = new Vault(VAULT_DIR);
let win = null;
let mediaToken = newToken();
let lastActivity = Date.now();
let cleanedUp = false;
const tempDirs = new Set();

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ------------------------------------------------------------------ temp files

// "Open in another app" needs a real file. Those copies are tracked and
// overwritten + deleted when the vault locks or the app closes.
async function wipeTempFiles() {
  for (const dir of [...tempDirs]) {
    try {
      for (const name of await fsp.readdir(dir)) {
        const f = path.join(dir, name);
        const { size } = await fsp.stat(f);
        const fh = await fsp.open(f, 'r+');
        try {
          for (let pos = 0; pos < size; pos += 1 << 20) {
            const len = Math.min(1 << 20, size - pos);
            await fh.write(crypto.randomBytes(len), 0, len, pos);
          }
        } finally {
          await fh.close();
        }
      }
      await fsp.rm(dir, { recursive: true, force: true, maxRetries: 3 });
      tempDirs.delete(dir);
    } catch {
      // File still open in another program; try again later.
    }
  }
}

async function removeStaleTemp() {
  try {
    for (const name of await fsp.readdir(os.tmpdir())) {
      if (name.startsWith(TEMP_PREFIX)) tempDirs.add(path.join(os.tmpdir(), name));
    }
  } catch {
    // ignore
  }
  await wipeTempFiles();
}

// ------------------------------------------------------------------ locking

async function lockVault(reason) {
  const wasUnlocked = vault.isUnlocked() || (await vault.status()).mfaPending;
  vault.cancelMfa();
  await vault.lockSafely();
  mediaToken = newToken();
  if (win && !win.isDestroyed()) await win.webContents.session.clearCache().catch(() => {});
  await wipeTempFiles();
  if (wasUnlocked) send('vault:locked', { reason });
}

function unlocked() {
  lastActivity = Date.now();
  mediaToken = newToken();
}

setInterval(() => {
  if (!vault.isUnlocked()) return;
  const minutes = vault.getSettings().autoLockMinutes || 5;
  if (Date.now() - lastActivity > minutes * 60 * 1000) lockVault('idle');
}, 10 * 1000).unref();

// ------------------------------------------------------------------ media protocol

// Streams decrypted bytes directly to the viewer: vlt://media/<token>/<id>
// Supports HTTP Range requests so videos can be seeked.
const PLAYBACK_TYPE = { 'video/quicktime': 'video/mp4', 'video/x-matroska': 'video/webm' };

async function handleMedia(request) {
  const url = new URL(request.url);
  const [, token, id] = url.pathname.split('/');
  if (url.hostname !== 'media' || !vault.isUnlocked() || token !== mediaToken) {
    return new Response('Forbidden', { status: 403 });
  }
  let item;
  try {
    item = vault.getItem(id);
  } catch {
    return new Response('Not found', { status: 404 });
  }
  if (item.kind !== 'file') return new Response('Not found', { status: 404 });

  const size = item.size;
  const type = PLAYBACK_TYPE[item.mime] || item.mime;
  const baseHeaders = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  if (size === 0) return new Response('', { status: 200, headers: { ...baseHeaders, 'Content-Length': '0' } });

  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = request.headers.get('range');
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (m && (m[1] !== '' || m[2] !== '')) {
    if (m[1] === '') {
      start = Math.max(0, size - Number(m[2]));
    } else {
      start = Number(m[1]);
      if (m[2] !== '') end = Math.min(Number(m[2]), size - 1);
    }
    if (start > end || start >= size) {
      return new Response('', { status: 416, headers: { ...baseHeaders, 'Content-Range': `bytes */${size}` } });
    }
    status = 206;
  }

  const gen = vault.readRange(id, start, end);
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await gen.next();
        if (done) controller.close();
        else controller.enqueue(new Uint8Array(value));
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await gen.return();
    },
  });
  const headers = { ...baseHeaders, 'Content-Length': String(end - start + 1) };
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  return new Response(body, { status, headers });
}

// ------------------------------------------------------------------ window

function hardenSession(ses) {
  ses.protocol.handle('vlt', handleMedia);
  // Only full-screen video is allowed; camera, mic, location, notifications... are all denied.
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'fullscreen'));
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen');
  // The vault window never talks to the internet.
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'ftp://*/*'] }, (_d, cb) =>
    cb({ cancel: true }),
  );
  // Block downloads (e.g. the PDF viewer's save button) so plaintext never lands on disk unnoticed.
  ses.on('will-download', (e) => e.preventDefault());
  ses.setSpellCheckerEnabled(false);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'VLT',
    backgroundColor: '#0b0f17',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      partition: PARTITION,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
      plugins: true, // built-in PDF viewer
      devTools: !app.isPackaged,
    },
  });
  // Prevents screenshots / screen recording / screen sharing of the vault window on Windows.
  win.setContentProtection(true);
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    win = null;
  });
  win.loadFile(RENDERER_HTML);
}

// ------------------------------------------------------------------ IPC

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!event.senderFrame || event.senderFrame.url.split('#')[0] !== RENDERER_URL) {
      return { ok: false, code: 'BLOCKED', error: 'Blocked' };
    }
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, code: err.code || 'ERROR', error: (err && err.message) || String(err) };
    }
  });
}

function str(v, max = 10000) {
  if (typeof v !== 'string' || v.length > max) throw Object.assign(new Error('Invalid input'), { code: 'BAD_INPUT' });
  return v;
}

async function importPaths(paths) {
  const added = [];
  const failed = [];
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    const name = path.basename(p);
    try {
      const st = await fsp.stat(p);
      if (!st.isFile()) throw new Error('Folders are not supported, add the files inside instead.');
      let lastSent = 0;
      added.push(
        await vault.addFile(p, {
          onProgress: (done, total) => {
            lastActivity = Date.now();
            if (Date.now() - lastSent > 150 || done === total) {
              lastSent = Date.now();
              send('import:progress', { name, index: i + 1, count: paths.length, done, total });
            }
          },
        }),
      );
    } catch (err) {
      failed.push({ name, error: err.message });
    }
  }
  send('import:progress', { finished: true });
  return { added, failed };
}

// Windows-safe file name (no reserved characters, names or trailing dots/spaces).
function safeFileName(name) {
  let n = String(name || 'file').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(n)) n = `_${n}`;
  return n.slice(0, 200) || 'file';
}

// Picks "name (2).ext", "name (3).ext"... if the name is taken on disk or earlier in this export.
async function uniquePath(dir, name, used) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? name : `${stem} (${i})${ext}`;
    const full = path.join(dir, candidate);
    if (used.has(candidate.toLowerCase())) continue;
    try {
      await fsp.access(full);
    } catch {
      used.add(candidate.toLowerCase());
      return full;
    }
  }
}

function registerIpc() {
  ipcMain.on('activity', (event) => {
    if (event.senderFrame && event.senderFrame.url.split('#')[0] === RENDERER_URL) lastActivity = Date.now();
  });

  handle('app:info', () => ({ version: app.getVersion(), vaultPath: VAULT_DIR, packaged: app.isPackaged }));
  handle('vault:status', () => vault.status());

  handle('vault:create', async (password) => {
    await vault.create(str(password, 1024));
    unlocked();
  });
  handle('vault:unlock', async (password) => {
    const r = await vault.unlockPassword(str(password, 1024));
    if (r.ok) unlocked();
    return r;
  });
  handle('vault:mfa', async (code) => {
    const r = await vault.unlockMfa(str(code, 64));
    if (r.ok) unlocked();
    return r;
  });
  handle('vault:cancelMfa', () => vault.cancelMfa());
  handle('vault:lock', () => lockVault('manual'));
  handle('vault:restore', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose a VLT backup folder',
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return false;
    await vault.restoreFrom(res.filePaths[0]);
    return true;
  });

  handle('items:list', () => vault.listItems());
  handle('note:create', (data) => vault.createNote({ title: str(data.title || '', 1000), body: str(data.body || '', 50e6) }));
  handle('note:get', (id) => vault.getNote(str(id, 64)));
  handle('note:update', (id, data) =>
    vault.updateNote(str(id, 64), {
      title: data.title === undefined ? undefined : str(data.title, 1000),
      body: data.body === undefined ? undefined : str(data.body, 50e6),
    }),
  );
  handle('item:rename', (id, name) => vault.rename(str(id, 64), str(name, 1000)));
  handle('item:delete', (id) => vault.deleteItem(str(id, 64)));

  handle('files:pick', async () => {
    const res = await dialog.showOpenDialog(win, { title: 'Add files to VLT', properties: ['openFile', 'multiSelections'] });
    if (res.canceled) return { added: [], failed: [] };
    return importPaths(res.filePaths);
  });
  handle('files:addPaths', (paths) => {
    if (!Array.isArray(paths)) throw new Error('Invalid input');
    return importPaths(paths.map((p) => str(p, 4096)));
  });

  handle('item:mediaUrl', (id) => {
    vault.getItem(str(id, 64));
    return `vlt://media/${mediaToken}/${id}`;
  });
  handle('item:text', async (id) => (await vault.readAll(str(id, 64), TEXT_PREVIEW_MAX)).toString('utf8'));
  handle('item:docx', async (id) => {
    const mammoth = require('mammoth');
    const buffer = await vault.readAll(str(id, 64), DOCX_PREVIEW_MAX);
    const { value } = await mammoth.convertToHtml({ buffer });
    return value;
  });
  handle('item:export', async (id) => {
    const item = vault.getItem(str(id, 64));
    const res = await dialog.showSaveDialog(win, {
      title: 'Export decrypted copy',
      defaultPath: path.join(app.getPath('downloads'), item.name),
    });
    if (res.canceled || !res.filePath) return null;
    await vault.exportFile(id, res.filePath);
    shell.showItemInFolder(res.filePath);
    return res.filePath;
  });
  handle('items:deleteMany', (ids) => {
    if (!Array.isArray(ids) || ids.length > 100000) throw new Error('Invalid input');
    return vault.deleteItems(ids.map((id) => str(id, 64)));
  });
  handle('items:exportMany', async (ids) => {
    if (!Array.isArray(ids) || ids.length > 100000) throw new Error('Invalid input');
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose a folder for the exported (unencrypted) copies',
      defaultPath: app.getPath('downloads'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const dir = res.filePaths[0];
    const used = new Set();
    let exported = 0;
    const failed = [];
    for (let i = 0; i < ids.length; i++) {
      let item;
      try {
        item = vault.getItem(str(ids[i], 64));
        const base = item.kind === 'note' ? `${item.title}.txt` : item.name;
        const file = await uniquePath(dir, safeFileName(base), used);
        send('bulk:progress', { label: `Exporting ${path.basename(file)}`, index: i + 1, count: ids.length });
        lastActivity = Date.now();
        if (item.kind === 'note') await fsp.writeFile(file, vault.getNote(item.id).body, { flag: 'wx' });
        else await vault.exportFile(item.id, file);
        exported++;
      } catch (err) {
        failed.push({ name: item ? item.name || item.title : ids[i], error: err.message });
      }
    }
    send('bulk:progress', { finished: true });
    if (exported) shell.openPath(dir);
    return { dir, exported, failed };
  });
  handle('item:openExternal', async (id) => {
    const item = vault.getItem(str(id, 64));
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX));
    tempDirs.add(dir);
    const file = path.join(dir, safeFileName(item.name));
    await vault.exportFile(id, file);
    const err = await shell.openPath(file);
    if (err) throw new Error(err);
  });

  handle('settings:get', () => vault.getSettings());
  handle('settings:set', (s) => vault.setSettings({ autoLockMinutes: s.autoLockMinutes }));
  handle('password:change', (cur, next) => vault.changePassword(str(cur, 1024), str(next, 1024)));

  handle('mfa:begin', async () => {
    const QRCode = require('qrcode');
    const { secret, uri } = vault.beginMfaSetup();
    const qr = await QRCode.toDataURL(uri, { margin: 1, width: 260, errorCorrectionLevel: 'M' });
    return { secret, qr };
  });
  handle('mfa:confirm', (code) => vault.confirmMfaSetup(str(code, 64)));
  handle('mfa:disable', (password) => vault.disableMfa(str(password, 1024)));

  handle('backup:create', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose where to save the encrypted backup (e.g. a USB drive)',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return vault.backupTo(res.filePaths[0]);
  });

  handle('update:check', (opts) => updater.check({ install: !!(opts && opts.install) }));
}

// ------------------------------------------------------------------ app lifecycle

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    fs.mkdirSync(path.dirname(VAULT_DIR), { recursive: true });
    hardenSession(session.fromPartition(PARTITION));
    registerIpc();
    updater.init({
      send: (s) => send('update:status', s),
      beforeInstall: async () => {
        await lockVault('update');
        cleanedUp = true;
      },
    });
    createWindow();
    removeStaleTemp();
    powerMonitor.on('lock-screen', () => lockVault('system'));
    powerMonitor.on('suspend', () => lockVault('system'));
    // Quiet check at startup; installing only happens when you click the button.
    if (app.isPackaged) setTimeout(() => updater.check({ install: false }), 8000);
  });

  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-navigate', (e) => e.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', (e) => {
    if (cleanedUp) return;
    e.preventDefault();
    (async () => {
      try {
        await lockVault('quit');
      } finally {
        cleanedUp = true;
        app.quit();
      }
    })();
  });
}
