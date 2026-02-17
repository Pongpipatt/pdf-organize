pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let rawPdfFiles = {}; 
let lastSelectedNode = null; 
let isConfirmingDelete = false; 

const elements = {
    thumbnailsContainer: document.getElementById('thumbnails-container'),
    pageBadge: document.getElementById('page-count-badge'),
    emptyState: document.getElementById('empty-state'),
    btnRotateLeft: document.getElementById('btn-rotate-left'),
    btnRotateRight: document.getElementById('btn-rotate-right'),
    btnDelete: document.getElementById('btn-delete'),
    btnExport: document.getElementById('btn-export'),
    mainContainer: document.getElementById('main-container'),
    selectionBox: document.getElementById('selection-box'),
    loadingOverlay: document.getElementById('loading-overlay'),
    loadingText: document.getElementById('loading-text'),
    loadingProgress: document.getElementById('loading-progress'),
    zoomSlider: document.getElementById('zoom-slider'),
    btnZoomOut: document.getElementById('btn-zoom-out'),
    btnZoomIn: document.getElementById('btn-zoom-in'),
    filenameInput: document.getElementById('filename-input')
};

// 0. ระบบ Zoom
const updateZoom = (size) => {
    document.documentElement.style.setProperty('--thumb-width', `${size}px`);
};

if (elements.zoomSlider) {
    elements.zoomSlider.addEventListener('input', (e) => updateZoom(parseInt(e.target.value)));
}
if (elements.btnZoomOut) {
    elements.btnZoomOut.addEventListener('click', () => {
        let newVal = Math.max(parseInt(elements.zoomSlider.min), parseInt(elements.zoomSlider.value) - 20);
        elements.zoomSlider.value = newVal;
        updateZoom(newVal);
    });
}
if (elements.btnZoomIn) {
    elements.btnZoomIn.addEventListener('click', () => {
        let newVal = Math.min(parseInt(elements.zoomSlider.max), parseInt(elements.zoomSlider.value) + 20);
        elements.zoomSlider.value = newVal;
        updateZoom(newVal);
    });
}

window.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
        e.preventDefault(); 
        let currentVal = parseInt(elements.zoomSlider.value);
        let delta = e.deltaY < 0 ? 15 : -15; 
        let newVal = Math.max(parseInt(elements.zoomSlider.min), Math.min(parseInt(elements.zoomSlider.max), currentVal + delta));
        elements.zoomSlider.value = newVal;
        updateZoom(newVal);
    }
}, { passive: false });

// 1. Setup SortableJS
new Sortable(elements.thumbnailsContainer, {
    animation: 150,
    ghostClass: 'sortable-ghost',
    dragClass: 'sortable-drag',
    filter: '.selection-box', 
    onStart: function (evt) {
        let item = evt.item;
        
        if (!item.classList.contains('thumbnail-active')) {
            document.querySelectorAll('.thumbnail-active').forEach(el => el.classList.remove('thumbnail-active'));
            item.classList.add('thumbnail-active');
            lastSelectedNode = item;
            updateToolStates();
        }

        const selected = document.querySelectorAll('.thumbnail-active');
        
        if (selected.length > 1) {
            const badge = document.createElement('div');
            badge.id = 'drag-badge';
            // ★ เปลี่ยน CSS ให้ป้ายมาอยู่ตรงกลางกระดาษ และขยายขนาดให้อ่านง่ายขึ้น ★
            badge.className = 'absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-rose-500 text-white text-sm font-bold px-4 py-2 flex items-center justify-center rounded-full z-50 shadow-xl border-2 border-white pointer-events-none whitespace-nowrap';
            badge.innerHTML = `<i class="fa-solid fa-copy mr-2"></i> ${selected.length} Pages`;
            item.appendChild(badge);

            selected.forEach(el => {
                if (el !== item) el.style.opacity = '0.3';
            });
        }
    },
    onEnd: function (evt) {
        const badge = document.getElementById('drag-badge');
        if (badge) badge.remove();

        const selected = Array.from(document.querySelectorAll('.thumbnail-active'));
        selected.forEach(el => el.style.opacity = '1'); 

        if (selected.length > 1) {
            selected.sort((a, b) => parseInt(a.dataset.pageIndex) - parseInt(b.dataset.pageIndex));
            
            let ref = evt.item.nextSibling;
            while (ref && ref.classList.contains('thumbnail-active')) {
                ref = ref.nextSibling;
            }
            
            selected.forEach(el => {
                elements.thumbnailsContainer.insertBefore(el, ref);
            });
        }
        updatePageNumbers();
    }
});

// 2. Lasso Selection Logic
let isSelecting = false;
let startX = 0, startY = 0;
let initialSelection = new Set();

elements.thumbnailsContainer.addEventListener('mousedown', (e) => {
    if (e.offsetX > elements.thumbnailsContainer.clientWidth) return; 

    if (e.target === elements.thumbnailsContainer || e.target === elements.emptyState) {
        isSelecting = true;
        startX = e.clientX;
        startY = e.clientY;
        
        elements.selectionBox.style.left = startX + 'px';
        elements.selectionBox.style.top = startY + 'px';
        elements.selectionBox.style.width = '0px';
        elements.selectionBox.style.height = '0px';
        elements.selectionBox.classList.remove('hidden');

        if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
            document.querySelectorAll('.thumb-item').forEach(el => {
                el.classList.remove('thumbnail-active', 'sortable-selected');
            });
            initialSelection.clear();
        } else {
            initialSelection = new Set(Array.from(document.querySelectorAll('.thumbnail-active')));
        }
        updateToolStates();
    }
});

window.addEventListener('mousemove', (e) => {
    if (!isSelecting) return;

    const currentX = e.clientX;
    const currentY = e.clientY;
    
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(startX - currentX);
    const height = Math.abs(startY - currentY);

    elements.selectionBox.style.left = left + 'px';
    elements.selectionBox.style.top = top + 'px';
    elements.selectionBox.style.width = width + 'px';
    elements.selectionBox.style.height = height + 'px';

    const boxRect = elements.selectionBox.getBoundingClientRect();

    document.querySelectorAll('.thumb-item').forEach(thumb => {
        const thumbRect = thumb.getBoundingClientRect();
        const isIntersecting = !(
            boxRect.right < thumbRect.left || 
            boxRect.left > thumbRect.right || 
            boxRect.bottom < thumbRect.top || 
            boxRect.top > thumbRect.bottom
        );
        
        if (isIntersecting) {
            thumb.classList.add('thumbnail-active', 'sortable-selected');
            lastSelectedNode = thumb; 
        } else {
            if (initialSelection.has(thumb)) {
                thumb.classList.add('thumbnail-active', 'sortable-selected');
            } else {
                thumb.classList.remove('thumbnail-active', 'sortable-selected');
            }
        }
    });
    updateToolStates();
});

window.addEventListener('mouseup', () => {
    if (isSelecting) {
        isSelecting = false;
        elements.selectionBox.classList.add('hidden');
    }
});

// 3. Grid Insert Marker
const insertMarker = document.createElement('div');
insertMarker.className = 'insert-marker hidden';
let targetInsertNode = null; 

elements.mainContainer.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) {
        const thumbs = Array.from(elements.thumbnailsContainer.querySelectorAll('.thumb-item'));
        if (thumbs.length === 0) return;

        targetInsertNode = null; 
        for (let i = 0; i < thumbs.length; i++) {
            const rect = thumbs[i].getBoundingClientRect();
            if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
                if (e.clientX < rect.left + (rect.width / 2)) {
                    targetInsertNode = thumbs[i];
                    break;
                }
            } else if (e.clientY < rect.top) {
                targetInsertNode = thumbs[i];
                break;
            }
        }
        elements.thumbnailsContainer.insertBefore(insertMarker, targetInsertNode);
        insertMarker.classList.remove('hidden');
    }
});

elements.mainContainer.addEventListener('dragleave', (e) => {
    if (!elements.mainContainer.contains(e.relatedTarget)) {
        insertMarker.classList.add('hidden');
    }
});

elements.mainContainer.addEventListener('drop', (e) => {
    e.preventDefault();
    insertMarker.classList.add('hidden');
    if (e.dataTransfer.types.includes('Files') && e.dataTransfer.files.length > 0) {
        processFiles(e.dataTransfer.files, targetInsertNode);
    }
});

document.getElementById('file-input').addEventListener('change', (e) => processFiles(e.target.files, null));

// 4. File Processing
async function processFiles(files, insertBeforeNode) {
    if(elements.emptyState) elements.emptyState.style.display = 'none';
    const newThumbnails = [];
    let hasInvalidFiles = false; 

    elements.loadingOverlay.classList.remove('hidden');
    elements.loadingOverlay.classList.add('flex');

    try {
        for (let file of files) {
            if (file.type !== 'application/pdf') {
                hasInvalidFiles = true;
                continue; 
            }

            elements.loadingText.innerText = `Reading file: ${file.name}...`;
            elements.loadingProgress.style.width = '10%';
            await new Promise(r => setTimeout(r, 10));

            const arrayBuffer = await file.arrayBuffer();
            const fileId = 'pdf_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
            rawPdfFiles[fileId] = arrayBuffer; 
            
            elements.loadingText.innerText = `Parsing PDF structure...`;
            elements.loadingProgress.style.width = '25%';
            await new Promise(r => setTimeout(r, 10));

            const pdf = await pdfjsLib.getDocument(new Uint8Array(arrayBuffer.slice(0))).promise;
            const totalPages = pdf.numPages;

            for (let i = 1; i <= totalPages; i++) {
                elements.loadingText.innerText = `Extracting page ${i} of ${totalPages}...`;
                const progressPercent = 25 + ((i / totalPages) * 75); 
                elements.loadingProgress.style.width = `${progressPercent}%`;

                await new Promise(r => setTimeout(r, 0));

                const page = await pdf.getPage(i);
                const thumbDiv = await createThumbnail(page, fileId, i);
                newThumbnails.push(thumbDiv);
            }
        }

        newThumbnails.forEach(t => {
            elements.thumbnailsContainer.insertBefore(t, insertBeforeNode);
        });
        updatePageNumbers();

        if (hasInvalidFiles) {
            setTimeout(() => alert('Some files were skipped because they are not valid PDF documents.'), 500);
        }

    } catch (error) {
        console.error("Error loading file:", error);
        alert("There was an error processing the PDF.");
    } finally {
        elements.loadingOverlay.classList.remove('flex');
        elements.loadingOverlay.classList.add('hidden');
        elements.loadingProgress.style.width = '0%';
        
        if (document.querySelectorAll('.thumb-item').length === 0) {
            if(elements.emptyState) elements.emptyState.style.display = 'flex';
        }
    }
}

async function createThumbnail(page, fileId, pageIndex) {
    const container = document.createElement('div');
    container.className = 'thumb-item relative cursor-pointer border-2 border-gray-200 bg-white rounded-md overflow-hidden';
    
    container.dataset.fileId = fileId;
    container.dataset.originalPageIndex = pageIndex; 
    container.dataset.pageIndex = pageIndex;
    container.dataset.rotation = page.rotate || 0; 

    const viewport = page.getViewport({ scale: 0.6, rotation: parseInt(container.dataset.rotation) });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    canvas.className = 'w-full h-auto pointer-events-none bg-white';

    await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;

    const badge = document.createElement('div');
    badge.className = 'page-number-badge absolute bottom-1.5 right-1.5 bg-gray-900/80 text-white text-[11px] px-2 py-0.5 rounded-sm font-medium z-10';
    
    container.appendChild(canvas);
    container.appendChild(badge);

    container.onclick = (e) => {
        if (e.shiftKey && lastSelectedNode) {
            const allThumbs = Array.from(elements.thumbnailsContainer.querySelectorAll('.thumb-item'));
            let startIdx = allThumbs.indexOf(lastSelectedNode);
            let endIdx = allThumbs.indexOf(container);
            
            if(startIdx === -1) startIdx = endIdx;

            const minIdx = Math.min(startIdx, endIdx);
            const maxIdx = Math.max(startIdx, endIdx);

            if (!e.ctrlKey && !e.metaKey) {
                allThumbs.forEach(el => el.classList.remove('thumbnail-active', 'sortable-selected'));
            }

            for (let i = minIdx; i <= maxIdx; i++) {
                allThumbs[i].classList.add('thumbnail-active', 'sortable-selected');
            }
        } else {
            if (!e.ctrlKey && !e.metaKey) {
                document.querySelectorAll('.thumb-item').forEach(el => {
                    if(el !== container) {
                        el.classList.remove('thumbnail-active', 'sortable-selected');
                    }
                });
            }
            container.classList.toggle('thumbnail-active');
            container.classList.toggle('sortable-selected'); 
        }
        
        lastSelectedNode = container; 
        updateToolStates();
    };

    return container;
}

function updatePageNumbers() {
    const thumbs = elements.thumbnailsContainer.querySelectorAll('.thumb-item');
    let count = 0;
    thumbs.forEach(thumb => {
        count++;
        thumb.dataset.pageIndex = count; 
        thumb.querySelector('.page-number-badge').innerText = count;
    });
    elements.pageBadge.innerText = `${count} Pages`;
    updateToolStates();
}

function updateToolStates() {
    const selected = document.querySelectorAll('.thumbnail-active');
    const hasSelected = selected.length > 0;
    
    elements.btnRotateLeft.disabled = !hasSelected;
    elements.btnRotateRight.disabled = !hasSelected;
    elements.btnDelete.disabled = !hasSelected;
}

// 5. PDF Actions: Rotate, Delete, Export
async function actionOnSelected(actionFunc) {
    const selected = document.querySelectorAll('.thumbnail-active');
    if (selected.length === 0) return;
    
    elements.btnRotateLeft.disabled = true;
    elements.btnRotateRight.disabled = true;
    elements.btnDelete.disabled = true;

    for (let thumb of selected) {
        await actionFunc(thumb);
    }
    updateToolStates(); 
}

elements.btnRotateLeft.onclick = () => actionOnSelected(t => rotatePage(t, -90));
elements.btnRotateRight.onclick = () => actionOnSelected(t => rotatePage(t, 90));

async function rotatePage(thumb, degrees) {
    let currentRotation = parseInt(thumb.dataset.rotation);
    currentRotation = (currentRotation + degrees) % 360;
    if (currentRotation < 0) currentRotation += 360;
    thumb.dataset.rotation = currentRotation;

    const fileId = thumb.dataset.fileId;
    const originalPageIndex = parseInt(thumb.dataset.originalPageIndex);
    
    const pdf = await pdfjsLib.getDocument(new Uint8Array(rawPdfFiles[fileId].slice(0))).promise;
    const page = await pdf.getPage(originalPageIndex);

    const thumbCanvas = thumb.querySelector('canvas');
    const thumbViewport = page.getViewport({ scale: 0.6, rotation: currentRotation });
    thumbCanvas.width = thumbViewport.width;
    thumbCanvas.height = thumbViewport.height;
    await page.render({ canvasContext: thumbCanvas.getContext('2d'), viewport: thumbViewport }).promise;
}

elements.btnDelete.onclick = () => {
    const selected = document.querySelectorAll('.thumbnail-active');
    if (selected.length === 0) return;

    if (isConfirmingDelete) return; 
    isConfirmingDelete = true;

    const confirmMessage = selected.length > 1 
        ? `Are you sure you want to delete ${selected.length} pages?` 
        : `Are you sure you want to delete this page?`;

    if (!confirm(confirmMessage)) {
        isConfirmingDelete = false; 
        return;
    }

    selected.forEach(thumb => thumb.remove());
    updatePageNumbers();
    
    lastSelectedNode = null; 
    isConfirmingDelete = false;
    
    if (document.querySelectorAll('.thumb-item').length === 0) {
        if(elements.emptyState) elements.emptyState.style.display = 'flex';
    }
};

window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
        const selected = document.querySelectorAll('.thumbnail-active');
        if (selected.length > 0 && !isConfirmingDelete) {
            elements.btnDelete.click(); 
        }
    }
});

elements.btnExport.onclick = async () => {
    const thumbs = elements.thumbnailsContainer.querySelectorAll('.thumb-item');
    if (thumbs.length === 0) return alert('No pages to export.');

    elements.btnExport.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Generating PDF...';
    elements.btnExport.disabled = true;

    try {
        const { PDFDocument } = PDFLib;
        const newPdf = await PDFDocument.create();
        const cachedPdfLibDocs = {}; 

        for (let thumb of thumbs) {
            const fileId = thumb.dataset.fileId;
            const originalPageIndex = parseInt(thumb.dataset.originalPageIndex);
            const pageIndex = originalPageIndex - 1; 
            const rotation = parseInt(thumb.dataset.rotation);

            if (!cachedPdfLibDocs[fileId]) {
                cachedPdfLibDocs[fileId] = await PDFDocument.load(rawPdfFiles[fileId].slice(0));
            }

            const [copiedPage] = await newPdf.copyPages(cachedPdfLibDocs[fileId], [pageIndex]);
            copiedPage.setRotation(PDFLib.degrees(rotation));
            newPdf.addPage(copiedPage);
        }

        const pdfBytes = await newPdf.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        
        let fileName = elements.filenameInput.value.trim() || 'My_Organized_Document';
        if (!fileName.toLowerCase().endsWith('.pdf')) {
            fileName += '.pdf';
        }
        
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error("Export Error:", error);
        alert('Error: ' + error.message);
    } finally {
        elements.btnExport.innerHTML = '<i class="fa-solid fa-download mr-2"></i> Export PDF';
        elements.btnExport.disabled = false;
    }
};