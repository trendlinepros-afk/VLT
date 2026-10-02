'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Windows antivirus / indexers sometimes hold a file open briefly; retry renames.
async function renameWithRetry(from, to, attempts = 10) {
  for (let i = 0; ; i++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (err) {
      if (i >= attempts - 1 || !['EPERM', 'EACCES', 'EBUSY'].includes(err.code)) throw err;
      await sleep(50 * (i + 1));
    }
  }
}

// Writes a file so that it is either fully the old content or fully the new
// content, even if the computer loses power mid-write.
async function writeFileAtomic(file, data) {
  const tmp = `${file}.tmp-${crypto.randomBytes(6).toString('hex')}`;
  const fh = await fsp.open(tmp, 'w');
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await renameWithRetry(tmp, file);
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
}

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(src, dest, filter = () => true) {
  await fsp.mkdir(dest, { recursive: true });
  for (const entry of await fsp.readdir(src, { withFileTypes: true })) {
    if (!filter(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d, filter);
    else if (entry.isFile()) await fsp.copyFile(s, d, fs.constants.COPYFILE_EXCL);
  }
}

// Overwrites a file with random bytes before it gets deleted.
async function overwriteRandom(file) {
  try {
    const { size } = await fsp.stat(file);
    const fh = await fsp.open(file, 'r+');
    try {
      const block = 1024 * 1024;
      for (let pos = 0; pos < size; pos += block) {
        const len = Math.min(block, size - pos);
        await fh.write(crypto.randomBytes(len), 0, len, pos);
      }
      await fh.sync();
    } finally {
      await fh.close();
    }
  } catch {
    // best effort
  }
}

// Simple async mutex so writes to the vault never interleave.
class Mutex {
  constructor() {
    this._last = Promise.resolve();
  }
  run(fn) {
    const result = this._last.then(fn, fn);
    this._last = result.catch(() => {});
    return result;
  }
}

module.exports = { writeFileAtomic, renameWithRetry, exists, copyDir, overwriteRandom, Mutex, sleep };
