const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload script - Exposes safe APIs to renderer process
 * This runs in an isolated context with access to Node.js APIs
 */

contextBridge.exposeInMainWorld('electronAPI', {
  // API configuration
  getApiUrl: () => ipcRenderer.invoke('get-api-url'),
  
  // Authentication
  getAuthToken: () => ipcRenderer.invoke('get-auth-token'),
  setAuthToken: (token) => ipcRenderer.invoke('set-auth-token', token),
  clearAuthToken: () => ipcRenderer.invoke('clear-auth-token'),
  
  // File operations
  selectFile: () => ipcRenderer.invoke('select-file'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  
  // Recent uploads
  addRecentUpload: (upload) => ipcRenderer.invoke('add-recent-upload', upload),
  
  // Navigation
  onNavigateTo: (callback) => {
    ipcRenderer.on('navigate-to', (event, route) => callback(route));
  },
  
  // Upload events
  onStartUpload: (callback) => {
    ipcRenderer.on('start-upload', (event, filePaths) => callback(filePaths));
  },
  
  // Platform info
  platform: process.platform,
  isDesktop: true
});

// Inject desktop-specific styles
window.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.textContent = `
    /* Desktop app specific styles */
    body {
      -webkit-app-region: drag;
      user-select: none;
    }
    
    button, a, input, textarea, select {
      -webkit-app-region: no-drag;
      user-select: auto;
    }
    
    /* Custom scrollbar for desktop */
    ::-webkit-scrollbar {
      width: 10px;
      height: 10px;
    }
    
    ::-webkit-scrollbar-track {
      background: rgba(255, 255, 255, 0.05);
    }
    
    ::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2);
      border-radius: 5px;
    }
    
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.3);
    }
  `;
  document.head.appendChild(style);
  
  // Add desktop indicator
  const indicator = document.createElement('div');
  indicator.id = 'desktop-indicator';
  indicator.textContent = '🖥️ Desktop App';
  indicator.style.cssText = `
    position: fixed;
    bottom: 10px;
    right: 10px;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 5px 10px;
    border-radius: 5px;
    font-size: 12px;
    z-index: 10000;
    pointer-events: none;
  `;
  document.body.appendChild(indicator);
});
