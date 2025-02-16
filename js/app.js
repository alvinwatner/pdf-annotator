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
        // Only handle clicks when in highlight mode
        if (!this.isHighlightMode) return;

        const highlightEl = event.target.closest('.highlight:not(.temp-highlight)');
        if (!highlightEl) return;

        // Find the annotation group this highlight belongs to
        const textLayer = highlightEl.closest('.text-layer');
        const pageWrapper = textLayer.closest('.page-wrapper');
        const pageNumber = parseInt(pageWrapper.dataset.pageNumber);
        
        // Get position of the clicked highlight
        const highlightRect = highlightEl.getBoundingClientRect();
        const textLayerRect = textLayer.getBoundingClientRect();
        const clickedPos = {
            left: highlightRect.left - textLayerRect.left,
            top: highlightRect.top - textLayerRect.top,
            width: highlightRect.width,
            height: highlightRect.height
        };

        // Find the annotation that contains this highlight
        const annotationIndex = this.annotations.findIndex(a => 
            a.pageNumber === pageNumber && 
            a.rects.some(r => 
                Math.abs(r.left - clickedPos.left) < 1 &&
                Math.abs(r.top - clickedPos.top) < 1 &&
                Math.abs(r.width - clickedPos.width) < 1 &&
                Math.abs(r.height - clickedPos.height) < 1
            )
        );

        if (annotationIndex !== -1) {
            // Remove the annotation from our array
            this.annotations.splice(annotationIndex, 1);
            
            // Re-render the page to update highlights
            this.renderPage(pageNumber);
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
            highlightGroup.dataset.annotationId = annotation.id || Math.random().toString(36).substr(2, 9);
            
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
                highlightDiv.title = 'Click to delete highlight';
                
                highlightGroup.appendChild(highlightDiv);
            });
            
            textLayer.appendChild(highlightGroup);

            // Create floating label if it exists
            if (annotation.label) {
                const floatingLabel = document.createElement('div');
                floatingLabel.className = 'floating-label';
                floatingLabel.textContent = annotation.label;
                floatingLabel.dataset.annotationId = highlightGroup.dataset.annotationId;
                
                // Position the label above the first highlight
                const firstRect = annotation.rects[0];
                floatingLabel.style.position = 'absolute';
                floatingLabel.style.left = `${firstRect.left}px`;
                floatingLabel.style.top = `${firstRect.top - 25}px`;
                
                textLayer.appendChild(floatingLabel);
            }
        });
    }

    showLabelInput(x, y, highlightId, text, pageNumber, rects) {
        // Remove any existing label input
        const existingInput = document.querySelector('.label-input-container');
        if (existingInput) {
            existingInput.remove();
        }

        // Create label input container
        const container = document.createElement('div');
        container.className = 'label-input-container';
        container.style.position = 'fixed';
        container.style.left = `${x}px`;
        container.style.top = `${y}px`;
        container.style.zIndex = '1000';

        // Create input element
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Enter label...';
        input.className = 'label-input';

        // Create add button
        const addButton = document.createElement('button');
        addButton.textContent = 'Add';
        addButton.className = 'add-button';

        // Add elements to container
        container.appendChild(input);
        container.appendChild(addButton);
        document.body.appendChild(container);

        // Focus the input
        input.focus();

        const saveHighlight = () => {
            const label = input.value.trim();
            if (label) {
                this.annotations.push({
                    id: highlightId,
                    text,
                    label,
                    color: this.colorPicker.value,
                    pageNumber,
                    rects
                });

                // Find the text layer and restore highlights
                const pageWrapper = document.querySelector(`[data-page-number="${pageNumber}"]`);
                if (pageWrapper) {
                    const textLayer = pageWrapper.querySelector('.text-layer');
                    if (textLayer) {
                        this.restoreHighlights(pageNumber, textLayer);
                    }
                }
            } else {
                // Remove the highlight if no label
                const highlight = document.querySelector(`[data-highlight-id="${highlightId}"]`);
                if (highlight) {
                    highlight.remove();
                }
            }
            container.remove();
        };

        const cancelHighlight = () => {
            // Remove the highlight
            const highlight = document.querySelector(`[data-highlight-id="${highlightId}"]`);
            if (highlight) {
                highlight.remove();
            }
            container.remove();
        };

        // Handle input events
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                saveHighlight();
            } else if (e.key === 'Escape') {
                cancelHighlight();
            }
        });

        // Handle add button click
        addButton.addEventListener('click', saveHighlight);

        // Handle click outside
        const handleClickOutside = (e) => {
            if (!container.contains(e.target)) {
                cancelHighlight();
                document.removeEventListener('mousedown', handleClickOutside);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
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
}

// Initialize the annotator when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new PDFAnnotator();
});
