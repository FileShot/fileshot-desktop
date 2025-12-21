/**
 * Custom build script to bypass electron-builder icon validation
 * Run with: node build-with-icon-override.js
 */

const builder = require('electron-builder');
const Platform = builder.Platform;

builder.build({
  targets: Platform.WINDOWS.createTarget(),
  config: {
    appId: 'io.fileshot.desktop',
    productName: 'FileShot',
    win: {
      target: ['nsis', 'portable'],
      icon: 'build/icon.ico',
      // Skip icon validation
      iconUrl: undefined
    },
    nsis: {
      oneClick: true,
      perMachine: false,
      createDesktopShortcut: true,
      createStartMenuShortcut: true
    }
  }
}).then(() => {
  console.log('Build complete!');
}).catch((error) => {
  console.error('Build failed:', error);
  process.exit(1);
});
