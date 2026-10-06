'use strict';

// The only bridge between the UI and the vault. The UI never gets keys or
// Node.js access; it can only call these specific functions.

const { contextBridge, ipcRenderer, webUtils } = require('electron');

async function call(channel, ...args) {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r.ok) {
    const err = new Error(r.error);
    err.code = r.code;
    throw err;
  }
  return r.data;
}

const EVENTS = new Set(['vault:locked', 'update:status', 'import:progress', 'bulk:progress']);

contextBridge.exposeInMainWorld('vlt', {
  info: () => call('app:info'),
  status: () => call('vault:status'),
  create: (password) => call('vault:create', password),
  unlock: (password) => call('vault:unlock', password),
  mfa: (code) => call('vault:mfa', code),
  cancelMfa: () => call('vault:cancelMfa'),
  lock: () => call('vault:lock'),
  restore: () => call('vault:restore'),

  list: () => call('items:list'),
  createNote: (data) => call('note:create', data),
  getNote: (id) => call('note:get', id),
  updateNote: (id, data) => call('note:update', id, data),
  rename: (id, name) => call('item:rename', id, name),
  remove: (id) => call('item:delete', id),
  removeMany: (ids) => call('items:deleteMany', ids),
  exportMany: (ids) => call('items:exportMany', ids),

  createFolder: (name, parent) => call('folder:create', name, parent),
  move: (ids, target) => call('items:move', ids, target),
  pickFiles: (parent) => call('files:pick', parent),
  addFiles: (files, parent) => call('files:addPaths', Array.from(files, (f) => webUtils.getPathForFile(f)).filter(Boolean), parent),
  mediaUrl: (id) => call('item:mediaUrl', id),
  text: (id) => call('item:text', id),
  docx: (id) => call('item:docx', id),
  exportFile: (id) => call('item:export', id),
  openExternal: (id) => call('item:openExternal', id),

  getSettings: () => call('settings:get'),
  setSettings: (s) => call('settings:set', s),
  changePassword: (cur, next) => call('password:change', cur, next),
  mfaBegin: () => call('mfa:begin'),
  mfaConfirm: (code) => call('mfa:confirm', code),
  mfaDisable: (password) => call('mfa:disable', password),
  backup: () => call('backup:create'),

  checkForUpdates: (install) => call('update:check', { install }),

  activity: () => ipcRenderer.send('activity'),
  on: (channel, cb) => {
    if (!EVENTS.has(channel)) return () => {};
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
