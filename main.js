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
  // Get primary display bounds for better multi-monitor support
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;
  
  win = new BrowserWindow({
    width: width,
    height: height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    webPreferences: { 
      nodeIntegration: true, 
      contextIsolation: false,
      enableRemoteModule: true
    }
  });
  
  // Set window to ignore mouse events by default (clickthrough enabled)
  win.setIgnoreMouseEvents(true, { forward: true });
  clickthroughEnabled = true;
  
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
      console.log('Keeping window visible due to clickthrough mode');
      // When clickthrough is enabled, don't hide the window
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

async function processScreenshotWithBackend(screenshotPath, prompt) {
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
    }, 30000); // 30 second timeout

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
      // Send message to renderer to focus input with a small delay
      setTimeout(() => {
        win.webContents.send('focus-input');
      }, 100);
    }
  });
  
  // Register global shortcut (Cmd+Shift+F) - Focus input box (when app is visible)
  globalShortcut.register('CommandOrControl+Shift+F', () => {
    if (win.isVisible()) {
      win.webContents.send('focus-input');
    }
  });
  
  // Register global shortcut (Cmd+/) - Submit prompt
  globalShortcut.register('CommandOrControl+/', () => {
    if (win.isVisible()) {
      win.webContents.send('submit-prompt');
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
      const { screenshotPath, prompt } = data;
      
      // Send processing status to frontend
      win.webContents.send('processing-status', 'Processing screenshot...');
      
      const result = await processScreenshotWithBackend(screenshotPath, prompt);
      
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
      }))
    };
  });
  
  // IPC handler for toggling clickthrough mode
  ipcMain.handle('toggle-clickthrough', () => {
    clickthroughEnabled = !clickthroughEnabled;
    console.log('IPC: Clickthrough mode:', clickthroughEnabled ? 'enabled' : 'disabled');
    
    if (clickthroughEnabled) {
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