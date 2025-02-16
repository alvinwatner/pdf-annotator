import { fetchLabels, fetchColors, getDocs, addDoc, deleteDoc, doc, collection, db } from './firebase-config.js';

// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

class PDFAnnotator {
    constructor() {
        this.container = document.getElementById('pdf-container');
        this.uploadBtn = document.getElementById('pdf-upload');
        this.highlightBtn = document.getElementById('highlight-btn');
        this.colorPicker = document.getElementById('color-picker');
        this.downloadBtn = document.getElementById('download-annotations');
        this.loadAnnotationsBtn = document.getElementById('load-annotations-btn');
        this.loadAnnotationsInput = document.getElementById('load-annotations');
        this.emptyState = document.getElementById('empty-state');
        this.annotationControls = document.getElementById('annotation-controls');
        
        this.pdfDoc = null;
        this.currentPage = 1;
        this.annotations = [];
        this.isHighlightMode = false;
        this.scale = 1.5;
        this.currentPdfName = '';
        this.labels = [];
        this.colors = [];
        
        this.init();
    }

    async init() {
        try {
            // Fetch labels and colors from Firebase
            const [labels, colors] = await Promise.all([
                fetchLabels(),
                fetchColors()
            ]);
            
            this.labels = labels;
            this.colors = colors;
            
            console.log('Fetched labels:', labels);
            console.log('Fetched colors:', colors);
            
            // Populate color picker
            if (this.colorPicker) {
                // Clear existing options
                this.colorPicker.innerHTML = '';
                
                // Add default option
                const defaultOption = document.createElement('option');
                defaultOption.value = '';
                defaultOption.textContent = 'Select Color';
                defaultOption.disabled = true;
                defaultOption.selected = true;
                this.colorPicker.appendChild(defaultOption);
                
                // Add color options
                this.colors.forEach(color => {
                    const option = document.createElement('option');
                    option.value = color.value;
                    option.textContent = color.name;
                    option.style.backgroundColor = color.value;
                    this.colorPicker.appendChild(option);
                });
                
                // Set default color if available
                if (this.colors.length > 0) {
                    this.colorPicker.value = this.colors[0].value;
                }
            }
        } catch (error) {
            console.error('Error initializing:', error);
            this.labels = [];
            this.colors = [];
        }
        
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.uploadBtn.addEventListener('change', this.handleFileUpload.bind(this));
        this.highlightBtn.addEventListener('click', () => {
            this.isHighlightMode = !this.isHighlightMode;
            this.highlightBtn.classList.toggle('active');
            document.body.classList.toggle('highlight-mode');
        });
        
        // Add document-level event listeners for text selection
        document.addEventListener('selectstart', this.handleSelectionStart.bind(this));
        document.addEventListener('selectionchange', this.handleSelectionChange.bind(this));
        document.addEventListener('mouseup', this.handleTextSelection.bind(this));
        
        // Add document-level event listener for highlight deletion
        document.addEventListener('click', this.handleHighlightClick.bind(this));

        // Add download annotations listener
        this.downloadBtn.addEventListener('click', this.downloadAnnotations.bind(this));

        // Add load annotations listeners
        this.loadAnnotationsBtn.addEventListener('click', () => {
            this.loadAnnotationsInput.click();
        });
        this.loadAnnotationsInput.addEventListener('change', this.loadAnnotations.bind(this));

        // Settings Modal
        const settingsModal = document.getElementById('settings-modal');
        const settingsBtn = document.getElementById('settings-btn');
        const closeBtn = document.querySelector('.close-btn');
        const labelList = document.querySelector('.label-list');
        const colorList = document.querySelector('.color-list');
        const newLabelInput = document.getElementById('new-label-input');
        const addLabelBtn = document.getElementById('add-label-btn');
        const newColorName = document.getElementById('new-color-name');
        const newColorValue = document.getElementById('new-color-value');
        const addColorBtn = document.getElementById('add-color-btn');

        // Show/hide settings modal
        settingsBtn.addEventListener('click', () => {
            settingsModal.style.display = 'flex';
            this.loadSettings();
        });

        closeBtn.addEventListener('click', () => {
            settingsModal.style.display = 'none';
        });

        // Close modal when clicking outside
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) {
                settingsModal.style.display = 'none';
            }
        });

        // Add new label
        addLabelBtn.addEventListener('click', () => this.addNewLabel());

        // Add new color
        addColorBtn.addEventListener('click', () => this.addNewColor());

        // Add delete label listeners
        // const labelList = document.querySelector('.label-list');
        labelList.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('.delete-btn');
            if (deleteBtn) {
                const labelId = deleteBtn.dataset.id;
                this.deleteLabel(labelId, deleteBtn);
            }
        });

        // Add delete color listeners
        // const colorList = document.querySelector('.color-list');
        colorList.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('.delete-btn');
            if (deleteBtn) {
                const colorId = deleteBtn.dataset.id;
                this.deleteColor(colorId, deleteBtn);
            }
        });
    }

    async renderPage(pageNum) {
        try {
            const page = await this.pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: this.scale });

            // Create page wrapper
            const pageWrapper = document.createElement('div');
            pageWrapper.className = 'page-wrapper';
            pageWrapper.setAttribute('data-page-number', pageNum);
            this.container.appendChild(pageWrapper);

            // Create canvas
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.width = viewport.width;
            canvas.height = viewport.height;

            // Create canvas wrapper
            const canvasWrapper = document.createElement('div');
            canvasWrapper.className = 'canvasWrapper';
            pageWrapper.appendChild(canvasWrapper);
            canvasWrapper.appendChild(canvas);

            // Create text layer
            const textLayerDiv = document.createElement('div');
            textLayerDiv.className = 'text-layer';
            textLayerDiv.style.width = `${viewport.width}px`;
            textLayerDiv.style.height = `${viewport.height}px`;
            pageWrapper.appendChild(textLayerDiv);

            // Create highlight layer
            const highlightLayer = document.createElement('div');
            highlightLayer.className = 'highlight-group';
            pageWrapper.appendChild(highlightLayer);

            // Render PDF page
            const renderContext = {
                canvasContext: context,
                viewport: viewport
            };

            // Get text content and render text layer
            const [textContent] = await Promise.all([
                page.getTextContent(),
                page.render(renderContext).promise
            ]);

            // Render text layer using renderTextLayer
            pdfjsLib.renderTextLayer({
                textContent: textContent,
                container: textLayerDiv,
                viewport: viewport,
                textDivs: []
            });

            // Restore highlights after text layer is rendered
            if (this.annotations && this.annotations.length > 0) {
                this.restoreHighlights(pageNum, textLayerDiv);
            }

        } catch (error) {
            console.error('Error rendering page:', error);
        }
    }

    handleTextSelection(event) {
        if (!this.isHighlightMode) return;

        const selection = window.getSelection();
        const selectedText = selection.toString().trim();

        if (selectedText) {
            try {
                const range = selection.getRangeAt(0);
                
                // Find the text layer
                let node = range.startContainer;
                let textLayer = null;
                let pageWrapper = null;
                while (node && !textLayer) {
                    if (node.nodeType === 1) {
                        if (node.classList.contains('text-layer')) {
                            textLayer = node;
                            pageWrapper = node.closest('.page-wrapper');
                        }
                    }
                    node = node.parentNode;
                }
                
                if (!textLayer || !pageWrapper) {
                    console.log('Selection not in text layer');
                    return;
                }

                const pageNumber = parseInt(pageWrapper.dataset.pageNumber);
                const textLayerRect = textLayer.getBoundingClientRect();
                
                // Get the selected text's position
                const rects = range.getClientRects();
                if (rects.length === 0) return;

                // Create highlight group
                const highlightId = Math.random().toString(36).substr(2, 9);
                const highlightGroup = document.createElement('div');
                highlightGroup.className = 'highlight-group';
                highlightGroup.dataset.highlightId = highlightId;

                // Store positions and create highlights
                const rectPositions = [];
                for (let rect of rects) {
                    const rectPos = {
                        left: rect.left - textLayerRect.left,
                        top: rect.top - textLayerRect.top,
                        width: rect.width,
                        height: rect.height
                    };

                    const highlightDiv = document.createElement('span');
                    highlightDiv.className = 'highlight';
                    highlightDiv.style.backgroundColor = this.colorPicker.value;
                    highlightDiv.style.left = `${rectPos.left}px`;
                    highlightDiv.style.top = `${rectPos.top}px`;
                    highlightDiv.style.width = `${rectPos.width}px`;
                    highlightDiv.style.height = `${rectPos.height}px`;
                    
                    highlightGroup.appendChild(highlightDiv);
                    rectPositions.push(rectPos);
                }

                textLayer.appendChild(highlightGroup);

                // Show label input
                const lastRect = rects[rects.length - 1];
                const labelX = lastRect.right + 10;
                const labelY = lastRect.top;
                
                this.showLabelInput(
                    labelX,
                    labelY,
                    highlightId,
                    selectedText,
                    pageNumber,
                    rectPositions
                );

            } catch (error) {
                console.error('Error in text selection:', error);
            }
        }
    }

    handleHighlightClick(event) {
        const highlight = event.target.closest('.highlight');
        if (!highlight) {
            this.removeHighlightMenu();
            return;
        }

        // Remove any existing menus
        this.removeHighlightMenu();

        // Find the annotation this highlight belongs to
        const highlightGroup = highlight.closest('.highlight-group');
        const annotationId = highlightGroup.dataset.annotationId;
        
        // Add selected class to all highlights in this group
        highlightGroup.querySelectorAll('.highlight').forEach(h => h.classList.add('selected'));

        // Create and show the menu
        const menu = document.createElement('div');
        menu.className = 'highlight-menu';
        menu.innerHTML = `
            <button class="delete-btn">Delete</button>
            <button class="cancel-btn">Cancel</button>
        `;

        // Position the menu near the clicked highlight
        const highlightRect = highlight.getBoundingClientRect();
        menu.style.left = `${highlightRect.left}px`;
        menu.style.top = `${highlightRect.bottom + 5}px`;

        // Add event listeners
        const deleteBtn = menu.querySelector('.delete-btn');
        const cancelBtn = menu.querySelector('.cancel-btn');

        deleteBtn.addEventListener('click', () => {
            this.deleteHighlight(annotationId);
            this.removeHighlightMenu();
        });

        cancelBtn.addEventListener('click', () => {
            this.removeHighlightMenu();
        });

        document.body.appendChild(menu);
    }

    removeHighlightMenu() {
        // Remove any existing menus
        const existingMenu = document.querySelector('.highlight-menu');
        if (existingMenu) {
            existingMenu.remove();
        }

        // Remove selected class from all highlights
        document.querySelectorAll('.highlight.selected').forEach(h => h.classList.remove('selected'));
    }

    deleteHighlight(annotationId) {
        // Find the annotation index
        const index = this.annotations.findIndex(a => a.id === annotationId);
        
        if (index !== -1) {
            // Remove from annotations array
            this.annotations.splice(index, 1);
            
            // Remove all highlights and labels with this annotation ID
            const highlightGroup = document.querySelector(`.highlight-group[data-annotation-id="${annotationId}"]`);
            const label = document.querySelector(`.floating-label[data-annotation-id="${annotationId}"]`);
            
            if (highlightGroup) {
                const textLayer = highlightGroup.closest('.text-layer');
                const pageWrapper = textLayer.closest('.page-wrapper');
                const pageNumber = parseInt(pageWrapper.dataset.pageNumber);
                
                // Remove the elements
                highlightGroup.remove();
                if (label) label.remove();
                
                // Re-render highlights for this page
                this.restoreHighlights(pageNumber, textLayer);
            }
        }
    }

    handleFileUpload(event) {
        const file = event.target.files[0];
        if (file && file.type === 'application/pdf') {
            this.currentPdfName = file.name;
            const fileReader = new FileReader();
            fileReader.onload = async (e) => {
                const typedArray = new Uint8Array(e.target.result);
                try {
                    this.pdfDoc = await pdfjsLib.getDocument(typedArray).promise;
                    this.showPdfView();
                    this.renderPDF();
                } catch (error) {
                    console.error('Error loading PDF:', error);
                    this.showEmptyState();
                }
            };
            fileReader.readAsArrayBuffer(file);
        }
    }

    showPdfView() {
        this.emptyState.style.display = 'none';
        this.annotationControls.style.display = 'flex';
        this.container.style.display = 'block';
    }

    showEmptyState() {
        this.emptyState.style.display = 'flex';
        this.annotationControls.style.display = 'none';
        this.container.style.display = 'none';
        this.container.innerHTML = '';
        this.pdfDoc = null;
        this.currentPdfName = '';
        this.annotations = [];
    }

    async renderPDF() {
        this.container.innerHTML = ''; // Clear existing content
        for (let pageNum = 1; pageNum <= this.pdfDoc.numPages; pageNum++) {
            await this.renderPage(pageNum);
        }
    }

    restoreHighlights() {
        const pages = this.container.querySelectorAll('.page-wrapper');
        pages.forEach(page => {
            const pageNumber = parseInt(page.dataset.pageNumber);
            const textLayer = page.querySelector('.text-layer');
            const viewport = textLayer.getBoundingClientRect();
            this.restoreHighlights(pageNumber, textLayer);
        });
    }

    restoreHighlights(pageNum, textLayer) {
        const pageAnnotations = this.annotations.filter(a => a.pageNumber === pageNum);
        
        // Remove any existing highlights first
        const existingHighlights = textLayer.querySelectorAll('.highlight-group');
        existingHighlights.forEach(h => h.remove());

        // Remove any existing labels
        const existingLabels = textLayer.querySelectorAll('.floating-label');
        existingLabels.forEach(l => l.remove());
        
        pageAnnotations.forEach(annotation => {
            const highlightGroup = document.createElement('div');
            highlightGroup.className = 'highlight-group';
            highlightGroup.dataset.annotationId = annotation.id;
            
            // Create highlights
            annotation.rects.forEach(rect => {
                const highlightDiv = document.createElement('span');
                highlightDiv.className = 'highlight';
                highlightDiv.style.backgroundColor = annotation.color;
                highlightDiv.style.position = 'absolute';
                highlightDiv.style.left = `${rect.left}px`;
                highlightDiv.style.top = `${rect.top}px`;
                highlightDiv.style.width = `${rect.width}px`;
                highlightDiv.style.height = `${rect.height}px`;
                
                highlightGroup.appendChild(highlightDiv);
            });
            
            textLayer.appendChild(highlightGroup);

            // Create floating label if it exists
            if (annotation.label) {
                const floatingLabel = document.createElement('div');
                floatingLabel.className = 'floating-label';
                floatingLabel.textContent = annotation.label;
                floatingLabel.dataset.annotationId = annotation.id;
                
                // Position the label above the first highlight
                const firstRect = annotation.rects[0];
                floatingLabel.style.position = 'absolute';
                floatingLabel.style.left = `${firstRect.left}px`;
                floatingLabel.style.top = `${firstRect.top - 25}px`;
                
                textLayer.appendChild(floatingLabel);
            }
        });
    }

    async showLabelInput(x, y, highlightId, text, pageNumber, rects) {
        // Prevent showing menu if one already exists
        if (document.querySelector('.label-menu-container')) {
            return;
        }
    
        console.log('Initializing label input...');
    
        // Create menu container
        const container = document.createElement('div');
        container.className = 'label-menu-container';
        container.style.position = 'fixed';
        container.style.left = `${x}px`;
        container.style.top = `${y}px`;
        container.style.zIndex = '9999';
    
        // Create scrollable menu wrapper
        const menuWrapper = document.createElement('div');
        menuWrapper.className = 'menu-wrapper';
    
        const cleanup = () => {
            console.log('Cleaning up...');
            if (container && container.parentNode) {
                container.remove();
            }
            document.removeEventListener('mousedown', handleClickOutside);
            window.getSelection().removeAllRanges();
        };
    
        const saveHighlight = (labelId) => {
            console.log('saveHighlight called with labelId:', labelId);
            
            if (labelId) {
                const selectedLabel = this.labels.find(l => l.id === labelId);
                if (!selectedLabel) {
                    console.error('Label not found:', labelId);
                    return;
                }

                this.annotations.push({
                    id: highlightId,
                    text,
                    label: selectedLabel.name,
                    labelId: selectedLabel.id,
                    color: this.colorPicker.value,
                    pageNumber,
                    rects
                });
    
                const pageWrapper = document.querySelector(`[data-page-number="${pageNumber}"]`);
                if (pageWrapper) {
                    const textLayer = pageWrapper.querySelector('.text-layer');
                    if (textLayer) {
                        this.restoreHighlights(pageNumber, textLayer);
                    }
                }
            } else {
                const highlight = document.querySelector(`[data-highlight-id="${highlightId}"]`);
                if (highlight) {
                    highlight.remove();
                }
            }
            
            cleanup();
        };
    
        const cancelHighlight = () => {
            console.log('Canceling highlight...');
            const highlight = document.querySelector(`[data-highlight-id="${highlightId}"]`);
            if (highlight) {
                highlight.remove();
            }
            cleanup();
        };
    
        // Use Firebase labels
        if (this.labels.length === 0) {
            console.warn('No labels available');
            cancelHighlight();
            return;
        }
        
        this.labels.forEach(label => {
            const menuItem = document.createElement('button');
            menuItem.className = 'menu-item';
            menuItem.setAttribute('type', 'button');
            menuItem.textContent = label.name;
            
            menuItem.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                console.log('Menu item clicked:', label.name);
                saveHighlight(label.id);
            });
            
            menuWrapper.appendChild(menuItem);
        });
    
        // Add wrapper to container
        container.appendChild(menuWrapper);
    
        // Handle click outside
        const handleClickOutside = (e) => {
            if (!container.contains(e.target)) {
                console.log('Click outside detected');
                cancelHighlight();
            }
        };
    
        document.addEventListener('mousedown', handleClickOutside);
        document.body.appendChild(container);
    
        // Adjust position if menu goes off screen
        const rect = container.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            container.style.left = `${window.innerWidth - rect.width - 10}px`;
        }
        if (rect.bottom > window.innerHeight) {
            container.style.top = `${window.innerHeight - rect.height - 10}px`;
        }
    
        console.log('Menu initialization complete');
    }

    downloadAnnotations() {
        if (this.annotations.length === 0) {
            alert('No annotations to download');
            return;
        }

        const annotationsData = {
            pdfName: this.currentPdfName,
            scale: this.scale,
            annotations: this.annotations.map(annotation => ({
                text: annotation.text,
                label: annotation.label,
                labelId: annotation.labelId,
                color: annotation.color,
                pageNumber: annotation.pageNumber,
                rects: annotation.rects
            }))
        };

        const blob = new Blob([JSON.stringify(annotationsData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.currentPdfName || 'pdf'}_annotations.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async loadAnnotations(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);

            // Validate the data structure
            if (!data.annotations || !Array.isArray(data.annotations)) {
                throw new Error('Invalid annotations file format');
            }

            // Store the annotations
            this.annotations = data.annotations.map(annotation => ({
                ...annotation,
                id: Math.random().toString(36).substr(2, 9)
            }));

            // If we have a PDF loaded, re-render all pages to show annotations
            if (this.pdfDoc) {
                this.renderPDF();
            }

            // Clear the file input
            event.target.value = '';
        } catch (error) {
            console.error('Error loading annotations:', error);
            alert('Error loading annotations file. Please make sure it\'s a valid JSON file.');
        }
    }

    async saveAnnotations() {
        // Placeholder for future implementation
        console.log('Save annotations endpoint not implemented yet');
    }

    handleSelectionStart(event) {
        if (!this.isHighlightMode) return;
        
        // Only handle selection in text layer
        const textLayer = event.target.closest('.text-layer');
        if (!textLayer) {
            event.preventDefault();
            return;
        }
        
        // Clear any existing temporary highlights
        this.clearTemporaryHighlights();
    }

    handleSelectionChange(event) {
        if (!this.isHighlightMode) return;

        const selection = window.getSelection();
        if (!selection.rangeCount) return;

        const range = selection.getRangeAt(0);
        if (range.collapsed) {
            this.clearTemporaryHighlights();
            return;
        }

        // Find the text layer
        let node = range.startContainer;
        let textLayer = null;
        while (node && !textLayer) {
            if (node.nodeType === 1 && node.classList.contains('text-layer')) {
                textLayer = node;
            }
            node = node.parentNode;
        }

        if (!textLayer) {
            this.clearTemporaryHighlights();
            return;
        }

        // Check if selection is within a single text layer
        const endNode = range.endContainer;
        let endTextLayer = null;
        node = endNode;
        while (node && !endTextLayer) {
            if (node.nodeType === 1 && node.classList.contains('text-layer')) {
                endTextLayer = node;
            }
            node = node.parentNode;
        }

        // If selection spans multiple text layers, clear it
        if (endTextLayer !== textLayer) {
            selection.removeAllRanges();
            this.clearTemporaryHighlights();
            return;
        }

        try {
            // Clear previous temporary highlights
            this.clearTemporaryHighlights();

            // Create a temporary highlight group
            const highlightGroup = document.createElement('div');
            highlightGroup.className = 'highlight-group temp-group';

            const textLayerRect = textLayer.getBoundingClientRect();
            const rects = range.getClientRects();

            // Create highlights for each rect
            for (let rect of rects) {
                const highlightDiv = document.createElement('span');
                highlightDiv.className = 'highlight temp-highlight selection-preview';
                highlightDiv.style.backgroundColor = this.colorPicker.value;
                
                const rectPos = {
                    left: rect.left - textLayerRect.left,
                    top: rect.top - textLayerRect.top,
                    width: rect.width,
                    height: rect.height
                };

                highlightDiv.style.left = `${rectPos.left}px`;
                highlightDiv.style.top = `${rectPos.top}px`;
                highlightDiv.style.width = `${rectPos.width}px`;
                highlightDiv.style.height = `${rectPos.height}px`;

                highlightGroup.appendChild(highlightDiv);
            }

            textLayer.appendChild(highlightGroup);
        } catch (error) {
            console.error('Error in selection preview:', error);
        }
    }

    clearTemporaryHighlights() {
        // Remove all temporary highlight groups
        const tempGroups = document.querySelectorAll('.temp-group');
        tempGroups.forEach(group => group.remove());
    }

    async loadSettings() {
        const labelList = document.querySelector('.label-list');
        const colorList = document.querySelector('.color-list');
        const labelSpinner = labelList.querySelector('.loading-spinner');
        const colorSpinner = colorList.querySelector('.loading-spinner');

        try {
            // Show loading spinners
            labelSpinner.style.display = 'flex';
            colorSpinner.style.display = 'flex';

            // Clear existing items
            labelList.innerHTML = '';
            colorList.innerHTML = '';

            // Add spinners back (they were cleared)
            labelList.appendChild(labelSpinner);
            colorList.appendChild(colorSpinner);

            // Load labels
            const labelsSnapshot = await getDocs(collection(db, 'labels'));
            labelsSnapshot.forEach(doc => {
                const label = doc.data();
                this.addLabelToList(label.name, doc.id);
            });

            // Load colors
            const colorsSnapshot = await getDocs(collection(db, 'colors'));
            colorsSnapshot.forEach(doc => {
                const color = doc.data();
                this.addColorToList(color.name, color.value, doc.id);
            });
        } catch (error) {
            console.error('Error loading settings:', error);
        } finally {
            // Hide loading spinners
            labelSpinner.style.display = 'none';
            colorSpinner.style.display = 'none';
        }
    }
    async addNewLabel() {
        const addLabelBtn = document.getElementById('add-label-btn');
        const btnText = addLabelBtn.querySelector('.btn-text');
        const btnSpinner = addLabelBtn.querySelector('.btn-spinner');
        const newLabelInput = document.getElementById('new-label-input');
        const labelName = newLabelInput.value.trim();
    
        if (labelName) {
            try {
                // Show loading state
                addLabelBtn.disabled = true;
                btnText.style.display = 'none';
                btnSpinner.style.display = 'block';
    
                const docRef = await addDoc(collection(db, 'labels'), {
                    name: labelName
                });
                
                // Add to local labels array
                const newLabel = {
                    id: docRef.id,
                    name: labelName
                };
                this.labels.push(newLabel);  // Add this line
                
                this.addLabelToList(labelName, docRef.id);
                newLabelInput.value = '';
                this.updateLabelDropdown();
            } catch (error) {
                console.error('Error adding label:', error);
            } finally {
                // Reset button state
                addLabelBtn.disabled = false;
                btnText.style.display = 'block';
                btnSpinner.style.display = 'none';
            }
        }
    }

    async addNewColor() {
        const addColorBtn = document.getElementById('add-color-btn');
        const btnText = addColorBtn.querySelector('.btn-text');
        const btnSpinner = addColorBtn.querySelector('.btn-spinner');
        const newColorName = document.getElementById('new-color-name');
        const newColorValue = document.getElementById('new-color-value');
        const colorName = newColorName.value.trim();
        const colorValue = newColorValue.value;

        if (colorName && colorValue) {
            try {
                // Show loading state
                addColorBtn.disabled = true;
                btnText.style.display = 'none';
                btnSpinner.style.display = 'block';

                const docRef = await addDoc(collection(db, 'colors'), {
                    name: colorName,
                    value: colorValue
                });
                this.addColorToList(colorName, colorValue, docRef.id);
                newColorName.value = '';
                newColorValue.value = '#000000';
                this.updateColorDropdown();
            } catch (error) {
                console.error('Error adding color:', error);
            } finally {
                // Reset button state
                addColorBtn.disabled = false;
                btnText.style.display = 'block';
                btnSpinner.style.display = 'none';
            }
        }
    }

    addLabelToList(name, id) {
        const div = document.createElement('div');
        div.className = 'label-item';
        div.innerHTML = `
            <span>${name}</span>
            <button class="delete-btn" data-id="${id}">
                <span class="btn-text">Delete</span>
                <div class="btn-spinner" style="display: none;"></div>
            </button>
        `;
        
        const labelList = document.querySelector('.label-list');
        labelList.appendChild(div);
    }

    addColorToList(name, value, id) {
        const div = document.createElement('div');
        div.className = 'color-item';
        div.innerHTML = `
            <div class="color-info">
                <span>${name}</span>
                <div class="color-preview" style="background-color: ${value}"></div>
            </div>
            <button class="delete-btn" data-id="${id}">
                <span class="btn-text">Delete</span>
                <div class="btn-spinner" style="display: none;"></div>
            </button>
        `;
        
        const colorList = document.querySelector('.color-list');
        colorList.appendChild(div);
    }

    async deleteLabel(labelId, button) {
        try {
            // Show loading state
            const btnText = button.querySelector('.btn-text');
            const btnSpinner = button.querySelector('.btn-spinner');
            button.disabled = true;
            btnText.style.display = 'none';
            btnSpinner.style.display = 'block';
    
            await deleteDoc(doc(db, 'labels', labelId));
            
            // Remove from local labels array
            this.labels = this.labels.filter(label => label.id !== labelId);  // Add this line
            
            button.closest('.label-item').remove();
            this.updateLabelDropdown();
        } catch (error) {
            console.error('Error deleting label:', error);
            // Reset button state on error
            const btnText = button.querySelector('.btn-text');
            const btnSpinner = button.querySelector('.btn-spinner');
            button.disabled = false;
            btnText.style.display = 'block';
            btnSpinner.style.display = 'none';
        }
    }

    async deleteColor(colorId, button) {
        try {
            // Show loading state
            const btnText = button.querySelector('.btn-text');
            const btnSpinner = button.querySelector('.btn-spinner');
            button.disabled = true;
            btnText.style.display = 'none';
            btnSpinner.style.display = 'block';

            await deleteDoc(doc(db, 'colors', colorId));
            button.closest('.color-item').remove();
            this.updateColorDropdown();
        } catch (error) {
            console.error('Error deleting color:', error);
            // Reset button state on error
            const btnText = button.querySelector('.btn-text');
            const btnSpinner = button.querySelector('.btn-spinner');
            button.disabled = false;
            btnText.style.display = 'block';
            btnSpinner.style.display = 'none';
        }
    }

    async updateColorDropdown()  {
        const colorPicker = document.getElementById('color-picker');
        colorPicker.innerHTML = '<option value="" disabled selected>Select Color</option>';
        
        try {
            const colorsSnapshot = await getDocs(collection(db, 'colors'));
            colorsSnapshot.forEach(doc => {
                const color = doc.data();
                const option = document.createElement('option');
                option.value = color.value;
                option.textContent = color.name;
                option.style.backgroundColor = color.value;
                colorPicker.appendChild(option);
            });
        } catch (error) {
            console.error('Error updating color dropdown:', error);
        }
    }

    updateLabelDropdown() {
        // Update the label dropdown in the main UI
    }
}

// Initialize the annotator when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new PDFAnnotator();
});
