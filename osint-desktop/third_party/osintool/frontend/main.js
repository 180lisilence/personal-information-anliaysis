const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

const { setupTitlebar, attachTitlebarToWindow } = require("custom-electron-titlebar/main");

// setup the titlebar main process
setupTitlebar();

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1350,
        height: 900,
        titleBarStyle: 'hidden',  // 隐藏默认标题栏
        titleBarOverlay: true,  // 使用自定义标题栏
        // frame: false,  // 禁用默认边框
        webPreferences: {
            sandbox: false,             // 禁用沙箱
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,     // 禁用 nodeIntegration
            contextIsolation: true,     // 启用上下文隔离
            enableRemoteModule: false   // 禁用远程模块，通过ipc通信
        }
    });

    attachTitlebarToWindow(mainWindow);

    mainWindow.loadFile('index.html');

    // 开发时打开开发者工具
    mainWindow.webContents.openDevTools()

    // 监听窗口关闭事件
    mainWindow.on('close', (e) => {
        // 在这里进行判断，例如检查某些条件
        if (mainWindow &&!mainWindow.isDestroyed()) {
            // 发送消息给渲染进程
            mainWindow.webContents.send('quit');
        }
    });

}

// 监听来自渲染进程的消息
ipcMain.on('show-save-dialog', (event, options) => {
    // 显示保存对话框
    const result = dialog.showSaveDialogSync(BrowserWindow.getFocusedWindow(), options);
    // 将结果返回给渲染进程
    event.sender.send('save-dialog-result', result);
});

app.whenReady().then(() => {
    mainWindow = createWindow();
    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});