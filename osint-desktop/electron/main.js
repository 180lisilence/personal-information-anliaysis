const { app, BrowserWindow } = require('electron');
const path = require('path');
const server = require('../server/index.js');
const config = require('../src/core/config');

// 关掉 GPU / 沙箱相关能力：部分机器（虚拟机、无显卡、受限环境）GPU 进程起不来会导致直接退出
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('no-sandbox');
app.disableHardwareAcceleration();

function getPort() {
  return (config.server && config.server.port) || 3999;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL('http://localhost:' + getPort() + '/');
  // win.webContents.openDevTools();
}

app.whenReady().then(() => {
  server.start();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  server.stop();
  app.quit();
});
