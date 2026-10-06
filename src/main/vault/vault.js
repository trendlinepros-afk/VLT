'use strict';

// VLT vault storage engine.
//
// On-disk layout (all inside the vault directory):
//
//   vault.json      Header. Argon2id salt/params, the master key encrypted with the
//                   password-derived key, and an encrypted "secure" section holding
//                   MFA secrets and settings. Contains no readable personal data.
//   state.json      Failed unlock attempt counter.
//   index.enc       Encrypted list of items (names, types, sizes, note text).
//   index.enc.bak   Previous generation of index.enc (crash safety).
//   blobs/<id>.bin  Encrypted file contents, split into authenticated chunks so
//                   videos can be streamed/seeked without decrypting to disk.
//
// Key hierarchy:
//   password --Argon2id--> KEK --AES-GCM unwrap--> master key (random 256-bit)
//   master key --HKDF--> index key, secure-section key, one key per file

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const c = require('./crypto');
const totp = require('./totp');
const { mimeFor, categoryFor } = require('./mime');
const { writeFileAtomic, renameWithRetry, exists, copyDir, overwriteRandom, Mutex } = require('./fsutil');

const FORMAT = 1;
const APP_ID = 'VLT';
const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_CHUNK = 512 * 1024;
const MIN_PASSWORD = 8;

const AAD_WRAP = 'VLT/v1/wrapped-key';
const AAD_SECURE = 'VLT/v1/secure';
const AAD_INDEX = 'VLT/v1/index';

const BLOB_MAGIC = Buffer.from('VLTB');
const BLOB_HEADER_LEN = 28; // magic(4) version(1) reserved(3) chunkSize(4) salt(16)
const TAG_LEN = 16;

class VaultError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function newId() {
  return c.randomBytes(16).toString('hex');
}

function chunkIv(i) {
  const iv = Buffer.alloc(12);
  iv.writeBigUInt64BE(BigInt(i), 4);
  return iv;
}

// Binds each chunk to the file header, its position and whether it is the last
// chunk, so chunks can't be reordered, swapped between files or truncated.
function chunkAad(header, i, final) {
  const aad = Buffer.alloc(header.length + 9);
  header.copy(aad, 0);
  aad.writeBigUInt64BE(BigInt(i), header.length);
  aad[header.length + 8] = final ? 1 : 0;
  return aad;
}

function encryptChunk(key, header, i, final, plain) {
  const cipher = crypto.createCipheriv('aes-256-gcm', key, chunkIv(i));
  cipher.setAAD(chunkAad(header, i, final));
  return Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
}

function decryptChunk(key, header, i, final, data) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, chunkIv(i));
  decipher.setAAD(chunkAad(header, i, final));
  decipher.setAuthTag(data.subarray(data.length - TAG_LEN));
  return Buffer.concat([decipher.update(data.subarray(0, data.length - TAG_LEN)), decipher.final()]);
}

async function readFull(fh, size) {
  const buf = Buffer.allocUnsafe(size);
  let off = 0;
  while (off < size) {
    const { bytesRead } = await fh.read(buf, off, size - off, null);
    if (!bytesRead) break;
    off += bytesRead;
  }
  return buf.subarray(0, off);
}

function cleanName(name, fallback) {
  const s = String(name ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 255);
  return s || fallback;
}

class Vault {
  constructor(dir, opts = {}) {
    this.dir = dir;
    this.kdf = opts.kdf || c.DEFAULT_KDF;
    this.maxAttempts = opts.maxAttempts || DEFAULT_MAX_ATTEMPTS;
    this.chunkSize = opts.chunkSize || DEFAULT_CHUNK;
    this.p = {
      header: path.join(dir, 'vault.json'),
      state: path.join(dir, 'state.json'),
      index: path.join(dir, 'index.enc'),
      indexBak: path.join(dir, 'index.enc.bak'),
      blobs: path.join(dir, 'blobs'),
    };
    this._mutex = new Mutex();
    this._clearKeys();
  }

  // ---------------------------------------------------------------- state

  _clearKeys() {
    c.wipe(this._dek);
    c.wipe(this._indexKey);
    c.wipe(this._secureKey);
    if (this._pending) c.wipe(this._pending.dek);
    this._dek = null;
    this._indexKey = null;
    this._secureKey = null;
    this._header = null;
    this._secure = null;
    this._index = null;
    this._pending = null;
    this._mfaSetup = null;
  }

  isUnlocked() {
    return !!this._dek;
  }

  async exists() {
    return exists(this.p.header);
  }

  _requireUnlocked() {
    if (!this._dek) throw new VaultError('LOCKED', 'The vault is locked.');
  }

  async _readHeader() {
    let header;
    try {
      header = JSON.parse(await fsp.readFile(this.p.header, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') throw new VaultError('NO_VAULT', 'No vault exists yet.');
      throw new VaultError('CORRUPT', 'The vault header could not be read.');
    }
    if (header.app !== APP_ID || !Number.isInteger(header.format)) {
      throw new VaultError('CORRUPT', 'The vault header is not valid.');
    }
    if (header.format > FORMAT) {
      throw new VaultError('TOO_NEW', 'This vault was created by a newer version of VLT. Update VLT to open it.');
    }
    return header;
  }

  async _readState() {
    try {
      const s = JSON.parse(await fsp.readFile(this.p.state, 'utf8'));
      return { failedAttempts: Number.isInteger(s.failedAttempts) && s.failedAttempts > 0 ? s.failedAttempts : 0 };
    } catch {
      return { failedAttempts: 0 };
    }
  }

  async _writeState(state) {
    await writeFileAtomic(this.p.state, JSON.stringify(state));
  }

  async status() {
    const ex = await this.exists();
    const { failedAttempts } = ex ? await this._readState() : { failedAttempts: 0 };
    return {
      exists: ex,
      unlocked: this.isUnlocked(),
      mfaPending: !!this._pending,
      failedAttempts,
      remainingAttempts: Math.max(0, this.maxAttempts - failedAttempts),
      maxAttempts: this.maxAttempts,
    };
  }

  // ---------------------------------------------------------------- create / unlock

  async create(password) {
    return this._mutex.run(async () => {
      if (await this.exists()) throw new VaultError('EXISTS', 'A vault already exists.');
      if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
        throw new VaultError('WEAK_PASSWORD', `Password must be at least ${MIN_PASSWORD} characters.`);
      }
      await fsp.mkdir(this.p.blobs, { recursive: true });

      const dek = c.randomBytes(32);
      const salt = c.randomBytes(16);
      const kek = await c.deriveKey(password, salt, this.kdf);
      const now = Date.now();
      const header = {
        app: APP_ID,
        format: FORMAT,
        createdAt: now,
        kdf: { ...this.kdf, salt: c.b64(salt) },
        wrappedKey: c.seal(kek, dek, AAD_WRAP),
      };
      c.wipe(kek);
      const secure = { createdAt: now, mfa: { enabled: false }, settings: { autoLockMinutes: 5 } };

      this._setKeys(dek, header, secure);
      this._index = { version: 1, items: {} };
      await this._writeIndex();
      await this._writeState({ failedAttempts: 0 });
      // The header is written last: its presence is what marks the vault as existing.
      await this._writeHeader();
    });
  }

  _setKeys(dek, header, secure) {
    this._dek = dek;
    this._indexKey = c.hkdf(dek, 'VLT/v1/index');
    this._secureKey = c.hkdf(dek, 'VLT/v1/secure');
    this._header = header;
    this._secure = secure;
  }

  async _registerFailure(failedBefore) {
    const failed = failedBefore + 1;
    if (failed >= this.maxAttempts) {
      await this._nuke();
      return { ok: false, nuked: true, remainingAttempts: 0 };
    }
    return { ok: false, remainingAttempts: this.maxAttempts - failed };
  }

  async unlockPassword(password) {
    return this._mutex.run(async () => {
      if (this._dek) return { ok: true };
      const header = await this._readHeader();
      const { failedAttempts } = await this._readState();
      if (failedAttempts >= this.maxAttempts) {
        await this._nuke();
        return { ok: false, nuked: true, remainingAttempts: 0 };
      }
      // Count the attempt *before* checking it so killing the app mid-check can't skip the counter.
      await this._writeState({ failedAttempts: failedAttempts + 1 });

      let dek = null;
      let kek = null;
      try {
        kek = await c.deriveKey(String(password ?? ''), c.unb64(header.kdf.salt), header.kdf);
        dek = c.open(kek, header.wrappedKey, AAD_WRAP);
      } catch {
        dek = null;
      } finally {
        c.wipe(kek);
      }
      if (!dek) return this._registerFailure(failedAttempts);

      // Correct password: undo the pre-count (earlier failures still count until fully unlocked).
      await this._writeState({ failedAttempts });
      const secure = JSON.parse(c.open(c.hkdf(dek, 'VLT/v1/secure'), header.secure, AAD_SECURE).toString('utf8'));

      if (secure.mfa && secure.mfa.enabled) {
        this._pending = { dek, header, secure };
        return { ok: false, mfaRequired: true, remainingAttempts: this.maxAttempts - failedAttempts };
      }
      await this._finishUnlock(dek, header, secure);
      return { ok: true };
    });
  }

  async unlockMfa(code) {
    return this._mutex.run(async () => {
      if (this._dek) return { ok: true };
      if (!this._pending) throw new VaultError('NO_PENDING', 'Enter your password first.');
      const { failedAttempts } = await this._readState();
      if (failedAttempts >= this.maxAttempts) {
        await this._nuke();
        return { ok: false, nuked: true, remainingAttempts: 0 };
      }
      await this._writeState({ failedAttempts: failedAttempts + 1 });

      const { dek, header, secure } = this._pending;
      let ok = totp.verifyTotp(secure.mfa.secret, code);
      let usedRecovery = false;
      if (!ok) {
        const norm = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (norm.length === 10) {
          const hash = c.sha256(Buffer.from(norm)).toString('hex');
          const idx = (secure.mfa.recovery || []).findIndex((h) => c.timingSafeEqualStr(h, hash));
          if (idx !== -1) {
            secure.mfa.recovery.splice(idx, 1);
            ok = true;
            usedRecovery = true;
          }
        }
      }
      if (!ok) return this._registerFailure(failedAttempts);

      this._pending = null;
      await this._finishUnlock(dek, header, secure);
      if (usedRecovery) await this._writeHeader();
      return { ok: true, usedRecovery, recoveryCodesLeft: usedRecovery ? secure.mfa.recovery.length : undefined };
    });
  }

  cancelMfa() {
    if (this._pending) c.wipe(this._pending.dek);
    this._pending = null;
  }

  async _finishUnlock(dek, header, secure) {
    this._setKeys(dek, header, secure);
    try {
      this._index = await this._loadIndex();
      await this._migrate();
      await this._cleanupTemp();
      await this._writeState({ failedAttempts: 0 });
    } catch (err) {
      this._clearKeys();
      throw err;
    }
  }

  lock() {
    this._clearKeys();
  }

  // Waits for any in-flight write to finish, then locks.
  async lockSafely() {
    await this._mutex.run(async () => {});
    this.lock();
  }

  // Upgrades older vault formats. Before touching anything the header and index
  // are copied to a backup folder so an update can never lose data.
  async _migrate() {
    const from = this._header.format;
    if (from === FORMAT) return;
    const backupDir = path.join(this.dir, `pre-upgrade-backup-v${from}-${Date.now()}`);
    await copyDir(this.dir, backupDir, (name) => name !== 'blobs' && !name.startsWith('pre-upgrade-backup'));
    // Future format migrations go here, e.g. if (from < 2) { ... }
    this._header.format = FORMAT;
    await this._writeHeader();
  }

  async _cleanupTemp() {
    await fsp.mkdir(this.p.blobs, { recursive: true });
    for (const name of await fsp.readdir(this.p.blobs)) {
      if (name.endsWith('.tmp')) await fsp.rm(path.join(this.p.blobs, name), { force: true });
    }
  }

  // ---------------------------------------------------------------- header / index persistence

  async _writeHeader() {
    this._header.secure = c.seal(this._secureKey, Buffer.from(JSON.stringify(this._secure)), AAD_SECURE);
    await writeFileAtomic(this.p.header, JSON.stringify(this._header, null, 2));
  }

  _decodeIndex(raw) {
    const box = JSON.parse(raw);
    const idx = JSON.parse(c.open(this._indexKey, box, AAD_INDEX).toString('utf8'));
    if (!idx || typeof idx.items !== 'object') throw new Error('bad index');
    return idx;
  }

  async _loadIndex() {
    for (const file of [this.p.index, this.p.indexBak]) {
      try {
        return this._decodeIndex(await fsp.readFile(file, 'utf8'));
      } catch {
        // try the next copy
      }
    }
    throw new VaultError('INDEX_CORRUPT', 'The vault index could not be read. Your files have not been touched.');
  }

  async _writeIndex() {
    const box = c.seal(this._indexKey, Buffer.from(JSON.stringify(this._index)), AAD_INDEX);
    if (await exists(this.p.index)) {
      try {
        // Keep the previous good generation before replacing it.
        this._decodeIndex(await fsp.readFile(this.p.index, 'utf8'));
        await fsp.copyFile(this.p.index, this.p.indexBak);
      } catch {
        // current index unreadable: leave the existing backup alone
      }
    }
    await writeFileAtomic(this.p.index, JSON.stringify(box));
  }

  _mutateIndex(fn) {
    return this._mutex.run(async () => {
      this._requireUnlocked();
      const result = await fn(this._index.items);
      await this._writeIndex();
      return result;
    });
  }

  // ---------------------------------------------------------------- items

  // ---- folders
  //
  // Folders are index entries ({ kind: 'folder', name, parent }). Every item has an
  // optional `parent` folder id; missing/unknown parents mean "top level", so vaults
  // created before folders existed need no migration. Moving only changes `parent`:
  // encrypted file contents are never rewritten.

  _parentOf(item, items = this._index.items) {
    const p = item.parent;
    return p && items[p] && items[p].kind === 'folder' ? p : null;
  }

  // Throws unless `parent` is null (top level) or an existing folder.
  _checkParent(items, parent) {
    if (parent === null || parent === undefined || parent === '') return null;
    if (!items[parent] || items[parent].kind !== 'folder') throw new VaultError('NO_FOLDER', 'That folder no longer exists.');
    return parent;
  }

  // True if `folderId` is `ancestorId` or somewhere inside it.
  _isWithin(items, folderId, ancestorId) {
    const seen = new Set();
    for (let cur = folderId; cur && !seen.has(cur); cur = this._parentOf(items[cur] || {}, items)) {
      if (cur === ancestorId) return true;
      seen.add(cur);
    }
    return false;
  }

  // The given ids plus, for folders, everything inside them.
  _withDescendants(items, ids) {
    const out = new Set();
    const queue = [...ids].filter((id) => items[id]);
    while (queue.length) {
      const id = queue.pop();
      if (out.has(id)) continue;
      out.add(id);
      if (items[id].kind === 'folder') {
        for (const it of Object.values(items)) if (this._parentOf(it, items) === id) queue.push(it.id);
      }
    }
    return out;
  }

  async createFolder({ name, parent } = {}) {
    const now = Date.now();
    const folder = await this._mutateIndex((items) => {
      const f = { id: newId(), kind: 'folder', name: cleanName(name, 'New folder'), parent: this._checkParent(items, parent), created: now, modified: now };
      items[f.id] = f;
      return f;
    });
    return this._publicItem(folder);
  }

  // Moves items (files, notes or folders) into `target` (a folder id, or null for top level).
  async move(ids, target) {
    return this._mutateIndex((items) => {
      const dest = this._checkParent(items, target);
      let moved = 0;
      for (const id of new Set(ids)) {
        const it = items[id];
        if (!it) continue;
        if (it.kind === 'folder' && dest && this._isWithin(items, dest, id)) {
          throw new VaultError('BAD_MOVE', `Can't move the folder "${it.name}" into itself.`);
        }
        if (this._parentOf(it, items) === dest) continue;
        it.parent = dest;
        it.modified = Date.now();
        moved++;
      }
      return moved;
    });
  }

  _publicItem(item) {
    const base = { id: item.id, kind: item.kind, parent: this._index ? this._parentOf(item) : null, created: item.created, modified: item.modified };
    if (item.kind === 'folder') return { ...base, name: item.name, category: 'folders' };
    if (item.kind === 'note') {
      return { ...base, name: item.title, category: 'notes', preview: String(item.body || '').slice(0, 160) };
    }
    return { ...base, name: item.name, mime: item.mime, category: categoryFor(item.mime), size: item.size };
  }

  listItems() {
    this._requireUnlocked();
    return Object.values(this._index.items)
      .map((i) => this._publicItem(i))
      .sort((a, b) => b.modified - a.modified);
  }

  getItem(id) {
    this._requireUnlocked();
    const item = this._index.items[id];
    if (!item) throw new VaultError('NOT_FOUND', 'Item not found.');
    return item;
  }

  async createNote({ title, body, parent } = {}) {
    const now = Date.now();
    const note = { id: newId(), kind: 'note', title: cleanName(title, 'Untitled note'), body: String(body ?? ''), created: now, modified: now };
    await this._mutateIndex((items) => {
      note.parent = this._checkParent(items, parent);
      items[note.id] = note;
    });
    return this._publicItem(note);
  }

  getNote(id) {
    const item = this.getItem(id);
    if (item.kind !== 'note') throw new VaultError('NOT_NOTE', 'Not a note.');
    return { id: item.id, title: item.title, body: item.body, created: item.created, modified: item.modified };
  }

  async updateNote(id, { title, body }) {
    return this._mutateIndex((items) => {
      const item = items[id];
      if (!item || item.kind !== 'note') throw new VaultError('NOT_FOUND', 'Note not found.');
      if (title !== undefined) item.title = cleanName(title, 'Untitled note');
      if (body !== undefined) item.body = String(body);
      item.modified = Date.now();
      return this._publicItem(item);
    });
  }

  async rename(id, name) {
    return this._mutateIndex((items) => {
      const item = items[id];
      if (!item) throw new VaultError('NOT_FOUND', 'Item not found.');
      if (item.kind === 'note') item.title = cleanName(name, item.title);
      else item.name = cleanName(name, item.name);
      item.modified = Date.now();
      return this._publicItem(item);
    });
  }

  async deleteItem(id) {
    this.getItem(id);
    await this.deleteItems([id]);
  }

  // Deletes several items with a single index write. Deleting a folder deletes
  // everything inside it. Unknown ids are skipped. Returns the number removed.
  async deleteItems(ids) {
    const removed = await this._mutateIndex((items) => {
      const out = [];
      for (const id of this._withDescendants(items, ids)) {
        out.push(items[id]);
        delete items[id];
      }
      return out;
    });
    for (const it of removed) {
      if (it.kind === 'file') await fsp.rm(this._blobPath(it.id), { force: true });
    }
    return removed.length;
  }

  _blobPath(id) {
    if (!/^[0-9a-f]{32}$/.test(id)) throw new VaultError('BAD_ID', 'Invalid id.');
    return path.join(this.p.blobs, `${id}.bin`);
  }

  _fileKey(dek, id, salt) {
    return c.hkdf(dek, `VLT/v1/file/${id}`, salt);
  }

  // Encrypts a file from disk into the vault. Plaintext is never written anywhere.
  async addFile(srcPath, { name, parent, onProgress } = {}) {
    this._requireUnlocked();
    const stat = await fsp.stat(srcPath);
    if (!stat.isFile()) throw new VaultError('NOT_FILE', 'Not a file: ' + srcPath);
    const id = newId();
    const fileName = cleanName(name || path.basename(srcPath), 'file');
    const blobPath = this._blobPath(id);
    const tmp = `${blobPath}.tmp`;
    const dek = Buffer.from(this._dek);
    const cs = this.chunkSize;

    const header = Buffer.alloc(BLOB_HEADER_LEN);
    BLOB_MAGIC.copy(header, 0);
    header[4] = 1;
    header.writeUInt32BE(cs, 8);
    const salt = c.randomBytes(16);
    salt.copy(header, 12);
    const key = this._fileKey(dek, id, salt);
    c.wipe(dek);

    let total = 0;
    const src = await fsp.open(srcPath, 'r');
    const out = await fsp.open(tmp, 'w');
    try {
      await out.write(header);
      let cur = await readFull(src, cs);
      for (let i = 0; ; i++) {
        const next = cur.length < cs ? Buffer.alloc(0) : await readFull(src, cs);
        const final = next.length === 0;
        await out.write(encryptChunk(key, header, i, final, cur));
        total += cur.length;
        if (onProgress) onProgress(total, stat.size);
        if (final) break;
        if (!this._dek) throw new VaultError('LOCKED', 'The vault was locked during import.');
        cur = next;
      }
      await out.sync();
    } catch (err) {
      await out.close().catch(() => {});
      await fsp.rm(tmp, { force: true });
      throw err;
    } finally {
      await src.close().catch(() => {});
      c.wipe(key);
    }
    await out.close();

    const now = Date.now();
    const item = { id, kind: 'file', name: fileName, mime: mimeFor(fileName), size: total, created: now, modified: now };
    try {
      await this._mutateIndex(async (items) => {
        await renameWithRetry(tmp, blobPath);
        // If the target folder was deleted during a long import, keep the file at top level.
        item.parent = parent && items[parent] && items[parent].kind === 'folder' ? parent : null;
        items[id] = item;
      });
    } catch (err) {
      await fsp.rm(tmp, { force: true });
      throw err;
    }
    return this._publicItem(item);
  }

  // Decrypts bytes [start, end] (inclusive) of a file, yielding Buffers. Used for
  // streaming photos/videos/documents straight into the viewer.
  async *readRange(id, start = 0, end) {
    const item = this.getItem(id);
    if (item.kind !== 'file') throw new VaultError('NOT_FILE', 'Not a file.');
    const size = item.size;
    if (size === 0) return;
    end = Math.min(end === undefined ? size - 1 : end, size - 1);
    if (start < 0 || start > end) return;

    const fh = await fsp.open(this._blobPath(id), 'r');
    let key = null;
    try {
      const header = await readFull(fh, BLOB_HEADER_LEN);
      if (header.length !== BLOB_HEADER_LEN || !header.subarray(0, 4).equals(BLOB_MAGIC) || header[4] !== 1) {
        throw new VaultError('CORRUPT_FILE', 'Encrypted file is damaged.');
      }
      const cs = header.readUInt32BE(8);
      const n = Math.max(1, Math.ceil(size / cs));
      const { size: diskSize } = await fh.stat();
      if (diskSize !== BLOB_HEADER_LEN + size + n * TAG_LEN) throw new VaultError('CORRUPT_FILE', 'Encrypted file is damaged.');
      this._requireUnlocked();
      key = this._fileKey(this._dek, id, header.subarray(12, 28));

      for (let i = Math.floor(start / cs); i <= Math.floor(end / cs); i++) {
        if (!this._dek) throw new VaultError('LOCKED', 'The vault is locked.');
        const plainLen = i === n - 1 ? size - i * cs : cs;
        const buf = Buffer.allocUnsafe(plainLen + TAG_LEN);
        const { bytesRead } = await fh.read(buf, 0, buf.length, BLOB_HEADER_LEN + i * (cs + TAG_LEN));
        if (bytesRead !== buf.length) throw new VaultError('CORRUPT_FILE', 'Encrypted file is damaged.');
        const plain = decryptChunk(key, header, i, i === n - 1, buf);
        const from = Math.max(start - i * cs, 0);
        const to = Math.min(end - i * cs + 1, plainLen);
        yield plain.subarray(from, to);
      }
    } finally {
      c.wipe(key);
      await fh.close();
    }
  }

  async readAll(id, maxBytes = Infinity) {
    const item = this.getItem(id);
    if (item.size > maxBytes) throw new VaultError('TOO_LARGE', 'File is too large to preview.');
    const parts = [];
    for await (const part of this.readRange(id)) parts.push(Buffer.from(part));
    return Buffer.concat(parts);
  }

  // Writes a decrypted copy to destPath (user-chosen export location).
  async exportFile(id, destPath) {
    const tmp = `${destPath}.vltpart`;
    const fh = await fsp.open(tmp, 'w');
    try {
      for await (const part of this.readRange(id)) await fh.write(part);
      await fh.sync();
    } catch (err) {
      await fh.close().catch(() => {});
      await fsp.rm(tmp, { force: true });
      throw err;
    }
    await fh.close();
    await fsp.rm(destPath, { force: true });
    await renameWithRetry(tmp, destPath);
  }

  // ---------------------------------------------------------------- settings

  getSettings() {
    this._requireUnlocked();
    return {
      autoLockMinutes: this._secure.settings?.autoLockMinutes ?? 5,
      mfaEnabled: !!this._secure.mfa?.enabled,
      recoveryCodesLeft: this._secure.mfa?.enabled ? (this._secure.mfa.recovery || []).length : 0,
      createdAt: this._secure.createdAt,
    };
  }

  async setSettings({ autoLockMinutes }) {
    return this._mutex.run(async () => {
      this._requireUnlocked();
      this._secure.settings = this._secure.settings || {};
      if (autoLockMinutes !== undefined) {
        const m = Number(autoLockMinutes);
        if (!Number.isFinite(m) || m < 1 || m > 240) throw new VaultError('BAD_SETTING', 'Auto-lock must be 1-240 minutes.');
        this._secure.settings.autoLockMinutes = Math.round(m);
      }
      await this._writeHeader();
      return this.getSettings();
    });
  }

  // ---------------------------------------------------------------- password

  async _checkPassword(password) {
    let kek = null;
    try {
      kek = await c.deriveKey(String(password ?? ''), c.unb64(this._header.kdf.salt), this._header.kdf);
      const dek = c.open(kek, this._header.wrappedKey, AAD_WRAP);
      const same = dek.equals(this._dek);
      c.wipe(dek);
      return same;
    } catch {
      return false;
    } finally {
      c.wipe(kek);
    }
  }

  async changePassword(current, next) {
    return this._mutex.run(async () => {
      this._requireUnlocked();
      if (!(await this._checkPassword(current))) throw new VaultError('BAD_PASSWORD', 'Current password is incorrect.');
      if (typeof next !== 'string' || next.length < MIN_PASSWORD) {
        throw new VaultError('WEAK_PASSWORD', `Password must be at least ${MIN_PASSWORD} characters.`);
      }
      const salt = c.randomBytes(16);
      const kek = await c.deriveKey(next, salt, this.kdf);
      this._header.kdf = { ...this.kdf, salt: c.b64(salt) };
      this._header.wrappedKey = c.seal(kek, this._dek, AAD_WRAP);
      c.wipe(kek);
      await this._writeHeader();
    });
  }

  // ---------------------------------------------------------------- MFA

  beginMfaSetup() {
    this._requireUnlocked();
    const secret = totp.generateSecret();
    this._mfaSetup = secret;
    return { secret, uri: totp.otpauthUri(secret) };
  }

  async confirmMfaSetup(code) {
    return this._mutex.run(async () => {
      this._requireUnlocked();
      if (!this._mfaSetup) throw new VaultError('NO_SETUP', 'Start MFA setup first.');
      if (!totp.verifyTotp(this._mfaSetup, code)) throw new VaultError('BAD_CODE', 'That code is not correct. Check your phone and try again.');
      const codes = [];
      const hashes = [];
      for (let i = 0; i < 8; i++) {
        const raw = totp.base32Encode(c.randomBytes(7)).slice(0, 10);
        codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
        hashes.push(c.sha256(Buffer.from(raw)).toString('hex'));
      }
      this._secure.mfa = { enabled: true, secret: this._mfaSetup, recovery: hashes };
      this._mfaSetup = null;
      await this._writeHeader();
      return { recoveryCodes: codes };
    });
  }

  async disableMfa(password) {
    return this._mutex.run(async () => {
      this._requireUnlocked();
      if (!(await this._checkPassword(password))) throw new VaultError('BAD_PASSWORD', 'Password is incorrect.');
      this._secure.mfa = { enabled: false };
      await this._writeHeader();
    });
  }

  // ---------------------------------------------------------------- backup / restore / nuke

  // Copies the (still encrypted) vault to a folder the user picks.
  async backupTo(parentDir) {
    return this._mutex.run(async () => {
      this._requireUnlocked();
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      const dest = path.join(parentDir, `VLT-Backup-${stamp}`);
      await copyDir(this.dir, dest, (n) => n !== 'state.json' && !n.includes('.tmp') && !n.startsWith('pre-upgrade-backup'));
      return dest;
    });
  }

  static async isVaultFolder(dir) {
    try {
      const h = JSON.parse(await fsp.readFile(path.join(dir, 'vault.json'), 'utf8'));
      return h.app === APP_ID && Number.isInteger(h.format);
    } catch {
      return false;
    }
  }

  async restoreFrom(srcDir) {
    return this._mutex.run(async () => {
      if (await this.exists()) throw new VaultError('EXISTS', 'A vault already exists. It must be removed before restoring.');
      if (!(await Vault.isVaultFolder(srcDir))) throw new VaultError('NOT_BACKUP', 'That folder is not a VLT backup.');
      const staging = `${this.dir}.restoring`;
      await fsp.rm(staging, { recursive: true, force: true });
      await copyDir(srcDir, staging, (n) => n !== 'state.json' && !n.includes('.tmp'));
      await fsp.rm(this.dir, { recursive: true, force: true });
      await renameWithRetry(staging, this.dir);
    });
  }

  // Destroys the vault. The key material is overwritten first, which makes the
  // remaining encrypted file contents permanently unreadable.
  async _nuke() {
    this._clearKeys();
    for (const f of [this.p.header, this.p.index, this.p.indexBak, this.p.state]) await overwriteRandom(f);
    await fsp.rm(this.dir, { recursive: true, force: true, maxRetries: 5 });
  }
}

module.exports = { Vault, VaultError, FORMAT, MIN_PASSWORD };
