'use strict';

// RFC 6238 time-based one-time passwords (compatible with Google Authenticator,
// Microsoft Authenticator, Authy, 1Password, etc).

const crypto = require('node:crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secretBuf, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', secretBuf).update(msg).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, '0');
}

function totp(secretB32, timeMs = Date.now(), step = 30, digits = 6) {
  return hotp(base32Decode(secretB32), Math.floor(timeMs / 1000 / step), digits);
}

// Accepts the current code and one step either side to allow for clock drift.
function verifyTotp(secretB32, code, timeMs = Date.now(), window = 1) {
  const clean = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  const secret = base32Decode(secretB32);
  const counter = Math.floor(timeMs / 1000 / 30);
  let ok = false;
  for (let i = -window; i <= window; i++) {
    const expected = hotp(secret, counter + i);
    // Constant-time comparison; check every window so timing doesn't leak which matched.
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) ok = true;
  }
  return ok;
}

function otpauthUri(secretB32, account = 'My Vault', issuer = 'VLT') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret: secretB32, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params.toString()}`;
}

module.exports = { base32Encode, base32Decode, generateSecret, totp, verifyTotp, otpauthUri };
