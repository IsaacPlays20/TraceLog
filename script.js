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

if (storage.isMobile) {
    document.body.classList.add('mobile-mode');
    document.getElementById('deviceToggle').innerText = '🖥️';
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

/* HYBRID MOBILE DRAGGING AND CLICKING LOGIC */
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
    if (state === 'open') {
        mobileSidebar.classList.remove('half');
        mobileSidebar.classList.add('open');
        mobileSidebar.style.top = '6vh';
    } else if (state === 'half') {
        mobileSidebar.classList.remove('open');
        mobileSidebar.classList.add('half');
        mobileSidebar.style.top = '50vh';
    } else {
        mobileSidebar.classList.remove('open', 'half');
        mobileSidebar.style.top = 'calc(100vh - 85px)';
    }
    triggerHaptic();
    resetSidebarScroll();
}

function cycleMobileSheet() {
    if (mobileSidebar.classList.contains('open')) snapTo('bottom');
    else if (mobileSidebar.classList.contains('half')) snapTo('open');
    else snapTo('half');
}

if (dragHandle) {
    dragHandle.addEventListener('touchstart', (e) => {
        if (!document.body.classList.contains('mobile-mode')) return;
        startY = e.touches[0].clientY;
        startTop = mobileSidebar.offsetTop;
        startTime = Date.now();
        isDragging = false;
        mobileSidebar.style.transition = 'none';
    }, { passive: true });

    dragHandle.addEventListener('touchmove', (e) => {
        if (!document.body.classList.contains('mobile-mode')) return;
        const touchY = e.touches[0].clientY;
        const deltaY = touchY - startY;
        if (Math.abs(deltaY) > 5) isDragging = true;
        let newTop = startTop + deltaY;
        const vh = window.innerHeight;
        if (newTop < vh * 0.06) newTop = vh * 0.06;
        if (newTop > vh - 85) newTop = vh - 85;
        mobileSidebar.style.top = newTop + 'px';
    }, { passive: true });

    dragHandle.addEventListener('touchend', (e) => {
        if (!document.body.classList.contains('mobile-mode')) return;
        const duration = Date.now() - startTime;
        if (!isDragging && duration < 200) {
            cycleMobileSheet();
            return;
        }
        const currentTop = mobileSidebar.offsetTop;
        const vh = window.innerHeight;
        if (currentTop < vh * 0.3) snapTo('open');
        else if (currentTop < vh * 0.7) snapTo('half');
        else snapTo('bottom');
    });

    dragHandle.addEventListener('click', (e) => {
        if (document.body.classList.contains('mobile-mode')) {
            cycleMobileSheet();
        }
    });
}

if (navigator.geolocation) {
    navigator.geolocation.watchPosition((position) => {
        const latlng = L.latLng(position.coords.latitude, position.coords.longitude);
        userPos = latlng;
        if (!userMarker) {
            userMarker = L.marker(latlng, { icon: L.divIcon({ className: '', html: '<div class="gps-indicator-wrapper"><div class="gps-indicator"></div><div class="gps-pulse"></div></div>', iconSize: [14, 14], iconAnchor: [7, 7] }) }).addTo(map);
        } else { userMarker.setLatLng(latlng); }
        if (isFirstLocationLoad) { map.setView(latlng, 15); isFirstLocationLoad = false; }
        updateHighlights();
    }, (error) => console.error(error), { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 });
}

function setupColorPickers() {
    ['modalColorPicker', 'detailColorPicker'].forEach(id => {
        const el = document.getElementById(id); if (!el) return;
        el.innerHTML = '';
        COLORS.forEach(c => {
            const dot = document.createElement('div'); dot.className = 'color-dot';
            dot.style.backgroundColor = c; if(c === selectedColor) dot.classList.add('active');
            dot.onclick = () => {
                selectedColor = c; document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active')); dot.classList.add('active');
                if(id === 'detailColorPicker' && isEditing) {
                    const item = storage.pins.find(p=>p.id===activeSelectionId) || storage.walks.find(w=>w.id===activeSelectionId);
                    if(item) { item.color = c; saveData(); refreshMapItems(); }
                }
            }; el.appendChild(dot);
        });
    });
}

function toggleLayerMenu() { const menu = document.getElementById('layer-popup'); menu.style.display = menu.style.display === 'flex' ? 'none' : 'flex'; }
function setMapLayer(style) { storage.mapStyle = style; map.removeLayer(baseLayer); baseLayer = L.tileLayer(mapStyles[style], { maxZoom: 18 }).addTo(map); saveData(); document.getElementById('layer-popup').style.display = 'none'; }
function isUIPressed(e) { return e.originalEvent.target.closest('#sidebar') || e.originalEvent.target.closest('#elevation-dock') || e.originalEvent.target.closest('.zoom-controls') || e.originalEvent.target.closest('#layer-popup') || e.originalEvent.target.closest('#expandBtn'); }

const locateBtn = document.getElementById('locateBtn');
if (locateBtn) locateBtn.onclick = (e) => { L.DomEvent.stopPropagation(e); if (userPos) map.setView(userPos, 15); };

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const expandBtn = document.getElementById('expandBtn');
    const dock = document.getElementById('elevation-dock');
    if(document.body.classList.contains('mobile-mode')) { sidebar.classList.remove('open', 'half'); return; }
    const isMinimized = sidebar.classList.toggle('minimized');
    expandBtn.style.display = isMinimized ? 'flex' : 'none';
    if (isMinimized) { dock.style.left = '20px'; } else { dock.style.left = 'calc(var(--sidebar) + 20px)'; }
    setTimeout(() => map.invalidateSize(), 400);
}

function goBack() {
    document.getElementById('backBtn').style.display = 'none';
    document.getElementById('minimizeBtn').style.display = 'flex';
    document.getElementById('mainTabs').style.display = 'flex';
    document.getElementById('detail-view').style.display = 'none';
    document.getElementById('mainSearch').style.display = 'block'; 
    closeElevation(); switchTab('explore');
    if(document.body.classList.contains('mobile-mode')) { 
        snapTo('open');
    }
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

function setFilter(category, value, btn) { activeFilters[category] = value; btn.parentElement.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); updateHighlights(); }

function setMode(mode) {
    currentMode = mode; document.querySelectorAll('.btn-main').forEach(b => b.classList.remove('active-mode'));
    if (document.getElementById(mode + 'ModeBtn')) document.getElementById(mode + 'ModeBtn').classList.add('active-mode');
    document.getElementById('route-stats').style.display = (mode === 'walk' ? 'block' : 'none');
    isEditing = false; nodeHandles.forEach(h => map.removeLayer(h));
    if(mode !== 'walk' && mode !== 'pin') { tempPath = []; tempPoly.setLatLngs([]); }
}

const pinModeBtn = document.getElementById('pinModeBtn');
const walkModeBtn = document.getElementById('walkModeBtn');
if (pinModeBtn) pinModeBtn.onclick = () => { selectedColor = COLORS[0]; setupColorPickers(); setMode('pin'); };
if (walkModeBtn) walkModeBtn.onclick = () => { selectedColor = COLORS[0]; setupColorPickers(); setMode('walk'); };

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

const confirmSaveBtn = document.getElementById('confirmSaveBtn');
if (confirmSaveBtn) confirmSaveBtn.onclick = async () => {
    const id = Date.now(), name = document.getElementById('itemName').value || "Untitled", desc = document.getElementById('itemDesc').value || "", rat = currentRating;
    let flat, flon;
    if (currentMode === 'pin') { flat = pendingCoords.lat; flon = pendingCoords.lng; const p = { id, name, desc, rating: rat, lat: flat, lng: flon, color: selectedColor }; storage.pins.push(p); addPin(p); }
    else { if (tempPath.length < 2) return; let d = 0; for(let i=1; i<tempPath.length; i++) d += L.latLng(tempPath[i-1]).distanceTo(L.latLng(tempPath[i])); flat = tempPath[0][0]; flon = tempPath[0][1]; const w = { id, name, desc, rating: rat, path: [...tempPath], dist: (d/1000).toFixed(2), lat: flat, lng: flon, color: selectedColor }; storage.walks.push(w); addWalk(w); }
    saveData(); document.getElementById('modal-overlay').style.display = 'none'; goBack(); fetchPhoto(flat, flon, id);
};

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
    if (elevationAbortController) { elevationAbortController.abort(); elevationAbortController = null; }
    activeSelectionId = item.id; isEditing = false; graphOpen = false; selectedColor = item.color || COLORS[0];
    document.getElementById('editColorContainer').style.display = 'none'; document.getElementById('explore-panel').style.display = 'none'; document.getElementById('add-panel').style.display = 'none'; document.getElementById('settings-panel').style.display = 'none'; document.getElementById('mainTabs').style.display = 'none'; document.getElementById('mainSearch').style.display = 'none'; 
    document.getElementById('backBtn').style.display = 'flex'; document.getElementById('minimizeBtn').style.display = 'none';
    document.getElementById('detail-view').style.display = 'flex';
    if(document.body.classList.contains('mobile-mode')) { 
        snapTo('half');
    }
    const floatEdit = document.getElementById('floatEditBtn'); floatEdit.innerHTML = '🖋️'; floatEdit.classList.remove('is-editing');
    document.getElementById('floatDeleteBtn').style.display = 'none'; document.getElementById('floatUploadBtn').style.display = 'none';
    document.getElementById('detPhoto').src = item.photo || "https://placehold.co/500x300?text=No+Photo";
    document.getElementById('editTitle').value = item.name; document.getElementById('editDesc').value = item.desc || "";
    document.querySelectorAll('.edit-input').forEach(i=>i.classList.remove('active'));
    renderStars(item); waypointMarkers.forEach(m => map.removeLayer(m)); waypointMarkers = [];
    if (isWalk) { document.getElementById('elevation-dock').classList.remove('active'); window.currentActiveLayer = layer; updateWalkStats(); fetchElevation(item.path, false); updateWalkWaypoints(); }
    else { document.getElementById('detStats').innerHTML = ``; closeElevation(); window.currentActiveLayer = null; }
    nodeHandles.forEach(h=>map.removeLayer(h));
    resetSidebarScroll();
}

function updateWalkWaypoints() {
    waypointMarkers.forEach(m => map.removeLayer(m)); waypointMarkers = [];
    const item = storage.walks.find(w => w.id === activeSelectionId);
    if(item && item.path.length > 0) {
        const startPt = item.path[0]; const endPt = item.path[item.path.length-1];
        waypointMarkers.push(L.marker(startPt, { icon: L.divIcon({ className: 'walk-marker-icon start-icon', html: '▶', iconSize: [24, 24], iconAnchor: [12, 12] }), zIndexOffset: 2000 }).addTo(map));
        waypointMarkers.push(L.marker(endPt, { icon: L.divIcon({ className: 'walk-marker-icon end-icon', html: '🏁', iconSize: [24, 24], iconAnchor: [12, 12] }), zIndexOffset: 2000 }).addTo(map));
    }
}

function toggleGraph() {
    const item = storage.walks.find(w => w.id === activeSelectionId); if (!item) return;
    graphOpen = !graphOpen; const btn = document.querySelector('.elev-toggle-btn');
    if(btn) btn.innerHTML = graphOpen ? '📉 Hide elevation graph' : '📈 Show elevation graph';
    if (graphOpen) { if(document.body.classList.contains('mobile-mode')) { document.getElementById('sidebar').classList.add('hidden-sheet'); } fetchElevation(item.path, true); } else { closeElevation(); }
}

function updateWalkStats() {
    const layer = window.currentActiveLayer; const item = storage.walks.find(w => w.id === activeSelectionId); if(!item) return;
    let d = 0; if (layer) { const lls = layer.getLatLngs(); for(let j=1; j<lls.length; j++) d += lls[j-1].distanceTo(lls[j]); item.dist = (d/1000).toFixed(2); item.path = lls.map(l => [l.lat, l.lng]); } else d = parseFloat(item.dist) * 1000;
    const paceKmH = 3; const totalMins = Math.round((d / 1000) / paceKmH * 60); let hours = Math.floor(totalMins / 60), mins = totalMins % 60;
    let ascent = 0, descent = 0, minE = 0, maxE = 0;
    if(item.elevData && item.elevData.length > 0) {
        minE = Math.round(Math.min(...item.elevData)); maxE = Math.round(Math.max(...item.elevData));
        for(let i=1; i<item.elevData.length; i++) { let diff = item.elevData[i] - item.elevData[i-1]; if(diff > 0) ascent += diff; else descent += Math.abs(diff); }
    }
    document.getElementById('detStats').innerHTML = `<div class="stats-grid"><div class="stat-card"><span class="stat-label">Length</span><span class="stat-value">${item.dist} km</span></div><div class="stat-card"><span class="stat-label">Est. Time</span><span class="stat-value">${hours > 0 ? hours + 'h ' : ''}${mins}m</span></div><div class="stat-card-dual"><div class="dual-row"><span class="stat-sub-label">Total Climb</span><span class="stat-sub-value">${Math.round(ascent)}m</span></div><div class="dual-divider"></div><div class="dual-row"><span class="stat-sub-label">Total Descent</span><span class="stat-sub-value">${Math.round(descent)}m</span></div></div><div class="stat-card-dual"><div class="dual-row"><span class="stat-sub-label">Min Height</span><span class="stat-sub-value">${minE}m</span></div><div class="dual-divider"></div><div class="dual-row"><span class="stat-sub-label">Max Height</span><span class="stat-sub-value">${maxE}m</span></div></div><button class="icon-btn elev-toggle-btn" onclick="toggleGraph()">${graphOpen ? '📉 Hide elevation graph' : '📈 Show elevation graph'}</button></div>`;
    updateWalkWaypoints(); saveData();
}

function renderStars(item) {
    const rDiv = document.getElementById('detRating'); rDiv.innerHTML = "";
    for(let i=1; i<=5; i++) { const s = document.createElement('span'); s.innerText = i <= item.rating ? '★' : '☆'; s.onclick = () => { if(isEditing) { item.rating = i; renderStars(item); saveData(); } }; rDiv.appendChild(s); }
}

function toggleEditingLogic() {
    isEditing = !isEditing; const editBtn = document.getElementById('floatEditBtn'); editBtn.innerHTML = isEditing ? '✅' : '🖋️'; editBtn.classList.toggle('is-editing', isEditing);
    document.getElementById('floatDeleteBtn').style.display = isEditing ? 'flex' : 'none'; document.getElementById('floatUploadBtn').style.display = isEditing ? 'flex' : 'none'; document.getElementById('editColorContainer').style.display = isEditing ? 'block' : 'none';
    if(isEditing) setupColorPickers();
    document.querySelectorAll('.edit-input').forEach(inp => inp.classList.toggle('active', isEditing));
    if(isEditing && window.currentActiveLayer instanceof L.Polyline) { createNodes(window.currentActiveLayer); } 
    else { nodeHandles.forEach(h=>map.removeLayer(h)); nodeHandles = []; }
    const item = storage.pins.find(p=>p.id===activeSelectionId) || storage.walks.find(w=>w.id===activeSelectionId);
    document.getElementById('editTitle').oninput = () => { item.name = document.getElementById('editTitle').value; saveData(); updateHighlights(); };
    document.getElementById('editDesc').oninput = () => { item.desc = document.getElementById('editDesc').value; saveData(); };
}

const floatEditBtn = document.getElementById('floatEditBtn');
if (floatEditBtn) floatEditBtn.onclick = toggleEditingLogic;

function createNodes(layer) {
    nodeHandles.forEach(h => map.removeLayer(h)); nodeHandles = []; const latlngs = layer.getLatLngs();
    latlngs.forEach((ll, i) => {
        let moved = false; const isStartOrEnd = (i === 0 || i === latlngs.length - 1);
        const handleClass = isStartOrEnd ? 'node-handle node-handle-hidden' : 'node-handle node-handle-visible';
        const m = L.marker(ll, { draggable: true, icon: L.divIcon({ className: handleClass, iconSize:[isStartOrEnd?30:16, isStartOrEnd?30:16], iconAnchor:[isStartOrEnd?15:8, isStartOrEnd?15:8] }), zIndexOffset: 10000 }).addTo(map);
        m.on('drag', (e) => { moved = true; const currentLls = layer.getLatLngs(); currentLls[i] = e.target.getLatLng(); layer.setLatLngs(currentLls); updateWalkStats(); });
        m.on('dragend', () => { createNodes(layer); fetchElevation(layer.getLatLngs().map(l => [l.lat, l.lng]), false); });
        m.on('click', (e) => { L.DomEvent.stopPropagation(e); if (!moved && layer.getLatLngs().length > 2) { const currentLls = layer.getLatLngs(); currentLls.splice(i, 1); layer.setLatLngs(currentLls); updateWalkStats(); createNodes(layer); fetchElevation(currentLls.map(l => [l.lat, l.lng]), false); } });
        nodeHandles.push(m);
        if (i < latlngs.length - 1) {
            const mid = L.latLng((ll.lat + latlngs[i+1].lat) / 2, (ll.lng + latlngs[i+1].lng) / 2);
            const midH = L.marker(mid, { draggable: true, icon: L.divIcon({ className:'mid-handle mid-handle-visible', iconSize:[12,12], iconAnchor:[6,6] }), zIndexOffset: 9000 }).addTo(map);
            midH.on('dragstart', (e) => { const currentLls = layer.getLatLngs(); currentLls.splice(i + 1, 0, e.target.getLatLng()); layer.setLatLngs(currentLls); });
            midH.on('drag', (e) => { const currentLls = layer.getLatLngs(); currentLls[i + 1] = e.target.getLatLng(); layer.setLatLngs(currentLls); updateWalkStats(); });
            midH.on('dragend', () => { createNodes(layer); fetchElevation(layer.getLatLngs().map(l => [l.lat, l.lng]), false); });
            nodeHandles.push(midH);
        }
    });
}

async function fetchElevation(path, forceOpen) {
    if (elevationAbortController) elevationAbortController.abort(); elevationAbortController = new AbortController(); const signal = elevationAbortController.signal;
    try {
        let sampledPoints = [];
        for (let i = 0; i < path.length - 1; i++) {
            const start = L.latLng(path[i]), end = L.latLng(path[i+1]), dist = start.distanceTo(end); sampledPoints.push(start);
            const numSteps = Math.floor(dist / 100); for (let j = 1; j <= numSteps; j++) { const ratio = (j * 100) / dist; sampledPoints.push(L.latLng(start.lat + (end.lat - start.lat) * ratio, start.lng + (end.lng - start.lng) * ratio)); }
        }
        sampledPoints.push(L.latLng(path[path.length - 1]));
        const res = await fetch('https://api.open-elevation.com/api/v1/lookup', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ locations: sampledPoints.map(p => ({ latitude: p.lat, longitude: p.lng })) }), signal: signal }).then(r=>r.json());
        const elevs = res.results.map(r => r.elevation); const item = storage.walks.find(w => w.id === activeSelectionId);
        if(item && (item.id === activeSelectionId || isEditing)) { 
            item.elevData = elevs; 
            if (graphOpen || forceOpen) {
                let currentTotal = 0, distData = [0]; for(let i = 1; i < sampledPoints.length; i++){ currentTotal += sampledPoints[i-1].distanceTo(sampledPoints[i]); distData.push(currentTotal / 1000); }
                let labels = distData.map(d => (Math.round(d * 10) / 10).toFixed(1));
                document.getElementById('elevation-dock').classList.add('active');
                const ctx = document.getElementById('elevChart').getContext('2d'); if(chartInstance) chartInstance.destroy();
                chartInstance = new Chart(ctx, { type:'line', data:{ labels: labels, datasets:[{ data:elevs, borderColor:'#2563eb', backgroundColor: 'rgba(37, 99, 235, 0.15)', fill:true, pointRadius:0, borderWidth: 2, tension:0.4, cubicInterpolationMode: 'monotone' }] }, options:{ maintainAspectRatio:false, plugins:{ legend:{display:false} }, scales:{ x:{ title:{display:true, text:'km'} }, y:{ title:{display:true, text:'m'}, position:'right' } } } });
            }
            updateWalkStats(); 
        }
    } catch(e) { if (e.name !== 'AbortError') console.error(e); }
}

const closeElevBtn = document.getElementById('closeElevBtn');
if (closeElevBtn) closeElevBtn.onclick = (e) => { L.DomEvent.stopPropagation(e); graphOpen = false; closeElevation(); updateWalkStats(); };

function closeElevation() { document.getElementById('elevation-dock').classList.remove('active'); if(document.body.classList.contains('mobile-mode')) { document.getElementById('sidebar').classList.remove('hidden-sheet'); } if(chartInstance) { chartInstance.destroy(); chartInstance = null; } if (elevationAbortController) { elevationAbortController.abort(); elevationAbortController = null; } const btn = document.querySelector('.elev-toggle-btn'); if(btn) btn.innerHTML = '📈 Show elevation graph'; }
function saveData() { localStorage.setItem('geojournal_v11', JSON.stringify(storage)); }
function deleteAction() { if(confirm("Delete this entry?")){ storage.pins = storage.pins.filter(p => p.id !== activeSelectionId); storage.walks = storage.walks.filter(w => w.id !== activeSelectionId); saveData(); refreshMapItems(); goBack(); } }

const floatDeleteBtn = document.getElementById('floatDeleteBtn');
if (floatDeleteBtn) floatDeleteBtn.onclick = deleteAction;

const themeToggle = document.getElementById('themeToggle');
if (themeToggle) themeToggle.onchange = (e) => { 
    const newTheme = e.target.checked ? 'dark' : 'light';
    const oldTheme = storage.theme;
    storage.theme = newTheme; 
    document.body.classList.remove(oldTheme + '-theme');
    document.body.classList.add(newTheme + '-theme');
    saveData(); 
};

const mainSearch = document.getElementById('mainSearch');
if (mainSearch) mainSearch.onkeypress = (e) => { if(e.key==='Enter') fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${e.target.value}`).then(r=>r.json()).then(d=>d.length && map.flyTo([d[0].lat, d[0].lon], 15)); };

const modalStars = document.getElementById('modalStars');
if (modalStars) modalStars.onclick = (e) => { if(e.target.dataset.value) { currentRating = parseInt(e.target.dataset.value); document.querySelectorAll('#modalStars .star').forEach(s => s.style.color = s.dataset.value <= currentRating ? '#fbbf24' : '#cbd5e1'); } };

const finishWalkBtn = document.getElementById('finishWalkBtn');
if (finishWalkBtn) finishWalkBtn.onclick = () => { selectedColor = COLORS[0]; setupColorPickers(); resetModal(); document.getElementById('modal-overlay').style.display = 'flex'; };

refreshMapItems(); updateHighlights(); switchTab('explore');
