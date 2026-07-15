// Electron wrapper — turns War Table into a standalone desktop app for
// Windows, macOS and Linux. It starts the bundled Node server as a child
// process and loads it in a native window; no browser or terminal needed.

const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');

const PORT = process.env.PORT || '4173';
// In dev the app root is the repo; when packaged it's unpacked under resources.
const appRoot = app.isPackaged ? path.join(process.resourcesPath, 'app') : path.join(__dirname, '..');
let serverProc;

function startServer() {
  serverProc = spawn(process.execPath, [path.join(appRoot, 'server.js')], {
    cwd: appRoot,
    // ELECTRON_RUN_AS_NODE makes the bundled Electron binary run as plain Node,
    // so we don't need Node installed separately on the user's machine.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT },
    stdio: 'inherit',
  });
  serverProc.on('exit', (code) => {
    if (code && !app.isQuitting) app.quit();
  });
}

function waitForServer(cb, tries = 0) {
  http
    .get(`http://127.0.0.1:${PORT}/`, () => cb())
    .on('error', () => {
      if (tries > 80) return cb(new Error('server did not start in time'));
      setTimeout(() => waitForServer(cb, tries + 1), 250);
    });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1120,
    height: 920,
    minWidth: 380,
    backgroundColor: '#12100d',
    title: 'War Table',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true },
  });
  // Open external links (e.g. wartable.co, docs) in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL(`http://127.0.0.1:${PORT}/`);
}

app.whenReady().then(() => {
  startServer();
  waitForServer((err) => {
    if (err) {
      console.error(err);
      app.quit();
      return;
    }
    createWindow();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverProc) serverProc.kill();
});
