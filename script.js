/* ═══════════════════════════════════════════════════════
   PDF Organizer Enhanced — script.js v3
   ═══════════════════════════════════════════════════════ */

if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
} else {
    console.error('pdf.js (pdfjsLib) failed to load — check your internet connection / CDN access.');
    alert('Could not load PDF engine (pdf.js) from the CDN.\nPlease check your internet connection, then reload the page.');
}

/* ─── THEMES ─────────────────────────────────────────── */
const THEMES = [
    { id:'navy',    name:'Navy',      dark:false, p:'#1d4ed8', rgb:'29,78,216',   grad:'linear-gradient(135deg,#1e3a8a,#2563eb)', sh:'rgba(29,78,216,.28)',  b1:'rgba(219,234,254,.45)', b2:'rgba(191,219,254,.35)' },
    { id:'steel',   name:'Steel',     dark:false, p:'#0e7490', rgb:'14,116,144',  grad:'linear-gradient(135deg,#155e75,#0891b2)', sh:'rgba(14,116,144,.28)', b1:'rgba(207,250,254,.45)', b2:'rgba(165,243,252,.35)' },
    { id:'cobalt',  name:'Cobalt',    dark:false, p:'#2563eb', rgb:'37,99,235',   grad:'linear-gradient(135deg,#1d4ed8,#3b82f6)', sh:'rgba(37,99,235,.28)',  b1:'rgba(219,234,254,.45)', b2:'rgba(199,210,254,.35)' },
    { id:'graphite',name:'Graphite',  dark:false, p:'#334155', rgb:'51,65,85',    grad:'linear-gradient(135deg,#1e293b,#475569)', sh:'rgba(51,65,85,.26)',   b1:'rgba(226,232,240,.55)', b2:'rgba(203,213,225,.40)' },
    { id:'teal',    name:'Teal',      dark:false, p:'#0d9488', rgb:'13,148,136',  grad:'linear-gradient(135deg,#0f766e,#14b8a6)', sh:'rgba(13,148,136,.28)', b1:'rgba(204,251,241,.45)', b2:'rgba(153,246,228,.35)' },
    { id:'indigo',  name:'Indigo',    dark:false, p:'#4f46e5', rgb:'79,70,229',   grad:'linear-gradient(135deg,#4338ca,#6366f1)', sh:'rgba(79,70,229,.28)',  b1:'rgba(224,231,255,.45)', b2:'rgba(199,210,254,.35)' },
    { id:'dark',    name:'Night 🌙',  dark:true,  p:'#60a5fa', rgb:'96,165,250',  grad:'linear-gradient(135deg,#2563eb,#60a5fa)', sh:'rgba(96,165,250,.30)', b1:'rgba(37,99,235,.12)',   b2:'rgba(29,78,216,.08)'   },
];
let theme = THEMES[0];

function applyTheme(t) {
    theme = t;
    localStorage.setItem('pdforg_theme', t.id);
    const s = document.documentElement.style;
    s.setProperty('--p',       t.p);
    s.setProperty('--p-rgb',   t.rgb);
    s.setProperty('--p-light', `rgba(${t.rgb},.12)`);
    s.setProperty('--p-grad',  t.grad);
    s.setProperty('--p-shadow',t.sh);
    document.documentElement.setAttribute('data-dark', t.dark ? 'true' : 'false');
    g('blob-tl').style.background = t.b1;
    g('blob-br').style.background = t.b2;
    g('logo-badge').style.background = t.grad;
    g('logo-badge').style.boxShadow = `0 6px 16px ${t.sh}`;
    g('brand-sub').style.color = t.p;
    g('page-count-badge').style.color = t.p;
    g('loading-spinner').style.borderTopColor = t.p;
    g('loading-bar').style.background = t.grad;
    g('zoom-slider').style.accentColor = t.p;
    refreshViewBtns();
    refreshPvTabs();
    document.querySelectorAll('.theme-option').forEach(b => {
        const on = b.dataset.tid === t.id;
        b.classList.toggle('active', on);
        b.querySelector('.tc').style.display = on ? 'inline' : 'none';
        b.querySelector('.tc').style.color = t.p;
        b.querySelector('.tn').style.color = on ? t.p : '';
        b.style.borderColor = on ? t.p : 'transparent';
        b.style.background  = on ? `rgba(${t.rgb},.10)` : '';
    });
    if (viewMode === 'page') pvRender();
}

function buildThemePanel() {
    const c = g('theme-options'); if (!c) return;
    THEMES.forEach(t => {
        const b = document.createElement('button');
        b.className = 'theme-option'; b.dataset.tid = t.id;
        b.innerHTML = `<div style="width:22px;height:22px;border-radius:6px;background:${t.grad};flex-shrink:0;box-shadow:0 2px 6px ${t.sh}"></div><div><div class="tn" style="font-size:12px;font-weight:700;color:var(--t1)">${t.name}</div></div><i class="fa-solid fa-check tc ml-auto" style="font-size:10px;display:none"></i>`;
        b.onclick = () => { applyTheme(t); closeAllPanels(); };
        c.appendChild(b);
    });
}

/* ─── STATE ──────────────────────────────────────────── */
let rawPdfs    = {};        // fileId → ArrayBuffer
let pvPdfDocs  = {};        // fileId → pdfjs doc
let lastNode   = null;      // last clicked thumb
let viewMode   = 'grid';
let navDest    = 'organize'; // active nav-rail destination
let pvIdx      = 0;
let pvZoom     = 100;
let pvPages    = [];        // ordered .thumb-item nodes
let pvMode     = 'single';  // 'single' | 'continuous'
let pvTask     = null;      // current pdfjs render task
let bookmarks  = new Set();
let sbFilter   = 'all';     // 'all' | 'bookmarks'
let srchQ      = '';
let srchMatches = [];       // [{pi, count}]
let sbVisible  = true;
let ctxTarget  = null;      // right-clicked thumb
let undoStack  = [];
let redoStack  = [];
let isConfirmingDelete = false;

/* ─── UTILS ──────────────────────────────────────────── */
const g  = id => document.getElementById(id);
const qs = (sel, ctx) => (ctx||document).querySelector(sel);
function tick() { return new Promise(r => setTimeout(r, 12)); }
function closeAllPanels() {
    g('theme-panel').style.display = 'none';
    g('menu-panel').style.display  = 'none';
    g('ctx-menu').style.display    = 'none';
}
function getFilename() {
    let n = g('filename-input').value.trim() || 'My_Document';
    return n.toLowerCase().endsWith('.pdf') ? n.slice(0,-4) : n;
}
function dlBlob(bytes, name) {
    const url = URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
    Object.assign(document.createElement('a'),{href:url,download:name}).click();
    URL.revokeObjectURL(url);
}

/* toast */
let _tt;
function toast(msg, color) {
    clearTimeout(_tt);
    let el = g('_toast');
    if (!el) {
        el = document.createElement('div'); el.id = '_toast';
        el.style.cssText='position:fixed;bottom:52px;left:50%;transform:translateX(-50%);color:white;padding:8px 18px;border-radius:999px;font-size:12px;font-weight:700;z-index:9999;white-space:nowrap;transition:opacity .3s;pointer-events:none';
        document.body.appendChild(el);
    }
    const c = color || theme.p;
    el.textContent = msg; el.style.background = c;
    el.style.boxShadow = `0 5px 18px ${c}88`; el.style.opacity = '1';
    _tt = setTimeout(() => el.style.opacity = '0', 2600);
}

/* loading */
function showLoading(v) {
    g('loading-overlay').style.display = v ? 'flex' : 'none';
    if (!v) { g('loading-bar').style.width='0'; }
}
function setLoading(txt, pct) {
    g('loading-text').textContent = txt;
    g('loading-bar').style.width  = pct + '%';
}

/* ─── UNDO / REDO ────────────────────────────────────── */
function snapshotState() {
    const thumbs = document.querySelectorAll('.thumb-item');
    return Array.from(thumbs).map(t => ({
        fileId: t.dataset.fileId,
        oi: t.dataset.originalPageIndex,
        rot: t.dataset.rotation,
        canvas: t.querySelector('canvas'),
    }));
}
function pushUndo() {
    undoStack.push(captureOrder());
    redoStack = [];
    updateUndoRedoBtns();
}
function captureOrder() {
    return Array.from(document.querySelectorAll('.thumb-item')).map(t => ({
        node: t, pi: parseInt(t.dataset.pageIndex), rot: parseInt(t.dataset.rotation||0)
    }));
}
function updateUndoRedoBtns() {
    g('btn-undo').disabled = undoStack.length === 0;
    g('btn-redo').disabled = redoStack.length === 0;
}
function undo() {
    if (!undoStack.length) return;
    redoStack.push(captureOrder());
    const prev = undoStack.pop();
    restoreOrder(prev);
    updateUndoRedoBtns();
}
function redo() {
    if (!redoStack.length) return;
    undoStack.push(captureOrder());
    const next = redoStack.pop();
    restoreOrder(next);
    updateUndoRedoBtns();
}
async function restoreOrder(snap) {
    const tc = g('thumbnails-container');
    // Reorder + fix rotation dataset synchronously so the layout snaps back instantly
    const needsRerender = [];
    snap.forEach(s => {
        const prevRot = parseInt(s.node.dataset.rotation || 0);
        const newRot  = parseInt(s.rot);
        s.node.dataset.rotation = newRot;
        tc.appendChild(s.node);
        if (newRot !== prevRot) needsRerender.push({ node: s.node, rot: newRot });
    });
    updatePageNumbers();
    toast('Restored', '#435573');
    // Re-paint any thumbnails whose rotation changed (canvas pixels must match the new angle)
    for (const r of needsRerender) await renderThumbCanvas(r.node, r.rot);
}

/* ─── INIT ───────────────────────────────────────────── */
function init() {
    buildThemePanel();
    const tid = localStorage.getItem('pdforg_theme');
    applyTheme(THEMES.find(t=>t.id===tid)||THEMES[0]);
    try { bookmarks = new Set(JSON.parse(localStorage.getItem('pdforg_bookmarks')||'[]')); } catch{}

    /* Header panel toggles */
    g('btn-theme').onclick = e => { e.stopPropagation(); togglePanel('theme-panel'); };
    g('btn-menu').onclick  = e => { e.stopPropagation(); togglePanel('menu-panel'); };
    document.addEventListener('click', closeAllPanels);

    /* Menu items */
    g('menu-add-files').onclick = () => g('file-input').click();
    g('menu-print').onclick     = doPrint;
    g('menu-export').onclick    = doExport;
    g('menu-extract-all').onclick = doExtractSelected;
    g('file-input').addEventListener('change', e => processFiles(e.target.files, null));
    g('btn-export').onclick     = doExport;
    g('btn-add-top').onclick    = () => g('file-input').click();

    /* Nav rail — swaps the workspace panel */
    g('nav-organize').onclick = () => setNav('organize');
    g('nav-reader').onclick   = () => setNav('reader');
    g('nav-bkm').onclick      = () => setNav('bookmarks');
    g('nav-search').onclick   = () => setNav('search');
    g('nav-add').onclick      = () => g('file-input').click();

    /* Grid toolbar */
    g('btn-undo').onclick         = undo;
    g('btn-redo').onclick         = redo;
    g('btn-rotate-left').onclick  = () => actionOnSelected(t => gridRotate(t,-90));
    g('btn-rotate-right').onclick = () => actionOnSelected(t => gridRotate(t, 90));
    g('btn-delete').onclick       = doDelete;
    g('btn-extract').onclick      = doExtractSelected;

    /* PV mode toggle */
    g('pv-mode-single').onclick = () => setPvMode('single');
    g('pv-mode-cont').onclick   = () => setPvMode('continuous');

    /* PV nav */
    g('pv-prev').onclick = () => pvNav(pvIdx-1);
    g('pv-next').onclick = () => pvNav(pvIdx+1);

    /* PV zoom */
    g('pv-zoom-in').onclick  = () => { pvZoom = Math.min(250, pvZoom+15); updatePvZoom(); pvRender(); };
    g('pv-zoom-out').onclick = () => { pvZoom = Math.max(30,  pvZoom-15); updatePvZoom(); pvRender(); };

    /* PV zoom presets */
    g('pv-zoom-fit').onclick  = () => { pvZoom = 100; updatePvZoom(); pvRender(); };
    g('pv-zoom-full').onclick = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
        } else {
            document.exitFullscreen();
        }
    };
    document.addEventListener('fullscreenchange', () => {
        const btn = g('pv-zoom-full');
        if (!btn) return;
        if (document.fullscreenElement) {
            btn.innerHTML = '<i class="fa-solid fa-compress"></i>';
            btn.title = 'Exit Fullscreen';
        } else {
            btn.innerHTML = '<i class="fa-solid fa-expand"></i>';
            btn.title = 'Fullscreen';
        }
    });

    /* Ctrl+scroll zoom in page view — handled by global capture listener above */
    g('pv-canvas-area').addEventListener('wheel', e => {
        if (e.ctrlKey || e.metaKey) return; // handled globally
        if (pvMode === 'single') {
            e.preventDefault();
            if (e.deltaY >  50) pvNav(pvIdx+1);
            if (e.deltaY < -50) pvNav(pvIdx-1);
        }
        // continuous: native scroll
    }, { passive: false });

    /* PV bookmark */
    g('pv-bkm-toggle').onclick = toggleBkmCurrent;
    g('pvr-bkm').onclick       = toggleBkmCurrent;
    g('pvr-rot-l').onclick     = () => pvRotate(-90);
    g('pvr-rot-r').onclick     = () => pvRotate( 90);
    g('pvr-extract').onclick   = pvExtract;
    g('pvr-print').onclick     = doPrint;
    g('pvr-delete').onclick    = pvDelete;

    /* PV sidebar tabs */
    g('pv-tab-all').onclick = () => { sbFilter='all';       refreshPvTabs(); pvBuildSidebar(); };
    g('pv-tab-bkm').onclick = () => { sbFilter='bookmarks'; refreshPvTabs(); pvBuildSidebar(); };

    /* PV sidebar toggle */
    g('pv-sidebar-toggle').onclick   = () => toggleSidebar(false);
    g('pv-sidebar-collapsed').onclick = () => toggleSidebar(true);

    /* PV search */
    g('pv-search').addEventListener('input', e => { srchQ = e.target.value; pvSearch(); });
    g('pv-search-jump').onclick = pvJumpMatch;

    /* Keyboard */
    window.addEventListener('keydown', e => {
        if (e.target.tagName==='INPUT') return;
        if (viewMode==='page') {
            if (e.key==='ArrowRight'||e.key==='ArrowDown') pvNav(pvIdx+1);
            if (e.key==='ArrowLeft' ||e.key==='ArrowUp')   pvNav(pvIdx-1);
            if ((e.ctrlKey||e.metaKey)&&e.key==='f') { e.preventDefault(); g('pv-search').focus(); }
        }
        if (viewMode==='grid') {
            if ((e.key==='Delete'||e.key==='Backspace') && !isConfirmingDelete)
                if (document.querySelectorAll('.thumbnail-active').length) doDelete();
            if ((e.ctrlKey||e.metaKey)&&e.key==='z') { e.preventDefault(); undo(); }
            if ((e.ctrlKey||e.metaKey)&&(e.key==='y'||(e.shiftKey&&e.key==='z'))) { e.preventDefault(); redo(); }
        }
    });

    /* Context menu — all actions use ctxGetTargets() for multi-select support */
    g('ctx-bkm').onclick     = () => { if(ctxTarget) toggleBkmNode(ctxTarget); closeAllPanels(); };
    g('ctx-extract').onclick = () => {
        const targets = ctxGetTargets();
        if (targets.length === 1) {
            extractNode(targets[0]);
        } else if (targets.length > 1) {
            // Temporarily ensure selection matches targets then use doExtractSelected
            document.querySelectorAll('.thumbnail-active').forEach(t => t.classList.remove('thumbnail-active'));
            targets.forEach(t => t.classList.add('thumbnail-active'));
            doExtractSelected();
        }
        closeAllPanels();
    };
    g('ctx-rot-l').onclick   = () => {
        const targets = ctxGetTargets();
        if (targets.length) { pushUndo(); targets.forEach(t => gridRotate(t, -90)); }
        closeAllPanels();
    };
    g('ctx-rot-r').onclick   = () => {
        const targets = ctxGetTargets();
        if (targets.length) { pushUndo(); targets.forEach(t => gridRotate(t, 90)); }
        closeAllPanels();
    };
    g('ctx-delete').onclick  = () => {
        const targets = ctxGetTargets();
        if (targets.length) {
            pushUndo();
            targets.forEach(t => { bookmarks.delete(parseInt(t.dataset.pageIndex)); t.remove(); });
            saveBkm(); updatePageNumbers(); lastNode = null;
            if (!g('thumbnails-container').querySelectorAll('.thumb-item').length && g('empty-state'))
                g('empty-state').style.display = 'flex';
        }
        closeAllPanels();
    };

    /* Drop PDF onto PV sidebar */
    const sidebar = g('pv-sidebar');
    ['dragenter','dragover'].forEach(ev => sidebar.addEventListener(ev, e => {
        if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); sidebar.classList.add('sb-drop-hover'); }
    }));
    ['dragleave','dragend'].forEach(ev => sidebar.addEventListener(ev, () => sidebar.classList.remove('sb-drop-hover')));
    sidebar.addEventListener('drop', e => {
        e.preventDefault(); sidebar.classList.remove('sb-drop-hover');
        if (e.dataTransfer.files.length) processFiles(e.dataTransfer.files, null);
    });

    /* Drop PDF onto PV main canvas area */
    const pvMain = g('pv-main');
    pvMain.addEventListener('dragover', e => {
        if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); pvMain.classList.add('pv-drop-hover'); }
    });
    pvMain.addEventListener('dragleave', e => { if (!pvMain.contains(e.relatedTarget)) pvMain.classList.remove('pv-drop-hover'); });
    pvMain.addEventListener('drop', e => {
        e.preventDefault(); pvMain.classList.remove('pv-drop-hover');
        if (e.dataTransfer.types.includes('Files') && e.dataTransfer.files.length)
            processFiles(e.dataTransfer.files, null);
    });

    /* PV sidebar insert-between-pages on file drag */
    const pvThumbList = g('pv-thumb-list');
    pvThumbList.addEventListener('dragover', e => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        pvClearInsertLines();
        const thumbs = [...pvThumbList.querySelectorAll('.pv-thumb')];
        if (!thumbs.length) return;
        let inserted = false;
        for (let i = 0; i < thumbs.length; i++) {
            const r = thumbs[i].getBoundingClientRect();
            if (e.clientY < r.top + r.height / 2) {
                const line = document.createElement('div');
                line.className = 'pv-insert-line';
                pvThumbList.insertBefore(line, thumbs[i]);
                inserted = true; break;
            }
        }
        if (!inserted) {
            const line = document.createElement('div');
            line.className = 'pv-insert-line';
            pvThumbList.appendChild(line);
        }
    });
    pvThumbList.addEventListener('dragleave', e => {
        if (!pvThumbList.contains(e.relatedTarget)) pvClearInsertLines();
    });
    pvThumbList.addEventListener('drop', e => {
        e.preventDefault(); e.stopPropagation(); pvClearInsertLines();
        if (e.dataTransfer.types.includes('Files') && e.dataTransfer.files.length) {
            // Find drop position in pvPages
            const thumbs = [...pvThumbList.querySelectorAll('.pv-thumb')];
            let dropIdx = pvPages.length;
            for (let i = 0; i < thumbs.length; i++) {
                const r = thumbs[i].getBoundingClientRect();
                if (e.clientY < r.top + r.height / 2) { dropIdx = parseInt(thumbs[i].dataset.pvr); break; }
            }
            const insertBefore = pvPages[dropIdx] || null;
            processFiles(e.dataTransfer.files, insertBefore);
        }
    });

    /* Prevent pvMain from also firing when drop happened on thumb-list */
    g('pv-main').addEventListener('drop', e => {
        if (e.target.closest('#pv-thumb-list')) return;
        e.preventDefault(); g('pv-main').classList.remove('pv-drop-hover');
        if (e.dataTransfer.types.includes('Files') && e.dataTransfer.files.length)
            processFiles(e.dataTransfer.files, null);
    });

    /* Grid drag-over / drop — shows dashed outline on container + insert marker at insertion point */
    const mc = g('main-container');
    mc.addEventListener('dragover', e => {
        e.preventDefault();
        if (!e.dataTransfer.types.includes('Files')) return;
        mc.classList.add('file-drag-over'); // show dashed outline around grid
        const thumbs = [...document.querySelectorAll('.thumb-item')];
        targetInsert = null;
        for (let t of thumbs) {
            const r = t.getBoundingClientRect();
            if (e.clientY>=r.top&&e.clientY<=r.bottom&&e.clientX<r.left+r.width/2){targetInsert=t;break;}
            else if(e.clientY<r.top){targetInsert=t;break;}
        }
        g('thumbnails-container').insertBefore(insertMarker, targetInsert);
        insertMarker.classList.remove('hidden-marker');
    });
    mc.addEventListener('dragleave', e => {
        if(!mc.contains(e.relatedTarget)) {
            insertMarker.classList.add('hidden-marker');
            mc.classList.remove('file-drag-over'); // hide dashed outline
        }
    });
    mc.addEventListener('drop', e => {
        e.preventDefault();
        insertMarker.classList.add('hidden-marker');
        mc.classList.remove('file-drag-over'); // hide dashed outline
        if (e.dataTransfer.types.includes('Files')&&e.dataTransfer.files.length)
            processFiles(e.dataTransfer.files, targetInsert);
    });

    /* Grid zoom */
    g('zoom-slider').addEventListener('input', e => updateGridZoom(parseInt(e.target.value)));
    g('btn-zoom-out').onclick = () => { const v=Math.max(120,parseInt(g('zoom-slider').value)-20); g('zoom-slider').value=v; updateGridZoom(v); };
    g('btn-zoom-in').onclick  = () => { const v=Math.min(300,parseInt(g('zoom-slider').value)+20); g('zoom-slider').value=v; updateGridZoom(v); };
    window.addEventListener('wheel', e => {
        if ((e.ctrlKey||e.metaKey) && viewMode==='grid') {
            e.preventDefault();
            let v = parseInt(g('zoom-slider').value) + (e.deltaY<0?15:-15);
            v = Math.max(120,Math.min(300,v)); g('zoom-slider').value=v; updateGridZoom(v);
        }
    }, { passive:false });

    document.body.classList.add('grid-view');
    updateNavButtons();
    updateToolStates();
    updateUndoRedoBtns();

    /* Global ctrl+scroll for page-view zoom
       - Single mode: immediate (pvRenderSeq cancels stale renders)
       - Continuous mode: debounced (rebuilding all pages is expensive) */
    g('app-body').addEventListener('wheel', e => {
        if (viewMode !== 'page') return;
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        e.stopPropagation();
        pvZoom = Math.max(30, Math.min(250, pvZoom + (e.deltaY < 0 ? 15 : -15)));
        updatePvZoom();
        pvRender();
    }, { passive: false, capture: true });
}

/* ─── PANELS ─────────────────────────────────────────── */
function togglePanel(id) {
    const el = g(id);
    const vis = el.style.display === 'block';
    closeAllPanels();
    if (!vis) el.style.display = 'block';
}

/* ─── VIEW MODE ──────────────────────────────────────── */
function setViewMode(mode) {
    viewMode = mode;
    document.body.className = document.body.className.replace(/\b(grid|page)-view\b/g,'').trim();
    document.body.classList.add(mode+'-view');
    // Explicit display control to avoid CSS cascade issues
    g('main-container').style.display       = mode==='grid' ? 'flex' : 'none';
    g('page-view-container').style.display  = mode==='page' ? 'flex' : 'none';
    g('zoom-bar').style.display             = mode==='grid' ? '' : 'none';
    const gst = g('grid-sub-toolbar'); if(gst) gst.style.display = mode==='grid' ? 'flex' : 'none';
    if (sbVisible) document.body.classList.remove('sb-collapsed');
    else document.body.classList.add('sb-collapsed');
    refreshViewBtns();
    if (mode==='page') {
        pvPages = [...document.querySelectorAll('.thumb-item')];
        if (pvIdx>=pvPages.length) pvIdx=0;
        pvUpdateEmptyState();
        pvBuildSidebar();
        pvNav(pvIdx);
    }
}
/* ─── NAV RAIL ───────────────────────────────────────── */
const NAV_TITLES = {
    organize:  { icon:'fa-grip',              label:'Organize' },
    reader:    { icon:'fa-file-lines',        label:'Reader'   },
    bookmarks: { icon:'fa-bookmark',          label:'Saved Pages' },
    search:    { icon:'fa-magnifying-glass',  label:'Search'   },
};
function setNav(dest) {
    navDest = dest;
    if (dest === 'organize') {
        setViewMode('grid');
    } else {
        // reader / bookmarks / search all live in page view
        sbFilter = (dest === 'bookmarks') ? 'bookmarks' : 'all';
        refreshPvTabs();
        setViewMode('page');
        if (!sbVisible) toggleSidebar(true);
        if (dest === 'search') setTimeout(() => { const s = g('pv-search'); if (s) s.focus(); }, 60);
    }
    updateNavButtons();
}
function updateNavButtons() {
    document.querySelectorAll('.rail-btn[data-nav]').forEach(b => {
        b.classList.toggle('active', b.dataset.nav === navDest);
    });
    const meta = NAV_TITLES[navDest] || NAV_TITLES.organize;
    const t = g('panel-title-text'); if (t) t.textContent = meta.label;
    const ti = g('panel-title'); if (ti) { const ic = ti.querySelector('i'); if (ic) ic.className = 'fa-solid ' + meta.icon; }
}
/* Back-compat: some engine code calls refreshViewBtns() */
function refreshViewBtns() { updateNavButtons(); }

/* ─── SIDEBAR TOGGLE ─────────────────────────────────── */
function toggleSidebar(show) {
    sbVisible = show;
    const sb = g('pv-sidebar');
    // Clear any inline style.width set by the resizer so the CSS class can take effect
    if (!show) sb.style.width = '';
    sb.classList.toggle('collapsed', !show);
    document.body.classList.toggle('sb-collapsed', !show);
    g('page-view-container').classList.toggle('sb-collapsed', !show);
}

/* ─── BOOKMARKS ──────────────────────────────────────── */
function saveBkm() { localStorage.setItem('pdforg_bookmarks', JSON.stringify([...bookmarks])); }
function toggleBkmCurrent() {
    if (!pvPages[pvIdx]) return;
    toggleBkmNode(pvPages[pvIdx]);
    pvBuildSidebar();
}
function toggleBkmNode(thumb) {
    const pi = parseInt(thumb.dataset.pageIndex);
    if (bookmarks.has(pi)) { bookmarks.delete(pi); toast('Bookmark removed','#8a9bb5'); }
    else                   { bookmarks.add(pi);    toast(`Page ${pi} bookmarked`,'#d97706'); }
    saveBkm();
    thumb.classList.toggle('bookmarked', bookmarks.has(pi));
    updateBkmUI();
}
function updateBkmUI() {
    if (!pvPages[pvIdx]) return;
    const bkm = bookmarks.has(parseInt(pvPages[pvIdx].dataset.pageIndex));
    const btn = g('pv-bkm-toggle');
    btn.classList.toggle('bookmarked', bkm);
    btn.innerHTML = bkm ? '<i class="fa-solid fa-bookmark"></i> Saved' : '<i class="fa-regular fa-bookmark"></i> Bookmark';
    const rbBtn = g('pvr-bkm');
    rbBtn.classList.toggle('pvr-active', bkm);
    rbBtn.querySelector('i').className = bkm ? 'fa-solid fa-bookmark' : 'fa-regular fa-bookmark';
}

function pvClearInsertLines() {
    g('pv-thumb-list').querySelectorAll('.pv-insert-line').forEach(l => l.remove());
}

/* ─── PV SIDEBAR ─────────────────────────────────────── */
function pvBuildSidebar() {
    [...g('pv-thumb-list').children].forEach(c => { if(c.id!=='pv-empty-bkm') c.remove(); });
    const list = sbFilter==='bookmarks'
        ? pvPages.filter(p => bookmarks.has(parseInt(p.dataset.pageIndex)))
        : pvPages;

    const noB = sbFilter==='bookmarks' && list.length===0;
    g('pv-empty-bkm').style.display = noB ? 'flex' : 'none';
    g('pv-page-count-label').textContent = sbFilter==='bookmarks'
        ? `${bookmarks.size} saved` : `${pvPages.length} pages`;

    list.forEach(thumb => {
        const ri = pvPages.indexOf(thumb);
        const isA = ri===pvIdx;
        const pi  = parseInt(thumb.dataset.pageIndex);
        const bkm = bookmarks.has(pi);
        const match = srchMatches.some(m=>m.pi===ri);

        const wrap = document.createElement('div');
        wrap.className = `pv-thumb${isA?' pv-active':''}${match&&!isA?' pv-match':''}`;
        wrap.dataset.pvr = String(ri);  // index into pvPages
        wrap.draggable = true;
        wrap.style.position = 'relative';

        // mini canvas
        const src = thumb.querySelector('canvas');
        const mini = document.createElement('canvas');
        const sc = 140/Math.max(src.width,1);
        mini.width  = Math.round(src.width*sc);
        mini.height = Math.round(src.height*sc);
        mini.getContext('2d').drawImage(src,0,0,mini.width,mini.height);

        if (bkm) {
            const bi=document.createElement('div'); bi.className='pv-thumb-bkm';
            bi.innerHTML='<i class="fa-solid fa-bookmark"></i>'; wrap.appendChild(bi);
        }
        if (match&&!isA) {
            const mb=document.createElement('div'); mb.className='pv-thumb-match-badge';
            mb.textContent='match'; wrap.appendChild(mb);
        }
        wrap.appendChild(mini);
        const lbl=document.createElement('div'); lbl.className='pv-thumb-label'; lbl.textContent=`Page ${pi}`;
        wrap.appendChild(lbl);

        wrap.addEventListener('click', ()=> pvNav(ri));
        g('pv-thumb-list').appendChild(wrap);
    });

    // scroll active thumb into view
    requestAnimationFrame(()=>{
        const a = g('pv-thumb-list').querySelector('.pv-active');
        if(a){ const tl=g('pv-thumb-list'); tl.scrollTop=a.offsetTop-tl.clientHeight/2+a.clientHeight/2; }
    });

    // Sortable reorder (only in 'all' mode)
    if (window._pvSortable) { try { window._pvSortable.destroy(); } catch{} }
    if (sbFilter === 'all') {
        window._pvSortable = new Sortable(g('pv-thumb-list'), {
            animation: 150,
            filter: '#pv-empty-bkm, .pv-insert-line',
            ghostClass: 'sortable-ghost',
            onEnd(evt) {
                // Rebuild pvPages from new DOM order
                const items = [...g('pv-thumb-list').querySelectorAll('.pv-thumb')];
                const newPvPages = items.map(el => pvPages[parseInt(el.dataset.pvr)]);
                pvPages = newPvPages;
                // Sync thumbnails-container order
                const tc = g('thumbnails-container');
                pvPages.forEach(t => tc.appendChild(t));
                updatePageNumbers();
                pushUndo();
                pvIdx = evt.newIndex;
                pvNav(pvIdx);
            }
        });
    }

    // Scroll to current page in continuous mode after rebuild
    requestAnimationFrame(() => {
        const contEl = g('pv-cont-area');
        const areaEl = g('pv-canvas-area');
        if (!contEl || !areaEl) return;
        const target = contEl.querySelector(`[data-cont-idx="${pvIdx}"]`);
        if (target) areaEl.scrollTop = target.offsetTop - 20;
    });
}
function refreshPvTabs() {
    const ta = g('pv-tab-all'); if(ta) ta.classList.toggle('active-pv-tab', sbFilter==='all');
    const tb = g('pv-tab-bkm'); if(tb) tb.classList.toggle('active-pv-tab', sbFilter==='bookmarks');
}

function pvUpdateEmptyState() {
    const empty = g('pv-empty-canvas');
    const wrapper = g('pv-page-wrapper');
    const hasPages = pvPages.length > 0;
    if (empty) { empty.classList.toggle('visible', !hasPages); }
    if (wrapper) { wrapper.classList.toggle('visible', hasPages); }
}

/* ─── PV NAVIGATE ────────────────────────────────────── */
function pvNav(idx) {
    pvUpdateEmptyState();
    if (!pvPages.length) return;
    idx = Math.max(0,Math.min(pvPages.length-1,idx));
    pvIdx = idx;
    g('pv-page-cur').textContent = idx+1;
    g('pv-page-tot').textContent = pvPages.length;
    g('pv-prev').disabled = idx===0;
    g('pv-next').disabled = idx===pvPages.length-1;
    updateBkmUI();
    pvBuildSidebar();
    pvRender();
    pvUpdateSearchBanner();
}

/* ─── PV RENDER (real PDF.js) ────────────────────────── */
let pvRenderSeq = 0; // sequence counter to cancel stale renders
async function pvRender() {
    if (!pvPages.length) return;
    if (pvMode === 'continuous') { await pvRenderContinuous(); return; }
    const thumb   = pvPages[pvIdx]; if(!thumb) return;
    const fileId  = thumb.dataset.fileId;
    const origIdx = parseInt(thumb.dataset.originalPageIndex);
    const rotation= parseInt(thumb.dataset.rotation)||0;
    if (!rawPdfs[fileId]) return;

    if (!pvPdfDocs[fileId]) {
        try { pvPdfDocs[fileId] = await pdfjsLib.getDocument(new Uint8Array(rawPdfs[fileId].slice(0))).promise; }
        catch(e) { console.error('PV doc:', e); return; }
    }
    let page;
    try { page = await pvPdfDocs[fileId].getPage(origIdx); }
    catch(e) { console.error('PV page:', e); return; }

    if (pvTask) { try{pvTask.cancel();}catch{} pvTask=null; }

    const seq = ++pvRenderSeq;
    const area   = g('pv-canvas-area');
    const availW = area.clientWidth  - 40;
    const availH = area.clientHeight - 40;
    const baseVP = page.getViewport({scale:1, rotation});
    const fitS   = Math.min(availW/baseVP.width, availH/baseVP.height, 2.5);
    const scale  = fitS * (pvZoom/100);
    const vp     = page.getViewport({scale, rotation});

    // Render to offscreen canvas first to avoid flicker
    const offscreen = document.createElement('canvas');
    offscreen.width  = Math.round(vp.width);
    offscreen.height = Math.round(vp.height);
    const offCtx = offscreen.getContext('2d');
    pvTask = page.render({canvasContext: offCtx, viewport: vp});
    try { await pvTask.promise; }
    catch(e) { if(e.name!=='RenderingCancelledException') console.warn('PV render:',e); return; }
    pvTask = null;
    if (seq !== pvRenderSeq) return; // stale

    // Swap to visible canvas
    const canvas = g('pv-canvas');
    canvas.width  = offscreen.width;
    canvas.height = offscreen.height;
    canvas.style.width  = canvas.width  + 'px';
    canvas.style.height = canvas.height + 'px';
    canvas.getContext('2d').drawImage(offscreen, 0, 0);

    // Page size indicator
    const w = Math.round(baseVP.width * 25.4 / 72);
    const h = Math.round(baseVP.height * 25.4 / 72);
    let sizeName = 'Custom';
    if ((w===210&&h===297)||(w===297&&h===210)) sizeName='A4';
    else if ((w===210&&h===148)||(w===148&&h===210)) sizeName='A5';
    else if ((w===297&&h===420)||(w===420&&h===297)) sizeName='A3';
    const sizeEl = g('pv-page-size-badge');
    if(sizeEl) sizeEl.textContent = sizeName ? `${sizeName} ${w}×${h}mm` : `${w}×${h}mm`;

    // Highlights
    g('pv-text-layer').innerHTML='';
    if (srchQ.trim()) await pvRenderHighlights(page, vp);
}

/* ─── PV MODE (single / continuous) ─────────────────── */
function updatePvZoom() {
    g('pv-zoom-label').textContent = pvZoom + '%';
}
function setPvMode(mode) {
    pvMode = mode;
    const area = g('pv-canvas-area');
    const wrapper = g('pv-page-wrapper');
    const cont = g('pv-cont-area');
    if (mode === 'continuous') {
        if (wrapper) wrapper.style.display = 'none';
        area.style.alignItems = 'flex-start';
        area.style.overflowY = 'auto';
        area.style.cursor = 'default';
        pvRenderContinuous();
    } else {
        if (wrapper) wrapper.style.display = 'inline-block';
        if (cont) cont.remove();
        area.style.alignItems = 'center';
        area.style.overflowY = 'auto';
        area.style.cursor = 'ns-resize';
        pvRender();
    }
    // update toggle buttons
    const bs = g('pv-mode-single'); const bc = g('pv-mode-cont');
    if (bs) { bs.classList.toggle('pv-mode-active', mode==='single'); }
    if (bc) { bc.classList.toggle('pv-mode-active', mode==='continuous'); }
}
async function pvRenderContinuous() {
    const area = g('pv-canvas-area');
    const availW = area.clientWidth - 40;
    const availH = area.clientHeight - 40;

    // ── Fingerprint: detect zoom-only vs page-list change ──
    const fp = pvPages.map(t =>
        `${t.dataset.fileId}:${t.dataset.originalPageIndex}:${t.dataset.rotation||0}:${t.dataset.pageIndex}`
    ).join('|');

    let cont = g('pv-cont-area');

    // ── Zoom-only update: resize & re-render in place, no DOM rebuild ──
    if (cont && cont.dataset.fp === fp) {
        const areaRect = area.getBoundingClientRect();
        for (let i = 0; i < pvPages.length; i++) {
            const wrapper = cont.children[i]; if (!wrapper) continue;
            // Disconnect stale render observer FIRST — prevents old vp from overwriting new canvas
            if (wrapper._renderObs) { wrapper._renderObs.disconnect(); wrapper._renderObs = null; }

            const thumb = pvPages[i];
            const fid = thumb.dataset.fileId;
            const oi  = parseInt(thumb.dataset.originalPageIndex);
            const rot = parseInt(thumb.dataset.rotation) || 0;
            if (!rawPdfs[fid] || !pvPdfDocs[fid]) continue;
            try {
                const page   = await pvPdfDocs[fid].getPage(oi);
                const baseVP = page.getViewport({scale:1, rotation:rot});
                const fitS   = Math.min(availW/baseVP.width, availH/baseVP.height, 2.5);
                const scale  = fitS * (pvZoom/100);
                const vp     = page.getViewport({scale, rotation:rot});
                const canvas = wrapper.querySelector('canvas'); if (!canvas) continue;
                canvas.width  = Math.round(vp.width);
                canvas.height = Math.round(vp.height);

                const wRect = wrapper.getBoundingClientRect();
                const inView = wRect.top < areaRect.bottom + 200 && wRect.bottom > areaRect.top - 200;
                if (inView) {
                    // Render immediately for visible pages
                    page.render({canvasContext: canvas.getContext('2d'), viewport: vp}).promise.catch(()=>{});
                } else {
                    // Lazy render with fresh observer using updated vp
                    const obs = new IntersectionObserver(async entries => {
                        if (!entries[0].isIntersecting) return;
                        obs.disconnect(); wrapper._renderObs = null;
                        const oc = document.createElement('canvas');
                        oc.width = canvas.width; oc.height = canvas.height;
                        await page.render({canvasContext: oc.getContext('2d'), viewport: vp}).promise;
                        canvas.getContext('2d').drawImage(oc, 0, 0);
                    }, {root: area, rootMargin: '200px'});
                    obs.observe(wrapper);
                    wrapper._renderObs = obs;
                }
            } catch {}
        }
        return;
    }

    // ── Full rebuild (page list, order or rotation changed) ──
    const restoreIdx = pvIdx;
    if (!cont) {
        cont = document.createElement('div');
        cont.id = 'pv-cont-area';
        cont.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:16px;padding:20px;width:100%;';
        area.appendChild(cont);
    }
    // Disconnect all stale observers before clearing DOM
    Array.from(cont.children).forEach(w => {
        if (w._renderObs) { w._renderObs.disconnect(); }
        if (w._idxObs)    { w._idxObs.disconnect(); }
    });
    cont.innerHTML = '';
    cont.dataset.fp = fp;

    for (let i = 0; i < pvPages.length; i++) {
        const thumb = pvPages[i];
        const fid   = thumb.dataset.fileId;
        const oi    = parseInt(thumb.dataset.originalPageIndex);
        const rot   = parseInt(thumb.dataset.rotation) || 0;
        if (!rawPdfs[fid]) continue;
        if (!pvPdfDocs[fid]) {
            try { pvPdfDocs[fid] = await pdfjsLib.getDocument(new Uint8Array(rawPdfs[fid].slice(0))).promise; } catch{continue;}
        }
        const page   = await pvPdfDocs[fid].getPage(oi);
        const baseVP = page.getViewport({scale:1, rotation:rot});
        // Same fitS as single mode → no size jump when switching modes
        const fitS   = Math.min(availW/baseVP.width, availH/baseVP.height, 2.5);
        const scale  = fitS * (pvZoom/100);
        const vp     = page.getViewport({scale, rotation:rot});

        const wrapper = document.createElement('div');
        wrapper.dataset.contIdx = i;
        wrapper.style.cssText = 'position:relative;background:white;border-radius:4px;box-shadow:0 4px 20px rgba(0,0,0,.20);flex-shrink:0;line-height:0;';
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(vp.width);
        canvas.height = Math.round(vp.height);
        canvas.style.display = 'block';
        wrapper.appendChild(canvas);
        // page label
        const lbl = document.createElement('div');
        lbl.textContent = `Page ${thumb.dataset.pageIndex}`;
        lbl.style.cssText = 'position:absolute;bottom:8px;right:10px;background:rgba(15,33,54,.82);color:white;font-size:10px;font-weight:800;padding:3px 8px;border-radius:5px;-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);';
        wrapper.appendChild(lbl);
        cont.appendChild(wrapper);

        // Lazy render — store ref so zoom update can disconnect it
        const renderObs = new IntersectionObserver(async entries => {
            if (!entries[0].isIntersecting) return;
            renderObs.disconnect(); wrapper._renderObs = null;
            const oc = document.createElement('canvas');
            oc.width = canvas.width; oc.height = canvas.height;
            await page.render({canvasContext: oc.getContext('2d'), viewport: vp}).promise;
            canvas.getContext('2d').drawImage(oc, 0, 0);
        }, {root: area, rootMargin: '200px'});
        renderObs.observe(wrapper);
        wrapper._renderObs = renderObs;

        // Track which page is most visible for pvIdx sync
        const idxObs = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting) { pvIdx = i; pvUpdatePageCounter(); pvUpdateSearchBanner(); }
        }, {root: area, threshold: 0.5});
        idxObs.observe(wrapper);
        wrapper._idxObs = idxObs;
    }

    // Restore scroll position to the page that was visible before rebuild
    requestAnimationFrame(() => {
        const target = cont.querySelector(`[data-cont-idx="${restoreIdx}"]`);
        if (target) area.scrollTop = target.offsetTop - 20;
    });
}

function pvUpdatePageCounter() {
    g('pv-page-cur').textContent = pvIdx + 1;
    g('pv-page-tot').textContent = pvPages.length;
    g('pv-prev').disabled = pvIdx === 0;
    g('pv-next').disabled = pvIdx === pvPages.length - 1;
}

/* ─── SEARCH ─────────────────────────────────────────── */
async function pvSearch() {
    srchMatches = [];
    const q = srchQ.trim().toLowerCase();
    g('pv-search').classList.toggle('has-results', false);
    g('pv-search-count').textContent = '';

    if (!q) {
        g('pv-search-banner').style.display='none';
        g('pv-text-layer').innerHTML='';
        pvBuildSidebar(); return;
    }
    for (let i=0; i<pvPages.length; i++) {
        const t=pvPages[i], fid=t.dataset.fileId, oi=parseInt(t.dataset.originalPageIndex);
        if (!rawPdfs[fid]) continue;
        try {
            if (!pvPdfDocs[fid]) pvPdfDocs[fid] = await pdfjsLib.getDocument(new Uint8Array(rawPdfs[fid].slice(0))).promise;
            const pg = await pvPdfDocs[fid].getPage(oi);
            const cnt = await pg.getTextContent();
            let n=0; cnt.items.forEach(it=>{ if(it.str&&it.str.toLowerCase().includes(q)) n++; });
            if(n) srchMatches.push({pi:i,count:n});
        } catch{}
    }
    const tot=srchMatches.length;
    g('pv-search').classList.toggle('has-results', tot>0);
    g('pv-search-count').textContent = tot>0 ? `${tot}p` : '';
    pvUpdateSearchBanner();
    pvBuildSidebar();
    pvRender();
}

async function pvRenderHighlights(page, vp) {
    const q = srchQ.trim().toLowerCase(); if(!q) return;
    const content = await page.getTextContent();
    const canvas  = g('pv-canvas');
    const tl      = g('pv-text-layer');
    tl.style.width  = canvas.style.width;
    tl.style.height = canvas.style.height;
    const sx = canvas.clientWidth  / vp.width;
    const sy = canvas.clientHeight / vp.height;
    content.items.forEach(item=>{
        if (!item.str||!item.str.toLowerCase().includes(q)) return;
        const tx = pdfjsLib.Util.transform(vp.transform, item.transform);
        const d=document.createElement('div'); d.className='search-highlight';
        d.style.left   = (tx[4]*sx)+'px';
        d.style.top    = ((vp.height-tx[5]-item.height)*sy)+'px';
        d.style.width  = (item.width*vp.scale*sx)+'px';
        d.style.height = (item.height*vp.scale*sy+2)+'px';
        tl.appendChild(d);
    });
}

function pvUpdateSearchBanner() {
    if (!srchQ.trim()) { g('pv-search-banner').style.display='none'; return; }
    const tot=srchMatches.length;
    const cur=srchMatches.find(m=>m.pi===pvIdx);
    const banner=g('pv-search-banner');
    banner.style.display='flex';
    banner.className = tot>0 ? 'has-results' : 'no-results';
    g('pv-search-msg').textContent = tot===0
        ? `No results for "${srchQ}"`
        : cur ? `"${srchQ}" — ${cur.count} match(es) on this page (${tot} pages total)`
              : `"${srchQ}" found in ${tot} page(s) — not on this page`;
    g('pv-search-jump').style.display = (!cur&&tot>0)?'inline':'none';
}
function pvJumpMatch() {
    const next=srchMatches.find(m=>m.pi>pvIdx)||srchMatches[0];
    if(next) pvNav(next.pi);
}

/* ─── PV ACTIONS ─────────────────────────────────────── */
async function pvRotate(deg) {
    const t=pvPages[pvIdx]; if(!t) return;
    pushUndo();
    const rot=(parseInt(t.dataset.rotation||0)+deg+360)%360;
    t.dataset.rotation=rot;
    await renderThumbCanvas(t, rot);
    pvRender();
    toast(`Page ${t.dataset.pageIndex} rotated ${deg>0?'right':'left'}`);
}

async function pvExtract() {
    const t=pvPages[pvIdx]; if(!t) return;
    await extractNode(t);
}

async function extractNode(thumb) {
    const fid=thumb.dataset.fileId, oi=parseInt(thumb.dataset.originalPageIndex)-1, rot=parseInt(thumb.dataset.rotation)||0;
    try {
        const {PDFDocument}=PDFLib;
        const src=await PDFDocument.load(rawPdfs[fid].slice(0));
        const dst=await PDFDocument.create();
        const [cp]=await dst.copyPages(src,[oi]);
        cp.setRotation(PDFLib.degrees(rot)); dst.addPage(cp);
        dlBlob(await dst.save(),`${getFilename()}_Page${thumb.dataset.pageIndex}.pdf`);
        toast(`Page ${thumb.dataset.pageIndex} extracted`,'#059669');
    } catch(e) { alert('Extract error: '+e.message); }
}

function pvDelete() {
    const t=pvPages[pvIdx]; if(!t) return;
    const pi=parseInt(t.dataset.pageIndex);
    if(!confirm(`Delete page ${pi}?`)) return;
    pushUndo();
    bookmarks.delete(pi); saveBkm();
    t.remove(); updatePageNumbers();
    pvPages=[...document.querySelectorAll('.thumb-item')];
    if(!pvPages.length){setNav('organize');return;}
    pvIdx=Math.max(0,pvIdx-1); pvNav(pvIdx);
    toast(`Page ${pi} deleted`,'#dc2626');
}

/* ─── PRINT ──────────────────────────────────────────── */
async function doPrint() {
    closeAllPanels();
    if (viewMode === 'page') {
        // Render ALL pages to iframe and print
        showLoading(true); setLoading('Preparing print…', 10);
        try {
            const frame = g('print-frame');
            frame.style.display = 'block';
            const doc = frame.contentDocument || frame.contentWindow.document;
            doc.open();
            doc.write(`<!DOCTYPE html><html><head><style>
                *{margin:0;padding:0;box-sizing:border-box}
                body{background:white}
                .print-page{display:flex;justify-content:center;align-items:flex-start;page-break-after:always;padding:0}
                .print-page:last-child{page-break-after:avoid}
                img{max-width:100%;height:auto;display:block}
            </style></head><body id="pb"></body></html>`);
            doc.close();
            const pb = doc.getElementById('pb');
            for (let i = 0; i < pvPages.length; i++) {
                setLoading(`Rendering page ${i+1} of ${pvPages.length}…`, 10 + (i/pvPages.length)*85);
                const thumb = pvPages[i];
                const fid = thumb.dataset.fileId;
                const oi = parseInt(thumb.dataset.originalPageIndex);
                const rot = parseInt(thumb.dataset.rotation) || 0;
                if (!pvPdfDocs[fid]) pvPdfDocs[fid] = await pdfjsLib.getDocument(new Uint8Array(rawPdfs[fid].slice(0))).promise;
                const page = await pvPdfDocs[fid].getPage(oi);
                const vp = page.getViewport({ scale: 2, rotation: rot });
                const oc = document.createElement('canvas');
                oc.width = vp.width; oc.height = vp.height;
                await page.render({ canvasContext: oc.getContext('2d'), viewport: vp }).promise;
                const div = doc.createElement('div'); div.className = 'print-page';
                const img = doc.createElement('img'); img.src = oc.toDataURL('image/jpeg', 0.92);
                div.appendChild(img); pb.appendChild(div);
            }
            setLoading('Opening print dialog…', 100);
            setTimeout(() => {
                frame.contentWindow.print();
                frame.style.display = 'none';
            }, 600);
        } catch(e) { alert('Print error: ' + e.message); }
        finally { showLoading(false); }
    } else {
        window.print();
    }
}

/* ─── GRID ZOOM ──────────────────────────────────────── */
function updateGridZoom(v) {
    document.documentElement.style.setProperty('--thumb-w', v+'px');
}

/* ─── SORTABLE ───────────────────────────────────────── */
new Sortable(g('thumbnails-container'),{
    animation:150, ghostClass:'sortable-ghost', dragClass:'sortable-drag',
    filter:'#selection-box',
    onStart(e){
        if(!e.item.classList.contains('thumbnail-active')){
            document.querySelectorAll('.thumbnail-active').forEach(el=>el.classList.remove('thumbnail-active'));
            e.item.classList.add('thumbnail-active'); lastNode=e.item; updateToolStates();
        }
        const sel=document.querySelectorAll('.thumbnail-active');
        if(sel.length>1){
            const b=document.createElement('div');
            b.id='drag-badge';
            b.style.cssText='position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:#1d4ed8;color:white;font-size:12px;font-weight:800;padding:5px 12px;border-radius:8px;z-index:50;box-shadow:0 6px 16px rgba(29,78,216,.4);border:2px solid white;white-space:nowrap;pointer-events:none';
            b.innerHTML=`<i class="fa-solid fa-copy" style="margin-right:5px"></i>${sel.length} Pages`;
            e.item.appendChild(b);
            sel.forEach(el=>{if(el!==e.item)el.style.opacity='.3';});
        }
    },
    onEnd(e){
        g('drag-badge')?.remove();
        const sel=[...document.querySelectorAll('.thumbnail-active')];
        sel.forEach(el=>el.style.opacity='1');
        if(sel.length>1){
            sel.sort((a,b)=>parseInt(a.dataset.pageIndex)-parseInt(b.dataset.pageIndex));
            let ref=e.item.nextSibling;
            while(ref&&ref.classList.contains('thumbnail-active'))ref=ref.nextSibling;
            sel.forEach(el=>g('thumbnails-container').insertBefore(el,ref));
        }
        pushUndo(); updatePageNumbers();
    }
});

/* ─── LASSO ──────────────────────────────────────────── */
let isLasso=false, lsX=0, lsY=0, lsInit=new Set();
g('thumbnails-container').addEventListener('mousedown', e => {
    if(e.target!==g('thumbnails-container')&&e.target!==g('empty-state'))return;
    isLasso=true; lsX=e.clientX; lsY=e.clientY;
    const sb=g('selection-box');
    Object.assign(sb.style,{left:lsX+'px',top:lsY+'px',width:'0',height:'0',display:'block'});
    if(!e.ctrlKey&&!e.metaKey&&!e.shiftKey){
        document.querySelectorAll('.thumb-item').forEach(t=>t.classList.remove('thumbnail-active'));
        lsInit.clear();
    } else { lsInit=new Set(document.querySelectorAll('.thumbnail-active')); }
    updateToolStates();
});
window.addEventListener('mousemove', e=>{
    if(!isLasso)return;
    const l=Math.min(lsX,e.clientX),t=Math.min(lsY,e.clientY),w=Math.abs(lsX-e.clientX),h=Math.abs(lsY-e.clientY);
    const sb=g('selection-box');
    Object.assign(sb.style,{left:l+'px',top:t+'px',width:w+'px',height:h+'px'});
    const br=sb.getBoundingClientRect();
    document.querySelectorAll('.thumb-item').forEach(thumb=>{
        const r=thumb.getBoundingClientRect();
        const hit=!(br.right<r.left||br.left>r.right||br.bottom<r.top||br.top>r.bottom);
        if(hit){thumb.classList.add('thumbnail-active');lastNode=thumb;}
        else if(lsInit.has(thumb))thumb.classList.add('thumbnail-active');
        else thumb.classList.remove('thumbnail-active');
    });
    updateToolStates();
});
window.addEventListener('mouseup',()=>{
    if(isLasso){isLasso=false;g('selection-box').style.display='none';}
});

/* ─── INSERT MARKER ──────────────────────────────────── */
const insertMarker=document.createElement('div');
insertMarker.className='insert-marker hidden-marker';
insertMarker.style.cssText='width:5px;height:200px;background:var(--p);border-radius:8px;margin:0 -12px;box-shadow:0 0 18px var(--p)';
g('thumbnails-container').appendChild(insertMarker);
let targetInsert=null;

/* ─── SIDEBAR RESIZE ─────────────────────────────────── */
(function(){
    const resizer = g('pv-sidebar-resizer');
    const sidebar = g('pv-sidebar');
    if (!resizer || !sidebar) return;
    let startX, startW;
    resizer.addEventListener('mousedown', e => {
        startX = e.clientX; startW = sidebar.offsetWidth;
        resizer.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        const onMove = e => {
            const w = Math.max(100, Math.min(320, startW + e.clientX - startX));
            sidebar.style.width = w + 'px';
        };
        const onUp = () => {
            resizer.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
})();

/* ─── CONTEXT MENU ───────────────────────────────────── */

/* Returns the set of thumb-items that a context-menu action should affect:
   - If ctxTarget is inside the current selection → all selected items
   - Otherwise → just ctxTarget alone */
function ctxGetTargets() {
    const sel = [...document.querySelectorAll('.thumbnail-active')];
    return (sel.length > 0 && ctxTarget && sel.includes(ctxTarget)) ? sel : (ctxTarget ? [ctxTarget] : []);
}

g('thumbnails-container').addEventListener('contextmenu', e=>{
    const t=e.target.closest('.thumb-item');
    if(!t){closeAllPanels();return;}
    e.preventDefault();
    ctxTarget=t;
    const sel = [...document.querySelectorAll('.thumbnail-active')];
    const affectedCount = (sel.length > 0 && sel.includes(t)) ? sel.length : 1;
    const suffix = affectedCount > 1 ? ` (${affectedCount})` : '';
    // Update labels
    const bkm=bookmarks.has(parseInt(t.dataset.pageIndex));
    g('ctx-bkm').innerHTML     = `<i class="fa-${bkm?'solid':'regular'} fa-bookmark"></i> ${bkm?'Remove Bookmark':'Bookmark'}`;
    g('ctx-extract').innerHTML = `<i class="fa-solid fa-file-export"></i> Extract${suffix}`;
    g('ctx-rot-l').innerHTML   = `<i class="fa-solid fa-rotate-left"></i> Rotate Left${suffix}`;
    g('ctx-rot-r').innerHTML   = `<i class="fa-solid fa-rotate-right"></i> Rotate Right${suffix}`;
    g('ctx-delete').innerHTML  = `<i class="fa-solid fa-trash-can"></i> Delete${suffix}`;
    const m=g('ctx-menu');
    m.style.display='block';
    const mx=Math.min(e.clientX,window.innerWidth-170);
    const my=Math.min(e.clientY,window.innerHeight-180);
    m.style.left=mx+'px'; m.style.top=my+'px';
});
document.addEventListener('contextmenu', e=>{
    if(!e.target.closest('#thumbnails-container')) closeAllPanels();
});

/* ─── FILE PROCESSING ────────────────────────────────── */
async function processFiles(files, insertBefore) {
    if(g('empty-state'))g('empty-state').style.display='none';
    showLoading(true); let hasInvalid=false; const newThumbs=[];
    try {
        for(let file of files){
            if(file.type!=='application/pdf'){hasInvalid=true;continue;}
            setLoading(`Reading: ${file.name}…`,10); await tick();
            const ab=await file.arrayBuffer();
            const fid='pdf_'+Date.now()+'_'+Math.floor(Math.random()*9999);
            rawPdfs[fid]=ab;
            setLoading('Parsing PDF…',25); await tick();
            const pdf=await pdfjsLib.getDocument(new Uint8Array(ab.slice(0))).promise;
            pvPdfDocs[fid]=pdf;
            const tot=pdf.numPages;
            for(let i=1;i<=tot;i++){
                setLoading(`Extracting page ${i} of ${tot}…`,25+(i/tot)*73); await tick();
                const pg=await pdf.getPage(i);
                newThumbs.push(await createThumb(pg,fid,i));
            }
        }
        newThumbs.forEach(t=>g('thumbnails-container').insertBefore(t,insertBefore));
        pushUndo(); updatePageNumbers();
        if(hasInvalid) setTimeout(()=>alert('Some files skipped (not valid PDFs).'),400);
        if(viewMode==='page'){
            pvPages=[...document.querySelectorAll('.thumb-item')];
            pvBuildSidebar(); pvNav(pvIdx);
        }
    } catch(e){console.error(e);alert('Error: '+e.message);}
    finally{
        showLoading(false);
        const tc=g('thumbnails-container');
        if(!tc.querySelectorAll('.thumb-item').length&&g('empty-state'))
            g('empty-state').style.display='flex';
    }
}

async function createThumb(page,fileId,pageIndex){
    const rotation=page.rotate||0;
    const el=document.createElement('div');
    el.className='thumb-item';
    el.dataset.fileId=fileId;
    el.dataset.originalPageIndex=pageIndex;
    el.dataset.pageIndex=pageIndex;
    el.dataset.rotation=rotation;

    const vp=page.getViewport({scale:.55,rotation});
    const canvas=document.createElement('canvas');
    canvas.width=vp.width; canvas.height=vp.height;
    await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;

    const badge=document.createElement('div');
    badge.className='page-badge'; badge.textContent=pageIndex;
    el.appendChild(canvas); el.appendChild(badge);

    el.addEventListener('click', e=>{
        if(e.shiftKey&&lastNode){
            const all=[...document.querySelectorAll('.thumb-item')];
            let s=all.indexOf(lastNode),en=all.indexOf(el);
            if(s===-1)s=en;
            const mn=Math.min(s,en),mx=Math.max(s,en);
            if(!e.ctrlKey&&!e.metaKey) all.forEach(t=>t.classList.remove('thumbnail-active'));
            for(let i=mn;i<=mx;i++) all[i].classList.add('thumbnail-active');
        } else {
            if(!e.ctrlKey&&!e.metaKey)
                document.querySelectorAll('.thumb-item').forEach(t=>{if(t!==el)t.classList.remove('thumbnail-active');});
            el.classList.toggle('thumbnail-active');
        }
        lastNode=el; updateToolStates();
    });

    el.addEventListener('dblclick', ()=>{
        pvIdx=[...document.querySelectorAll('.thumb-item')].indexOf(el);
        setNav('reader');
    });

    return el;
}

/* ─── PAGE NUMBERS / TOOL STATES ─────────────────────── */
function updatePageNumbers(){
    let n=0;
    document.querySelectorAll('.thumb-item').forEach(t=>{
        n++; t.dataset.pageIndex=n;
        t.querySelector('.page-badge').textContent=n;
    });
    g('page-count-badge').textContent=`${n} Pages`;
    updateToolStates();
}
function updateToolStates(){
    const count=document.querySelectorAll('.thumbnail-active').length;
    const has=count>0;
    ['btn-extract','btn-rotate-left','btn-rotate-right','btn-delete'].forEach(id=>{
        const b=g(id); if(b) b.disabled=!has;
    });
    const ss=g('selection-status');
    if(ss){
        ss.textContent = has ? `${count} selected` : 'No selection';
        ss.classList.toggle('has-sel', has);
    }
}

/* ─── GRID ACTIONS ───────────────────────────────────── */
async function actionOnSelected(fn){
    const sel=document.querySelectorAll('.thumbnail-active');
    if(!sel.length)return;
    pushUndo();
    ['btn-extract','btn-rotate-left','btn-rotate-right','btn-delete'].forEach(id=>{const b=g(id);if(b)b.disabled=true;});
    for(let t of sel) await fn(t);
    updateToolStates();
}

/* Loads (and caches) the pdf.js document for a fileId — shared by thumb + page-view rendering */
async function getPvDoc(fileId) {
    if (!pvPdfDocs[fileId]) {
        pvPdfDocs[fileId] = await pdfjsLib.getDocument(new Uint8Array(rawPdfs[fileId].slice(0))).promise;
    }
    return pvPdfDocs[fileId];
}

/* Re-renders a grid thumbnail's canvas at the given rotation (scale matches createThumb) */
async function renderThumbCanvas(thumb, rotation) {
    const doc = await getPvDoc(thumb.dataset.fileId);
    const pg  = await doc.getPage(parseInt(thumb.dataset.originalPageIndex));
    const vp  = pg.getViewport({scale:.55, rotation});
    const c   = thumb.querySelector('canvas');
    c.width = vp.width; c.height = vp.height;
    // Reset inline styles so CSS (width:100%; height:auto) controls display
    c.style.width=''; c.style.height='';
    await pg.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
}

async function gridRotate(thumb,deg){
    const rot=(parseInt(thumb.dataset.rotation||0)+deg+360)%360;
    thumb.dataset.rotation=rot;
    const c=thumb.querySelector('canvas');
    c.style.opacity='.4';
    try { await renderThumbCanvas(thumb, rot); }
    finally {c.style.opacity='1';}
}

function doDelete(){
    const sel=document.querySelectorAll('.thumbnail-active');
    if(!sel.length||isConfirmingDelete)return;
    isConfirmingDelete=true;
    if(!confirm(sel.length>1?`Delete ${sel.length} pages?`:'Delete this page?')){isConfirmingDelete=false;return;}
    pushUndo();
    sel.forEach(t=>{bookmarks.delete(parseInt(t.dataset.pageIndex));t.remove();});
    saveBkm(); updatePageNumbers(); lastNode=null; isConfirmingDelete=false;
    if(!g('thumbnails-container').querySelectorAll('.thumb-item').length&&g('empty-state'))
        g('empty-state').style.display='flex';
}

async function doExtractSelected(){
    const sel=document.querySelectorAll('.thumbnail-active');
    if(!sel.length)return;
    const orig=g('btn-extract').innerHTML;
    g('btn-extract').innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>'; g('btn-extract').disabled=true;
    try {
        const {PDFDocument}=PDFLib;
        const dst=await PDFDocument.create(); const cache={};
        for(let t of sel){
            const fid=t.dataset.fileId,oi=parseInt(t.dataset.originalPageIndex)-1,rot=parseInt(t.dataset.rotation)||0;
            if(!cache[fid])cache[fid]=await PDFDocument.load(rawPdfs[fid].slice(0));
            const[cp]=await dst.copyPages(cache[fid],[oi]);
            cp.setRotation(PDFLib.degrees(rot)); dst.addPage(cp);
        }
        dlBlob(await dst.save(),getFilename()+'_Extracted.pdf');
        toast(`Extracted ${sel.length} page(s)`,'#059669');
    } catch(e){alert('Extract error: '+e.message);}
    finally{g('btn-extract').innerHTML=orig; g('btn-extract').disabled=false;}
}

async function doExport(){
    const thumbs=document.querySelectorAll('.thumb-item');
    if(!thumbs.length)return alert('No pages to export.');
    const orig=g('btn-export').innerHTML;
    g('btn-export').innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Exporting…'; g('btn-export').disabled=true;
    try {
        const {PDFDocument}=PDFLib;
        const dst=await PDFDocument.create(); const cache={};
        for(let t of thumbs){
            const fid=t.dataset.fileId,oi=parseInt(t.dataset.originalPageIndex)-1,rot=parseInt(t.dataset.rotation)||0;
            if(!cache[fid])cache[fid]=await PDFDocument.load(rawPdfs[fid].slice(0));
            const[cp]=await dst.copyPages(cache[fid],[oi]);
            cp.setRotation(PDFLib.degrees(rot)); dst.addPage(cp);
        }
        dlBlob(await dst.save(),getFilename()+'.pdf');
        toast('Exported successfully ✓');
    } catch(e){alert('Export error: '+e.message);}
    finally{g('btn-export').innerHTML=orig; g('btn-export').disabled=false;}
    closeAllPanels();
}

/* ─── BOOT ───────────────────────────────────────────────
   Run init LAST — after every top-level const/function (e.g.
   NAV_TITLES) is defined — to avoid a temporal-dead-zone
   ReferenceError during startup. */
init();
