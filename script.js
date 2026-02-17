pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let rawPdfFiles = {}; 

const elements = {
    thumbnailsContainer: document.getElementById('thumbnails-container'),
    pageBadge: document.getElementById('page-count-badge'),
    emptyState: document.getElementById('empty-state'),
    btnRotateLeft: document.getElementById('btn-rotate-left'),
    btnRotateRight: document.getElementById('btn-rotate-right'),
    btnDelete: document.getElementById('btn-delete'),
    btnExport: document.getElementById('btn-export'),
    mainContainer: document.getElementById('main-container'),
    selectionBox: document.getElementById('selection-box')
};

try { if (typeof Sortable.MultiDrag !== 'undefined') Sortable.mount(new Sortable.MultiDrag()); } catch (e) {}

// 1. SortableJS
new Sortable(elements.thumbnailsContainer, {
    animation: 150,
    multiDrag: true, 
    selectedClass: 'sortable-selected',
    ghostClass: 'sortable-ghost',
    dragClass: 'sortable-drag',
    onEnd: updatePageNumbers,
    filter: '.selection-box' // ป้องกันการไปจับกล่อง selection
});

// ==========================================
// 2. ระบบลากคลุมเพื่อเลือก (Lasso Selection)
// ==========================================
let isSelecting = false;
let startX = 0, startY = 0;
let initialSelection = new Set(); // เก็บค่าที่เลือกไว้ก่อนลาก (เผื่อกด Ctrl ค้าง)

elements.thumbnailsContainer.addEventListener('mousedown', (e) => {
    // จะเริ่มลากคลุมได้ก็ต่อเมื่อคลิกที่ "พื้นหลัง" เท่านั้น (ไม่โดนหน้ากระดาษ)
    if (e.target === elements.thumbnailsContainer || e.target === elements.emptyState) {
        isSelecting = true;
        startX = e.clientX;
        startY = e.clientY;
        
        elements.selectionBox.style.left = startX + 'px';
        elements.selectionBox.style.top = startY + 'px';
        elements.selectionBox.style.width = '0px';
        elements.selectionBox.style.height = '0px';
        elements.selectionBox.classList.remove('hidden');

        // ถ้าไม่ได้กด Ctrl/Cmd ค้างไว้ ให้ล้างการเลือกเก่าทิ้ง
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
            document.querySelectorAll('.thumb-item').forEach(el => {
                el.classList.remove('thumbnail-active', 'sortable-selected');
            });
            initialSelection.clear();
        } else {
            // จำไว้ว่าก่อนลาก มีแผ่นไหนเลือกไว้บ้าง
            initialSelection = new Set(Array.from(document.querySelectorAll('.thumbnail-active')));
        }
        updateToolStates();
    }
});

window.addEventListener('mousemove', (e) => {
    if (!isSelecting) return;

    // คำนวณขนาดกล่อง
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

    // เช็คว่ากล่องไปโดนหน้ากระดาษแผ่นไหนบ้าง
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
        } else {
            // ถอยกลับไปค่าเดิมตอนก่อนลาก (เผื่อลากไปโดนแล้วลากกลับ)
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

// ==========================================
// 3. ระบบคำนวณตำแหน่งแทรกไฟล์
// ==========================================
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

// ==========================================
// 4. นำเข้าและ Render รูปย่อ
// ==========================================
async function processFiles(files, insertBeforeNode) {
    if(elements.emptyState) elements.emptyState.style.display = 'none';
    const newThumbnails = [];

    for (let file of files) {
        if (file.type !== 'application/pdf') continue;
        const arrayBuffer = await file.arrayBuffer();
        const fileId = 'pdf_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        rawPdfFiles[fileId] = arrayBuffer; 
        
        const pdf = await pdfjsLib.getDocument(new Uint8Array(arrayBuffer.slice(0))).promise;

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const thumbDiv = await createThumbnail(page, fileId, i);
            newThumbnails.push(thumbDiv);
        }
    }

    newThumbnails.forEach(t => {
        elements.thumbnailsContainer.insertBefore(t, insertBeforeNode);
    });
    updatePageNumbers();
}

// สร้าง Thumbnail
async function createThumbnail(page, fileId, pageIndex) {
    const container = document.createElement('div');
    container.className = 'thumb-item relative cursor-pointer border-2 border-gray-200 bg-white rounded-md overflow-hidden';
    
    container.dataset.fileId = fileId;
    container.dataset.pageIndex = pageIndex;
    container.dataset.rotation = page.rotate || 0; 

    const viewport = page.getViewport({ scale: 0.5, rotation: parseInt(container.dataset.rotation) });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.className = 'w-full h-auto pointer-events-none bg-white';

    await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;

    const badge = document.createElement('div');
    badge.className = 'page-number-badge absolute bottom-1.5 right-1.5 bg-gray-900/80 text-white text-[11px] px-2 py-0.5 rounded-sm font-medium';
    
    container.appendChild(canvas);
    container.appendChild(badge);

    // คลิกเพื่อเลือก
    container.onclick = (e) => {
        if (!e.ctrlKey && !e.metaKey) {
            document.querySelectorAll('.thumb-item').forEach(el => {
                if(el !== container) {
                    el.classList.remove('thumbnail-active', 'sortable-selected');
                }
            });
        }
        container.classList.toggle('thumbnail-active');
        container.classList.toggle('sortable-selected'); 
        updateToolStates();
    };

    return container;
}

function updatePageNumbers() {
    const thumbs = elements.thumbnailsContainer.querySelectorAll('.thumb-item');
    let count = 0;
    thumbs.forEach(thumb => {
        count++;
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

// ==========================================
// 5. จัดการ หมุน, ลบ, Export (เปลี่ยน Text เป็นภาษาอังกฤษ)
// ==========================================
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
    const pageIndex = parseInt(thumb.dataset.pageIndex);
    
    const pdf = await pdfjsLib.getDocument(new Uint8Array(rawPdfFiles[fileId].slice(0))).promise;
    const page = await pdf.getPage(pageIndex);

    const thumbCanvas = thumb.querySelector('canvas');
    const thumbViewport = page.getViewport({ scale: 0.5, rotation: currentRotation });
    thumbCanvas.width = thumbViewport.width;
    thumbCanvas.height = thumbViewport.height;
    await page.render({ canvasContext: thumbCanvas.getContext('2d'), viewport: thumbViewport }).promise;
}

elements.btnDelete.onclick = () => {
    const selected = document.querySelectorAll('.thumbnail-active');
    selected.forEach(thumb => thumb.remove());
    updatePageNumbers();
    
    if (document.querySelectorAll('.thumb-item').length === 0) {
        if(elements.emptyState) elements.emptyState.style.display = 'flex';
    }
};

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
            const pageIndex = parseInt(thumb.dataset.pageIndex) - 1; 
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
        a.href = url;
        a.download = 'My_Organized_Document.pdf';
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