// Renderiza build/icon.svg em build/icon.png (512 px, com transparência) usando o Chromium do Electron.
// Rodado pelo scripts/icon.mjs (npm run icon); não faz parte do app.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const [svgFile, pngFile] = process.argv.slice(-2);
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const svg = fs.readFileSync(svgFile, 'utf8');
  const html = `<!doctype html><html style="background:transparent;overflow:hidden"><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`;
  const win = new BrowserWindow({
    show: false,
    width: 512,
    height: 512,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    webPreferences: { offscreen: true },
  });
  win.webContents.on('paint', () => {}); // liga a renderização fora da tela
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 500));
  const image = (await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 })).resize({ width: 512, height: 512, quality: 'best' });
  fs.mkdirSync(path.dirname(pngFile), { recursive: true });
  fs.writeFileSync(pngFile, image.toPNG());
  app.quit();
});
