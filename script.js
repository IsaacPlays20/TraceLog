let storage = JSON.parse(localStorage.getItem('geojournal_v11')) || { pins: [], walks: [], theme: 'light', mapStyle: 'voyager' };
let currentMode = 'explore', tempPath = [], pendingCoords = null, activeSelectionId = null, currentRating = 0, isEditing = false;
let activeFilters = { type: 'all', sort: 'rating' };
let mapItems = new L.FeatureGroup(), userPos = null, userMarker = null, nodeHandles = [], waypointMarkers = [], chartInstance = null;
let elevationAbortController = null;

const map = L.map('map', { zoomControl: false }).setView([51.505, -0.09], 13);
mapItems.addTo(map);

const mapStyles = { 
    voyager: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', 
    dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    sat: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    topo: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png'
};

let baseLayer = L.tileLayer(mapStyles[storage.mapStyle] || mapStyles.voyager).addTo(map);
let tempPoly = L.polyline([], {color: '#10b981', weight: 4, dashArray: '5, 10'}).addTo(map);

document.body.className = (storage.theme || 'light') + '-theme';
document.getElementById('themeToggle').checked = (storage.theme === 'dark');
document.getElementById('mapStyleSelect').value = storage.mapStyle || 'voyager';

map.on('locationfound', (e) => {
    userPos = e.latlng;
    if (!userMarker) {
        userMarker = L.marker(e.latlng, { 
            icon: L.divIcon({ className: '', html: '<div class="gps-indicator-wrapper"><div class="gps-indicator"></div><div class="gps-pulse"></div></div>', iconSize: [14, 14], iconAnchor: [7, 7] }) 
        }).addTo(map);
    } else userMarker.setLatLng(e.latlng);
    updateHighlights();
});
map.locate({ setView: false, watch: false });

document.getElementById('locateBtn').onclick = () => {
    if (userPos) map.setView(userPos, 15);
    else map.locate({setView: true, maxZoom: 15});
};

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const expandBtn = document.getElementById('expandBtn');
    const dock = document.getElementById('elevation-dock');
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
    document.getElementById('reopenGraphBtn').style.display = 'none';
    closeElevation(); 
    switchTab('explore');
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(tab + 'Tab').classList.add('active');
    document.getElementById('explore-panel').style.display = (tab === 'explore' ? 'block' : 'none');
    document.getElementById('add-panel').style.display = (tab === 'add' ? 'block' : 'none');
    document.getElementById('settings-panel').style.display = (tab === 'settings' ? 'block' : 'none');
    document.getElementById('detail-view').style.display = 'none';
    closeElevation(); 
    setMode(tab === 'explore' ? 'explore' : 'ready');
}

function setFilter(category, value, btn) {
    activeFilters[category] = value;
    btn.parentElement.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateHighlights();
}

function setMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.btn-main').forEach(b => b.classList.remove('active-mode'));
    if (document.getElementById(mode + 'ModeBtn')) document.getElementById(mode + 'ModeBtn').classList.add('active-mode');
    document.getElementById('route-stats').style.display = (mode === 'walk' ? 'block' : 'none');
    isEditing = false; nodeHandles.forEach(h => map.removeLayer(h));
    if(mode !== 'walk' && mode !== 'pin') { tempPath = []; tempPoly.setLatLngs([]); }
}

document.getElementById('pinModeBtn').onclick = () => setMode('pin');
document.getElementById('walkModeBtn').onclick = () => setMode('walk');

function updateHighlights() {
    const list = document.getElementById('highlights-list');
    if (list) {
        let all = [...storage.pins.map(p => ({...p, type:'PIN'})), ...storage.walks.map(w => ({...w, type:'WALK', lat:w.path[0][0], lng:w.path[0][1]}))];
        if (activeFilters.type !== 'all') all = all.filter(i => i.type === activeFilters.type);
        if (userPos) all.forEach(i => i.d = L.latLng(i.lat, i.lng).distanceTo(userPos) / 1000);
        if (activeFilters.sort === 'rating') all.sort((a,b) => b.rating - a.rating);
        else all.sort((a,b) => (a.d || 0) - (b.d || 0));
        list.innerHTML = all.length ? '' : '<p style="font-size:12px;opacity:0.5;text-align:center;margin-top:20px;">Empty library.</p>';
        all.forEach(i => {
            const div = document.createElement('div'); div.className = 'highlight-item';
            div.innerHTML = `<img class="highlight-thumb" src="${i.photo || 'https://placehold.co/100x100?text=No+Photo'}">
                <div style="flex:1"><span class="type-label">${i.type}</span><p style="font-weight:bold;font-size:13px;margin:0;">${i.name}</p><div style="font-size:11px;color:#fbbf24;">${'★'.repeat(i.rating)} <span style="color:var(--text);opacity:0.5;">${i.d?i.d.toFixed(1)+'km away':''}</span></div></div>`;
            div.onclick = () => {
                const obj = i.type === 'PIN' ? storage.pins.find(p=>p.id===i.id) : storage.walks.find(w=>w.id===i.id);
                map.flyTo([i.lat, i.lng], 15);
                map.once('moveend', () => {
                    const layer = mapItems.getLayers().find(l => (i.type === 'WALK' && l instanceof L.Polyline && JSON.stringify(l.getLatLngs()[0]) === JSON.stringify(L.latLng(i.lat, i.lng))) || (i.type === 'PIN' && l instanceof L.Marker && l.getLatLng().equals(L.latLng(i.lat, i.lng))));
                    showDetails(obj, i.type==='WALK', layer);
                });
            };
            list.appendChild(div);
        });
    }
}

map.on('click', (e) => {
    if (isEditing && window.currentActiveLayer instanceof L.Polyline) {
        const lls = window.currentActiveLayer.getLatLngs(); lls.push(e.latlng);
        window.currentActiveLayer.setLatLngs(lls); updateWalkStats(); createNodes(window.currentActiveLayer); 
        fetchElevation(lls.map(l => [l.lat, l.lng])); return;
    }
    if (currentMode === 'pin') { pendingCoords = e.latlng; currentRating = 0; resetModal(); document.getElementById('modal-overlay').style.display = 'flex'; }
    if (currentMode === 'walk') { tempPath.push([e.latlng.lat, e.latlng.lng]); tempPoly.setLatLngs(tempPath); let d = 0; for(let i=1; i<tempPath.length; i++) d += L.latLng(tempPath[i-1]).distanceTo(L.latLng(tempPath[i])); document.getElementById('liveDist').innerText = `${(d/1000).toFixed(2)} km`; fetchElevation(tempPath); }
});

function resetModal() {
    document.getElementById('itemName').value = ''; document.getElementById('itemDesc').value = ''; currentRating = 0;
    document.querySelectorAll('#modalStars .star').forEach(s => s.style.color = '#cbd5e1');
}

document.getElementById('confirmSaveBtn').onclick = async () => {
    const id = Date.now(), name = document.getElementById('itemName').value || "Untitled", desc = document.getElementById('itemDesc').value || "", rat = currentRating;
    let flat, flon;
    if (currentMode === 'pin') {
        flat = pendingCoords.lat; flon = pendingCoords.lng;
        const p = { id, name, desc, rating: rat, lat: flat, lng: flon };
        storage.pins.push(p); addPin(p);
    } else {
        if (tempPath.length < 2) return;
        let d = 0; for(let i=1; i<tempPath.length; i++) d += L.latLng(tempPath[i-1]).distanceTo(L.latLng(tempPath[i]));
        flat = tempPath[0][0]; flon = tempPath[0][1];
        const w = { id, name, desc, rating: rat, path: [...tempPath], dist: (d/1000).toFixed(2), lat: flat, lng: flon };
        storage.walks.push(w); addWalk(w);
    }
    saveData(); document.getElementById('modal-overlay').style.display = 'none'; goBack();
    fetchPhoto(flat, flon, id);
};

async function fetchPhoto(lat, lon, id) {
    try {
        const res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gsradius=500&gscoord=${lat}|${lon}&format=json&origin=*`).then(r=>r.json());
        if(res.query?.geosearch?.length) {
            const title = res.query.geosearch[0].title;
            const imgRes = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&format=json&piprop=original&titles=${encodeURIComponent(title)}&pithumbsize=500&origin=*`).then(r=>r.json());
            const pg = Object.values(imgRes.query.pages)[0];
            if(pg.original) {
                let entry = storage.pins.find(x=>x.id===id) || storage.walks.find(x=>x.id===id);
                if(entry && !entry.photo) { entry.photo = pg.original.source; saveData(); updateHighlights(); }
            }
        }
    } catch(e){}
}

document.getElementById('photoInput').onchange = function(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function(event) {
        const item = storage.pins.find(p=>p.id===activeSelectionId) || storage.walks.find(w=>w.id===activeSelectionId);
        if (item) { item.photo = event.target.result; saveData(); document.getElementById('detPhoto').src = item.photo; updateHighlights(); }
    };
    reader.readAsDataURL(file);
};

function addPin(p) { L.marker([p.lat, p.lng]).addTo(mapItems).on('click', (e) => { L.DomEvent.stopPropagation(e); showDetails(p, false, e.target); }); }
function addWalk(w) { 
    const poly = L.polyline(w.path, {color:'#2563eb', weight:5}).addTo(mapItems);
    poly.on('click', (e) => { 
        L.DomEvent.stopPropagation(e); map.flyTo(e.target.getCenter ? e.target.getCenter() : e.latlng, 15);
        map.once('moveend', () => showDetails(w, true, e.target));
    });
}

function showDetails(item, isWalk, layer) {
    if (!item) return;
    if (elevationAbortController) { elevationAbortController.abort(); elevationAbortController = null; }
    activeSelectionId = item.id; isEditing = false;
    document.getElementById('explore-panel').style.display = 'none';
    document.getElementById('add-panel').style.display = 'none';
    document.getElementById('settings-panel').style.display = 'none';
    document.getElementById('mainTabs').style.display = 'none';
    document.getElementById('backBtn').style.display = 'flex';
    document.getElementById('minimizeBtn').style.display = 'none';
    document.getElementById('reopenGraphBtn').style.display = 'none';
    const dv = document.getElementById('detail-view'); dv.style.display = 'flex';
    const toggleBtn = document.getElementById('toggleEditBtn');
    toggleBtn.innerHTML = '✏️ EDIT ENTRY'; toggleBtn.classList.remove('active-saving');
    document.getElementById('deleteItemBtn').style.display = 'none';
    document.getElementById('uploadContainer').style.display = 'none';
    const img = document.getElementById('detPhoto'); img.src = item.photo || "https://placehold.co/500x300?text=No+Photo";
    document.getElementById('editTitle').value = item.name; document.getElementById('editDesc').value = item.desc || "";
    document.querySelectorAll('.edit-input').forEach(i=>i.classList.remove('active'));
    renderStars(item);
    waypointMarkers.forEach(m => map.removeLayer(m)); waypointMarkers = [];
    const statsDiv = document.getElementById('detStats');
    if (isWalk) { 
        statsDiv.innerHTML = `<div class="stats-grid"><div class="stat-card"><span class="stat-label">Length</span><span class="stat-value">... km</span></div><div class="stat-card"><span class="stat-label">Est. Time</span><span class="stat-value">... m</span></div><div class="stat-card-dual"><div class="dual-row"><span class="stat-sub-label">Total Climb</span><span class="stat-sub-value">... m</span></div><div class="dual-divider"></div><div class="dual-row"><span class="stat-sub-label">Total Descent</span><span class="stat-sub-value">... m</span></div></div></div>`;
        if(chartInstance) { chartInstance.destroy(); chartInstance = null; }
        document.getElementById('elevation-dock').classList.remove('active');
        window.currentActiveLayer = layer;
        updateWalkStats(); fetchElevation(item.path); 
        const startPt = item.path[0]; const endPt = item.path[item.path.length-1];
        waypointMarkers.push(L.marker(startPt, { icon: L.divIcon({ className: 'walk-marker-icon start-icon', html: '▶', iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(map));
        waypointMarkers.push(L.marker(endPt, { icon: L.divIcon({ className: 'walk-marker-icon end-icon', html: '🏁', iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(map));
    } else { statsDiv.innerHTML = ``; closeElevation(); window.currentActiveLayer = null; }
    nodeHandles.forEach(h=>map.removeLayer(h));
}

function reopenGraph() {
    const item = storage.walks.find(w => w.id === activeSelectionId);
    if (item) { document.getElementById('reopenGraphBtn').style.display = 'none'; fetchElevation(item.path); }
}

function updateWalkStats() {
    const layer = window.currentActiveLayer; const item = storage.walks.find(w => w.id === activeSelectionId); if(!item) return;
    let d = 0; if (layer) { const lls = layer.getLatLngs(); for(let j=1; j<lls.length; j++) d += lls[j-1].distanceTo(lls[j]); item.dist = (d/1000).toFixed(2); item.path = lls.map(l => [l.lat, l.lng]); } else d = parseFloat(item.dist) * 1000;
    const paceKmH = 3; const totalMins = Math.round((d / 1000) / paceKmH * 60); let hours = Math.floor(totalMins / 60); let mins = totalMins % 60;
    let ascent = 0, descent = 0, minE = 0, maxE = 0;
    if(item.elevData && item.elevData.length > 0) {
        minE = Math.round(Math.min(...item.elevData)); maxE = Math.round(Math.max(...item.elevData));
        for(let i=1; i<item.elevData.length; i++) { let diff = item.elevData[i] - item.elevData[i-1]; if(diff > 0) ascent += diff; else descent += Math.abs(diff); }
    }
    document.getElementById('detStats').innerHTML = `<div class="stats-grid"><div class="stat-card"><span class="stat-label">Length</span><span class="stat-value">${item.dist} km</span></div><div class="stat-card"><span class="stat-label">Est. Time</span><span class="stat-value">${hours > 0 ? hours + 'h ' : ''}${mins}m</span></div><div class="stat-card-dual"><div class="dual-row"><span class="stat-sub-label">Total Climb</span><span class="stat-sub-value">${Math.round(ascent)}m</span></div><div class="dual-divider"></div><div class="dual-row"><span class="stat-sub-label">Total Descent</span><span class="stat-sub-value">${Math.round(descent)}m</span></div></div><div class="stat-card-dual"><div class="dual-row"><span class="stat-sub-label">Min Height</span><span class="stat-sub-value">${minE}m</span></div><div class="dual-divider"></div><div class="dual-row"><span class="stat-sub-label">Max Height</span><span class="stat-sub-value">${maxE}m</span></div></div></div>`;
    saveData();
}

function renderStars(item) {
    const rDiv = document.getElementById('detRating'); rDiv.innerHTML = "";
    for(let i=1; i<=5; i++) {
        const s = document.createElement('span'); s.innerText = i <= item.rating ? '★' : '☆';
        s.onclick = () => { if(isEditing) { item.rating = i; renderStars(item); saveData(); } };
        rDiv.appendChild(s);
    }
}

document.getElementById('toggleEditBtn').onclick = function() {
    isEditing = !isEditing; this.innerHTML = isEditing ? '✔️ SAVE CHANGES' : '✏️ EDIT ENTRY';
    this.classList.toggle('active-saving', isEditing);
    document.getElementById('deleteItemBtn').style.display = isEditing ? 'block' : 'none';
    document.getElementById('uploadContainer').style.display = isEditing ? 'block' : 'none';
    document.querySelectorAll('.edit-input').forEach(inp => inp.classList.toggle('active', isEditing));
    if(isEditing && window.currentActiveLayer instanceof L.Polyline) createNodes(window.currentActiveLayer); else nodeHandles.forEach(h=>map.removeLayer(h));
    const item = storage.pins.find(p=>p.id===activeSelectionId) || storage.walks.find(w=>w.id===activeSelectionId);
    document.getElementById('editTitle').oninput = () => { item.name = document.getElementById('editTitle').value; saveData(); };
    document.getElementById('editDesc').oninput = () => { item.desc = document.getElementById('editDesc').value; saveData(); };
};

function createNodes(layer) {
    nodeHandles.forEach(h => map.removeLayer(h)); nodeHandles = []; const latlngs = layer.getLatLngs();
    latlngs.forEach((ll, i) => {
        let moved = false;
        const m = L.marker(ll, { draggable: true, icon: L.divIcon({ className:'node-handle', iconSize:[12,12], iconAnchor:[6,6] }) }).addTo(map);
        m.on('drag', (e) => { moved = true; const currentLls = layer.getLatLngs(); currentLls[i] = e.target.getLatLng(); layer.setLatLngs(currentLls); updateWalkStats(); });
        m.on('dragend', () => { createNodes(layer); fetchElevation(layer.getLatLngs().map(l => [l.lat, l.lng])); });
        m.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            if (!moved && layer.getLatLngs().length > 2) {
                const currentLls = layer.getLatLngs(); currentLls.splice(i, 1); layer.setLatLngs(currentLls);
                updateWalkStats(); createNodes(layer); fetchElevation(currentLls.map(l => [l.lat, l.lng]));
            }
        });
        nodeHandles.push(m);
        if (i < latlngs.length - 1) {
            const mid = L.latLng((ll.lat + latlngs[i+1].lat) / 2, (ll.lng + latlngs[i+1].lng) / 2);
            const midH = L.marker(mid, { draggable: true, icon: L.divIcon({ className:'mid-handle', iconSize:[8,8], iconAnchor:[4,4] }) }).addTo(map);
            midH.on('dragstart', (e) => { const currentLls = layer.getLatLngs(); currentLls.splice(i + 1, 0, e.target.getLatLng()); layer.setLatLngs(currentLls); });
            midH.on('drag', (e) => { const currentLls = layer.getLatLngs(); currentLls[i + 1] = e.target.getLatLng(); layer.setLatLngs(currentLls); updateWalkStats(); });
            midH.on('dragend', () => { createNodes(layer); fetchElevation(layer.getLatLngs().map(l => [l.lat, l.lng])); });
            nodeHandles.push(midH);
        }
    });
}

async function fetchElevation(path) {
    if (elevationAbortController) elevationAbortController.abort(); elevationAbortController = new AbortController(); const signal = elevationAbortController.signal;
    try {
        let sampledPoints = [];
        for (let i = 0; i < path.length - 1; i++) {
            const start = L.latLng(path[i]); const end = L.latLng(path[i+1]); const dist = start.distanceTo(end); sampledPoints.push(start);
            const numSteps = Math.floor(dist / 100); for (let j = 1; j <= numSteps; j++) { const ratio = (j * 100) / dist; sampledPoints.push(L.latLng(start.lat + (end.lat - start.lat) * ratio, start.lng + (end.lng - start.lng) * ratio)); }
        }
        sampledPoints.push(L.latLng(path[path.length - 1]));
        const res = await fetch('https://api.open-elevation.com/api/v1/lookup', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ locations: sampledPoints.map(p => ({ latitude: p.lat, longitude: p.lng })) }), signal: signal }).then(r=>r.json());
        const elevs = res.results.map(r => r.elevation); const item = storage.walks.find(w => w.id === activeSelectionId);
        if(item && (item.id === activeSelectionId || isEditing)) { 
            item.elevData = elevs; saveData(); updateWalkStats(); 
            let currentTotal = 0, distData = [0]; for(let i = 1; i < sampledPoints.length; i++){ currentTotal += sampledPoints[i-1].distanceTo(sampledPoints[i]); distData.push(currentTotal / 1000); }
            let labels = distData.map(d => (Math.round(d * 10) / 10).toFixed(1));
            document.getElementById('elevation-dock').classList.add('active');
            const ctx = document.getElementById('elevChart').getContext('2d'); if(chartInstance) chartInstance.destroy();
            chartInstance = new Chart(ctx, { 
                type:'line', data:{ labels: labels, datasets:[{ data:elevs, borderColor:'#2563eb', backgroundColor: 'rgba(37, 99, 235, 0.15)', fill:true, pointRadius:0, borderWidth: 2, tension:0.4, cubicInterpolationMode: 'monotone' }] }, 
                options:{ maintainAspectRatio:false, layout: { padding: { left: 5, right: 10, bottom: 5, top: 5 } }, plugins:{ legend:{display:false} }, 
                scales:{ x:{ display: true, title: { display: true, text: 'km', font: { size: 10 } }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } }, y:{ display: true, position: 'right', grid: { color: 'rgba(0,0,0,0.05)' } } } } 
            });
        }
    } catch(e) { if (e.name === 'AbortError') console.log('Fetch aborted'); }
}

function closeElevation() { 
    document.getElementById('elevation-dock').classList.remove('active');
    if(chartInstance) { chartInstance.destroy(); chartInstance = null; }
    waypointMarkers.forEach(m => map.removeLayer(m)); waypointMarkers = [];
    const isWalk = storage.walks.find(w => w.id === activeSelectionId);
    if (isWalk && document.getElementById('detail-view').style.display === 'flex') { document.getElementById('reopenGraphBtn').style.display = 'flex'; }
    if (elevationAbortController) { elevationAbortController.abort(); elevationAbortController = null; }
}

function saveData() { localStorage.setItem('geojournal_v11', JSON.stringify(storage)); }
document.getElementById('themeToggle').onchange = (e) => { storage.theme = e.target.checked ? 'dark' : 'light'; document.body.className = storage.theme + '-theme'; saveData(); };
document.getElementById('mapStyleSelect').onchange = (e) => { const selected = e.target.value; storage.mapStyle = selected; map.removeLayer(baseLayer); baseLayer = L.tileLayer(mapStyles[selected], { maxZoom: selected === 'sat' ? 18 : 19 }).addTo(map); saveData(); };
document.getElementById('mainSearch').onkeypress = (e) => { if(e.key==='Enter') fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${e.target.value}`).then(r=>r.json()).then(d=>d.length && map.flyTo([d[0].lat, d[0].lon], 15)); };
document.getElementById('modalStars').onclick = (e) => { if(e.target.dataset.value) { currentRating = parseInt(e.target.dataset.value); document.querySelectorAll('#modalStars .star').forEach(s => s.style.color = s.dataset.value <= currentRating ? '#fbbf24' : '#cbd5e1'); } };
document.getElementById('deleteItemBtn').onclick = () => { if(confirm("Delete?")){ storage.pins = storage.pins.filter(p => p.id !== activeSelectionId); storage.walks = storage.walks.filter(w => w.id !== activeSelectionId); saveData(); mapItems.clearLayers(); storage.pins.forEach(addPin); storage.walks.forEach(addWalk); goBack(); } };
document.getElementById('finishWalkBtn').onclick = () => { if(tempPath.length < 2) return; resetModal(); document.getElementById('modal-overlay').style.display = 'flex'; };

storage.pins.forEach(addPin); storage.walks.forEach(addWalk);
updateHighlights(); switchTab('explore');
