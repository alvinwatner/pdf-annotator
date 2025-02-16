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
        
        // Add document-level event listener for text selection
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
                    this.renderPDF();
                } catch (error) {
                    console.error('Error loading PDF:', error);
                }
            };
            fileReader.readAsArrayBuffer(file);
        }
    }

    async renderPDF() {
        this.container.innerHTML = ''; // Clear existing content
        for (let pageNum = 1; pageNum <= this.pdfDoc.numPages; pageNum++) {
            await this.renderPage(pageNum);
        }
    }

    async renderPage(pageNum) {
        try {
            const page = await this.pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: this.scale });

            // Create wrapper
            const wrapper = document.createElement('div');
            wrapper.className = 'page-wrapper';
            wrapper.dataset.pageNumber = pageNum;
            
            const pageDiv = document.createElement('div');
            pageDiv.className = 'page';
            pageDiv.style.width = `${viewport.width}px`;
            pageDiv.style.height = `${viewport.height}px`;
            
            // Create canvas layer
            const canvasWrapper = document.createElement('div');
            canvasWrapper.className = 'canvasWrapper';
            
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            
            const ctx = canvas.getContext('2d');
            canvasWrapper.appendChild(canvas);
            
            // Create text layer
            const textLayerDiv = document.createElement('div');
            textLayerDiv.className = 'text-layer';
            textLayerDiv.style.width = `${viewport.width}px`;
            textLayerDiv.style.height = `${viewport.height}px`;
            
            // Append elements
            pageDiv.appendChild(canvasWrapper);
            pageDiv.appendChild(textLayerDiv);
            wrapper.appendChild(pageDiv);
            this.container.appendChild(wrapper);

            // Render canvas
            const renderContext = {
                canvasContext: ctx,
                viewport: viewport
            };
            
            // Get text content and render text layer
            const [textContent] = await Promise.all([
                page.getTextContent(),
                page.render(renderContext).promise
            ]);

            // Create text layer
            const textLayer = await new Promise((resolve) => {
                const renderTextLayer = pdfjsLib.renderTextLayer({
                    textContent: textContent,
                    container: textLayerDiv,
                    viewport: viewport,
                    textDivs: []
                });

                const checkTextLayer = () => {
                    if (textLayerDiv.children.length > 0) {
                        resolve(renderTextLayer);
                    } else {
                        requestAnimationFrame(checkTextLayer);
                    }
                };
                checkTextLayer();
            });

            // After text layer is rendered, restore highlights
            this.restoreHighlights(pageNum, textLayerDiv, viewport);

        } catch (error) {
            console.error('Error rendering page:', error);
        }
    }

    restoreHighlights(pageNum, textLayer, viewport) {
        const pageAnnotations = this.annotations.filter(a => a.pageNumber === pageNum);
        
        // Remove any existing highlights first
        const existingHighlights = textLayer.querySelectorAll('.highlight');
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

    handleTextSelection(event) {
        if (!this.isHighlightMode) return;

        const selection = window.getSelection();
        const selectedText = selection.toString().trim();

        if (selectedText) {
            try {
                const range = selection.getRangeAt(0);
                const color = this.colorPicker.value;
                
                // Find the text layer by traversing up from any text node
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

                // Create temporary highlights
                const highlights = [];
                const rectPositions = [];
                const annotationId = Math.random().toString(36).substr(2, 9);
                
                const highlightGroup = document.createElement('div');
                highlightGroup.className = 'highlight-group';
                highlightGroup.dataset.annotationId = annotationId;
                
                for (let rect of rects) {
                    const highlightDiv = document.createElement('span');
                    highlightDiv.className = 'highlight temp-highlight';
                    highlightDiv.style.backgroundColor = color;
                    
                    // Store positions relative to text layer
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
                    highlights.push(highlightDiv);
                    rectPositions.push(rectPos);
                }
                
                textLayer.appendChild(highlightGroup);

                // Create and position label input
                const labelInput = document.createElement('div');
                labelInput.className = 'label-input';
                
                const input = document.createElement('input');
                input.type = 'text';
                input.placeholder = 'Enter label...';
                
                const saveButton = document.createElement('button');
                saveButton.textContent = 'Add';
                
                labelInput.appendChild(input);
                labelInput.appendChild(saveButton);
                
                // Position the label input near the last highlight
                const lastRect = rects[rects.length - 1];
                labelInput.style.position = 'absolute';
                labelInput.style.left = `${lastRect.right - textLayerRect.left}px`;
                labelInput.style.top = `${lastRect.bottom - textLayerRect.top + 5}px`;
                
                textLayer.appendChild(labelInput);
                input.focus();

                const handleSave = () => {
                    const label = input.value.trim();
                    if (label) {
                        // Store annotation
                        this.annotations.push({
                            id: annotationId,
                            pageNumber: pageNumber,
                            text: selectedText,
                            label: label,
                            color: color,
                            rects: rectPositions
                        });

                        // Re-render the highlights for this page
                        this.restoreHighlights(pageNumber, textLayer);
                    } else {
                        highlightGroup.remove();
                    }
                    
                    labelInput.remove();
                    selection.removeAllRanges();
                };

                const handleCancel = () => {
                    highlightGroup.remove();
                    labelInput.remove();
                    selection.removeAllRanges();
                };

                saveButton.addEventListener('click', handleSave);
                
                input.addEventListener('keyup', (e) => {
                    if (e.key === 'Enter') {
                        handleSave();
                    } else if (e.key === 'Escape') {
                        handleCancel();
                    }
                });

                // Handle click outside
                setTimeout(() => {
                    const handleClickOutside = (e) => {
                        if (!labelInput.contains(e.target)) {
                            handleCancel();
                            document.removeEventListener('click', handleClickOutside);
                        }
                    };
                    document.addEventListener('click', handleClickOutside);
                }, 0);

            } catch (error) {
                console.error('Error in text selection:', error);
            }
        }
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
        try {
            const response = await fetch('/save_annotations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(this.annotations)
            });

            const data = await response.json();
            
            if (data.status === 'success') {
                alert('Annotations saved successfully!');
                console.log('Saved annotations:', this.annotations);
            } else {
                throw new Error('Failed to save annotations');
            }
        } catch (error) {
            console.error('Error saving annotations:', error);
            alert('Error saving annotations. Please try again.');
        }
    }
}

// Initialize the annotator when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new PDFAnnotator();
});
