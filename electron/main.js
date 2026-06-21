const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// Store API key in userData (not in the app bundle)
const userDataPath = app.getPath('userData');
const keyFile = path.join(userDataPath, 'api-key.enc');

function loadApiKey() {
  try { return fs.readFileSync(keyFile, 'utf8').trim(); } catch { return ''; }
}

function saveApiKey(key) {
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(keyFile, key, 'utf8');
}

// Start the game server
let serverPort = 3000;

async function startServer() {
  const key = loadApiKey();
  if (key) process.env.ANTHROPIC_API_KEY = key;

  const { start } = require('../server');
  // Try port 3000, fall back to a random one
  try {
    serverPort = await start(3000);
  } catch {
    serverPort = await start(0); // OS assigns port
  }
  return serverPort;
}

let win;

async function createWindow() {
  const port = await startServer();

  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    title: 'Taberna del Dragón',
    icon: path.join(__dirname, '../public/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#120800',
    show: false
  });

  // Remove default menu
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Juego',
      submenu: [
        { label: 'Nueva Aventura', click: () => win.webContents.executeJavaScript('newAdventure && newAdventure()') },
        { type: 'separator' },
        { label: 'Configuración API', click: () => win.webContents.executeJavaScript("openModal('settings-modal')") },
        { type: 'separator' },
        { role: 'quit', label: 'Salir' }
      ]
    },
    {
      label: 'Vista',
      submenu: [
        { role: 'reload', label: 'Recargar' },
        { role: 'togglefullscreen', label: 'Pantalla Completa' },
        { role: 'resetZoom', label: 'Zoom Normal' },
        { role: 'zoomIn', label: 'Acercar' },
        { role: 'zoomOut', label: 'Alejar' }
      ]
    }
  ]));

  win.loadURL(`http://localhost:${port}`);

  win.once('ready-to-show', () => {
    win.show();
    // If no API key saved, open settings
    if (!loadApiKey() && !process.env.ANTHROPIC_API_KEY) {
      setTimeout(() => win.webContents.executeJavaScript("openModal('settings-modal')"), 800);
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// IPC for key management from renderer
ipcMain.handle('save-key', (_, key) => { saveApiKey(key); process.env.ANTHROPIC_API_KEY = key; return true; });
ipcMain.handle('load-key', () => loadApiKey());

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
