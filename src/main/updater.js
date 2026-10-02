'use strict';

// "Check for updates": asks GitHub Releases for a newer version, downloads it,
// verifies its SHA-512 checksum and installs it.
//
// The vault lives in %APPDATA%\VLT\vault, completely separate from the program
// files that the installer replaces, so updating never touches your data.

const { app } = require('electron');

let updater = null;
let busy = false;
let send = () => {};
let beforeInstall = async () => {};

function get() {
  if (!updater) {
    updater = require('electron-updater').autoUpdater;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent || 0) }));
  }
  return updater;
}

function init(opts) {
  send = opts.send;
  beforeInstall = opts.beforeInstall;
}

function friendlyError(err) {
  const msg = String((err && err.message) || err);
  if (/404|Unable to find latest version|No published versions/i.test(msg)) {
    return 'No published release found on GitHub yet (or the repository is private).';
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::ERR/i.test(msg)) return 'Could not reach GitHub. Check your internet connection.';
  return msg.split('\n')[0].slice(0, 300);
}

// install=false: only report whether an update exists (used quietly at startup).
// install=true:  download and install it straight away.
async function check({ install }) {
  if (!app.isPackaged) {
    const r = { state: 'dev', message: 'Updates work in the installed app only.' };
    send(r);
    return r;
  }
  if (busy) return { state: 'busy' };
  busy = true;
  try {
    const u = get();
    send({ state: 'checking' });
    const result = await u.checkForUpdates();
    const version = result && result.updateInfo && result.updateInfo.version;
    const available = result && (result.isUpdateAvailable ?? (version && version !== app.getVersion()));
    if (!available) {
      const r = { state: 'none', version: app.getVersion() };
      send(r);
      return r;
    }
    if (!install) {
      const r = { state: 'available', version };
      send(r);
      return r;
    }
    send({ state: 'downloading', percent: 0, version });
    await u.downloadUpdate();
    send({ state: 'installing', version });
    await beforeInstall();
    // Silent install, then relaunch the new version.
    setTimeout(() => u.quitAndInstall(true, true), 300);
    return { state: 'installing', version };
  } catch (err) {
    const r = { state: 'error', message: friendlyError(err) };
    send(r);
    return r;
  } finally {
    busy = false;
  }
}

module.exports = { init, check };
