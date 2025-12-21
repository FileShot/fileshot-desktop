const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const Store = require('electron-store');

// Initialize electron-store for settings
const store = new Store();

// Keep references to prevent garbage collection
let mainWindow = null;
let tray = null;
let uploadQueue = [];

// App configuration
const isDev = process.argv.includes('--dev');
const API_URL = isDev ? 'http://localhost:3000' : 'https://api.fileshot.io';
const FRONTEND_URL = isDev ? 'http://localhost:8080' : 'https://fileshot.io';

// Auto-updater configuration
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

/**
 * Create the main window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    },
    show: false, // Don't show until ready
    backgroundColor: '#1a1a1a',
    titleBarStyle: 'default',
    autoHideMenuBar: true
  });

  // Load the app
  // Always load production URL unless explicitly in dev mode
  // Dev mode requires: npm run dev AND web app running on localhost:8080
  if (isDev) {
    console.log('[FileShot] Development mode - attempting to connect to localhost:8080');
    console.log('[FileShot] Make sure your web app is running on localhost:8080');
    mainWindow.loadURL('http://localhost:8080');
    mainWindow.webContents.openDevTools();
  } else {
    console.log('[FileShot] Production mode - connecting to', FRONTEND_URL);
    mainWindow.loadURL(FRONTEND_URL);
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle window close - minimize to tray instead
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      
      // Show notification
      if (tray) {
        tray.displayBalloon({
          title: 'FileShot',
          content: 'FileShot is still running in the background. Click the tray icon to open.',
          icon: path.join(__dirname, 'assets', 'icon.png')
        });
      }
    }
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/**
 * Create system tray icon
 */
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  const trayIcon = nativeImage.createFromPath(iconPath);
  
  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open FileShot',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      }
    },
    {
      label: 'Upload File',
      click: () => {
        selectAndUploadFile();
      }
    },
    {
      label: 'Upload Folder',
      click: () => {
        selectAndUploadFolder();
      }
    },
    { type: 'separator' },
    {
      label: 'Recent Uploads',
      submenu: getRecentUploadsMenu()
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('navigate-to', '/settings');
        }
      }
    },
    {
      label: 'Check for Updates',
      click: () => {
        checkForUpdates();
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('FileShot - Fast, Private File Sharing');
  tray.setContextMenu(contextMenu);

  // Double-click to open window
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });

  // Enable drag & drop on tray icon
  tray.on('drop-files', (event, files) => {
    event.preventDefault();
    uploadFiles(files);
  });
}

/**
 * Get recent uploads menu
 */
function getRecentUploadsMenu() {
  const recentUploads = store.get('recentUploads', []);
  
  if (recentUploads.length === 0) {
    return [{ label: 'No recent uploads', enabled: false }];
  }

  return recentUploads.slice(0, 5).map(upload => ({
    label: upload.fileName,
    click: () => {
      shell.openExternal(upload.url);
    }
  }));
}

/**
 * Select and upload file
 */
async function selectAndUploadFile() {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    title: 'Select files to upload'
  });

  if (!result.canceled && result.filePaths.length > 0) {
    uploadFiles(result.filePaths);
  }
}

/**
 * Select and upload folder
 */
async function selectAndUploadFolder() {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select folder to upload'
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const folderPath = result.filePaths[0];
    const files = getAllFilesInFolder(folderPath);
    uploadFiles(files);
  }
}

/**
 * Get all files in folder recursively
 */
function getAllFilesInFolder(folderPath) {
  const files = [];
  const items = fs.readdirSync(folderPath);

  items.forEach(item => {
    const fullPath = path.join(folderPath, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...getAllFilesInFolder(fullPath));
    } else {
      files.push(fullPath);
    }
  });

  return files;
}

/**
 * Upload files
 */
async function uploadFiles(filePaths) {
  // Add files to upload queue
  filePaths.forEach(filePath => {
    uploadQueue.push({
      path: filePath,
      fileName: path.basename(filePath),
      status: 'pending'
    });
  });

  // Show upload window
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('start-upload', filePaths);
  }

  // Send notification
  const notifier = require('node-notifier');
  notifier.notify({
    title: 'FileShot',
    message: `Uploading ${filePaths.length} file(s)...`,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    sound: false
  });
}

/**
 * Check for updates
 */
function checkForUpdates() {
  autoUpdater.checkForUpdates();
}

/**
 * Auto-updater events
 */
autoUpdater.on('checking-for-update', () => {
  console.log('Checking for updates...');
});

autoUpdater.on('update-available', (info) => {
  console.log('Update available:', info.version);
  
  dialog.showMessageBox({
    type: 'info',
    title: 'Update Available',
    message: `A new version (${info.version}) is available. Would you like to download it now?`,
    buttons: ['Download', 'Later']
  }).then(result => {
    if (result.response === 0) {
      autoUpdater.downloadUpdate();
    }
  });
});

autoUpdater.on('update-not-available', () => {
  console.log('No updates available');
  dialog.showMessageBox({
    type: 'info',
    title: 'No Updates',
    message: 'You are running the latest version of FileShot.',
    buttons: ['OK']
  });
});

autoUpdater.on('download-progress', (progressObj) => {
  console.log(`Download progress: ${progressObj.percent}%`);
  if (mainWindow) {
    mainWindow.setProgressBar(progressObj.percent / 100);
  }
});

autoUpdater.on('update-downloaded', () => {
  console.log('Update downloaded');
  
  dialog.showMessageBox({
    type: 'info',
    title: 'Update Ready',
    message: 'Update downloaded. The application will restart to install the update.',
    buttons: ['Restart Now', 'Later']
  }).then(result => {
    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });
});

/**
 * IPC handlers
 */
ipcMain.handle('get-api-url', () => {
  return API_URL;
});

ipcMain.handle('get-auth-token', () => {
  return store.get('authToken', null);
});

ipcMain.handle('set-auth-token', (event, token) => {
  store.set('authToken', token);
});

ipcMain.handle('clear-auth-token', () => {
  store.delete('authToken');
});

ipcMain.handle('add-recent-upload', (event, upload) => {
  const recentUploads = store.get('recentUploads', []);
  recentUploads.unshift(upload);
  
  // Keep only last 10 uploads
  if (recentUploads.length > 10) {
    recentUploads.pop();
  }
  
  store.set('recentUploads', recentUploads);
  
  // Update tray menu
  if (tray) {
    const contextMenu = tray.getContextMenu();
    tray.setContextMenu(contextMenu);
  }
});

ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections']
  });
  
  return result.filePaths;
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  
  return result.filePaths;
});

/**
 * App lifecycle
 */
app.whenReady().then(() => {
  createWindow();
  createTray();
  
  // Check for updates on startup (after 5 seconds)
  if (!isDev) {
    setTimeout(() => {
      autoUpdater.checkForUpdates();
    }, 5000);
  }
});

app.on('window-all-closed', () => {
  // Don't quit on macOS when all windows are closed
  if (process.platform !== 'darwin') {
    // Keep running in tray
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else if (mainWindow) {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  dialog.showErrorBox('Error', `An error occurred: ${error.message}`);
});
