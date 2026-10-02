'use strict';

// Cryptographic primitives used by the vault.
//
//  - Password -> key:   Argon2id (memory-hard, resists GPU/ASIC brute force)
//  - Encryption:        AES-256-GCM (authenticated: tampering is detected)
//  - Key separation:    HKDF-SHA256 derives independent sub-keys from the master key

const crypto = require('node:crypto');
const { argon2id } = require('hash-wasm');

// 128 MiB of memory and 3 passes. Takes roughly 0.5-1.5 s on a typical PC,
// which makes each password guess very expensive for an attacker.
const DEFAULT_KDF = Object.freeze({
  alg: 'argon2id',
  memKiB: 131072,
  iterations: 3,
  parallelism: 1,
});

function randomBytes(n) {
  return crypto.randomBytes(n);
}

function b64(buf) {
  return Buffer.from(buf).toString('base64');
}

function unb64(str) {
  return Buffer.from(str, 'base64');
}

async function deriveKey(password, salt, params) {
  if (params.alg !== 'argon2id') throw new Error('Unsupported KDF: ' + params.alg);
  const out = await argon2id({
    password: Buffer.from(String(password).normalize('NFC'), 'utf8'),
    salt,
    iterations: params.iterations,
    parallelism: params.parallelism,
    memorySize: params.memKiB,
    hashLength: 32,
    outputType: 'binary',
  });
  return Buffer.from(out);
}

function hkdf(key, info, salt = Buffer.alloc(0)) {
  return Buffer.from(crypto.hkdfSync('sha256', key, salt, Buffer.from(info, 'utf8'), 32));
}

// Encrypts a buffer into a JSON-friendly box.
function seal(key, plaintext, aad) {
  const iv = randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv: b64(iv), ct: b64(ct), tag: b64(cipher.getAuthTag()) };
}

// Decrypts a box produced by seal(). Throws if the key is wrong or data was modified.
function open(key, box, aad) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, unb64(box.iv));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(unb64(box.tag));
  return Buffer.concat([decipher.update(unb64(box.ct)), decipher.final()]);
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest();
}

function timingSafeEqualStr(a, b) {
  const ha = sha256(Buffer.from(String(a)));
  const hb = sha256(Buffer.from(String(b)));
  return crypto.timingSafeEqual(ha, hb);
}

function wipe(buf) {
  if (buf && typeof buf.fill === 'function') buf.fill(0);
}

module.exports = {
  DEFAULT_KDF,
  randomBytes,
  b64,
  unb64,
  deriveKey,
  hkdf,
  seal,
  open,
  sha256,
  timingSafeEqualStr,
  wipe,
};
