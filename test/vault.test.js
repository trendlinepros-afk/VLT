'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Vault } = require('../src/main/vault/vault');
const totp = require('../src/main/vault/totp');

// Small KDF params so tests run fast; production uses 128 MiB.
const FAST_KDF = { alg: 'argon2id', memKiB: 1024, iterations: 1, parallelism: 1 };
const PW = 'correct horse battery';

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'vlt-test-'));
}

async function newVault(opts = {}) {
  const root = await tmpDir();
  const dir = path.join(root, 'vault');
  const v = new Vault(dir, { kdf: FAST_KDF, chunkSize: 1024, ...opts });
  await v.create(PW);
  return { v, dir, root };
}

async function collect(gen) {
  const parts = [];
  for await (const p of gen) parts.push(Buffer.from(p));
  return Buffer.concat(parts);
}

test('create, lock, unlock with correct password', async () => {
  const { v, dir } = await newVault();
  assert.equal(v.isUnlocked(), true);
  await v.createNote({ title: 'Secret', body: 'my secret text' });
  v.lock();
  assert.equal(v.isUnlocked(), false);
  assert.throws(() => v.listItems(), /locked/);

  const v2 = new Vault(dir, { kdf: FAST_KDF });
  const res = await v2.unlockPassword(PW);
  assert.equal(res.ok, true);
  const items = v2.listItems();
  assert.equal(items.length, 1);
  assert.equal(v2.getNote(items[0].id).body, 'my secret text');
});

test('nothing readable on disk', async () => {
  const { v, dir } = await newVault();
  await v.createNote({ title: 'PlainTitleMarker', body: 'PlainBodyMarker' });
  const src = path.join(dir, '..', 'src.txt');
  await fsp.writeFile(src, 'FileContentMarker'.repeat(200));
  await v.addFile(src, { name: 'FileNameMarker.txt' });

  const all = [];
  const walk = async (d) => {
    for (const e of await fsp.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else all.push(await fsp.readFile(p));
    }
  };
  await walk(dir);
  const blob = Buffer.concat(all).toString('latin1');
  for (const marker of ['PlainTitleMarker', 'PlainBodyMarker', 'FileContentMarker', 'FileNameMarker', PW]) {
    assert.equal(blob.includes(marker), false, `found ${marker} on disk`);
  }
});

test('wrong passwords count down and 10th nukes the vault', async () => {
  const { v, dir } = await newVault();
  v.lock();
  for (let i = 1; i <= 9; i++) {
    const r = await v.unlockPassword('wrong-password-' + i);
    assert.equal(r.ok, false);
    assert.equal(r.remainingAttempts, 10 - i);
    assert.ok(!r.nuked);
  }
  assert.equal(fs.existsSync(path.join(dir, 'vault.json')), true);
  const r = await v.unlockPassword('wrong again');
  assert.equal(r.nuked, true);
  assert.equal(fs.existsSync(dir), false);
  assert.equal(await v.exists(), false);
});

test('correct password resets the counter', async () => {
  const { v } = await newVault();
  v.lock();
  for (let i = 0; i < 5; i++) await v.unlockPassword('nope nope');
  assert.equal((await v.status()).remainingAttempts, 5);
  assert.equal((await v.unlockPassword(PW)).ok, true);
  assert.equal((await v.status()).remainingAttempts, 10);
});

test('files round trip, including range reads across chunk boundaries', async () => {
  const { v, root } = await newVault();
  for (const size of [0, 1, 1023, 1024, 1025, 5000, 4096]) {
    const data = crypto.randomBytes(size);
    const src = path.join(root, `f${size}.bin`);
    await fsp.writeFile(src, data);
    const item = await v.addFile(src);
    assert.equal(item.size, size);
    assert.deepEqual(await v.readAll(item.id), data);
    if (size > 10) {
      for (const [s, e] of [[0, 0], [5, size - 1], [1000, Math.min(2100, size - 1)], [size - 3, size - 1]]) {
        assert.deepEqual(await collect(v.readRange(item.id, s, e)), data.subarray(s, e + 1), `range ${s}-${e} of ${size}`);
      }
    }
    const out = path.join(root, `out${size}.bin`);
    await v.exportFile(item.id, out);
    assert.deepEqual(await fsp.readFile(out), data);
  }
});

test('tampered or truncated file is rejected', async () => {
  const { v, root, dir } = await newVault();
  const src = path.join(root, 'x.bin');
  await fsp.writeFile(src, crypto.randomBytes(3000));
  const item = await v.addFile(src);
  const blob = path.join(dir, 'blobs', item.id + '.bin');
  const buf = await fsp.readFile(blob);
  buf[100] ^= 1;
  await fsp.writeFile(blob, buf);
  await assert.rejects(v.readAll(item.id));
  await fsp.writeFile(blob, buf.subarray(0, buf.length - 10));
  await assert.rejects(v.readAll(item.id), /damaged/);
});

test('index backup is used if main index is corrupted', async () => {
  const { v, dir } = await newVault();
  await v.createNote({ title: 'a' });
  await v.createNote({ title: 'b' });
  v.lock();
  await fsp.writeFile(path.join(dir, 'index.enc'), 'garbage');
  const v2 = new Vault(dir, { kdf: FAST_KDF });
  assert.equal((await v2.unlockPassword(PW)).ok, true);
  assert.equal(v2.listItems().length, 1); // previous generation
});

test('MFA: setup, required at unlock, wrong codes count, recovery code works once', async () => {
  const { v, dir } = await newVault();
  const { secret } = v.beginMfaSetup();
  await assert.rejects(v.confirmMfaSetup('000000'.replace(/./g, (d, i) => String((Number(totp.totp(secret)[i]) + 1) % 10))));
  const { recoveryCodes } = await v.confirmMfaSetup(totp.totp(secret));
  assert.equal(recoveryCodes.length, 8);
  v.lock();

  const v2 = new Vault(dir, { kdf: FAST_KDF });
  const r1 = await v2.unlockPassword(PW);
  assert.equal(r1.mfaRequired, true);
  assert.equal(v2.isUnlocked(), false);
  const bad = await v2.unlockMfa('123456' === totp.totp(secret) ? '654321' : '123456');
  assert.equal(bad.ok, false);
  assert.equal(bad.remainingAttempts, 9);
  assert.equal((await v2.unlockMfa(totp.totp(secret))).ok, true);
  assert.equal((await v2.status()).remainingAttempts, 10);
  v2.lock();

  await v2.unlockPassword(PW);
  const rec = await v2.unlockMfa(recoveryCodes[0].toLowerCase());
  assert.equal(rec.ok, true);
  assert.equal(rec.recoveryCodesLeft, 7);
  v2.lock();
  await v2.unlockPassword(PW);
  assert.equal((await v2.unlockMfa(recoveryCodes[0])).ok, false);
});

test('change password', async () => {
  const { v, dir } = await newVault();
  await v.createNote({ title: 'keep me' });
  await assert.rejects(v.changePassword('bad', 'new password 123'));
  await v.changePassword(PW, 'new password 123');
  v.lock();
  const v2 = new Vault(dir, { kdf: FAST_KDF });
  assert.equal((await v2.unlockPassword(PW)).ok, false);
  assert.equal((await v2.unlockPassword('new password 123')).ok, true);
  assert.equal(v2.listItems()[0].name, 'keep me');
});

test('backup and restore', async () => {
  const { v, root } = await newVault();
  await v.createNote({ title: 'backed up', body: 'body' });
  const backup = await v.backupTo(root);
  const dir2 = path.join(root, 'restored');
  const v2 = new Vault(dir2, { kdf: FAST_KDF });
  await v2.restoreFrom(backup);
  assert.equal((await v2.unlockPassword(PW)).ok, true);
  assert.equal(v2.listItems()[0].name, 'backed up');
  await assert.rejects(v2.restoreFrom(backup), /already exists/);
});

test('vault from a newer format is refused, not modified', async () => {
  const { v, dir } = await newVault();
  v.lock();
  const hp = path.join(dir, 'vault.json');
  const h = JSON.parse(await fsp.readFile(hp, 'utf8'));
  h.format = 99;
  await fsp.writeFile(hp, JSON.stringify(h));
  const before = await fsp.readFile(hp);
  await assert.rejects(v.unlockPassword(PW), /newer version/);
  assert.deepEqual(await fsp.readFile(hp), before);
  assert.equal((await v.status()).remainingAttempts, 10);
});

test('notes update, rename, delete', async () => {
  const { v, dir, root } = await newVault();
  const n = await v.createNote({ title: 't', body: 'b' });
  await v.updateNote(n.id, { body: 'b2' });
  assert.equal(v.getNote(n.id).body, 'b2');
  await v.rename(n.id, 'renamed');
  assert.equal(v.getNote(n.id).title, 'renamed');
  const src = path.join(root, 'f.txt');
  await fsp.writeFile(src, 'hello');
  const f = await v.addFile(src);
  assert.equal(f.category, 'documents');
  await v.deleteItem(f.id);
  assert.equal(fs.existsSync(path.join(dir, 'blobs', f.id + '.bin')), false);
  await v.deleteItem(n.id);
  assert.equal(v.listItems().length, 0);
});

test('totp matches RFC 6238 test vector', () => {
  const secret = totp.base32Encode(Buffer.from('12345678901234567890'));
  // RFC 6238 SHA1 vector at T=59s is 94287082 (8 digits); last 6 digits = 287082
  assert.equal(totp.totp(secret, 59 * 1000), '287082');
  assert.equal(totp.verifyTotp(secret, '287082', 59 * 1000), true);
  assert.equal(totp.verifyTotp(secret, '287083', 59 * 1000), false);
});

test('deleteItems removes several items and their encrypted files at once', async () => {
  const { v, dir, root } = await newVault();
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const src = path.join(root, `m${i}.txt`);
    await fsp.writeFile(src, 'x' + i);
    ids.push((await v.addFile(src)).id);
  }
  const note = await v.createNote({ title: 'keep' });
  const n = await v.deleteItems([ids[0], ids[2], 'ffffffffffffffffffffffffffffffff', ids[0]]);
  assert.equal(n, 2);
  assert.deepEqual(v.listItems().map((i) => i.id).sort(), [ids[1], note.id].sort());
  assert.equal(fs.existsSync(path.join(dir, 'blobs', ids[0] + '.bin')), false);
  assert.equal(fs.existsSync(path.join(dir, 'blobs', ids[1] + '.bin')), true);
  v.lock();
  const v2 = new Vault(dir, { kdf: FAST_KDF });
  await v2.unlockPassword(PW);
  assert.equal(v2.listItems().length, 2);
});

test('folders: create, nest, move, rename, block cycles, recursive delete', async () => {
  const { v, dir, root } = await newVault();
  const trips = await v.createFolder({ name: 'Trips' });
  const y2024 = await v.createFolder({ name: '2024', parent: trips.id });
  assert.equal(y2024.parent, trips.id);
  await assert.rejects(v.createFolder({ name: 'x', parent: 'ffffffffffffffffffffffffffffffff' }), /no longer exists/);

  const src = path.join(root, 'clip.mp4');
  await fsp.writeFile(src, crypto.randomBytes(3000));
  const vid = await v.addFile(src, { parent: y2024.id });
  assert.equal(vid.parent, y2024.id);
  const note = await v.createNote({ title: 'top' });
  assert.equal(note.parent, null);

  // move note into Trips, video to top level
  assert.equal(await v.move([note.id], trips.id), 1);
  assert.equal(await v.move([vid.id], null), 1);
  const byId = Object.fromEntries(v.listItems().map((i) => [i.id, i]));
  assert.equal(byId[note.id].parent, trips.id);
  assert.equal(byId[vid.id].parent, null);
  // moving doesn't touch encrypted contents
  assert.equal((await v.readAll(vid.id)).length, 3000);

  // a folder can't go into itself or its own subfolder
  await assert.rejects(v.move([trips.id], y2024.id), /into itself/);
  await assert.rejects(v.move([trips.id], trips.id), /into itself/);
  await assert.rejects(v.move([note.id], 'ffffffffffffffffffffffffffffffff'), /no longer exists/);

  await v.rename(y2024.id, '2024 Summer');
  assert.equal(v.listItems().find((i) => i.id === y2024.id).name, '2024 Summer');

  // put the video back inside the subfolder, then delete the top folder: everything inside goes
  await v.move([vid.id], y2024.id);
  const n = await v.deleteItems([trips.id]);
  assert.equal(n, 4); // Trips, 2024 Summer, note, video
  assert.equal(v.listItems().length, 0);
  assert.equal(fs.existsSync(path.join(dir, 'blobs', vid.id + '.bin')), false);

  // survives a lock/unlock
  const f = await v.createFolder({ name: 'Keep' });
  v.lock();
  const v2 = new Vault(dir, { kdf: FAST_KDF });
  await v2.unlockPassword(PW);
  assert.deepEqual(v2.listItems().map((i) => [i.name, i.kind, i.parent]), [['Keep', 'folder', null]]);
  assert.equal(v2.listItems()[0].id, f.id);
});

test('items whose folder is missing show at top level (older vaults have no parent field)', async () => {
  const { v } = await newVault();
  const note = await v.createNote({ title: 'legacy' });
  v._index.items[note.id].parent = 'ffffffffffffffffffffffffffffffff';
  delete v._index.items[note.id].parent;
  assert.equal(v.listItems()[0].parent, null);
  v._index.items[note.id].parent = 'ffffffffffffffffffffffffffffffff';
  assert.equal(v.listItems()[0].parent, null);
});
