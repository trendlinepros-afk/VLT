// Renders build/icon.png (512x512) from an SVG using Electron.
// Usage: npx electron scripts/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b8cff"/><stop offset="1" stop-color="#7c5cff"/></linearGradient></defs>
  <rect x="16" y="16" width="480" height="480" rx="110" fill="url(#g)"/>
  <path d="M256 92 L392 142 V250 C392 340 330 396 256 428 C182 396 120 340 120 250 V142 Z" fill="none" stroke="#fff" stroke-width="30" stroke-linejoin="round"/>
  <rect x="206" y="240" width="100" height="80" rx="14" fill="#fff"/>
  <path d="M226 240 V214 a30 30 0 0 1 60 0 V240" fill="none" stroke="#fff" stroke-width="18"/>
</svg>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, useContentSize: true });
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.png'), img.resize({ width: 512, height: 512 }).toPNG());
  app.quit();
});
