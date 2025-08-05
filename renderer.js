const { ipcRenderer } = require('electron');

class BubbleApp {
    constructor() {
        this.initializeElements();
        this.bindEvents();
        this.setupCanvas();
        this.currentPrompt = '';
        this.isProcessing = false;
        this.highlightingBoxes = [];
        this.lastKeyPress = null;
        this.initialPromptEntered = false;
        this.promptBoxShown = false;
        this.workflowStartTime = null; // Add timing variable
        this.taskHistory = []; // Track task history with status
        this.currentTask = null; // Track current task being displayed
        
        // Debug initial state
        console.log('BubbleApp initialized with:', {
            initialPromptEntered: this.initialPromptEntered,
            promptBoxShown: this.promptBoxShown,
            promptContainerClasses: this.promptContainer ? this.promptContainer.className : 'not found'
        });
    }

    initializeElements() {
        this.promptInput = document.getElementById('promptInput');
        this.submitBtn = document.getElementById('submitBtn');
        this.promptBar = document.getElementById('promptBar');
        this.promptContainer = document.getElementById('promptContainer');
        this.overlayCanvas = document.getElementById('overlayCanvas');
        this.overlayContainer = document.getElementById('overlayContainer');
        this.fullscreenBorder = document.getElementById('fullscreenBorder');
        this.loadingIndicator = document.getElementById('loadingIndicator');
        this.statusMessage = document.getElementById('statusMessage');
        
        // Ensure prompt container is visible by default for first use
        if (this.promptContainer) {
            this.promptContainer.classList.remove('hidden');
        }
    }

    bindEvents() {
        // Submit button click
        this.submitBtn.addEventListener('click', () => this.handleSubmit());
        
        // Enter key in input
        this.promptInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.handleSubmit();
            }
        });

        // Settings button
        // this.settingsBtn.addEventListener('click', () => this.handleSettings()); // Removed

        // Input focus
        this.promptInput.addEventListener('focus', () => this.handleInputFocus());
        this.promptInput.addEventListener('blur', () => this.handleInputBlur());

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboardShortcuts(e));

        // Window resize events
        window.addEventListener('resize', () => this.handleResize());
        window.addEventListener('orientationchange', () => this.handleResize());

        // Click event to clear bounding boxes
        document.addEventListener('click', (e) => this.handleClick(e));

        // Enable clickthrough for non-interactive elements
        this.setupClickthrough();

        // IPC listeners
        this.setupIPCListeners();
    }
    
    setupClickthrough() {
        // Make overlay container clickthrough
        this.overlayContainer.style.pointerEvents = 'none';
        this.fullscreenBorder.style.pointerEvents = 'none';
        
        // Only allow interaction with prompt container
        this.promptContainer.style.pointerEvents = 'auto';
        
        // Track clickthrough state - enabled by default
        this.clickthroughEnabled = true;
        document.body.classList.add('clickthrough-mode');
        
        console.log('Renderer: Initial clickthrough setup complete');
    }
    
    enableClickthrough() {
        this.clickthroughEnabled = true;
        document.body.classList.add('clickthrough-mode');
        
        // Disable interaction with overlay elements when clickthrough is enabled
        this.overlayContainer.style.pointerEvents = 'none';
        this.fullscreenBorder.style.pointerEvents = 'none';
        
        // Allow interaction with prompt container
        this.promptContainer.style.pointerEvents = 'auto';
        
        console.log('Renderer: Clickthrough enabled');
    }
    
    disableClickthrough() {
        this.clickthroughEnabled = false;
        document.body.classList.remove('clickthrough-mode');
        
        // Allow interaction with all elements when clickthrough is disabled
        this.overlayContainer.style.pointerEvents = 'auto';
        this.fullscreenBorder.style.pointerEvents = 'auto';
        this.promptContainer.style.pointerEvents = 'auto';
        
        console.log('Renderer: Clickthrough disabled');
        this.showStatusMessage('Clickthrough disabled', 'info');
    }
    
    focusInput() {
        if (this.promptInput) {
            // Always show prompt box on first focus, regardless of state
            if (!this.initialPromptEntered) {
                this.showPromptBox();
                this.promptBoxShown = true;
                this.promptInput.focus();
                this.promptInput.select();
                console.log('First time focus - showing prompt box and focusing input');
            } else {
                // For subsequent focuses, just focus the input
                this.promptInput.focus();
                this.promptInput.select();
                console.log('Subsequent focus - input focused and text selected');
            }
        } else {
            console.warn('Prompt input element not found');
        }
    }
    
    async toggleClickthrough() {
        try {
            const isEnabled = await ipcRenderer.invoke('toggle-clickthrough');
            if (isEnabled) {
                this.enableClickthrough();
            } else {
                this.disableClickthrough();
            }
        } catch (error) {
            console.error('Failed to toggle clickthrough:', error);
            this.showStatusMessage('Failed to toggle clickthrough mode', 'error');
        }
    }
    
    hidePromptForScreenshot() {
        console.log('Hiding prompt for screenshot (force style)');
        // Hide loading indicator
        const loader = document.getElementById('loadingIndicator');
        if (loader) {
            loader.style.display = 'none';
            loader.style.opacity = '0';
        }
        // Hide next step cue
        const cue = document.getElementById('nextStepCue');
        if (cue) {
            cue.style.display = 'none';
            cue.style.opacity = '0';
        }
        // Hide prompt container as before
        this.promptContainer.classList.add('hidden');
    }
    
    showPromptAfterScreenshot() {
        console.log('Showing prompt after screenshot');
        // Only show prompt if this is the first time and initial prompt hasn't been entered
        if (!this.initialPromptEntered) {
            this.promptContainer.classList.remove('hidden');
        }
        // Show loading indicator again after screenshot if processing
        if (this.isProcessing) {
            this.loadingIndicator.style.display = 'flex';
            this.loadingIndicator.style.opacity = '1';
        }
        // Show next step cue if it should be visible (e.g., after step is drawn)
        const nextStepCue = document.getElementById('nextStepCue');
        if (nextStepCue && !this.isProcessing && this.highlightingBoxes.length > 0) {
            nextStepCue.style.display = 'flex';
            nextStepCue.style.opacity = '1';
        }
    }
    
    handleResize() {
        console.log('Window resized, updating canvas...');
        this.resizeCanvas();
        
        // Redraw any existing highlighting boxes if they exist
        if (this.highlightingBoxes && this.highlightingBoxes.length > 0) {
            this.drawHighlightingBoxes(this.highlightingBoxes);
        }
    }
    
    handleClick(e) {
        // Don't clear boxes if clicking on the prompt container (input, buttons, etc.)
        if (e.target.closest('.prompt-container')) {
            return;
        }
        
        // Clear bounding boxes and task descriptions
        console.log('Click detected - clearing bounding boxes and descriptions');
        this.clearHighlightingBoxes();
    }
    
    // Add method to handle clicks on underlying application
    handleUnderlyingAppClick() {
        console.log('Click detected on underlying application - clearing bounding boxes');
        this.clearHighlightingBoxes();
    }
    
    cleanup() {
        console.log('Cleaning up resources...');
        this.clearCanvas();
        this.highlightingBoxes = [];
        this.isProcessing = false;
        this.showLoading(false);
        
        // Remove event listeners to prevent memory leaks
        if (this.promptInput) {
            this.promptInput.removeEventListener('keypress', this.handleSubmit);
        }
    }

    setupIPCListeners() {
        // Test IPC listener to verify communication
        ipcRenderer.on('test-ipc', () => {
            console.log('TEST: IPC communication is working!');
        });
        
        // Listen for backend results
        ipcRenderer.on('backend-result', (event, data) => {
            this.handleBackendResult(data);
        });

        // Listen for screenshot completion
        ipcRenderer.on('screenshot-complete', (event, data) => {
            this.handleScreenshotComplete(data);
        });

        // Listen for error messages
        ipcRenderer.on('backend-error', (event, error) => {
            this.showStatusMessage(error, 'error');
        });

        // Listen for processing status
        ipcRenderer.on('processing-status', (event, status) => {
            this.updateProcessingStatus(status);
        });
        
        // Listen for focus input command
        ipcRenderer.on('focus-input', () => {
            this.focusInput();
        });
        
        // Ensure clickthrough is enabled when window is shown
        ipcRenderer.on('clickthrough-enabled', () => {
            this.enableClickthrough();
        });
        
        // Listen for clickthrough mode changes
        ipcRenderer.on('clickthrough-enabled', () => {
            this.enableClickthrough();
        });
        
        ipcRenderer.on('clickthrough-disabled', () => {
            this.disableClickthrough();
        });
        
        // Listen for screenshot workflow
        ipcRenderer.on('hide-prompt-for-screenshot', () => {
            this.hidePromptForScreenshot();
        });
        
        ipcRenderer.on('show-prompt-after-screenshot', () => {
            this.showPromptAfterScreenshot();
        });
        
        // Listen for global shortcut trigger
        ipcRenderer.on('trigger-new-screenshot', () => {
            console.log('Received trigger-new-screenshot from main process');
            this.handleClearAndRescreenshot();
        });
        
        // Listen for clear highlighting command
        ipcRenderer.on('clear-highlighting', () => {
            console.log('Received clear-highlighting command from main process');
            this.clearHighlightingBoxes();
        });
        
        // Listen for underlying app click detection
        ipcRenderer.on('underlying-app-click', () => {
            console.log('Received underlying-app-click from main process');
            this.handleUnderlyingAppClick();
        });
        
        // Listen for step control commands
        ipcRenderer.on('mark-step-success', () => {
            console.log('=== MARK STEP SUCCESS IPC RECEIVED ===');
            console.log('Received mark-step-success from main process');
            console.log('Current task:', this.currentTask);
            console.log('Is processing:', this.isProcessing);
            console.log('Task history:', this.taskHistory);
            console.log('About to call markStepSuccess()');
            this.markStepSuccess();
            console.log('=== MARK STEP SUCCESS IPC HANDLED ===');
        });
        
        ipcRenderer.on('mark-step-failure', () => {
            console.log('=== MARK STEP FAILURE IPC RECEIVED ===');
            console.log('Received mark-step-failure from main process');
            console.log('Current task:', this.currentTask);
            console.log('Is processing:', this.isProcessing);
            console.log('Task history:', this.taskHistory);
            console.log('About to call markStepFailure()');
            this.markStepFailure();
            console.log('=== MARK STEP FAILURE IPC HANDLED ===');
        });
    }

    setupCanvas() {
        this.ctx = this.overlayCanvas.getContext('2d');
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        
        // Get actual display info from Electron
        this.getDisplayInfo();
        
        // Canvas setup complete
    }
    
    async getDisplayInfo() {
        try {
            // Try to get display info from Electron main process
            const displayInfo = await ipcRenderer.invoke('get-display-info');
            console.log('Display info from Electron:', displayInfo);
            
            // Use the primary display dimensions if available
            if (displayInfo.primary && displayInfo.primary.size) {
                this.screenWidth = displayInfo.primary.size.width;
                this.screenHeight = displayInfo.primary.size.height;
                console.log('Using Electron display dimensions:', { width: this.screenWidth, height: this.screenHeight });
            }
            
            // Store window bounds for coordinate calculations
            if (displayInfo.window) {
                this.windowBounds = displayInfo.window.bounds;
                this.windowContentBounds = displayInfo.window.contentBounds;
                console.log('Window bounds:', this.windowBounds);
                console.log('Window content bounds:', this.windowContentBounds);
            }
            
            return displayInfo;
        } catch (error) {
            console.log('Could not get display info from Electron, using window.screen');
            return null;
        }
    }
    


    resizeCanvas() {
        if (!this.overlayCanvas) {
            console.warn('Canvas not available for resizing');
            return;
        }

        // Get the device pixel ratio for high-DPI displays
        const devicePixelRatio = window.devicePixelRatio || 1;
        
        // Get the viewport dimensions (what the canvas should actually display)
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        // Get screen dimensions for reference
        const screenWidth = window.screen.width;
        const screenHeight = window.screen.height;
        
        // Set canvas size accounting for device pixel ratio
        this.overlayCanvas.width = viewportWidth * devicePixelRatio;
        this.overlayCanvas.height = viewportHeight * devicePixelRatio;
        
        // Set the CSS size to match the viewport
        this.overlayCanvas.style.width = `${viewportWidth}px`;
        this.overlayCanvas.style.height = `${viewportHeight}px`;
        
        // Scale the context to account for the device pixel ratio
        const ctx = this.overlayCanvas.getContext('2d');
        ctx.scale(devicePixelRatio, devicePixelRatio);
        
        // Also update the overlay container size (should already be 100vw/100vh in CSS)
        this.overlayContainer.style.width = `${viewportWidth}px`;
        this.overlayContainer.style.height = `${viewportHeight}px`;
        
        // Store both dimensions for use in drawing
        this.screenWidth = screenWidth;
        this.screenHeight = screenHeight;
        this.viewportWidth = viewportWidth;
        this.viewportHeight = viewportHeight;
        this.devicePixelRatio = devicePixelRatio;
        
        // Update window bounds if not already set
        if (!this.windowBounds) {
            this.getDisplayInfo();
        }
        
        console.log('Canvas resized to:', {
            width: this.overlayCanvas.width,
            height: this.overlayCanvas.height,
            cssWidth: this.overlayCanvas.style.width,
            cssHeight: this.overlayCanvas.style.height,
            viewport: { width: viewportWidth, height: viewportHeight },
            screen: { width: screenWidth, height: screenHeight },
            window: { width: window.innerWidth, height: window.innerHeight },
            availScreen: { width: window.screen.availWidth, height: window.screen.availHeight },
            devicePixelRatio: devicePixelRatio
        });
    }

    handleSubmit() {
        const prompt = this.promptInput.value.trim();
        if (!prompt || this.isProcessing) return;

        // Start timing for the entire workflow
        this.workflowStartTime = Date.now();
        console.log(`[TIMING] Workflow started at: ${new Date(this.workflowStartTime).toISOString()}`);

        this.currentPrompt = prompt;
        this.initialPromptEntered = true;
        this.isProcessing = true;
        this.showLoading(true);
        this.clearHighlightingBoxes();
        this.taskHistory = []; // Reset history for new workflow

        // Hide prompt box after first use and keep it hidden
        this.hidePromptBox();
        this.promptBoxShown = false;

        // Start the screenshot and processing workflow
        this.startScreenshotWorkflow();
    }

    async startScreenshotWorkflow() {
        try {
            // Always hide overlays before every screenshot
            this.hidePromptForScreenshot();

            // Force a reflow and wait a bit longer to ensure DOM updates
            document.body.offsetHeight;
            await new Promise(resolve => setTimeout(resolve, 250));

            const workflowStepTime = Date.now();
            console.log(`[TIMING] Screenshot workflow started at: ${new Date(workflowStepTime).toISOString()}`);
            if (this.workflowStartTime) {
                console.log(`[TIMING] Time since workflow start: ${workflowStepTime - this.workflowStartTime}ms`);
            }

            // Step 1: Hide prompt box during processing
            this.hidePromptBox();
            
            // Step 2: Expand animation with full-screen border
            await this.expandForScreenshot();
            
            // Step 3: Border is always visible now
            
            // Step 4: Take screenshot (prompt will be hidden by main process)
            const screenshotStartTime = Date.now();
            console.log(`[TIMING] Taking screenshot at: ${new Date(screenshotStartTime).toISOString()}`);
            const screenshotPath = await this.takeScreenshot();
            const screenshotEndTime = Date.now();
            console.log(`[TIMING] Screenshot completed in: ${screenshotEndTime - screenshotStartTime}ms`);
            
            // Step 5: Send to backend (border stays visible during processing)
            const backendStartTime = Date.now();
            console.log(`[TIMING] Sending to backend at: ${new Date(backendStartTime).toISOString()}`);
            await this.sendToBackend(screenshotPath);
            const backendEndTime = Date.now();
            console.log(`[TIMING] Backend processing completed in: ${backendEndTime - backendStartTime}ms`);
            
            // Step 6: Contract animation (border remains visible)
            await this.contractAfterScreenshot();
            
        } catch (error) {
            console.error('Screenshot workflow error:', error);
            this.showStatusMessage('Failed to process request', 'error');
            this.showLoading(false);
            this.isProcessing = false;
        }
    }

    async expandForScreenshot() {
        return new Promise((resolve) => {
            this.promptBar.classList.add('expanding');
            setTimeout(() => resolve(), 500); // Match animation duration
        });
    }

    async contractAfterScreenshot() {
        return new Promise((resolve) => {
            this.promptBar.classList.remove('expanding');
            this.promptBar.classList.add('contracting');
            setTimeout(() => {
                this.promptBar.classList.remove('contracting');
                resolve();
            }, 400); // Match animation duration
        });
    }
    
    showFullscreenBorder() {
        console.log('Full-screen border is always visible now');
        // Border is always visible, no need to show/hide
    }
    
    hideFullscreenBorder() {
        console.log('Full-screen border is always visible now');
        // Border is always visible, no need to show/hide
    }
    
    hidePromptBox() {
        console.log('Hiding prompt box');
        this.promptContainer.classList.add('hidden');
    }
    
    showPromptBox() {
        console.log('Showing prompt box');
        this.promptContainer.classList.remove('hidden');
        // Force a reflow to ensure the change takes effect
        this.promptContainer.offsetHeight;
        console.log('Prompt container classes after show:', this.promptContainer.className);
    }

    async takeScreenshot() {
        try {
            // Use the existing IPC handler from main.js
            const screenshotPath = await ipcRenderer.invoke('hide-and-screenshot');
            return screenshotPath;
        } catch (error) {
            throw new Error('Failed to capture screen: ' + error.message);
        }
    }

    async sendToBackend(screenshotPath) {
        try {
            console.log('Sending to backend with history:', this.taskHistory);
            const result = await ipcRenderer.invoke('process-screenshot', {
                screenshotPath,
                prompt: this.currentPrompt,
                history: this.taskHistory  // Include history with status
            });
            return result;
        } catch (error) {
            throw new Error('Processing failed: ' + error.message);
        }
    }

    async handleBackendResult(data) {
        this.showLoading(false);
        this.isProcessing = false;

        const resultTime = Date.now();
        console.log(`[TIMING] Backend result received at: ${new Date(resultTime).toISOString()}`);
        if (this.workflowStartTime) {
            console.log(`[TIMING] Total time from workflow start to result: ${resultTime - this.workflowStartTime}ms`);
        }

        console.log('Backend result received:', data);
        console.log('Data type:', typeof data);
        console.log('Data keys:', Object.keys(data));
        console.log('highlighting_boxes:', data.highlighting_boxes);
        console.log('highlightingBoxes:', data.highlightingBoxes);

        // Check if the task is completed
        if (data.status === 'completed') {
            console.log('Task completed - showing completion notification');
            this.showCompletionNotification(data.message || 'Task completed successfully!');
            // Clear history when task is completed
            this.taskHistory = [];
            this.currentTask = null;
            return;
        }

        // Check for both possible property names
        const boxes = data.highlighting_boxes || data.highlightingBoxes;
        
        // Check if this is a scroll action
        if (data.task && data.task.action && (data.task.action.toLowerCase().includes('scroll'))) {
            console.log('Scroll action detected:', data.task.action);
            this.drawScrollCommentBox(data.task.action);
            return;
        }
        
        if (boxes && Array.isArray(boxes) && boxes.length > 0) {
            console.log('Drawing highlighting boxes:', boxes);
            console.log('Current viewport dimensions:', {
                viewportWidth: this.viewportWidth || window.innerWidth,
                viewportHeight: this.viewportHeight || window.innerHeight,
                screenWidth: this.screenWidth || window.screen.width,
                screenHeight: this.screenHeight || window.screen.height
            });
            
            // Store current task for step control
            if (data.task) {
                this.currentTask = data.task;
                console.log('Current task set for step control:', this.currentTask);
            } else {
                console.log('No task data in backend result');
            }
            
            // Display step description if available
            let stepInfo = null;
            if (data.task && data.task.step && data.task.action) {
                stepInfo = { step: data.task.step, action: data.task.action };
            } else if (data.task && data.task.action) {
                stepInfo = { action: data.task.action };
            }
            
            // Animate border shrinking to bounding boxes
            const drawStartTime = Date.now();
            console.log(`[TIMING] Starting to draw bounding boxes at: ${new Date(drawStartTime).toISOString()}`);
            await this.animateBorderToBoxes(boxes, stepInfo);
            const drawEndTime = Date.now();
            console.log(`[TIMING] Bounding boxes drawn in: ${drawEndTime - drawStartTime}ms`);
            
            // Final timing summary
            if (this.workflowStartTime) {
                const totalTime = drawEndTime - this.workflowStartTime;
                console.log(`[TIMING] TOTAL TIME from prompt/trigger to bounding box drawn: ${totalTime}ms`);
                console.log(`[TIMING] Workflow completed at: ${new Date(drawEndTime).toISOString()}`);
            }
            

        } else {
            console.log('No highlighting boxes found in data. Available keys:', Object.keys(data));
            // Border is always visible now, no need to hide it

        }
    }
    
    async animateBorderToBoxes(boxes, stepInfo = null) {
        console.log('Animating border to bounding boxes');
        
        // Border is always visible now, just draw the highlighting boxes
        await this.drawHighlightingBoxes(boxes, stepInfo);
    }

    handleScreenshotComplete(data) {
        // Handle screenshot completion if needed
        console.log('Screenshot completed:', data);
    }

    async drawHighlightingBoxes(boxes, stepInfo = null) {
        // Ensure canvas is properly sized before drawing
        this.resizeCanvas();
        this.clearCanvas();
        
        for (let i = 0; i < boxes.length; i++) {
            await this.drawBox(boxes[i], i, stepInfo);
        }
    }

    async drawBox(box, index, stepInfo = null) {
        const { x, y, width, height } = box;
        // Use stored dimensions or fall back to current values
        const viewportWidth = this.viewportWidth || window.innerWidth;
        const viewportHeight = this.viewportHeight || window.innerHeight;
        const screenWidth = this.screenWidth || window.screen.width;
        const screenHeight = this.screenHeight || window.screen.height;
        const windowBounds = this.windowBounds || { x: 0, y: 0, width: screenWidth, height: screenHeight };
        const actualWindowWidth = windowBounds.width;
        const actualWindowHeight = windowBounds.height;
        const actualWindowX = windowBounds.x;
        const actualWindowY = windowBounds.y;
        const scaleX = viewportWidth / actualWindowWidth;
        const scaleY = viewportHeight / actualWindowHeight;
        // Convert from screen percentages to window coordinates
        const windowX = Math.round(x * screenWidth - actualWindowX);
        const windowY = Math.round(y * screenHeight - actualWindowY);
        const windowWidth = Math.round(width * screenWidth);
        const windowHeight = Math.round(height * screenHeight);
        // Scale to viewport
        const scaledX = Math.round(windowX * scaleX);
        const scaledY = Math.round(windowY * scaleY);
        const scaledWidth = Math.round(windowWidth * scaleX);
        const scaledHeight = Math.round(windowHeight * scaleY);
        // Center-top of the element
        const anchorX = scaledX + scaledWidth / 2;
        const anchorY = scaledY;
        // Draw only the comment/task box with a connecting line
        if (stepInfo) {
            this.drawCommentBox(anchorX, anchorY, stepInfo.action);
            this.showNextStepCue();
        }
    }

    drawCommentBox(anchorX, anchorY, text) {
        // Settings for the comment box
        const ctx = this.ctx;
        const font = '16px Lato';
        ctx.font = font;
        const viewportWidth = this.viewportWidth || window.innerWidth;
        const maxWidth = Math.floor(viewportWidth * 0.7);
        const padding = 16;
        // Word wrap
        const words = text.split(' ');
        let lines = [];
        let currentLine = '';
        for (let i = 0; i < words.length; i++) {
            const testLine = currentLine ? currentLine + ' ' + words[i] : words[i];
            const testWidth = ctx.measureText(testLine).width;
            if (testWidth > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = words[i];
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine) lines.push(currentLine);
        // Calculate box size
        const lineHeight = 24;
        const boxWidth = Math.min(
            maxWidth,
            Math.max(...lines.map(line => ctx.measureText(line).width)) + padding * 2
        );
        const boxHeight = lines.length * lineHeight + padding * 2;
        // Position the box above the anchor point
        let boxX = anchorX - boxWidth / 2;
        const boxY = anchorY - boxHeight - 24; // 24px gap above the element
        // Clamp boxX so the box stays within the viewport
        const minX = 8; // 8px margin from left
        const maxX = viewportWidth - boxWidth - 8; // 8px margin from right
        if (boxX < minX) boxX = minX;
        if (boxX > maxX) boxX = maxX;
        // Adjust tailX so it still points to anchorX, but doesn't go outside the box
        const tailWidth = 22;
        let tailX = anchorX;
        if (tailX < boxX + tailWidth / 2) tailX = boxX + tailWidth / 2;
        if (tailX > boxX + boxWidth - tailWidth / 2) tailX = boxX + boxWidth - tailWidth / 2;
        // Draw seamless speech bubble (rounded rect + tail as one path)
        ctx.save();
        ctx.beginPath();
        const radius = 16;
        const tailHeight = 14;
        // Top left corner
        ctx.moveTo(boxX + radius, boxY);
        // Top edge
        ctx.lineTo(boxX + boxWidth - radius, boxY);
        // Top right corner
        ctx.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + radius);
        // Right edge
        ctx.lineTo(boxX + boxWidth, boxY + boxHeight - radius);
        // Bottom right corner
        ctx.quadraticCurveTo(boxX + boxWidth, boxY + boxHeight, boxX + boxWidth - radius, boxY + boxHeight);
        // Bottom edge to right of tail
        ctx.lineTo(tailX + tailWidth / 2, boxY + boxHeight);
        // Tail (downward triangle, seamlessly connected)
        ctx.lineTo(tailX, boxY + boxHeight + tailHeight);
        ctx.lineTo(tailX - tailWidth / 2, boxY + boxHeight);
        // Bottom edge to left
        ctx.lineTo(boxX + radius, boxY + boxHeight);
        // Bottom left corner
        ctx.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - radius);
        // Left edge
        ctx.lineTo(boxX, boxY + radius);
        // Top left corner
        ctx.quadraticCurveTo(boxX, boxY, boxX + radius, boxY);
        ctx.closePath();
        // Fill with dark grey background (matching "Thinking..." box)
        ctx.fillStyle = 'rgba(45, 48, 53, 0.95)';
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 2;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();
        // Draw text
        ctx.save();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.font = font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], boxX + boxWidth / 2, boxY + padding + lineHeight / 2 + i * lineHeight);
        }
        ctx.restore();
    }

    drawScrollCommentBox(action) {
        console.log('Drawing scroll comment box for action:', action);
        
        // Clear any existing highlighting
        this.clearCanvas();
        
        const viewportWidth = this.viewportWidth || window.innerWidth;
        const viewportHeight = this.viewportHeight || window.innerHeight;
        
        // Determine scroll direction
        const isScrollUp = action.toLowerCase().includes('up');
        const isScrollDown = action.toLowerCase().includes('down');
        
        if (!isScrollUp && !isScrollDown) {
            console.log('Unknown scroll direction:', action);
            return;
        }
        
        // Position the comment box at the top or bottom of the screen
        const anchorX = viewportWidth / 2; // Center horizontally
        const anchorY = isScrollUp ? 100 : viewportHeight - 100; // Top or bottom of screen
        
        // Create the scroll instruction text
        const scrollText = isScrollUp ? 'Scroll Up' : 'Scroll Down';
        
        // Use the same drawCommentBox method for consistent styling
        this.drawCommentBox(anchorX, anchorY, scrollText);
        
        // Show next step cue
        this.showNextStepCue();
    }

    clearCanvas() {
        if (this.ctx && this.overlayCanvas) {
            this.ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
            console.log('Canvas cleared');
        } else {
            console.warn('Canvas context not available for clearing');
        }
    }

    clearHighlightingBoxes() {
        console.log('Clearing highlighting boxes...');
        this.clearCanvas();
        this.highlightingBoxes = [];
        this.currentTask = null; // Clear current task when clearing highlighting
        // Border is always visible now, no need to hide it
        
        // Don't show prompt box after first use - it should stay hidden
        // Only show if this is the very first time and prompt hasn't been shown yet
        if (!this.initialPromptEntered && !this.promptBoxShown) {
            this.showPromptBox();
            this.promptBoxShown = true;
        }
        
        // Force garbage collection if available
        if (window.gc) {
            window.gc();
        }
    }

    handleKeyboardShortcuts(e) {
        // Ctrl+Shift+0 is now handled globally by main.js
        
        // Ctrl+Shift+G - Toggle app visibility (handled by main.js)
        if (e.ctrlKey && e.shiftKey && e.key === 'G') {
            // This is handled by the main process
        }
        
        // Cmd+Shift+F - Focus input (when app is visible)
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'F') {
            e.preventDefault();
            this.focusInput();
        }
        
        // Cmd+/ - Submit prompt (when app is visible)
        if ((e.metaKey || e.ctrlKey) && e.key === '/') {
            e.preventDefault();
            this.handleSubmit();
        }
        
        // Cmd+Shift+T - Toggle clickthrough mode
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'T') {
            e.preventDefault();
            this.toggleClickthrough();
        }
        
        // Ctrl+Shift+0 - Mark current step as success and move to next
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === '0') {
            e.preventDefault();
            this.markStepSuccess();
        }
        
        // Ctrl+Shift+1 - Mark current step as failure and retry
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === '1') {
            e.preventDefault();
            this.markStepFailure();
        }
    }

    async handleClearAndRescreenshot() {
        if (this.isProcessing) {
            console.log('Already processing, ignoring request');
            return;
        }
        
        // Start timing for global shortcut workflow
        this.workflowStartTime = Date.now();
        console.log(`[TIMING] Global shortcut workflow started at: ${new Date(this.workflowStartTime).toISOString()}`);
        
        console.log('Starting new workflow...');
        this.clearHighlightingBoxes();
        this.taskHistory = []; // Reset history for new workflow

        
        // For global shortcut, we need to handle the case where there's no current prompt
        if (!this.currentPrompt || this.currentPrompt.trim() === '') {
            // Use a default prompt for global shortcut
            this.currentPrompt = 'Analyze this screen and identify all interactive elements';
        }
        
        // Start new workflow - prompt box should remain hidden
        this.isProcessing = true;
        this.showLoading(true);
        
        try {
            await this.startScreenshotWorkflow();
        } catch (error) {
            console.error('Workflow failed:', error);
            this.showStatusMessage('Request failed: ' + error.message, 'error');
            this.isProcessing = false;
            this.showLoading(false);
        }
    }

    handleInputFocus() {
        this.promptBar.style.transform = 'scale(1.02)';
    }

    handleInputBlur() {
        this.promptBar.style.transform = 'scale(1)';
    }

    showLoading(show) {
        if (show) {
            this.loadingIndicator.style.display = 'flex';
            this.loadingIndicator.style.opacity = '1';
            this.hideNextStepCue();
        } else {
            this.loadingIndicator.style.display = 'none';
            this.loadingIndicator.style.opacity = '0';
        }
    }

    showStatusMessage(message, type = 'info') {
        this.statusMessage.textContent = message;
        this.statusMessage.className = `status-message show ${type}`;
        
        setTimeout(() => {
            this.statusMessage.classList.remove('show');
        }, 3000);
    }
    
    showCompletionNotification(message) {
        // Show a special completion notification
        this.statusMessage.textContent = message;
        this.statusMessage.className = `status-message show completed`;
        
        // Play completion sound if available
        this.playCompletionSound();
        
        // Keep the completion message visible longer
        setTimeout(() => {
            this.statusMessage.classList.remove('show');
        }, 5000); // 5 seconds for completion notification
        
        console.log('Completion notification shown:', message);
        this.hideNextStepCue();
    }
    
    playCompletionSound() {
        try {
            // Create a simple completion sound using Web Audio API
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
            oscillator.frequency.setValueAtTime(1000, audioContext.currentTime + 0.1);
            oscillator.frequency.setValueAtTime(1200, audioContext.currentTime + 0.2);
            
            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.3);
            
            console.log('Completion sound played');
        } catch (error) {
            console.log('Could not play completion sound:', error);
        }
    }

    updateProcessingStatus(status) {
        const loadingText = this.loadingIndicator.querySelector('.loading-text');
        if (loadingText) {
            loadingText.textContent = status;
        }
    }

    showNextStepCue() {
        const cue = document.getElementById('nextStepCue');
        const loader = document.getElementById('loadingIndicator');
        if (cue) {
            cue.style.display = 'flex';
            cue.style.opacity = '1';
        }
        if (loader) {
            loader.style.display = 'none';
        }
    }

    hideNextStepCue() {
        const cue = document.getElementById('nextStepCue');
        if (cue) {
            cue.style.opacity = '0';
            setTimeout(() => { cue.style.display = 'none'; }, 200);
        }
        // Always show loader when hiding cue (if processing)
        const loader = document.getElementById('loadingIndicator');
        if (loader && this.isProcessing) {
            loader.style.display = 'flex';
        }
    }

    markStepSuccess() {
        console.log('markStepSuccess called');
        console.log('Current task:', this.currentTask);
        console.log('Is processing:', this.isProcessing);
        
        if (!this.currentTask || this.isProcessing) {
            console.log('No current task or already processing - returning early');
            return;
        }
        
        console.log('Marking step as success:', this.currentTask);
        
        // Add current task to history with success status
        this.taskHistory.push({
            step: this.currentTask.step,
            action: this.currentTask.action,
            status: 'success'
        });
        
        console.log('Updated task history:', this.taskHistory);
        
        // Clear current highlighting and start processing next step
        this.clearHighlightingBoxes();
        this.hideNextStepCue();
        this.startNextStep();
    }
    
    markStepFailure() {
        if (!this.currentTask || this.isProcessing) {
            console.log('No current task or already processing');
            return;
        }
        
        console.log('Marking step as failure:', this.currentTask);
        
        // Add current task to history with failure status
        this.taskHistory.push({
            step: this.currentTask.step,
            action: this.currentTask.action,
            status: 'failure'
        });
        
        // Clear current highlighting and start processing retry
        this.clearHighlightingBoxes();
        this.hideNextStepCue();
        this.retryCurrentStep();
    }
    
    startNextStep() {
        console.log('startNextStep called');
        console.log('Starting next step with history:', this.taskHistory);
        this.isProcessing = true;
        this.showLoading(true);
        console.log('About to call startScreenshotWorkflow');
        this.startScreenshotWorkflow();
    }
    
    retryCurrentStep() {
        console.log('Retrying current step with history:', this.taskHistory);
        this.isProcessing = true;
        this.showLoading(true);
        this.startScreenshotWorkflow();
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('BubbleApp: DOM loaded, initializing app...');
    const app = new BubbleApp();
    console.log('BubbleApp: App initialized successfully');
    
    // Test IPC communication on startup
    setTimeout(() => {
        console.log('BubbleApp: Testing IPC communication...');
        ipcRenderer.send('test-renderer-ready');
    }, 1000);
});

// Handle window focus/blur for better UX
window.addEventListener('focus', () => {
    document.body.classList.remove('window-blurred');
});

window.addEventListener('blur', () => {
    document.body.classList.add('window-blurred');
}); 