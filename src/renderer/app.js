'use strict';

/* global vlt */
const api = window.vlt;
const $app = document.getElementById('app');
const $modals = document.getElementById('modal-root');
const $toasts = document.getElementById('toasts');

const state = {
  info: null,
  items: [],
  filter: 'all',
  query: '',
  settings: null,
  update: null,
  mediaUrls: new Map(),
  folder: null, // folder being viewed in "All items" (null = top level)
  dragIds: null,
  selecting: false,
  selected: new Set(),
  lastClicked: null,
  confirmedPlaintext: false,
};

// ------------------------------------------------------------------ helpers

const ICONS = {
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  video: '<rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>',
  file: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  box: '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  left: '<polyline points="15 18 9 12 15 6"/>',
  right: '<polyline points="9 18 15 12 9 6"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  back10: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  fwd10: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  folderPlus: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>',
  move: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polyline points="12 10 15 13 12 16"/><line x1="8" y1="13" x2="15" y2="13"/>',
  checkSquare: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
};

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = ICONS[name] || ICONS.file; // constant strings only
  return svg;
}

// Builds DOM safely: user data always goes in as text, never as HTML.
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function logo() {
  return h('div', { class: 'logo' }, h('div', { class: 'logo-mark' }, icon('shield')), h('div', { class: 'logo-text', text: 'VLT' }));
}

function formatSize(n) {
  if (n === undefined) return '';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < units.length - 1);
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

function formatDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function ext(name) {
  const m = /\.([a-z0-9]{1,6})$/i.exec(name || '');
  return m ? m[1].toUpperCase() : '';
}

function toast(message, kind = '', ms = 3500) {
  const el = h('div', { class: `toast ${kind}` }, message);
  $toasts.append(el);
  if (ms) setTimeout(() => el.remove(), ms);
  return el;
}

function setBusy(btn, busy, label) {
  btn.disabled = busy;
  if (busy) {
    btn.dataset.label = btn.textContent;
    btn.replaceChildren(h('span', { class: 'spinner' }), label || 'Working…');
  } else if (btn.dataset.label !== undefined) {
    btn.textContent = btn.dataset.label;
  }
}

function msgBox() {
  const el = h('div');
  el.show = (text, kind = 'error') => el.replaceChildren(text ? h('div', { class: `msg ${kind}` }, text) : '');
  return el;
}

function passwordStrength(pw) {
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9]/.test(pw)) pool += 33;
  let bits = pw.length * Math.log2(pool || 1);
  const unique = new Set(pw).size;
  if (unique < pw.length / 2) bits *= 0.6;
  if (/^(password|qwerty|123456|letmein|admin)/i.test(pw)) bits *= 0.3;
  if (bits < 45) return { pct: 20, label: 'Weak', color: 'var(--danger)' };
  if (bits < 65) return { pct: 50, label: 'Fair', color: 'var(--warn)' };
  if (bits < 85) return { pct: 75, label: 'Good', color: 'var(--accent)' };
  return { pct: 100, label: 'Strong', color: 'var(--ok)' };
}

// ------------------------------------------------------------------ modals

function closeModals() {
  $modals.replaceChildren();
}

function modal(content, { wide = false, onClose } = {}) {
  const dialog = h('div', { class: `dialog${wide ? ' wide' : ''}` }, content);
  const overlay = h('div', { class: 'overlay' }, dialog);
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });
  function close() {
    overlay.remove();
    if (onClose) onClose();
  }
  overlay.close = close;
  $modals.append(overlay);
  const first = dialog.querySelector('input, textarea, button.primary');
  if (first) setTimeout(() => first.focus(), 30);
  return overlay;
}

function confirmDialog({ title, body, confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const ok = h('button', { class: `btn ${danger ? 'danger solid' : 'primary'}`, text: confirm });
    const cancel = h('button', { class: 'btn', text: 'Cancel' });
    const m = modal([h('h2', { text: title }), h('p', {}, body), h('div', { class: 'dialog-actions' }, cancel, ok)], {
      onClose: () => resolve(result),
    });
    ok.onclick = () => {
      result = true;
      m.close();
    };
    cancel.onclick = () => m.close();
    setTimeout(() => ok.focus(), 30);
  });
}

function promptDialog({ title, label, value = '', confirm = 'Save', type = 'text' }) {
  return new Promise((resolve) => {
    let result = null;
    const input = h('input', { class: 'input', type, value });
    const ok = h('button', { class: 'btn primary', type: 'submit', text: confirm });
    const cancel = h('button', { class: 'btn', type: 'button', text: 'Cancel' });
    const form = h('form', {}, h('h2', { text: title }), h('label', { class: 'field' }, h('span', { text: label }), input), h('div', { class: 'dialog-actions' }, cancel, ok));
    const m = modal(form, { onClose: () => resolve(result) });
    form.onsubmit = (e) => {
      e.preventDefault();
      result = input.value;
      m.close();
    };
    cancel.onclick = () => m.close();
    setTimeout(() => input.select(), 40);
  });
}

// ------------------------------------------------------------------ first run

function renderSetup() {
  closeModals();
  const pw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'At least 10 characters' });
  const pw2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const bar = h('div');
  const barLabel = h('div', { class: 'strength-label', text: ' ' });
  const ack = h('input', { type: 'checkbox' });
  const msg = msgBox();
  const btn = h('button', { class: 'btn primary block', type: 'submit', text: 'Create vault' });

  pw.addEventListener('input', () => {
    if (!pw.value) {
      bar.style.width = '0';
      barLabel.textContent = ' ';
      return;
    }
    const s = passwordStrength(pw.value);
    bar.style.width = s.pct + '%';
    bar.style.background = s.color;
    barLabel.textContent = `Strength: ${s.label}`;
  });

  const form = h(
    'form',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        msg.show('');
        if (pw.value.length < 10) return msg.show('Use at least 10 characters. A short sentence is easy to remember and hard to guess.');
        if (pw.value !== pw2.value) return msg.show('The passwords do not match.');
        if (!ack.checked) return msg.show('Please confirm you understand the warning.');
        setBusy(btn, true, 'Creating your vault…');
        try {
          await api.create(pw.value);
          pw.value = pw2.value = '';
          await enterVault();
          toast('Your vault is ready.', 'ok');
        } catch (err) {
          msg.show(err.message);
          setBusy(btn, false);
        }
      },
    },
    logo(),
    h('h2', { text: 'Create your vault' }),
    h('p', { class: 'sub', text: 'Choose a strong master password. It encrypts everything you store in VLT.' }),
    h('label', { class: 'field' }, h('span', { text: 'Master password' }), pw, h('div', { class: 'strength' }, bar), barLabel),
    h('label', { class: 'field' }, h('span', { text: 'Confirm password' }), pw2),
    h(
      'label',
      { class: 'check' },
      ack,
      h('span', {
        text: 'I understand that nobody can recover my password, and that entering a wrong password 10 times in a row permanently destroys the vault.',
      }),
    ),
    msg,
    btn,
    h(
      'div',
      { class: 'auth-foot' },
      h('button', {
        class: 'link',
        type: 'button',
        text: 'Restore from a backup…',
        onclick: async () => {
          try {
            if (await api.restore()) {
              toast('Backup restored. Unlock it with the password it was created with.', 'ok', 6000);
              renderLock(await api.status());
            }
          } catch (err) {
            msg.show(err.message);
          }
        },
      }),
      versionLabel(),
    ),
  );
  $app.replaceChildren(h('div', { class: 'auth' }, h('div', { class: 'auth-card' }, form)));
  pw.focus();
}

function versionLabel() {
  return h('span', { class: 'link', text: state.info ? `v${state.info.version}` : '' });
}

// ------------------------------------------------------------------ unlock

const LOCK_REASONS = {
  idle: 'VLT locked itself after a period of inactivity.',
  system: 'VLT locked because your computer was locked or went to sleep.',
  update: 'VLT locked to install an update.',
  manual: '',
};

function attemptsMessage(remaining, max) {
  if (remaining >= max) return null;
  const kind = remaining <= 3 ? 'error' : 'warn';
  return [`${remaining} attempt${remaining === 1 ? '' : 's'} left before the vault is permanently destroyed.`, kind];
}

function renderLock(status, reason) {
  closeModals();
  const pw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'Master password' });
  const msg = msgBox();
  const btn = h('button', { class: 'btn primary block', type: 'submit', text: 'Unlock' });
  const updateLink = h('button', { class: 'link', type: 'button', text: 'Check for updates', onclick: () => runUpdate() });

  const form = h(
    'form',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        if (!pw.value) return;
        msg.show('');
        setBusy(btn, true, 'Unlocking…');
        try {
          const r = await api.unlock(pw.value);
          pw.value = '';
          if (r.ok) return enterVault();
          if (r.nuked) return renderNuked();
          if (r.mfaRequired) return renderMfa(r);
          setBusy(btn, false);
          const am = attemptsMessage(r.remainingAttempts, status.maxAttempts);
          msg.show(`Wrong password. ${am ? am[0] : ''}`, 'error');
          pw.focus();
        } catch (err) {
          setBusy(btn, false);
          msg.show(err.message);
        }
      },
    },
    logo(),
    h('h2', { text: 'Vault locked' }),
    h('p', { class: 'sub', text: 'Enter your master password to unlock.' }),
    reason && LOCK_REASONS[reason] ? h('div', { class: 'msg info', text: LOCK_REASONS[reason] }) : null,
    pw,
    msg,
    h('div', { style: 'height:12px' }),
    btn,
    h('div', { class: 'auth-foot' }, updateLink, versionLabel()),
  );
  const am = attemptsMessage(status.remainingAttempts, status.maxAttempts);
  if (am) msg.show(am[0], am[1]);
  $app.replaceChildren(h('div', { class: 'auth' }, h('div', { class: 'auth-card' }, form)));
  pw.focus();
}

function renderMfa(r) {
  const code = h('input', { class: 'input code', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '000000', maxlength: '11' });
  const msg = msgBox();
  const btn = h('button', { class: 'btn primary block', type: 'submit', text: 'Verify' });
  const form = h(
    'form',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        if (!code.value.trim()) return;
        setBusy(btn, true, 'Verifying…');
        try {
          const res = await api.mfa(code.value.trim());
          if (res.ok) {
            await enterVault();
            if (res.usedRecovery) toast(`Recovery code used. ${res.recoveryCodesLeft} left.`, '', 7000);
            return;
          }
          if (res.nuked) return renderNuked();
          setBusy(btn, false);
          msg.show(`That code is not correct. ${res.remainingAttempts} attempt${res.remainingAttempts === 1 ? '' : 's'} left before the vault is destroyed.`);
          code.value = '';
          code.focus();
        } catch (err) {
          setBusy(btn, false);
          msg.show(err.message);
        }
      },
    },
    logo(),
    h('h2', { text: 'Two-factor authentication' }),
    h('p', { class: 'sub', text: 'Enter the 6-digit code from your authenticator app, or one of your recovery codes.' }),
    code,
    msg,
    h('div', { style: 'height:12px' }),
    btn,
    h(
      'div',
      { class: 'auth-foot' },
      h('button', {
        class: 'link',
        type: 'button',
        text: '← Back',
        onclick: async () => {
          await api.cancelMfa();
          renderLock(await api.status());
        },
      }),
    ),
  );
  const am = attemptsMessage(r.remainingAttempts, 10);
  if (am) msg.show(am[0], am[1]);
  $app.replaceChildren(h('div', { class: 'auth' }, h('div', { class: 'auth-card' }, form)));
  code.focus();
}

function renderNuked() {
  closeModals();
  $app.replaceChildren(
    h(
      'div',
      { class: 'auth' },
      h(
        'div',
        { class: 'auth-card' },
        logo(),
        h('h2', { text: 'Vault destroyed' }),
        h('div', {
          class: 'msg error',
          text: 'Too many wrong attempts. The vault and everything in it has been permanently destroyed.',
        }),
        h('div', { style: 'height:8px' }),
        h('button', { class: 'btn primary block', text: 'Set up a new vault', onclick: renderSetup }),
      ),
    ),
  );
}

// ------------------------------------------------------------------ main vault view

const CATEGORIES = [
  ['all', 'All items', 'grid'],
  ['notes', 'Notes', 'note'],
  ['photos', 'Photos', 'image'],
  ['videos', 'Videos', 'video'],
  ['documents', 'Documents', 'file'],
  ['audio', 'Audio', 'music'],
  ['other', 'Other', 'box'],
];

const CATEGORY_ICON = { notes: 'note', photos: 'image', videos: 'video', documents: 'file', audio: 'music', other: 'box' };

let dom = {};

async function enterVault() {
  closeModals();
  state.mediaUrls.clear();
  state.filter = 'all';
  state.query = '';
  state.folder = null;
  [state.items, state.settings] = await Promise.all([api.list(), api.getSettings()]);
  renderMain();
}

async function refreshItems() {
  state.items = await api.list();
  if (state.folder && !folderById(state.folder)) state.folder = null;
  renderNav();
  renderGrid();
}

function renderMain() {
  dom.nav = h('nav', { class: 'nav' });
  dom.search = h('input', {
    class: 'input',
    placeholder: 'Search your vault',
    oninput: () => {
      state.query = dom.search.value.trim().toLowerCase();
      renderGrid();
    },
  });
  dom.updateBtn = h('button', { class: 'btn update-pill', onclick: () => runUpdate() }, icon('refresh'), 'Check for updates');
  dom.content = h('div', { class: 'content' });
  const main = h(
    'div',
    { class: 'main' },
    h(
      'div',
      { class: 'topbar' },
      h('div', { class: 'search' }, icon('search'), dom.search),
      h('div', { class: 'grow' }),
      (dom.selectBtn = h(
        'button',
        { class: 'btn', title: 'Select several items (or Ctrl+click a card)', onclick: () => setSelecting(!state.selecting) },
        icon('checkSquare'),
        'Select',
      )),
      h('button', { class: 'btn', onclick: newFolder }, icon('folderPlus'), 'New Folder'),
      h('button', { class: 'btn', onclick: newNote }, icon('plus'), 'New note'),
      h('button', { class: 'btn primary', onclick: pickFiles }, icon('upload'), 'Add files'),
      dom.updateBtn,
    ),
    dom.content,
  );
  const sidebar = h(
    'aside',
    { class: 'sidebar' },
    logo(),
    dom.nav,
    h('div', { class: 'spacer' }),
    h('button', { class: 'nav-item', onclick: openSettings }, icon('settings'), 'Settings'),
    h('button', { class: 'nav-item', onclick: lockNow }, icon('lock'), 'Lock vault'),
  );
  $app.replaceChildren(h('div', { class: 'shell' }, sidebar, main));
  setupDrop(dom.content);
  renderNav();
  renderGrid();
  renderUpdateButton();
}

function renderNav() {
  const counts = { all: 0 };
  for (const it of state.items) {
    if (it.kind === 'folder') continue;
    counts.all++;
    counts[it.category] = (counts[it.category] || 0) + 1;
  }
  dom.nav.replaceChildren(
    ...CATEGORIES.map(([key, label, ic]) =>
      h(
        'button',
        {
          class: `nav-item${state.filter === key ? ' active' : ''}`,
          onclick: () => {
            // Clicking "All items" again goes back to the top-level folder.
            if (key === 'all' && state.filter === 'all') state.folder = null;
            state.filter = key;
            renderNav();
            renderGrid();
          },
        },
        icon(ic),
        label,
        h('span', { class: 'count', text: counts[key] ? String(counts[key]) : '' }),
      ),
    ),
  );
}

// "All items" without a search shows one folder at a time. Categories and search
// look through the whole vault.
function isFolderView() {
  return state.filter === 'all' && !state.query;
}

// Where new files / notes / folders go: the open folder, or top level in other views.
function targetFolder() {
  return isFolderView() ? state.folder : null;
}

function folderById(id) {
  return state.items.find((i) => i.id === id && i.kind === 'folder') || null;
}

// [top-most folder, ..., folder] for a folder id.
function folderPath(id) {
  const out = [];
  const seen = new Set();
  for (let f = folderById(id); f && !seen.has(f.id); f = folderById(f.parent)) {
    seen.add(f.id);
    out.unshift(f);
  }
  return out;
}

function childCount(folderId) {
  return state.items.filter((i) => i.parent === folderId).length;
}

// Ids of the given folders and everything inside them.
function withDescendants(ids) {
  const out = new Set();
  const queue = [...ids];
  while (queue.length) {
    const id = queue.pop();
    if (out.has(id)) continue;
    out.add(id);
    for (const it of state.items) if (it.parent === id) queue.push(it.id);
  }
  return out;
}

const byFolderFirst = (a, b) =>
  (a.kind === 'folder') === (b.kind === 'folder')
    ? a.kind === 'folder'
      ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      : b.modified - a.modified
    : a.kind === 'folder'
      ? -1
      : 1;

function visibleItems() {
  if (isFolderView()) return state.items.filter((it) => it.parent === state.folder).sort(byFolderFirst);
  return state.items
    .filter(
      (it) =>
        (state.filter === 'all' ? true : it.category === state.filter) &&
        (!state.query || (it.name || '').toLowerCase().includes(state.query) || (it.preview || '').toLowerCase().includes(state.query)),
    )
    .sort(byFolderFirst);
}

function openFolder(id) {
  state.folder = id;
  state.filter = 'all';
  state.query = '';
  if (dom.search) dom.search.value = '';
  state.selected.clear();
  state.selecting = false;
  renderNav();
  renderGrid();
}

async function mediaUrl(id) {
  if (!state.mediaUrls.has(id)) state.mediaUrls.set(id, await api.mediaUrl(id));
  return state.mediaUrls.get(id);
}

function renderGrid() {
  const items = visibleItems();
  const count = h('span', { class: 'count', text: `${items.length} item${items.length === 1 ? '' : 's'}` });
  let header;
  if (isFolderView()) {
    header = h('div', { class: 'section-title' }, breadcrumbs(), count);
    if (state.folder) {
      header.append(
        h('div', { class: 'grow' }),
        h('button', { class: 'btn ghost', onclick: () => renameItem(folderById(state.folder)) }, icon('edit'), 'Rename folder'),
      );
    }
  } else {
    const label = state.query ? 'Search results' : CATEGORIES.find((c) => c[0] === state.filter)[1];
    header = h('div', { class: 'section-title' }, h('h1', { text: label }), count);
  }
  const where = folderById(targetFolder());
  const drop = h('div', { class: 'dropzone', text: `Drop files to encrypt them into ${where ? `"${where.name}"` : 'your vault'}` });

  if (!items.length) {
    const empty = state.items.length
      ? isFolderView() && state.folder
        ? h(
            'div',
            { class: 'empty' },
            icon('folder'),
            h('h2', { text: 'This folder is empty' }),
            h('div', { text: 'Add files or notes here, drag items onto the folder, or use Move.' }),
            h('div', { style: 'height:16px' }),
            h('button', { class: 'btn primary', onclick: pickFiles }, icon('upload'), 'Add files'),
          )
        : h('div', { class: 'empty' }, icon('search'), h('h2', { text: 'Nothing here' }), h('div', { text: 'No items match this view.' }))
      : h(
          'div',
          { class: 'empty' },
          icon('shield'),
          h('h2', { text: 'Your vault is empty' }),
          h('div', { text: 'Add photos, videos and documents, or write a note. You can also drag files here.' }),
          h('div', { style: 'height:16px' }),
          h('button', { class: 'btn primary', onclick: pickFiles }, icon('upload'), 'Add files'),
        );
    dom.content.replaceChildren(drop, header, empty);
    return;
  }

  // Selection only ever covers items you can currently see.
  const visible = new Set(items.map((i) => i.id));
  for (const id of [...state.selected]) if (!visible.has(id)) state.selected.delete(id);

  dom.cards = new Map();
  const grid = h('div', { class: `grid${state.selecting ? ' selecting' : ''}` });
  dom.grid = grid;
  items.forEach((it, idx) => {
    const el = card(it, idx);
    dom.cards.set(it.id, el);
    grid.append(el);
  });
  dom.selectBar = h('div', { class: 'select-bar' });
  dom.content.replaceChildren(drop, dom.selectBar, header, grid);
  renderSelection();
}

// ------------------------------------------------------------------ multi-select

function setSelecting(on) {
  state.selecting = on;
  if (!on) state.selected.clear();
  state.lastClicked = null;
  renderSelection();
}

function toggleSelect(it, idx, shift) {
  state.selecting = true;
  const items = visibleItems();
  if (shift && state.lastClicked !== null && items[state.lastClicked]) {
    // Shift+click selects the whole range from the last clicked card.
    const [a, b] = [Math.min(state.lastClicked, idx), Math.max(state.lastClicked, idx)];
    for (let i = a; i <= b; i++) state.selected.add(items[i].id);
  } else if (state.selected.has(it.id)) {
    state.selected.delete(it.id);
  } else {
    state.selected.add(it.id);
  }
  state.lastClicked = idx;
  renderSelection();
}

function selectAllVisible() {
  state.selecting = true;
  for (const it of visibleItems()) state.selected.add(it.id);
  renderSelection();
}

// Updates checkmarks and the action bar in place (no grid rebuild, so thumbnails don't reload).
function renderSelection() {
  if (!dom.grid || !dom.grid.isConnected) return;
  dom.grid.classList.toggle('selecting', state.selecting);
  if (dom.selectBtn) dom.selectBtn.classList.toggle('active', state.selecting);
  for (const [id, el] of dom.cards) el.classList.toggle('selected', state.selected.has(id));

  if (!state.selecting) {
    dom.selectBar.replaceChildren();
    dom.selectBar.classList.remove('show');
    return;
  }
  const n = state.selected.size;
  const total = visibleItems().length;
  dom.selectBar.classList.add('show');
  dom.selectBar.replaceChildren(
    h('strong', { text: n ? `${n} selected` : 'Select items' }),
    h('span', { class: 'hint', text: n ? '' : 'Click cards to select them. Shift+click selects a range.' }),
    h('div', { class: 'grow' }),
    n < total
      ? h('button', { class: 'btn ghost', onclick: selectAllVisible }, `Select all (${total})`)
      : h(
          'button',
          {
            class: 'btn ghost',
            onclick: () => {
              state.selected.clear();
              renderSelection();
            },
          },
          'Select none',
        ),
    n === 1
      ? h('button', { class: 'btn', onclick: () => renameItem(state.items.find((i) => i.id === [...state.selected][0])) }, icon('edit'), 'Rename')
      : null,
    h('button', { class: 'btn', disabled: !n, onclick: () => moveDialog([...state.selected]) }, icon('move'), 'Move'),
    h('button', { class: 'btn', disabled: !n, onclick: bulkExport }, icon('download'), 'Export'),
    h('button', { class: 'btn danger', disabled: !n, onclick: bulkDelete }, icon('trash'), 'Delete'),
    h('button', { class: 'btn ghost', title: 'Done (Esc)', onclick: () => setSelecting(false) }, icon('x')),
  );
}

async function bulkDelete() {
  const ids = [...state.selected];
  if (!ids.length) return;
  const hasFolders = ids.some((id) => folderById(id));
  const total = withDescendants(ids).size;
  const ok = await confirmDialog({
    title: `Delete ${ids.length} item${ids.length === 1 ? '' : 's'}?`,
    body: hasFolders
      ? `Folders are deleted together with everything inside them (${total} item${total === 1 ? '' : 's'} in total). This cannot be undone.`
      : 'They will be permanently removed from your vault. This cannot be undone.',
    confirm: `Delete ${hasFolders ? total : ids.length}`,
    danger: true,
  });
  if (!ok) return;
  try {
    const n = await api.removeMany(ids);
    setSelecting(false);
    await refreshItems();
    toast(`Deleted ${n} item${n === 1 ? '' : 's'}.`, 'ok');
  } catch (err) {
    toast(err.message, 'error');
    await refreshItems();
  }
}

async function bulkExport() {
  const ids = [...state.selected];
  if (!ids.length || !(await ensurePlaintextOk('export'))) return;
  try {
    const res = await api.exportMany(ids);
    if (!res) return;
    if (res.exported) toast(`Exported ${res.exported} item${res.exported === 1 ? '' : 's'} to ${res.dir}`, 'ok', 6000);
    for (const f of res.failed) toast(`Could not export ${f.name}: ${f.error}`, 'error', 7000);
    setSelecting(false);
  } catch (err) {
    toast(err.message, 'error');
  }
}

let bulkToast = null;
api.on('bulk:progress', (p) => {
  if (p.finished) {
    if (bulkToast) bulkToast.remove();
    bulkToast = null;
    return;
  }
  if (!bulkToast) {
    bulkToast = toast('', '', 0);
    bulkToast.label = h('div');
    bulkToast.bar = h('div');
    bulkToast.append(bulkToast.label, h('div', { class: 'progress' }, bulkToast.bar));
  }
  bulkToast.label.textContent = `${p.label} (${p.index} of ${p.count})`;
  bulkToast.bar.style.width = `${Math.round((p.index / p.count) * 100)}%`;
});

function card(it, idx) {
  const thumb = h('div', { class: 'thumb' });
  if (it.kind === 'folder') {
    thumb.classList.add('folder');
    thumb.append(icon('folder'));
  } else if (it.kind === 'note') {
    thumb.classList.add('note');
    thumb.textContent = it.preview || 'Empty note';
  } else if (it.category === 'photos' && !/heic|heif|tiff/.test(it.mime)) {
    const img = h('img', { loading: 'lazy', alt: '', draggable: 'false' });
    img.onerror = () => img.replaceWith(icon('image'));
    mediaUrl(it.id).then((u) => (img.src = u)).catch(() => {});
    thumb.append(img);
  } else if (it.category === 'videos') {
    const vid = h('video', { preload: 'metadata', muted: true });
    vid.muted = true;
    vid.onerror = () => vid.replaceWith(icon('video'));
    mediaUrl(it.id).then((u) => (vid.src = `${u}#t=0.5`)).catch(() => {});
    thumb.append(vid, h('span', { class: 'badge' }, 'VIDEO'));
  } else {
    thumb.append(icon(CATEGORY_ICON[it.category] || 'file'));
    if (ext(it.name)) thumb.append(h('span', { class: 'badge', text: ext(it.name) }));
  }
  let meta;
  if (it.kind === 'folder') {
    const n = childCount(it.id);
    meta = `Folder · ${n} item${n === 1 ? '' : 's'}`;
  } else {
    meta = it.kind === 'note' ? `Note · ${formatDate(it.modified)}` : `${formatSize(it.size)} · ${formatDate(it.created)}`;
  }
  // Outside the folder view, show where each item lives.
  if (!isFolderView() && it.parent) meta = `${folderPath(it.parent).map((f) => f.name).join(' / ')} · ${meta}`;
  const box = h(
    'button',
    {
      class: 'select-box',
      title: 'Select',
      onclick: (e) => {
        e.stopPropagation();
        toggleSelect(it, idx, e.shiftKey);
      },
    },
    icon('check'),
  );
  thumb.append(box);
  const el = h(
    'div',
    {
      class: `card${it.kind === 'folder' ? ' folder-card' : ''}`,
      title: it.name,
      draggable: 'true',
      onclick: (e) => {
        if (state.selecting || e.ctrlKey || e.shiftKey) toggleSelect(it, idx, e.shiftKey);
        else if (it.kind === 'folder') openFolder(it.id);
        else openViewer(it);
      },
      ondragstart: (e) => {
        // Dragging a selected card drags the whole selection.
        const ids = state.selected.has(it.id) ? [...state.selected] : [it.id];
        state.dragIds = ids;
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
        e.dataTransfer.effectAllowed = 'move';
        el.classList.add('dragging');
      },
      ondragend: () => {
        state.dragIds = null;
        el.classList.remove('dragging');
      },
    },
    thumb,
    h('div', { class: 'card-body' }, h('div', { class: 'card-name', text: it.name }), h('div', { class: 'card-meta', text: meta })),
  );
  if (it.kind === 'folder') makeDropTarget(el, it.id);
  return el;
}

// ------------------------------------------------------------------ folders

const DRAG_TYPE = 'application/x-vlt-items';

function breadcrumbs() {
  const crumbs = [{ id: null, name: 'All items' }, ...folderPath(state.folder)];
  const wrap = h('div', { class: 'crumbs' });
  crumbs.forEach((c, i) => {
    if (i) wrap.append(h('span', { class: 'crumb-sep' }, icon('right')));
    const last = i === crumbs.length - 1;
    const el = h(last ? 'h1' : 'button', { class: last ? 'crumb current' : 'crumb', text: c.name, onclick: last ? null : () => openFolder(c.id) });
    // Drop on a breadcrumb to move items up to that folder.
    if (!last) makeDropTarget(el, c.id);
    wrap.append(el);
  });
  return wrap;
}

// Accepts vault items (move) and files from Windows (import) dropped on a folder.
function makeDropTarget(el, folderId) {
  const accepts = (e) => {
    const types = [...e.dataTransfer.types];
    if (types.includes('Files')) return true;
    if (!types.includes(DRAG_TYPE)) return false;
    // Can't drop a folder onto itself or into its own sub-folder.
    return !(state.dragIds && folderId && state.dragIds.some((id) => withDescendants([id]).has(folderId)));
  };
  el.addEventListener('dragover', (e) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = [...e.dataTransfer.types].includes('Files') ? 'copy' : 'move';
    el.classList.add('drop-target');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
  el.addEventListener('drop', async (e) => {
    el.classList.remove('drop-target');
    if (!accepts(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dom.content.classList.remove('dropping');
    const target = folderById(folderId);
    try {
      if (e.dataTransfer.files.length) {
        reportImport(await api.addFiles(e.dataTransfer.files, folderId));
      } else {
        const ids = JSON.parse(e.dataTransfer.getData(DRAG_TYPE) || '[]');
        const n = await api.move(ids, folderId);
        if (n) toast(`Moved ${n} item${n === 1 ? '' : 's'} to ${target ? `"${target.name}"` : 'the top level'}.`, 'ok');
        setSelecting(false);
      }
      await refreshItems();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function newFolder() {
  const name = await promptDialog({ title: 'New folder', label: 'Folder name', value: 'New folder', confirm: 'Create' });
  if (name === null || !name.trim()) return;
  try {
    const parent = targetFolder();
    await api.createFolder(name.trim(), parent);
    // Show the folder the new one was created in.
    openFolder(parent);
    await refreshItems();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function renameItem(item) {
  if (!item) return null;
  const isFolder = item.kind === 'folder';
  const name = await promptDialog({ title: isFolder ? 'Rename folder' : 'Rename', label: 'Name', value: item.name });
  if (name === null || !name.trim() || name.trim() === item.name) return null;
  try {
    const updated = await api.rename(item.id, name.trim());
    await refreshItems();
    return updated;
  } catch (err) {
    toast(err.message, 'error');
    return null;
  }
}

// "Move to…" dialog with the folder tree. Resolves true if something moved.
function moveDialog(ids) {
  return new Promise((resolve) => {
    let moved = false;
    const blocked = withDescendants(ids.filter((id) => folderById(id)));
    const items = ids.map((id) => state.items.find((i) => i.id === id)).filter(Boolean);
    const current = items.length && items.every((i) => i.parent === items[0].parent) ? items[0].parent : undefined;
    let choice = null;
    const list = h('div', { class: 'folder-tree' });
    const ok = h('button', { class: 'btn primary', text: 'Move here' });

    const renderTree = () => {
      const rows = [{ id: null, name: 'All items (top level)', depth: 0 }];
      const walk = (parent, depth) => {
        state.items
          .filter((i) => i.kind === 'folder' && i.parent === parent)
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
          .forEach((f) => {
            rows.push({ id: f.id, name: f.name, depth });
            walk(f.id, depth + 1);
          });
      };
      walk(null, 1);
      list.replaceChildren(
        ...rows.map((r) => {
          const disabled = blocked.has(r.id);
          const row = h(
            'button',
            {
              class: `tree-row${choice === r.id ? ' chosen' : ''}`,
              disabled,
              title: disabled ? "A folder can't be moved into itself" : '',
              onclick: () => {
                choice = r.id;
                renderTree();
              },
              ondblclick: () => !disabled && ok.click(),
            },
            r.id === null ? icon('grid') : icon('folder'),
            h('span', { text: r.name }),
            r.id === current ? h('span', { class: 'tree-note', text: 'current' }) : null,
          );
          row.style.paddingLeft = `${10 + r.depth * 20}px`;
          return row;
        }),
      );
      ok.disabled = choice === current || blocked.has(choice);
    };

    const newHere = h(
      'button',
      {
        class: 'btn',
        type: 'button',
        onclick: async () => {
          const name = await promptDialog({ title: 'New folder', label: `Create inside "${choice ? folderById(choice).name : 'All items'}"`, value: 'New folder', confirm: 'Create' });
          if (name === null || !name.trim()) return;
          try {
            const f = await api.createFolder(name.trim(), choice);
            state.items = await api.list();
            choice = f.id;
            renderTree();
          } catch (err) {
            toast(err.message, 'error');
          }
        },
      },
      icon('folderPlus'),
      'New folder',
    );
    const cancel = h('button', { class: 'btn', text: 'Cancel' });
    const label = items.length === 1 ? `"${items[0].name}"` : `${items.length} items`;
    const m = modal([h('h2', { text: `Move ${label} to…` }), list, h('div', { class: 'dialog-actions' }, newHere, h('div', { class: 'grow' }), cancel, ok)], {
      onClose: () => {
        refreshItems();
        resolve(moved);
      },
    });
    cancel.onclick = () => m.close();
    ok.onclick = async () => {
      try {
        const n = await api.move(ids, choice);
        moved = n > 0;
        const dest = folderById(choice);
        toast(`Moved ${n} item${n === 1 ? '' : 's'} to ${dest ? `"${dest.name}"` : 'the top level'}.`, 'ok');
        setSelecting(false);
        m.close();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    choice = current === undefined ? null : current;
    renderTree();
  });
}

// ------------------------------------------------------------------ adding things

let progressToast = null;

api.on('import:progress', (p) => {
  if (p.finished) {
    if (progressToast) progressToast.remove();
    progressToast = null;
    return;
  }
  if (!progressToast) {
    progressToast = toast('', '', 0);
    progressToast.label = h('div');
    progressToast.bar = h('div');
    progressToast.append(progressToast.label, h('div', { class: 'progress' }, progressToast.bar));
  }
  progressToast.label.textContent = `Encrypting ${p.name} (${p.index} of ${p.count})`;
  progressToast.bar.style.width = `${p.total ? Math.round((p.done / p.total) * 100) : 100}%`;
});

function reportImport(res) {
  if (res.added.length) toast(`Added ${res.added.length} file${res.added.length === 1 ? '' : 's'} to your vault.`, 'ok');
  for (const f of res.failed) toast(`Could not add ${f.name}: ${f.error}`, 'error', 7000);
  if (res.added.length) {
    toast('Tip: the originals are still on your PC. Delete them if you only want the vault copy.', '', 6000);
  }
}

async function pickFiles() {
  try {
    const res = await api.pickFiles(targetFolder());
    if (res.added.length || res.failed.length) {
      reportImport(res);
      await refreshItems();
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

function setupDrop(el) {
  let depth = 0;
  const isFiles = (e) => [...e.dataTransfer.types].includes('Files');
  el.addEventListener('dragenter', (e) => {
    if (!isFiles(e)) return; // moving items inside the vault, not importing
    e.preventDefault();
    depth++;
    el.classList.add('dropping');
  });
  el.addEventListener('dragleave', (e) => {
    if (!isFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) el.classList.remove('dropping');
  });
  el.addEventListener('dragover', (e) => e.preventDefault());
  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    el.classList.remove('dropping');
    if (!e.dataTransfer.files.length) return;
    try {
      reportImport(await api.addFiles(e.dataTransfer.files, targetFolder()));
      await refreshItems();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// Stop the window from navigating to files dropped outside the drop zone.
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

async function newNote() {
  try {
    const note = await api.createNote({ title: 'Untitled note', body: '', parent: targetFolder() });
    await refreshItems();
    openViewer(note, { focusTitle: true });
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ------------------------------------------------------------------ viewer

let viewerEl = null;
let viewerCleanup = null;

// Returns a promise that settles once any unsaved note text has been saved.
function closeViewer() {
  const pending = viewerCleanup ? viewerCleanup() : null;
  viewerCleanup = null;
  if (viewerEl) {
    for (const m of viewerEl.querySelectorAll('video, audio')) {
      m.pause();
      m.removeAttribute('src');
      m.load();
    }
    viewerEl.remove();
  }
  viewerEl = null;
  return Promise.resolve(pending);
}

async function lockNow() {
  await closeViewer();
  await api.lock();
}

async function ensurePlaintextOk(action) {
  if (state.confirmedPlaintext) return true;
  const ok = await confirmDialog({
    title: action === 'export' ? 'Save an unencrypted copy?' : 'Open in another app?',
    body:
      action === 'export'
        ? 'This saves a normal, unencrypted copy of the file outside the vault. Anyone with access to your PC could open that copy.'
        : 'Another app needs a temporary unencrypted copy of the file. VLT wipes it when you lock the vault or close VLT (if the other app has closed it).',
    confirm: 'Continue',
  });
  if (ok) state.confirmedPlaintext = true;
  return ok;
}

function openViewer(item, opts = {}) {
  closeViewer();
  // Arrow keys / buttons step through photos and videos like a gallery.
  const isMedia = (i) => i.category === 'photos' || i.category === 'videos';
  const list = isMedia(item) ? visibleItems().filter(isMedia) : [item];
  const idx = list.findIndex((i) => i.id === item.id);
  const body = h('div', { class: 'viewer-body' });
  const title = h('div', { class: 'viewer-title', text: item.name });
  const saveState = h('span', { class: 'save-state' });

  const actions = [];
  if (item.kind === 'file') {
    actions.push(
      h(
        'button',
        {
          class: 'btn ghost',
          title: 'Open with the default Windows app',
          onclick: async () => {
            if (!(await ensurePlaintextOk('open'))) return;
            api.openExternal(item.id).catch((e) => toast(e.message, 'error'));
          },
        },
        icon('external'),
        'Open in app',
      ),
      h(
        'button',
        {
          class: 'btn ghost',
          onclick: async () => {
            if (!(await ensurePlaintextOk('export'))) return;
            try {
              const p = await api.exportFile(item.id);
              if (p) toast('Exported.', 'ok');
            } catch (e) {
              toast(e.message, 'error');
            }
          },
        },
        icon('download'),
        'Export',
      ),
    );
  } else {
    actions.push(saveState);
  }
  actions.push(
    h(
      'button',
      {
        class: 'btn ghost',
        title: 'Move to a folder',
        onclick: async () => {
          if (await moveDialog([item.id])) closeViewer();
        },
      },
      icon('move'),
      'Move',
    ),
    h(
      'button',
      {
        class: 'btn ghost',
        onclick: async () => {
          const name = await promptDialog({ title: 'Rename', label: 'Name', value: item.name });
          if (name === null || !name.trim()) return;
          try {
            const updated = await api.rename(item.id, name.trim());
            item.name = updated.name;
            title.textContent = updated.name;
            const t = viewerEl && viewerEl.querySelector('.note-editor .title');
            if (t) t.value = updated.name;
            await refreshItems();
          } catch (e) {
            toast(e.message, 'error');
          }
        },
      },
      icon('edit'),
      'Rename',
    ),
    h(
      'button',
      {
        class: 'btn ghost danger',
        onclick: async () => {
          const ok = await confirmDialog({
            title: `Delete "${item.name}"?`,
            body: 'It will be permanently removed from your vault. This cannot be undone.',
            confirm: 'Delete',
            danger: true,
          });
          if (!ok) return;
          try {
            await api.remove(item.id);
            closeViewer();
            await refreshItems();
            toast('Deleted.');
          } catch (e) {
            toast(e.message, 'error');
          }
        },
      },
      icon('trash'),
      'Delete',
    ),
    h('button', { class: 'btn ghost', title: 'Close (Esc)', onclick: closeViewer }, icon('x')),
  );

  const go = (d) => {
    const next = list[idx + d];
    if (next) openViewer(next);
  };
  const navBtns = [];
  if (list.length > 1) {
    if (idx > 0) navBtns.push(h('button', { class: 'btn viewer-nav prev', onclick: () => go(-1) }, icon('left')));
    if (idx < list.length - 1) navBtns.push(h('button', { class: 'btn viewer-nav next', onclick: () => go(1) }, icon('right')));
  }

  viewerEl = h('div', { class: 'viewer' }, h('div', { class: 'viewer-head' }, title, ...actions), body, ...navBtns);
  $app.append(viewerEl);

  const onKey = (e) => {
    if ($modals.childElementCount) return;
    if (e.key === 'Escape') closeViewer();
    const typing = /INPUT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName);
    if (typing) return;
    const media = viewerEl && viewerEl.querySelector('.viewer-body video, .viewer-body audio');
    if (media && !e.ctrlKey && !e.shiftKey) {
      // While watching: ← / → (or J / L) skip 10 seconds, Space plays/pauses.
      const k = e.key.toLowerCase();
      if (k === 'arrowleft' || k === 'j') return e.preventDefault(), skip(media, -10);
      if (k === 'arrowright' || k === 'l') return e.preventDefault(), skip(media, 10);
      if (k === ' ' && document.activeElement !== media) return e.preventDefault(), media.paused ? media.play() : media.pause();
    }
    // Previous / next item: arrows for photos, Shift+arrows (or Page Up / Down) when a video is open.
    if (e.key === 'PageUp' || e.key === 'ArrowLeft') return e.preventDefault(), go(-1);
    if (e.key === 'PageDown' || e.key === 'ArrowRight') return e.preventDefault(), go(1);
  };
  document.addEventListener('keydown', onKey);
  viewerCleanup = () => document.removeEventListener('keydown', onKey);

  if (item.kind === 'note') renderNoteEditor(item, body, title, saveState, opts);
  else renderFilePreview(item, body);
}

async function renderNoteEditor(item, body, titleEl, saveState, opts) {
  const note = await api.getNote(item.id);
  const t = h('input', { class: 'title', value: note.title, placeholder: 'Title' });
  const ta = h('textarea', { placeholder: 'Write something private…', spellcheck: 'false' });
  ta.value = note.body;
  body.append(h('div', { class: 'note-editor' }, t, ta));
  (opts.focusTitle ? t : ta).focus();
  if (opts.focusTitle) t.select();

  let timer = null;
  let dirty = false;
  const save = async () => {
    clearTimeout(timer);
    if (!dirty) return;
    dirty = false;
    try {
      const updated = await api.updateNote(item.id, { title: t.value.trim() || 'Untitled note', body: ta.value });
      titleEl.textContent = updated.name;
      saveState.textContent = 'Saved';
      refreshItems();
    } catch (e) {
      dirty = true;
      saveState.textContent = 'Not saved';
      toast(e.message, 'error');
    }
  };
  const changed = () => {
    dirty = true;
    saveState.textContent = 'Editing…';
    clearTimeout(timer);
    timer = setTimeout(save, 700);
  };
  t.addEventListener('input', changed);
  ta.addEventListener('input', changed);
  ta.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      save();
    }
  });
  const prevCleanup = viewerCleanup;
  viewerCleanup = () => {
    if (prevCleanup) prevCleanup();
    return save();
  };
}

function skip(media, seconds) {
  const end = Number.isFinite(media.duration) ? media.duration : Infinity;
  media.currentTime = Math.max(0, Math.min(end, media.currentTime + seconds));
  flashSkip(media, seconds);
}

// Brief "-10s" / "+10s" bubble over the player.
function flashSkip(media, seconds) {
  const player = media.closest('.player');
  if (!player) return;
  const old = player.querySelector('.skip-flash');
  if (old) old.remove();
  const el = h('div', { class: `skip-flash ${seconds < 0 ? 'left' : 'right'}`, text: `${seconds < 0 ? '−' : '+'}${Math.abs(seconds)}s` });
  player.append(el);
  setTimeout(() => el.remove(), 600);
}

function skipControls(media) {
  return h(
    'div',
    { class: 'skip-bar' },
    h('button', { class: 'btn', title: 'Back 10 seconds (← or J)', onclick: () => skip(media, -10) }, icon('back10'), '10s'),
    h(
      'button',
      { class: 'btn', title: 'Play / pause (Space)', onclick: () => (media.paused ? media.play() : media.pause()) },
      icon('play'),
      'Play / Pause',
    ),
    h('button', { class: 'btn', title: 'Forward 10 seconds (→ or L)', onclick: () => skip(media, 10) }, '10s', icon('fwd10')),
    h('span', { class: 'skip-hint', text: '← → skip 10s · Shift+← → previous / next' }),
  );
}

async function renderFilePreview(item, body) {
  const mime = item.mime || '';
  const noPreview = (why) =>
    body.replaceChildren(
      h(
        'div',
        { class: 'nopreview' },
        icon(CATEGORY_ICON[item.category] || 'file'),
        h('h3', { text: item.name }),
        h('p', { text: why || 'VLT cannot preview this type of file. Use "Open in app" to view it with another program.' }),
        h('p', { text: formatSize(item.size) }),
      ),
    );
  try {
    if (mime.startsWith('image/') && !/heic|heif|tiff/.test(mime)) {
      const img = h('img', { alt: item.name, draggable: 'false' });
      img.onerror = () => noPreview('This image format cannot be displayed here. Use "Open in app".');
      img.src = await mediaUrl(item.id);
      body.replaceChildren(img);
    } else if (mime.startsWith('video/')) {
      const v = h('video', { controls: true, autoplay: true, controlslist: 'nodownload' });
      v.onerror = () => noPreview('This video format cannot be played here. Use "Open in app" to play it in another player.');
      v.src = await mediaUrl(item.id);
      body.replaceChildren(h('div', { class: 'player' }, v, skipControls(v)));
    } else if (mime.startsWith('audio/')) {
      const a = h('audio', { controls: true, autoplay: true, controlslist: 'nodownload' });
      a.onerror = () => noPreview('This audio format cannot be played here.');
      a.src = await mediaUrl(item.id);
      body.replaceChildren(h('div', { class: 'player' }, a, skipControls(a)));
    } else if (mime === 'application/pdf') {
      body.replaceChildren(h('iframe', { src: await mediaUrl(item.id), title: item.name }));
    } else if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      body.replaceChildren(h('div', { class: 'nopreview' }, h('span', { class: 'spinner' })));
      const html = await api.docx(item.id);
      const doc = `<!doctype html><meta charset="utf-8"><style>body{font:15px/1.6 'Segoe UI',sans-serif;max-width:820px;margin:40px auto;padding:0 24px;color:#111}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}</style>${html}`;
      // Fully sandboxed: no scripts, no navigation, no network.
      body.replaceChildren(h('iframe', { sandbox: '', srcdoc: doc, title: item.name }));
    } else if (mime.startsWith('text/')) {
      if (item.size > 10 * 1024 * 1024) return noPreview('This text file is too large to preview. Use "Open in app".');
      body.replaceChildren(h('pre', { text: await api.text(item.id) }));
    } else {
      noPreview();
    }
  } catch (err) {
    noPreview(err.message);
  }
}

// ------------------------------------------------------------------ settings

async function openSettings() {
  const settings = await api.getSettings();
  state.settings = settings;
  const content = h('div');
  const m = modal(content, { wide: true });

  const mfaSection = h('div', { class: 'settings-section' });
  const renderMfaSection = () => {
    const s = state.settings;
    mfaSection.replaceChildren(
      h(
        'div',
        { class: 'settings-row' },
        h(
          'div',
          {},
          h('h3', {}, 'Two-factor authentication (MFA)', h('span', { class: `tag ${s.mfaEnabled ? 'on' : 'off'}`, text: s.mfaEnabled ? 'On' : 'Off' })),
          h('p', {
            text: s.mfaEnabled
              ? `A code from your authenticator app is required after your password. ${s.recoveryCodesLeft} recovery codes left.`
              : 'Require a code from Google Authenticator (or similar) after your password.',
          }),
        ),
        s.mfaEnabled
          ? h('button', { class: 'btn danger', text: 'Turn off', onclick: disableMfa })
          : h('button', { class: 'btn primary', text: 'Set up', onclick: setupMfa }),
      ),
    );
  };

  async function setupMfa() {
    try {
      const { secret, qr } = await api.mfaBegin();
      const code = h('input', { class: 'input code', inputmode: 'numeric', maxlength: '6', placeholder: '000000' });
      const msg = msgBox();
      const btn = h('button', { class: 'btn primary', type: 'submit', text: 'Turn on MFA' });
      const form = h(
        'form',
        {
          onsubmit: async (e) => {
            e.preventDefault();
            setBusy(btn, true, 'Checking…');
            try {
              const { recoveryCodes } = await api.mfaConfirm(code.value.trim());
              state.settings = await api.getSettings();
              renderMfaSection();
              showRecoveryCodes(recoveryCodes);
            } catch (err) {
              setBusy(btn, false);
              msg.show(err.message);
            }
          },
        },
        h('p', { text: '1. Open Google Authenticator (or Microsoft Authenticator, Authy…) on your phone and scan this QR code.' }),
        h('div', { class: 'qr' }, h('img', { src: qr, alt: 'QR code' }), h('div', {}, h('p', { text: "Can't scan? Enter this key manually:" }), h('div', { class: 'secret', text: secret }))),
        h('p', { text: '2. Enter the 6-digit code the app shows to confirm.' }),
        code,
        msg,
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: renderMfaSection }), btn),
      );
      mfaSection.replaceChildren(h('h3', { text: 'Set up two-factor authentication' }), form);
      code.focus();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function showRecoveryCodes(codes) {
    const ack = h('input', { type: 'checkbox' });
    const done = h('button', { class: 'btn primary', text: 'Done', disabled: true, onclick: renderMfaSection });
    ack.onchange = () => (done.disabled = !ack.checked);
    mfaSection.replaceChildren(
      h('h3', { text: 'MFA is on. Save your recovery codes' }),
      h('div', {
        class: 'msg warn',
        text: 'If you lose your phone, these codes are the only way to get past the MFA step. Each works once. Write them down and keep them somewhere safe, not on this PC.',
      }),
      h('div', { class: 'codes' }, codes.map((c) => h('div', { text: c }))),
      h('label', { class: 'check' }, ack, h('span', { text: 'I have saved my recovery codes.' })),
      h('div', { class: 'dialog-actions' }, done),
    );
  }

  async function disableMfa() {
    const pw = await promptDialog({ title: 'Turn off MFA', label: 'Enter your master password to confirm', type: 'password', confirm: 'Turn off' });
    if (pw === null) return;
    try {
      await api.mfaDisable(pw);
      state.settings = await api.getSettings();
      renderMfaSection();
      toast('Two-factor authentication turned off.');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // change password
  const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
  const n1 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const n2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const pwMsg = msgBox();
  const pwBtn = h('button', { class: 'btn', type: 'submit', text: 'Change password' });
  const pwForm = h(
    'form',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        if (n1.value.length < 10) return pwMsg.show('Use at least 10 characters.');
        if (n1.value !== n2.value) return pwMsg.show('New passwords do not match.');
        setBusy(pwBtn, true, 'Changing…');
        try {
          await api.changePassword(cur.value, n1.value);
          cur.value = n1.value = n2.value = '';
          pwMsg.show('Password changed.', 'ok');
        } catch (err) {
          pwMsg.show(err.message);
        }
        setBusy(pwBtn, false);
      },
    },
    h('h3', { text: 'Master password' }),
    h('label', { class: 'field' }, h('span', { text: 'Current password' }), cur),
    h('label', { class: 'field' }, h('span', { text: 'New password' }), n1),
    h('label', { class: 'field' }, h('span', { text: 'Confirm new password' }), n2),
    pwMsg,
    pwBtn,
  );

  // auto-lock
  const lockSel = h(
    'select',
    {
      class: 'input',
      style: 'width:160px',
      onchange: async () => {
        try {
          state.settings = await api.setSettings({ autoLockMinutes: Number(lockSel.value) });
          toast('Saved.');
        } catch (err) {
          toast(err.message, 'error');
        }
      },
    },
    [1, 2, 5, 10, 15, 30, 60].map((n) => h('option', { value: String(n), text: `${n} minute${n === 1 ? '' : 's'}` })),
  );
  lockSel.value = String(settings.autoLockMinutes);

  const info = state.info;
  content.append(
    h('h2', { text: 'Settings' }),
    mfaSection,
    h('div', { class: 'settings-section' }, pwForm),
    h(
      'div',
      { class: 'settings-section' },
      h(
        'div',
        { class: 'settings-row' },
        h('div', {}, h('h3', { text: 'Auto-lock' }), h('p', { text: 'Lock the vault after this much inactivity. It also locks when you lock Windows or your PC sleeps.' })),
        lockSel,
      ),
    ),
    h(
      'div',
      { class: 'settings-section' },
      h(
        'div',
        { class: 'settings-row' },
        h(
          'div',
          {},
          h('h3', { text: 'Backup' }),
          h('p', { text: 'Copy your encrypted vault to another drive (e.g. a USB stick). The backup stays encrypted with your password.' }),
        ),
        h('button', {
          class: 'btn',
          text: 'Back up now…',
          onclick: async (e) => {
            const b = e.currentTarget;
            setBusy(b, true, 'Backing up…');
            try {
              const dest = await api.backup();
              if (dest) toast(`Backup saved to ${dest}`, 'ok', 7000);
            } catch (err) {
              toast(err.message, 'error');
            }
            setBusy(b, false);
          },
        }),
      ),
    ),
    h(
      'div',
      { class: 'settings-section' },
      h(
        'div',
        { class: 'settings-row' },
        h('div', {}, h('h3', { text: `VLT ${info.version}` }), h('div', { class: 'path', text: `Vault location: ${info.vaultPath}` })),
        h('button', { class: 'btn', onclick: () => runUpdate() }, icon('refresh'), 'Check for updates'),
      ),
    ),
    h('div', { class: 'dialog-actions' }, h('button', { class: 'btn primary', text: 'Close', onclick: () => m.close() })),
  );
  renderMfaSection();
}

// ------------------------------------------------------------------ updates

let updateToast = null;

function renderUpdateButton() {
  if (!dom.updateBtn || !dom.updateBtn.isConnected) return;
  const u = state.update;
  const label = u && u.state === 'available' ? `Install update v${u.version}` : 'Check for updates';
  dom.updateBtn.classList.toggle('has-update', !!(u && u.state === 'available'));
  dom.updateBtn.replaceChildren(icon('refresh'), label);
}

async function runUpdate() {
  try {
    await api.checkForUpdates(true);
  } catch (err) {
    toast(err.message, 'error');
  }
}

api.on('update:status', (s) => {
  state.update = s;
  renderUpdateButton();
  const show = (text, kind = '', ms = 0) => {
    if (updateToast) updateToast.remove();
    updateToast = toast(text, kind, ms);
    return updateToast;
  };
  switch (s.state) {
    case 'checking':
      show('Checking GitHub for updates…');
      break;
    case 'none':
      show(`You're on the latest version (v${s.version}).`, 'ok', 4000);
      break;
    case 'available':
      if (updateToast) updateToast.remove();
      updateToast = null;
      break;
    case 'downloading': {
      const t = show(`Downloading update${s.version ? ` v${s.version}` : ''}… ${s.percent || 0}%`);
      t.append(h('div', { class: 'progress' }, h('div', { style: `width:${s.percent || 0}%` })));
      break;
    }
    case 'installing':
      show('Installing update. VLT will restart in a moment. Your vault data is not affected.', 'ok');
      break;
    case 'dev':
      show(s.message, '', 4000);
      break;
    case 'error':
      show(`Update failed: ${s.message}`, 'error', 8000);
      break;
    default:
      break;
  }
});

// ------------------------------------------------------------------ activity & lock events

let lastPing = 0;
function ping() {
  const now = Date.now();
  if (now - lastPing > 15000) {
    lastPing = now;
    api.activity();
  }
}
for (const ev of ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart']) {
  window.addEventListener(ev, ping, { passive: true });
}
// Watching a long video counts as activity.
setInterval(() => {
  if ([...document.querySelectorAll('video, audio')].some((m) => !m.paused)) api.activity();
}, 30000);

document.addEventListener('keydown', (e) => {
  if (!dom.content || !dom.content.isConnected) return;
  if (e.ctrlKey && e.key.toLowerCase() === 'l') {
    e.preventDefault();
    lockNow();
  }
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName);
  if (!viewerEl && !$modals.childElementCount && !typing) {
    if (e.ctrlKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selectAllVisible();
    }
    if (e.key === 'Escape' && state.selecting) setSelecting(false);
    if ((e.key === 'Backspace' || (e.altKey && e.key === 'ArrowUp')) && isFolderView() && state.folder) {
      e.preventDefault();
      openFolder(folderById(state.folder).parent || null);
    }
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'n' && !viewerEl) {
    e.preventDefault();
    newNote();
  }
});

api.on('vault:locked', async ({ reason }) => {
  closeViewer();
  closeModals();
  state.items = [];
  state.mediaUrls.clear();
  state.confirmedPlaintext = false;
  state.selecting = false;
  state.selected.clear();
  state.folder = null;
  dom = {};
  if (bulkToast) bulkToast.remove();
  bulkToast = null;
  if (progressToast) progressToast.remove();
  progressToast = null;
  renderLock(await api.status(), reason);
});

// ------------------------------------------------------------------ boot

(async function boot() {
  try {
    state.info = await api.info();
    const s = await api.status();
    if (!s.exists) renderSetup();
    else if (s.unlocked) await enterVault();
    else renderLock(s);
  } catch (err) {
    $app.replaceChildren(
      h('div', { class: 'auth' }, h('div', { class: 'auth-card' }, logo(), h('div', { class: 'msg error', text: `VLT could not start: ${err.message}` }))),
    );
  }
})();
