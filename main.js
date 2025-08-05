const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { execSync } = require('child_process');
const os = require('os');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

let win = null;
let pythonProcess = null;
let clickthroughEnabled = false;

function createWindow() {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;

  // Hide dock on macOS
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  win = new BrowserWindow({
    width: width,
    height: height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true, // Hidden from taskbar
    hasShadow: false,
    focusable: true,
    backgroundColor: '#00000000', // Fully transparent
    hiddenInMissionControl: true, // macOS only, Electron 25+
    webPreferences: { 
      nodeIntegration: true, 
      contextIsolation: false,
      enableRemoteModule: true
    }
  });

  // Makes window click-through - user can interact with content behind it
  win.setIgnoreMouseEvents(true, { forward: true });
  clickthroughEnabled = true;
  
  // Monitor mouse events to detect clicks on underlying application
  let mouseClickDetected = false;
  
  // Listen for mouse events that pass through
  win.webContents.on('did-start-loading', () => {
    win.webContents.executeJavaScript(`
      document.addEventListener('mouseup', (e) => {
        // Only detect clicks that are not on our overlay elements
        if (!e.target.closest('.prompt-container') && !e.target.closest('.overlay-container')) {
          // Send IPC message directly since nodeIntegration is enabled
          require('electron').ipcRenderer.send('underlying-app-click');
        }
      }, true);
    `);
  });

  // Suppress DevTools warnings
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (message.includes('Autofill.enable') || message.includes('SharedImageManager')) {
      event.preventDefault();
    }
  });
  win.loadFile('index.html');

  // Hide window initially
  win.hide();

  // Close window when it loses focus (only when not in clickthrough mode)
  win.on('blur', () => {
    console.log('Window blur event triggered, clickthrough enabled:', clickthroughEnabled);
    if (!clickthroughEnabled) {
      console.log('Hiding window due to blur (clickthrough disabled)');
      win.hide();
    } else {
      console.log('Keeping window visible due to clickthrough mode - clicks will pass through');
      // When clickthrough is enabled, keep the window visible and let clicks pass through
      // Don't hide the window - this ensures the overlay stays visible
      // Clear bounding boxes when user clicks through
      win.webContents.send('clear-highlighting');
    }
  });
  
  // Detect clicks on underlying application when in clickthrough mode
  let lastBlurTime = 0;
  let clickDetectionTimeout = null;
  
  win.on('blur', () => {
    if (clickthroughEnabled) {
      lastBlurTime = Date.now();
      
      // Clear any existing timeout
      if (clickDetectionTimeout) {
        clearTimeout(clickDetectionTimeout);
      }
      
      // Set a timeout to detect if this was a click on underlying app
      clickDetectionTimeout = setTimeout(() => {
        // If window is still blurred after a delay, it was likely a click on underlying app
        if (!win.isFocused() && (Date.now() - lastBlurTime) > 50) {
          console.log('Click detected on underlying application - clearing highlighting');
          win.webContents.send('underlying-app-click');
        }
      }, 150); // 150ms delay to distinguish between focus changes and actual clicks
    }
  });
  
  win.on('focus', () => {
    // Clear timeout if window regains focus
    if (clickDetectionTimeout) {
      clearTimeout(clickDetectionTimeout);
      clickDetectionTimeout = null;
    }
  });

  // Debug focus events
  win.on('focus', () => {
    console.log('Window focus event triggered');
  });
}

function startPythonBackend() {
  const backendPath = path.join(__dirname, 'backend');
  const mainPyPath = path.join(backendPath, 'main.py');
  
  // Check if Python backend exists
  if (!fs.existsSync(mainPyPath)) {
    console.error('Python backend not found at:', mainPyPath);
    return;
  }

  // Change to backend directory and start Python process
  pythonProcess = spawn('python', ['main.py'], {
    cwd: backendPath,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  pythonProcess.stdout.on('data', (data) => {
    console.log('Python stdout:', data.toString());
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error('Python stderr:', data.toString());
  });

  pythonProcess.on('close', (code) => {
    console.log('Python process exited with code:', code);
  });

  pythonProcess.on('error', (error) => {
    console.error('Python process error:', error);
  });
}

async function processScreenshotWithBackend(screenshotPath, prompt, history) {
  return new Promise((resolve, reject) => {
    if (!pythonProcess) {
      reject(new Error('Python backend not running'));
      return;
    }

    // Check if Python process is still alive
    if (pythonProcess.killed) {
      reject(new Error('Python backend process has died'));
      return;
    }

    // Send data to Python backend
    const data = JSON.stringify({
      screenshot_path: screenshotPath,
      prompt: prompt,
      history: history, // Pass history to the backend
      action: 'process_screenshot'
    });

    try {
      pythonProcess.stdin.write(data + '\n');
    } catch (error) {
      reject(new Error('Failed to send data to Python backend: ' + error.message));
      return;
    }

    // Set up timeout
    const timeout = setTimeout(() => {
      console.error('Backend processing timeout');
      reject(new Error('Backend processing timeout'));
    }, 90000); // 90 second timeout

    // Listen for response
    let responseBuffer = '';
    const responseHandler = (data) => {
      responseBuffer += data.toString();
      
      // Try to find complete JSON in the buffer
      const lines = responseBuffer.split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.startsWith('{') && line.endsWith('}')) {
          try {
            const response = JSON.parse(line);
            clearTimeout(timeout);
            pythonProcess.stdout.removeListener('data', responseHandler);
            resolve(response);
            return;
          } catch (error) {
            console.error('Failed to parse JSON line:', line);
          }
        }
      }
    };

    pythonProcess.stdout.on('data', responseHandler);
    
    // Handle Python process errors
    pythonProcess.on('error', (error) => {
      clearTimeout(timeout);
      pythonProcess.stdout.removeListener('data', responseHandler);
      reject(new Error('Python process error: ' + error.message));
    });
  });
}

app.whenReady().then(() => {
  createWindow();
  startPythonBackend();
  
  // Register global shortcut (Ctrl+Shift+G) - Toggle app visibility
  globalShortcut.register('CommandOrControl+Shift+G', () => {
    if (win.isVisible()) {
      win.hide();
      clickthroughEnabled = false;
      win.setIgnoreMouseEvents(true, { forward: true });
    } else {
      win.show();
      win.focus();
      // Ensure clickthrough is enabled when showing the window
      clickthroughEnabled = true;
      win.setIgnoreMouseEvents(true, { forward: true });
      win.webContents.send('clickthrough-enabled');
      // Send message to renderer to focus input with a small delay
      setTimeout(() => {
        win.webContents.send('focus-input');
      }, 200);
    }
  });
  
  // Register global shortcut (Ctrl+Shift+T) - Toggle clickthrough mode
  globalShortcut.register('CommandOrControl+Shift+T', () => {
    if (win.isVisible()) {
      clickthroughEnabled = !clickthroughEnabled;
      console.log('Clickthrough mode:', clickthroughEnabled ? 'enabled' : 'disabled');
      
      if (clickthroughEnabled) {
        // Enable clickthrough - mouse events pass through to underlying windows
        win.setIgnoreMouseEvents(true, { forward: true });
        win.webContents.send('clickthrough-enabled');
        console.log('Mouse events now pass through to underlying windows');
      } else {
        // Disable clickthrough - mouse events are captured by this window
        win.setIgnoreMouseEvents(false);
        win.webContents.send('clickthrough-disabled');
        console.log('Mouse events now captured by this window');
      }
    } else {
      // If window is not visible, show it and enable clickthrough
      win.show();
      win.focus();
      clickthroughEnabled = true;
      win.setIgnoreMouseEvents(true, { forward: true });
      win.webContents.send('clickthrough-enabled');
      console.log('Window shown and clickthrough enabled');
    }
  });

  // Register global shortcut (Ctrl+Shift+0) - Take new screenshot and process OR mark step as success
  globalShortcut.register('CommandOrControl+Shift+0', async () => {
    console.log('Global shortcut Ctrl+Shift+0 triggered');
    
    if (win.isVisible()) {
      // If window is visible, mark step as success
      console.log('Window is visible, sending mark-step-success IPC message');
      console.log('Window webContents ready:', win.webContents.isLoading() ? 'loading' : 'ready');
      console.log('Window webContents destroyed:', win.webContents.isDestroyed());
      
      try {
        win.webContents.send('mark-step-success');
        console.log('mark-step-success IPC message sent successfully');
        
        // Test IPC communication
        console.log('Sending test IPC message');
        win.webContents.send('test-ipc');
        console.log('test-ipc message sent successfully');
      } catch (error) {
        console.error('Error sending IPC message:', error);
      }
    } else {
      // If window is hidden, show it and trigger new screenshot
      console.log('Window is hidden, showing window and triggering new screenshot');
      try {
        win.show();
        win.focus();
        
        // Small delay to ensure window is properly focused
        setTimeout(() => {
          win.webContents.send('trigger-new-screenshot');
        }, 200);
      } catch (error) {
        console.error('Error handling global screenshot shortcut:', error);
      }
    }
  });

  // Register global shortcut (Ctrl+Shift+1) - Mark step as failure
  globalShortcut.register('CommandOrControl+Shift+1', () => {
    console.log('Global shortcut Ctrl+Shift+1 (failure) triggered');
    if (win.isVisible()) {
      console.log('Window is visible, sending mark-step-failure IPC message');
      console.log('Window webContents ready:', win.webContents.isLoading() ? 'loading' : 'ready');
      console.log('Window webContents destroyed:', win.webContents.isDestroyed());
      
      try {
        win.webContents.send('mark-step-failure');
        console.log('mark-step-failure IPC message sent successfully');
      } catch (error) {
        console.error('Error sending IPC message:', error);
      }
    } else {
      console.log('Window is not visible, ignoring mark-step-failure');
    }
  });

  // Register global shortcut (Ctrl+Shift+D) - Open Developer Tools for debugging
  globalShortcut.register('CommandOrControl+Shift+D', () => {
    console.log('Global shortcut Ctrl+Shift+D (DevTools) triggered');
    if (win.isVisible()) {
      if (win.webContents.isDevToolsOpened()) {
        win.webContents.closeDevTools();
        console.log('Developer Tools closed');
      } else {
        win.webContents.openDevTools();
        console.log('Developer Tools opened');
      }
    } else {
      console.log('Window not visible, cannot open DevTools');
    }
  });

  // IPC handler for screenshot (window only)
  ipcMain.handle('take-screenshot', async () => {
    const image = await win.capturePage();
    const tempPath = path.join(app.getPath('temp'), `gemma_screenshot_${Date.now()}.png`);
    fs.writeFileSync(tempPath, image.toPNG());
    return tempPath;
  });

  // IPC handler for full-screen screenshot (macOS & Windows)
  ipcMain.handle('hide-and-screenshot', async () => {
    const tempPath = path.join(app.getPath('temp'), `gemma_screenshot_${Date.now()}.png`);
    
    try {
      // Only hide the prompt, not the entire window
      win.webContents.send('hide-prompt-for-screenshot');
      
      // Wait for prompt to hide
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Take screenshot
      if (isMac) {
        execSync(`screencapture -x "${tempPath}"`);
      } else if (isWin) {
        // Path to nircmd.exe (assumed in project root)
        const nircmdPath = path.join(__dirname, 'nircmd.exe');
        execSync(`"${nircmdPath}" savescreenshot "${tempPath}"`);
      } else {
        throw new Error('Screenshot not implemented for this OS.');
      }
      
      // Verify screenshot was created
      if (!fs.existsSync(tempPath)) {
        throw new Error('Screenshot file was not created');
      }
      
      // Show prompt again
      win.webContents.send('show-prompt-after-screenshot');
      
      return tempPath;
    } catch (e) {
      console.error('Screenshot error:', e);
      win.webContents.send('show-prompt-after-screenshot');
      throw new Error(`Screenshot failed: ${e.message}`);
    }
  });

  // IPC handler for processing screenshots with backend
  ipcMain.handle('process-screenshot', async (event, data) => {
    try {
      const { screenshotPath, prompt, history } = data;
      
      console.log('IPC received data:', { screenshotPath, prompt, history });
      
      // Send processing status to frontend
      win.webContents.send('processing-status', 'Thinking...');
      
      const result = await processScreenshotWithBackend(screenshotPath, prompt, history);
      
      // Send result back to frontend
      win.webContents.send('backend-result', result);
      
      return result;
    } catch (error) {
      console.error('Backend processing error:', error);
      win.webContents.send('backend-error', error.message);
      throw error;
    }
  });

  // IPC handler for clearing highlighting boxes
  ipcMain.handle('clear-highlighting', async () => {
    win.webContents.send('clear-highlighting');
  });

  // IPC handler for getting display info
  ipcMain.handle('get-display-info', async () => {
    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const allDisplays = screen.getAllDisplays();
    
    // Get the actual window bounds
    const windowBounds = win.getBounds();
    const windowContentBounds = win.getContentBounds();
    
    return {
      primary: {
        size: primaryDisplay.size,
        workArea: primaryDisplay.workArea,
        bounds: primaryDisplay.bounds,
        scaleFactor: primaryDisplay.scaleFactor
      },
      all: allDisplays.map(display => ({
        size: display.size,
        workArea: display.workArea,
        bounds: display.bounds,
        scaleFactor: display.scaleFactor
      })),
      window: {
        bounds: windowBounds,
        contentBounds: windowContentBounds,
        isFullScreen: win.isFullScreen(),
        isMaximized: win.isMaximized()
      }
    };
  });
  
  // IPC handler for toggling clickthrough mode
  ipcMain.handle('toggle-clickthrough', () => {
    clickthroughEnabled = !clickthroughEnabled;
    console.log('IPC: Clickthrough mode:', clickthroughEnabled ? 'enabled' : 'disabled');
    
    if (clickthroughEnabled) {
      // Ensure window is visible and clickthrough is enabled
      if (!win.isVisible()) {
        win.show();
        win.focus();
      }
      win.setIgnoreMouseEvents(true, { forward: true });
      win.webContents.send('clickthrough-enabled');
      console.log('IPC: Mouse events now pass through to underlying windows');
    } else {
      win.setIgnoreMouseEvents(false);
      win.webContents.send('clickthrough-disabled');
      console.log('IPC: Mouse events now captured by this window');
    }
    return clickthroughEnabled;
  });
  
  // IPC handler for underlying app click detection
  ipcMain.on('underlying-app-click', () => {
    console.log('Underlying app click detected via IPC');
    win.webContents.send('underlying-app-click');
  });
  
  // Test IPC communication from renderer
  ipcMain.on('test-renderer-ready', () => {
    console.log('Renderer is ready and communicating!');
    win.webContents.send('test-ipc');
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  // Clean up Python process
  if (pythonProcess) {
    pythonProcess.kill();
  }
}); 