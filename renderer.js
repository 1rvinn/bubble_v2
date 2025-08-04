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
    }

    initializeElements() {
        this.promptInput = document.getElementById('promptInput');
        this.submitBtn = document.getElementById('submitBtn');
        this.settingsBtn = document.getElementById('settingsBtn');
        this.promptBar = document.getElementById('promptBar');
        this.promptContainer = document.getElementById('promptContainer');
        this.loadingIndicator = document.getElementById('loadingIndicator');
        this.statusMessage = document.getElementById('statusMessage');
        this.overlayCanvas = document.getElementById('overlayCanvas');
        this.overlayContainer = document.getElementById('overlayContainer');
        this.fullscreenBorder = document.getElementById('fullscreenBorder');
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
        this.settingsBtn.addEventListener('click', () => this.handleSettings());

        // Input focus
        this.promptInput.addEventListener('focus', () => this.handleInputFocus());
        this.promptInput.addEventListener('blur', () => this.handleInputBlur());

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboardShortcuts(e));

        // Window resize events
        window.addEventListener('resize', () => this.handleResize());
        window.addEventListener('orientationchange', () => this.handleResize());

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
        
        // Ensure overlay elements are clickthrough
        this.overlayContainer.style.pointerEvents = 'none';
        this.fullscreenBorder.style.pointerEvents = 'none';
        
        // Allow interaction with prompt container
        this.promptContainer.style.pointerEvents = 'auto';
        
        console.log('Renderer: Clickthrough enabled');
        this.showStatusMessage('Clickthrough enabled - Use Cmd+Shift+F to focus input, Cmd+/ to submit', 'info');
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
            // Show prompt box if this is the first time and it hasn't been shown yet
            if (!this.initialPromptEntered && !this.promptBoxShown) {
                this.showPromptBox();
                this.promptBoxShown = true;
                this.showStatusMessage('Input focused - Type your prompt', 'info');
            } else {
                this.promptInput.focus();
                this.promptInput.select();
                console.log('Input focused and text selected');
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
        console.log('Hiding prompt for screenshot');
        this.promptContainer.classList.add('hidden');
        // Hide loading indicator during screenshot
        this.loadingIndicator.classList.remove('show');
        // Mark that prompt was shown during screenshot process
        if (!this.initialPromptEntered) {
            this.promptBoxShown = true;
        }
    }
    
    showPromptAfterScreenshot() {
        console.log('Showing prompt after screenshot');
        // Only show prompt if this is the first time and initial prompt hasn't been entered
        if (!this.initialPromptEntered) {
            this.promptContainer.classList.remove('hidden');
        }
        // Show loading indicator again after screenshot
        if (this.isProcessing) {
            this.loadingIndicator.classList.add('show');
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
        
        // Listen for submit prompt command
        ipcRenderer.on('submit-prompt', () => {
            this.handleSubmit();
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
        // Get the viewport dimensions (what the canvas should actually display)
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        // Get screen dimensions for reference
        const screenWidth = window.screen.width;
        const screenHeight = window.screen.height;
        
        // Set canvas to viewport dimensions (matches the CSS 100vw/100vh)
        this.overlayCanvas.width = viewportWidth;
        this.overlayCanvas.height = viewportHeight;
        
        // Also update the overlay container size (should already be 100vw/100vh in CSS)
        this.overlayContainer.style.width = `${viewportWidth}px`;
        this.overlayContainer.style.height = `${viewportHeight}px`;
        
        // Store both dimensions for use in drawing
        this.screenWidth = screenWidth;
        this.screenHeight = screenHeight;
        this.viewportWidth = viewportWidth;
        this.viewportHeight = viewportHeight;
        
        // Update window bounds if not already set
        if (!this.windowBounds) {
            this.getDisplayInfo();
        }
        
        console.log('Canvas resized to:', {
            width: this.overlayCanvas.width,
            height: this.overlayCanvas.height,
            viewport: { width: viewportWidth, height: viewportHeight },
            screen: { width: screenWidth, height: screenHeight },
            window: { width: window.innerWidth, height: window.innerHeight },
            availScreen: { width: window.screen.availWidth, height: window.screen.availHeight },
            devicePixelRatio: window.devicePixelRatio
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

        // Hide prompt box after first use and keep it hidden
        this.hidePromptBox();
        this.promptBoxShown = false;

        // Start the screenshot and processing workflow
        this.startScreenshotWorkflow();
    }

    async startScreenshotWorkflow() {
        try {
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
            const result = await ipcRenderer.invoke('process-screenshot', {
                screenshotPath,
                prompt: this.currentPrompt
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

        // Check for both possible property names
        const boxes = data.highlighting_boxes || data.highlightingBoxes;
        
        if (boxes && Array.isArray(boxes) && boxes.length > 0) {
            console.log('Drawing highlighting boxes:', boxes);
            console.log('Current viewport dimensions:', {
                viewportWidth: this.viewportWidth || window.innerWidth,
                viewportHeight: this.viewportHeight || window.innerHeight,
                screenWidth: this.screenWidth || window.screen.width,
                screenHeight: this.screenHeight || window.screen.height
            });
            
            // Display step description if available
            let stepInfo = null;
            if (data.task && data.task.step && data.task.action) {
                this.showStepDescription(data.task.step, data.task.action);
                stepInfo = { step: data.task.step, action: data.task.action };
            } else if (data.task && data.task.action) {
                this.showTaskDescription(data.task.action);
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
    
    showTaskDescription(action) {
        const taskMessage = `Task: ${action}`;
        console.log('Task description:', taskMessage);
        this.showStatusMessage(taskMessage, 'task');
    }
    
    showStepDescription(step, action) {
        const stepMessage = `Step ${step}: ${action}`;
        console.log('Step description:', stepMessage);
        this.showStatusMessage(stepMessage, 'step');
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
        
        // Use actual window bounds if available, otherwise fall back to full screen
        const windowBounds = this.windowBounds || { x: 0, y: 0, width: screenWidth, height: screenHeight };
        const windowContentBounds = this.windowContentBounds || { x: 0, y: 0, width: screenWidth, height: screenHeight };
        
        // Calculate the actual area the window covers on screen
        const actualWindowWidth = windowBounds.width;
        const actualWindowHeight = windowBounds.height;
        const actualWindowX = windowBounds.x;
        const actualWindowY = windowBounds.y;
        
        // Calculate scaling factors between actual window area and viewport
        const scaleX = viewportWidth / actualWindowWidth;
        const scaleY = viewportHeight / actualWindowHeight;
        
        // Scale coordinates from screen percentages to viewport pixels
        // First convert from screen percentages to actual window coordinates
        const windowX = Math.round(x * screenWidth - actualWindowX);
        const windowY = Math.round(y * screenHeight - actualWindowY);
        const windowWidth = Math.round(width * screenWidth);
        const windowHeight = Math.round(height * screenHeight);
        
        // Then scale to viewport pixels
        const scaledX = Math.round(windowX * scaleX);
        const scaledY = Math.round(windowY * scaleY);
        const scaledWidth = Math.round(windowWidth * scaleX);
        const scaledHeight = Math.round(windowHeight * scaleY);
        
        console.log(`Drawing box ${index + 1}:`, {
            original: { x, y, width, height },
            windowCoords: { x: windowX, y: windowY, width: windowWidth, height: windowHeight },
            scaled: { x: scaledX, y: scaledY, width: scaledWidth, height: scaledHeight },
            screen: { width: screenWidth, height: screenHeight },
            windowBounds: windowBounds,
            viewport: { width: viewportWidth, height: viewportHeight },
            scale: { x: scaleX, y: scaleY },
            devicePixelRatio: window.devicePixelRatio,
            canvasSize: { width: this.overlayCanvas.width, height: this.overlayCanvas.height }
        });
        
        // Ensure coordinates are within canvas bounds
        const clampedX = Math.max(0, Math.min(scaledX, this.overlayCanvas.width));
        const clampedY = Math.max(0, Math.min(scaledY, this.overlayCanvas.height));
        const clampedWidth = Math.min(scaledWidth, this.overlayCanvas.width - clampedX);
        const clampedHeight = Math.min(scaledHeight, this.overlayCanvas.height - clampedY);
        
        // Draw semi-transparent background
        this.ctx.fillStyle = 'rgba(0, 255, 255, 0.1)';
        this.ctx.fillRect(clampedX, clampedY, clampedWidth, clampedHeight);
        
        // Draw border
        this.ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(clampedX, clampedY, clampedWidth, clampedHeight);
        
        // Draw corner indicators
        this.drawCornerIndicators(clampedX, clampedY, clampedWidth, clampedHeight);
        
        // Draw label with step info if available
        const labelText = stepInfo ? '' : (index + 1).toString();
        this.drawLabel(clampedX, clampedY, labelText);
        
        // Draw step description alongside the bounding box
        if (stepInfo) {
            this.drawStepDescription(clampedX, clampedY, clampedWidth, clampedHeight, stepInfo);
        }
    }

    drawCornerIndicators(x, y, width, height) {
        const cornerSize = 8;
        const cornerColor = 'rgba(0, 255, 255, 1)';
        
        this.ctx.fillStyle = cornerColor;
        
        // Top-left corner
        this.ctx.fillRect(x - 1, y - 1, cornerSize, 2);
        this.ctx.fillRect(x - 1, y - 1, 2, cornerSize);
        
        // Top-right corner
        this.ctx.fillRect(x + width - cornerSize + 1, y - 1, cornerSize, 2);
        this.ctx.fillRect(x + width - 1, y - 1, 2, cornerSize);
        
        // Bottom-left corner
        this.ctx.fillRect(x - 1, y + height - 1, cornerSize, 2);
        this.ctx.fillRect(x - 1, y + height - cornerSize + 1, 2, cornerSize);
        
        // Bottom-right corner
        this.ctx.fillRect(x + width - cornerSize + 1, y + height - 1, cornerSize, 2);
        this.ctx.fillRect(x + width - 1, y + height - cornerSize + 1, 2, cornerSize);
    }

    drawLabel(x, y, text) {
        // Don't draw label if text is empty
        if (!text || text.trim() === '') {
            return;
        }
        
        const labelSize = 20;
        const labelX = x - labelSize / 2;
        const labelY = y - labelSize - 5;
        
        // Background circle
        this.ctx.fillStyle = 'rgba(0, 255, 255, 0.9)';
        this.ctx.beginPath();
        this.ctx.arc(x, labelY + labelSize / 2, labelSize / 2, 0, 2 * Math.PI);
        this.ctx.fill();
        
        // Text
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        this.ctx.font = '12px Lato';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(text.toString(), x, labelY + labelSize / 2);
    }
    
    drawStepDescription(x, y, width, height, stepInfo) {
        const description = stepInfo.action;
        const viewportWidth = this.viewportWidth || window.innerWidth;
        const maxBoxWidth = Math.floor(viewportWidth * 0.8); // 80% of viewport
        const minBoxWidth = Math.max(200, width + 50);
        const font = '14px Lato';
        this.ctx.font = font;

        // Word wrap the description
        const words = description.split(' ');
        let lines = [];
        let currentLine = '';
        for (let i = 0; i < words.length; i++) {
            const testLine = currentLine ? currentLine + ' ' + words[i] : words[i];
            const testWidth = this.ctx.measureText(testLine).width;
            if (testWidth > maxBoxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = words[i];
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine) lines.push(currentLine);

        // Calculate box size
        const textHeight = 20;
        const lineHeight = 22;
        const bgPadding = 10;
        const boxWidth = Math.max(
            minBoxWidth,
            Math.min(
                maxBoxWidth,
                Math.max(...lines.map(line => this.ctx.measureText(line).width)) + bgPadding * 2
            )
        );
        const boxHeight = lines.length * lineHeight + bgPadding * 2;

        // Position box above the bounding box
        const textX = x + width / 2;
        const textY = y - 30;
        const bgX = textX - boxWidth / 2;
        const bgY = textY - boxHeight / 2;

        // Draw background rectangle
        this.ctx.fillStyle = 'rgba(128, 0, 255, 0.9)';
        this.ctx.fillRect(bgX, bgY, boxWidth, boxHeight);

        // Border
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(bgX, bgY, boxWidth, boxHeight);

        // Draw each line of text
        this.ctx.fillStyle = 'rgba(255, 255, 255, 1)';
        this.ctx.font = font;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        for (let i = 0; i < lines.length; i++) {
            this.ctx.fillText(
                lines[i],
                textX,
                bgY + bgPadding + lineHeight / 2 + i * lineHeight
            );
        }

        // Draw connecting line from description to bounding box
        this.ctx.strokeStyle = 'rgba(128, 0, 255, 0.8)';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(textX, bgY + boxHeight);
        this.ctx.lineTo(x + width / 2, y);
        this.ctx.stroke();
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

    handleSettings() {
        // Toggle settings panel or show settings
        this.showStatusMessage('Settings panel coming soon', 'info');
    }

    handleInputFocus() {
        this.promptBar.style.transform = 'scale(1.02)';
    }

    handleInputBlur() {
        this.promptBar.style.transform = 'scale(1)';
    }

    showLoading(show) {
        if (show) {
            this.loadingIndicator.classList.add('show');
        } else {
            this.loadingIndicator.classList.remove('show');
        }
    }

    showStatusMessage(message, type = 'info') {
        this.statusMessage.textContent = message;
        this.statusMessage.className = `status-message show ${type}`;
        
        setTimeout(() => {
            this.statusMessage.classList.remove('show');
        }, 3000);
    }

    updateProcessingStatus(status) {
        const loadingText = this.loadingIndicator.querySelector('.loading-text');
        if (loadingText) {
            loadingText.textContent = status;
        }
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new BubbleApp();
});

// Handle window focus/blur for better UX
window.addEventListener('focus', () => {
    document.body.classList.remove('window-blurred');
});

window.addEventListener('blur', () => {
    document.body.classList.add('window-blurred');
}); 