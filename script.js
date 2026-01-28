/* --- VARIABLES --- */
const COLORS = ['#2563eb', '#10b981', '#ef4444', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];
let selectedColor = COLORS[0];

let storage = JSON.parse(localStorage.getItem('geojournal_v11')) || { pins: [], walks: [], theme: 'light', mapStyle: 'voyager', isMobile: false };
let currentMode = 'explore', tempPath = [], pendingCoords = null, activeSelectionId = null, currentRating = 0, isEditing = false, graphOpen = false;
let activeFilters = { type: 'all', sort: 'rating' };
let mapItems = new L.FeatureGroup(), userPos = null, userMarker = null, nodeHandles = [], waypointMarkers = [], chartInstance = null;
let elevationAbortController = null;
let isFirstLocationLoad = true; 

const map = L.map('map', { zoomControl: false }).setView([51.505, -0.09], 13);
mapItems.addTo(map);

const mapStyles = { 
    voyager: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', 
    dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    sat: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    topo: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    transit: 'https://tile.memomaps.de/tilegen/{z}/{x}/{y}.png'
};

let baseLayer = L.tileLayer(mapStyles[storage.mapStyle] || mapStyles.voyager).addTo(map);
let tempPoly = L.polyline([], {color: '#10b981', weight: 4, dashArray: '5, 10'}).addTo(map);

/* --- MOBILE PANEL LOGIC --- */
let startY = 0, startTop = 0, startTime = 0, isDragging = false;
const mobileSidebar = document.getElementById('sidebar');
const dragHandle = document.getElementById('mobileDragHandle');

function triggerHaptic() {
    if (window.navigator && window.navigator.vibrate) {
        window.navigator.vibrate(15);
    }
}

function snapTo(state) {
    mobileSidebar.style.transition = 'top 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
    const expandBtn = document.getElementById('expandBtn');

    if (state === 'open') {
        mobileSidebar.classList.remove('half', 'minimized');
        mobileSidebar.classList.add('open');
        mobileSidebar.style.top = '6vh';
        if (storage.isMobile) expandBtn.style.display = 'none';
    } else if (state === 'half') {
        mobileSidebar.classList.remove('open', 'minimized');
        mobileSidebar.classList.add('half');
        mobileSidebar.style.top = '50vh';
        if (storage.isMobile) expandBtn.style.display = 'none';
    } else if (state === 'bottom') {
        mobileSidebar.classList.remove('open', 'half', 'minimized');
        mobileSidebar.style.top = 'calc(100vh - 100px)';
        if (storage.isMobile) expandBtn.style.display = 'flex';
    } else if (state === 'closed') {
        mobileSidebar.classList.add('minimized');
        mobileSidebar.style.top = '100vh';
        if (storage.isMobile) expandBtn.style.display = 'flex';
    }
    triggerHaptic();
    resetSidebarScroll();
}

function cycleMobileSheet() {
    if (mobileSidebar.classList.contains('open')) snapTo('bottom');
    else if (mobileSidebar.classList.contains('half')) snapTo('open');
    else snapTo('half');
}

/* TOUCH EVENT HANDLERS (FULL PANEL) */
const handleTouchStart = (e) => {
    if (!document.body.classList.contains('mobile-mode')) return;
    const scrollArea = document.getElementById('mainScrollArea');
    if (scrollArea.scrollTop > 0 && mobileSidebar.classList.contains('open') && !e.target.closest('#mobileDragHandle')) return;
    
    startY = e.touches[0].clientY;
    startTop = mobileSidebar.offsetTop;
    startTime = Date.now();
    isDragging = false;
    mobileSidebar.style.transition = 'none';
};

const handleTouchMove = (e) => {
    if (!document.body.classList.contains('mobile-mode')) return;
    const touchY = e.touches[0].clientY;
    const deltaY = touchY - startY;
    
    if (deltaY < 0 && mobileSidebar.classList.contains('open')) return;
    if (Math.abs(deltaY) > 5) isDragging = true;
    
    let newTop = startTop + deltaY;
    const vh = window.innerHeight;
    if (newTop < vh * 0.06) newTop = vh * 0.06;
    mobileSidebar.style.top = newTop + 'px';
};

const handleTouchEnd = (e) => {
    if (!document.body.classList.contains('mobile-mode')) return;
    const duration = Date.now() - startTime;
    
    if (!isDragging && duration < 200 && (e.target.closest('#mobileDragHandle') || e.target.closest('.sidebar-header'))) {
        cycleMobileSheet();
        return;
    }
    if (!isDragging) return;

    const currentTop = mobileSidebar.offsetTop;
    const vh = window.innerHeight;
    if (currentTop < vh * 0.3) snapTo('open');
    else if (currentTop < vh * 0.7) snapTo('half');
    else snapTo('bottom');
};

mobileSidebar.addEventListener('touchstart', handleTouchStart, { passive: true });
mobileSidebar.addEventListener('touchmove', handleTouchMove, { passive: true });
mobileSidebar.addEventListener('touchend', handleTouchEnd);

/* --- APP INITIALIZATION --- */
if (storage.isMobile) {
    document.body.classList.add('mobile-mode');
    document.getElementById('deviceToggle').innerText = '🖥️';
    document.getElementById('expandBtn').style.display = 'none';
}

document.body.classList.add((storage.theme || 'light') + '-theme');
document.getElementById('themeToggle').checked = (storage.theme === 'dark');

function toggleDeviceMode() {
    storage.isMobile = !storage.isMobile;
    saveData();
    location.reload(); 
}

function resetSidebarScroll() {
    const area = document.getElementById('mainScrollArea');
    if (area) area.scrollTo({top: 0, behavior: 'smooth'});
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const expandBtn = document.getElementById('expandBtn');
    
    if (document.body.classList.contains('mobile-mode')) {
        if (sidebar.classList.contains('minimized') || sidebar.style.top === '100vh') {
            snapTo('bottom');
        } else {
            snapTo('closed');
        }
        return;
    }
    
    const isMinimized = sidebar.classList.toggle('minimized');
    expandBtn.style.display = isMinimized ? 'flex' : 'none';
    setTimeout(() => map.invalidateSize(), 400);
}

function goBack() {
    document.getElementById('backBtn').style.display = 'none';
    document.getElementById('minimizeBtn').style.display = 'flex';
    document.getElementById('mainTabs').style.display = 'flex';
    document.getElementById('detail-view').style.display = 'none';
    document.getElementById('mainSearch').style.display = 'block'; 
    closeElevation(); switchTab('explore');
    if(document.body.classList.contains('mobile-mode')) snapTo('open');
    resetSidebarScroll();
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const targetTab = document.getElementById(tab + 'Tab');
    if (targetTab) targetTab.classList.add('active');
    document.getElementById('explore-panel').style.display = (tab === 'explore' ? 'block' : 'none');
    document.getElementById('add-panel').style.display = (tab === 'add' ? 'block' : 'none');
    document.getElementById('settings-panel').style.display = (tab === 'settings' ? 'block' : 'none');
    document.getElementById('detail-view').style.display = 'none';
    document.getElementById('mainSearch').style.display = 'block'; 
    closeElevation(); setMode(tab === 'explore' ? 'explore' : 'ready');
    resetSidebarScroll();
}

/* --- MAP & DATA LOGIC --- */
function setFilter(category, value, btn) { activeFilters[category] = value; btn.parentElement.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); updateHighlights(); }
function setMode(mode) {
    currentMode = mode; document.querySelectorAll('.btn-main').forEach(b => b.classList.remove('active-mode'));
    if (document.getElementById(mode + 'ModeBtn')) document.getElementById(mode + 'ModeBtn').classList.add('active-mode');
    document.getElementById('route-stats').style.display = (mode === 'walk' ? 'block' : 'none');
    isEditing = false; nodeHandles.forEach(h => map.removeLayer(h));
    if(mode !== 'walk' && mode !== 'pin') { tempPath = []; tempPoly.setLatLngs([]); }
}

document.getElementById('pinModeBtn').onclick = () => { selectedColor = COLORS[0]; setupColorPickers(); setMode('pin'); };
document.getElementById('walkModeBtn').onclick = () => { selectedColor = COLORS[0]; setupColorPickers(); setMode('walk'); };

function updateHighlights() {
    const list = document.getElementById('highlights-list'); if (!list) return;
    let all = [...storage.pins.map(p => ({...p, type:'PIN'})), ...storage.walks.map(w => ({...w, type:'WALK', lat:w.path[0][0], lng:w.path[0][1]}))];
    if (activeFilters.type !== 'all') all = all.filter(i => i.type === activeFilters.type);
    if (userPos) all.forEach(i => i.d = L.latLng(i.lat, i.lng).distanceTo(userPos) / 1000);
    if (activeFilters.sort === 'rating') all.sort((a,b) => b.rating - a.rating); else all.sort((a,b) => (a.d || 0) - (b.d || 0));
    list.innerHTML = all.length ? '' : '<p style="font-size:12px;opacity:0.5;text-align:center;margin-top:20px;">Empty library.</p>';
    all.forEach(i => {
        const div = document.createElement('div'); div.className = 'highlight-item'; div.style.borderLeft = `4px solid ${i.color || '#2563eb'}`;
        div.innerHTML = `<img class="highlight-thumb" src="${i.photo || 'https://placehold.co/100x100?text=No+Photo'}"><div style="flex:1"><span class="type-label" style="background:${i.color || '#2563eb'}">${i.type}</span><p style="font-weight:bold;font-size:13px;margin:0;">${i.name}</p><div style="font-size:11px;color:#fbbf24;">${'★'.repeat(i.rating)} <span style="color:var(--text);opacity:0.5;">${i.d?i.d.toFixed(1)+'km':''}</span></div></div>`;
        div.onclick = () => { const obj = i.type === 'PIN' ? storage.pins.find(p=>p.id===i.id) : storage.walks.find(w=>w.id===i.id); 
            if(i.type === 'WALK' && obj.path) {
                const poly = L.polyline(obj.path);
                const bounds = poly.getBounds();
                const sidePadding = document.body.classList.contains('mobile-mode') ? 20 : (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar')) + 40);
                const bottomPadding = document.body.classList.contains('mobile-mode') ? (window.innerHeight / 2) : 40;
                map.flyToBounds(bounds, { paddingBottomRight: [sidePadding, bottomPadding], paddingTopLeft: [20, 20], duration: 1.5 });
            } else { map.flyTo([i.lat, i.lng], 15); }
            map.once('moveend', () => { 
                const layer = mapItems.getLayers().find(l => (i.type === 'WALK' && l instanceof L.Polyline && JSON.stringify(l.getLatLngs()[0]) === JSON.stringify(L.latLng(i.lat, i.lng))) || (i.type === 'PIN' && l instanceof L.Marker && l.getLatLng().equals(L.latLng(i.lat, i.lng)))); 
                showDetails(obj, i.type==='WALK', layer); 
            }); 
        };
        list.appendChild(div);
    });
}

map.on('click', (e) => {
    if (isUIPressed(e)) return;
    if (isEditing && window.currentActiveLayer instanceof L.Polyline) { const lls = window.currentActiveLayer.getLatLngs(); lls.push(e.latlng); window.currentActiveLayer.setLatLngs(lls); updateWalkStats(); createNodes(window.currentActiveLayer); fetchElevation(lls.map(l => [l.lat, l.lng]), false); return; }
    if (currentMode === 'pin') { pendingCoords = e.latlng; currentRating = 0; resetModal(); document.getElementById('modal-overlay').style.display = 'flex'; }
    if (currentMode === 'walk') { tempPath.push([e.latlng.lat, e.latlng.lng]); tempPoly.setLatLngs(tempPath); let d = 0; for(let i=1; i<tempPath.length; i++) d += L.latLng(tempPath[i-1]).distanceTo(L.latLng(tempPath[i])); document.getElementById('liveDist').innerText = `${(d/1000).toFixed(2)} km`; fetchElevation(tempPath, false); }
});

function resetModal() { document.getElementById('itemName').value = ''; document.getElementById('itemDesc').value = ''; currentRating = 0; document.querySelectorAll('#modalStars .star').forEach(s => s.style.color = '#cbd5e1'); setupColorPickers(); }

document.getElementById('confirmSaveBtn').onclick = async () => {
    const id = Date.now(), name = document.getElementById('itemName').value || "Untitled", desc = document.getElementById('itemDesc').value || "", rat = currentRating;
    let flat, flon;
    if (currentMode === 'pin') { flat = pendingCoords.lat; flon = pendingCoords.lng; const p = { id, name, desc, rating: rat, lat: flat, lng: flon, color: selectedColor }; storage.pins.push(p); addPin(p); }
    else { if (tempPath.length < 2) return; let d = 0; for(let i=1; i<tempPath.length; i++) d += L.latLng(tempPath[i-1]).distanceTo(L.latLng(tempPath[i])); flat = tempPath[0][0]; flon = tempPath[0][1]; const w = { id, name, desc, rating: rat, path: [...tempPath], dist: (d/1000).toFixed(2), lat: flat, lng: flon, color: selectedColor }; storage.walks.push(w); addWalk(w); }
    saveData(); document.getElementById('modal-overlay').style.display = 'none'; goBack(); fetchPhoto(flat, flon, id);
};

/* --- PHOTO & ELEVATION TOOLS --- */
async function fetchPhoto(lat, lon, id) {
    try {
        const res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gsradius=500&gscoord=${lat}|${lon}&format=json&origin=*`).then(r=>r.json());
        if(res.query?.geosearch?.length) {
            const title = res.query.geosearch[0].title;
            const imgRes = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&format=json&piprop=original&titles=${encodeURIComponent(title)}&pithumbsize=500&origin=*`).then(r=>r.json());
            const pg = Object.values(imgRes.query.pages)[0];
            if(pg.original) { let entry = storage.pins.find(x=>x.id===id) || storage.walks.find(x=>x.id===id); if(entry && !entry.photo) { entry.photo = pg.original.source; saveData(); updateHighlights(); } }
        }
    } catch(e){}
}

function addPin(p) { const pinIcon = L.divIcon({ className: 'custom-pin-marker', html: `<div class="pin-wrapper"><div class="pin-shape" style="background:${p.color || '#2563eb'}"></div></div>`, iconSize: [30, 30], iconAnchor: [15, 30] }); L.marker([p.lat, p.lng], {icon: pinIcon, zIndexOffset: 1000}).addTo(mapItems).on('click', (e) => { L.DomEvent.stopPropagation(e); showDetails(p, false, e.target); }); }
function addWalk(w) { 
    const poly = L.polyline(w.path, {color: w.color || '#2563eb', weight:5, zIndex: 500}).addTo(mapItems); 
    poly.on('click', (e) => { 
        L.DomEvent.stopPropagation(e); 
        const bounds = e.target.getBounds();
        const sidePadding = document.body.classList.contains('mobile-mode') ? 20 : (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar')) + 40);
        const bottomPadding = document.body.classList.contains('mobile-mode') ? (window.innerHeight / 2) : 40;
        map.flyToBounds(bounds, { paddingBottomRight: [sidePadding, bottomPadding], paddingTopLeft: [20, 20], duration: 1.5 });
        map.once('moveend', () => showDetails(w, true, e.target)); 
    }); 
}

function refreshMapItems() { mapItems.clearLayers(); storage.pins.forEach(addPin); storage.walks.forEach(addWalk); updateHighlights(); }

function showDetails(item, isWalk, layer) {
    if (!item) return;
    activeSelectionId = item.id; isEditing = false; graphOpen = false; selectedColor = item.color || COLORS[0];
    document.getElementById('editColorContainer').style.display = 'none'; document.getElementById('explore-panel').style.display = 'none'; document.getElementById('add-panel').style.display = 'none'; document.getElementById('settings-panel').style.display = 'none'; document.getElementById('mainTabs').style.display = 'none'; document.getElementById('mainSearch').style.display = 'none'; 
    document.getElementById('backBtn').style.display = 'flex'; document.getElementById('minimizeBtn').style.display = 'none';
    document.getElementById('detail-view').style.display = 'flex';
    if(document.body.classList.contains('mobile-mode')) snapTo('half');
    document.getElementById('detPhoto').src = item.photo || "https://placehold.co/500x300?text=No+Photo";
    document.getElementById('editTitle').value = item.name; document.getElementById('editDesc').value = item.desc || "";
    renderStars(item);
    if (isWalk) { window.currentActiveLayer = layer; updateWalkStats(); fetchElevation(item.path, false); }
    resetSidebarScroll();
}

/* ... Other existing logic (fetchElevation, setupColorPickers, triggerHaptic, etc) ... */

function isUIPressed(e) { return e.originalEvent.target.closest('#sidebar') || e.originalEvent.target.closest('#elevation-dock') || e.originalEvent.target.closest('.zoom-controls') || e.originalEvent.target.closest('#layer-popup') || e.originalEvent.target.closest('#expandBtn'); }
function saveData() { localStorage.setItem('geojournal_v11', JSON.stringify(storage)); }

document.getElementById('themeToggle').onchange = (e) => { 
    const newTheme = e.target.checked ? 'dark' : 'light';
    const oldTheme = storage.theme;
    storage.theme = newTheme; 
    document.body.classList.remove(oldTheme + '-theme');
    document.body.classList.add(newTheme + '-theme');
    saveData(); 
};

document.getElementById('locateBtn').onclick = (e) => { L.DomEvent.stopPropagation(e); if (userPos) map.setView(userPos, 15); };
document.getElementById('finishWalkBtn').onclick = () => { setupColorPickers(); resetModal(); document.getElementById('modal-overlay').style.display = 'flex'; };

refreshMapItems(); updateHighlights(); switchTab('explore');
