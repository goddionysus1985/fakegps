// Load saved coordinates from localStorage
const savedCoords = localStorage.getItem('fakegps_coords');
let startLat = 40.7580;
let startLng = -73.9855;
if (savedCoords) {
    try {
        const parsed = JSON.parse(savedCoords);
        if (parsed.lat && parsed.lng) {
            startLat = parsed.lat;
            startLng = parsed.lng;
        }
    } catch (e) {}
}

// App configuration and state
const STATE = {
    lat: startLat,
    lng: startLng,
    alt: 10,
    speed: 0,
    heading: 0,
    accuracy: 3,
    activeMode: 'static', // 'static', 'route', 'joystick'
    
    // Bookmark locations
    bookmarks: [],
    
    // Route state
    routePoints: [],      // Array of L.LatLng
    routePolyline: null,  // Leaflet Polyline
    routeIndex: 0,        // Current index in route simulation
    routeInterval: null,  // Simulation timer
    isRoutePlaying: false,
    routeTargetMarker: null,
    
    // Joystick state
    joyActive: false,
    joyPos: { x: 0, y: 0 },
    joyDelta: { x: 0, y: 0 },
    joySpeed: 30, // km/h
    joyAnimationId: null
};

// Initialize elements
const elLat = document.getElementById('val-lat');
const elLng = document.getElementById('val-lng');
const elSpeed = document.getElementById('val-speed');
const elHeading = document.getElementById('val-heading');
const elAlt = document.getElementById('val-alt');
const elAccuracy = document.getElementById('val-accuracy');
const elStatus = document.getElementById('hud-status');
const elCodeBlock = document.getElementById('override-script-code');

// Map Setup
const map = L.map('map', {
    zoomControl: true,
    attributionControl: true
}).setView([STATE.lat, STATE.lng], 13);

// Different map styles
const mapLayers = {
    light: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20,
        className: 'map-light-tiles'
    }),
    positron: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20,
        className: 'map-light-tiles'
    }),
    google: L.tileLayer('https://mt1.google.com/vt/lyrs=m&hl=en&gl=US&x={x}&y={y}&z={z}', {
        attribution: '&copy; Google Maps',
        maxZoom: 20
    }),
    osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }),
    dark: L.layerGroup([
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 20
        }),
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 20,
            className: 'high-contrast-dark-labels'
        })
    ]),
    satellite: L.layerGroup([
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
        }),
        L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Labels &copy; Esri'
        }),
        L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Labels &copy; Esri'
        })
    ]),
    esriStreet: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
        maxZoom: 19
    }),
    topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
        maxZoom: 17
    })
};

// Set saved or default layer
const savedStyle = localStorage.getItem('fakegps_map_style') || 'light';
let currentLayer = mapLayers[savedStyle] || mapLayers.light;
currentLayer.addTo(map);

// Update style select dropdown to match
document.getElementById('map-style-select').value = savedStyle;

// Custom pulses/markers
const pulseIcon = L.divIcon({
    className: 'custom-pulse-marker',
    html: `<div class="marker-beam"></div><div class="marker-pulse"></div><div class="marker-core"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10]
});

// Primary navigation marker
const mainMarker = L.marker([STATE.lat, STATE.lng], {
    icon: pulseIcon,
    draggable: false
}).addTo(map);

// Target marker for routing destination
let routeTargetMarker = null;

// CSS for dynamic markers
const style = document.createElement('style');
style.innerHTML = `
.custom-pulse-marker {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
}
.marker-core {
    width: 14px;
    height: 14px;
    background-color: #007aff;
    border: 2px solid white;
    border-radius: 50%;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
    z-index: 3;
}
.marker-pulse {
    position: absolute;
    width: 32px;
    height: 32px;
    background-color: rgba(0, 122, 255, 0.22);
    border-radius: 50%;
    animation: markerPulse 2s infinite ease-out;
    z-index: 2;
}
.marker-beam {
    position: absolute;
    width: 80px;
    height: 80px;
    background: linear-gradient(0deg, rgba(0, 122, 255, 0.4) 0%, rgba(0, 122, 255, 0) 80%);
    clip-path: polygon(50% 100%, 15% 0%, 85% 0%);
    bottom: 50%;
    left: calc(50% - 40px);
    transform-origin: 50% 100%;
    display: none;
    pointer-events: none;
    z-index: 1;
}
@keyframes markerPulse {
    0% { transform: scale(0.5); opacity: 1; }
    100% { transform: scale(1.8); opacity: 0; }
}
`;
document.head.appendChild(style);

// Update HUD & UI Telemetry
function updateTelemetry(lat, lng, speed = STATE.speed, heading = STATE.heading, alt = STATE.alt) {
    STATE.lat = parseFloat(lat.toFixed(6));
    STATE.lng = parseFloat(lng.toFixed(6));
    STATE.speed = speed;
    STATE.heading = Math.round(heading) % 360;
    STATE.alt = Math.round(alt);

    // Save active position to localStorage
    localStorage.setItem('fakegps_coords', JSON.stringify({ lat: STATE.lat, lng: STATE.lng }));

    elLat.textContent = STATE.lat;
    elLng.textContent = STATE.lng;
    
    elSpeed.innerHTML = `${STATE.speed.toFixed(1)} <span class="unit">км/ч</span>`;
    
    // Heading direction
    let dir = 'N';
    if (STATE.heading > 22.5 && STATE.heading <= 67.5) dir = 'NE';
    else if (STATE.heading > 67.5 && STATE.heading <= 112.5) dir = 'E';
    else if (STATE.heading > 112.5 && STATE.heading <= 157.5) dir = 'SE';
    else if (STATE.heading > 157.5 && STATE.heading <= 202.5) dir = 'S';
    else if (STATE.heading > 202.5 && STATE.heading <= 247.5) dir = 'SW';
    else if (STATE.heading > 247.5 && STATE.heading <= 292.5) dir = 'W';
    else if (STATE.heading > 292.5 && STATE.heading <= 337.5) dir = 'NW';
    
    elHeading.innerHTML = `${STATE.heading}° <span class="unit">${dir}</span>`;
    elAlt.innerHTML = `${STATE.alt} <span class="unit">м</span>`;
    elAccuracy.innerHTML = `${STATE.accuracy} <span class="unit">м</span>`;
    
    mainMarker.setLatLng([STATE.lat, STATE.lng]);
    
    // Rotate and show/hide heading beam like iOS
    const markerEl = mainMarker.getElement();
    if (markerEl) {
        const beamEl = markerEl.querySelector('.marker-beam');
        const pulseEl = markerEl.querySelector('.marker-pulse');
        if (beamEl) {
            if (STATE.speed > 0) {
                beamEl.style.display = 'block';
                beamEl.style.transform = `rotate(${STATE.heading}deg)`;
                if (pulseEl) pulseEl.style.display = 'none';
            } else {
                beamEl.style.display = 'none';
                if (pulseEl) pulseEl.style.display = 'block';
            }
        }
    }
    
    // Update Override script
    elCodeBlock.textContent = `// Скрипт подмены Geolocation API
const mockLat = ${STATE.lat};
const mockLng = ${STATE.lng};
const mockSpeed = ${STATE.speed > 0 ? (STATE.speed / 3.6).toFixed(2) : 'null'}; // м/с
const mockHeading = ${STATE.speed > 0 ? STATE.heading : 'null'};

navigator.geolocation.getCurrentPosition = (success) => {
  success({
    coords: {
      latitude: mockLat,
      longitude: mockLng,
      accuracy: ${STATE.accuracy},
      altitude: ${STATE.alt},
      heading: mockHeading,
      speed: mockSpeed,
      altitudeAccuracy: null
    },
    timestamp: Date.now()
  });
};

navigator.geolocation.watchPosition = (success) => {
  const sendUpdate = () => {
    success({
      coords: {
        latitude: mockLat,
        longitude: mockLng,
        accuracy: ${STATE.accuracy},
        altitude: ${STATE.alt},
        heading: mockHeading,
        speed: mockSpeed,
        altitudeAccuracy: null
      },
      timestamp: Date.now()
    });
  };
  sendUpdate();
  return setInterval(sendUpdate, 1000);
};

console.log("GPS Location set to: " + mockLat + ", " + mockLng);`;
}

// Set initial location
updateTelemetry(STATE.lat, STATE.lng);

// Map Clicks (Static Selection or Route target)
map.on('click', (e) => {
    if (STATE.activeMode === 'static' || STATE.activeMode === 'joystick') {
        stopRouteSimulation();
        updateTelemetry(e.latlng.lat, e.latlng.lng, 0);
        map.panTo(e.latlng);
    } else if (STATE.activeMode === 'route') {
        setRouteDestination(e.latlng);
    }
});

// Mode Switching Logic
const tabs = document.querySelectorAll('.tab-btn');
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        // Hide all mode panels
        document.getElementById('mode-static-panel').classList.add('hidden');
        document.getElementById('mode-route-panel').classList.add('hidden');
        document.getElementById('mode-joystick-panel').classList.add('hidden');
        
        const mode = tab.getAttribute('data-mode');
        STATE.activeMode = mode;
        
        document.getElementById(`mode-${mode}-panel`).classList.remove('hidden');
        
        // Manage indicators and actions
        if (mode !== 'route') {
            clearRoute();
        }
        if (mode === 'joystick') {
            startJoystickLoop();
            elStatus.textContent = "Режим управления: Джойстик / WASD";
        } else {
            stopJoystickLoop();
            if (mode === 'static') elStatus.textContent = "Симуляция активна (Статично)";
            else elStatus.textContent = "Режим маршрута";
        }
        
        updateTelemetry(STATE.lat, STATE.lng, 0);
    });
});

// --- Search functionality ---
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');

async function performSearch() {
    const query = searchInput.value.trim();
    if (!query) return;
    
    // Check if user input looks like coords (e.g. 55.75, 37.61)
    const coordMatch = query.match(/^([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)$/);
    if (coordMatch) {
        const lat = parseFloat(coordMatch[1]);
        const lng = parseFloat(coordMatch[2]);
        updateTelemetry(lat, lng, 0);
        map.setView([lat, lng], 14);
        return;
    }
    
    // Query OSM Nominatim
    try {
        searchBtn.disabled = true;
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
        const data = await res.json();
        if (data && data.length > 0) {
            const lat = parseFloat(data[0].lat);
            const lng = parseFloat(data[0].lon);
            updateTelemetry(lat, lng, 0);
            map.setView([lat, lng], 14);
        } else {
            alert('Локация не найдена');
        }
    } catch (e) {
        console.error('Ошибка поиска:', e);
        alert('Не удалось выполнить поиск');
    } finally {
        searchBtn.disabled = false;
    }
}

searchBtn.addEventListener('click', performSearch);
searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performSearch();
});

// --- Bookmarks Logic ---
const bookmarksList = document.getElementById('bookmarks-list');
const btnBookmarkCurrent = document.getElementById('btn-bookmark-current');

function saveBookmarksToStorage() {
    localStorage.setItem('fakegps_bookmarks', JSON.stringify(STATE.bookmarks));
}

function loadBookmarks() {
    const stored = localStorage.getItem('fakegps_bookmarks');
    if (stored) {
        try {
            STATE.bookmarks = JSON.parse(stored);
        } catch (e) {
            STATE.bookmarks = [];
        }
    } else {
        // Default bookmarks
        STATE.bookmarks = [
            { name: "Москва (Кремль)", lat: 55.7520, lng: 37.6175 },
            { name: "Лондон (Big Ben)", lat: 51.5007, lng: -0.1246 },
            { name: "Нью-Йорк (Times Square)", lat: 40.7580, lng: -73.9855 },
            { name: "Токио (Shibuya)", lat: 35.6580, lng: 139.7016 }
        ];
        saveBookmarksToStorage();
    }
    renderBookmarks();
}

function renderBookmarks() {
    bookmarksList.innerHTML = '';
    if (STATE.bookmarks.length === 0) {
        bookmarksList.innerHTML = '<li class="empty-list-msg">Нет сохраненных локаций</li>';
        return;
    }
    
    STATE.bookmarks.forEach((bm, idx) => {
        const li = document.createElement('li');
        li.className = 'bookmark-item';
        li.innerHTML = `
            <div class="bookmark-info">
                <span class="bookmark-name">${bm.name}</span>
                <span class="bookmark-coords">${bm.lat.toFixed(4)}, ${bm.lng.toFixed(4)}</span>
            </div>
            <button class="icon-btn delete-bm-btn" data-index="${idx}" title="Удалить"><i data-lucide="x"></i></button>
        `;
        
        li.addEventListener('click', (e) => {
            if (e.target.closest('.delete-bm-btn')) return;
            updateTelemetry(bm.lat, bm.lng, 0);
            map.flyTo([bm.lat, bm.lng], 14);
        });
        
        bookmarksList.appendChild(li);
    });
    
    // Activate delete buttons
    document.querySelectorAll('.delete-bm-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.getAttribute('data-index'));
            STATE.bookmarks.splice(idx, 1);
            saveBookmarksToStorage();
            renderBookmarks();
        });
    });
    
    lucide.createIcons();
}

btnBookmarkCurrent.addEventListener('click', () => {
    const name = prompt("Введите название для этой точки:", `Точка ${STATE.bookmarks.length + 1}`);
    if (name) {
        STATE.bookmarks.push({
            name: name,
            lat: STATE.lat,
            lng: STATE.lng
        });
        saveBookmarksToStorage();
        renderBookmarks();
    }
});

document.getElementById('btn-teleport-home').addEventListener('click', () => {
    // Default home - Times Square, NY
    updateTelemetry(40.7580, -73.9855, 0);
    map.flyTo([40.7580, -73.9855], 14);
});

// --- Route Simulation Logic ---
const btnDrawRoute = document.getElementById('btn-draw-route');
const btnClearRoute = document.getElementById('btn-clear-route');
const btnStartRoute = document.getElementById('btn-start-route');
const btnPauseRoute = document.getElementById('btn-pause-route');
const selectRouteSpeed = document.getElementById('route-speed');

let routingDestination = null;

function setRouteDestination(latlng) {
    if (routeTargetMarker) {
        map.removeLayer(routeTargetMarker);
    }
    
    routingDestination = latlng;
    routeTargetMarker = L.marker(latlng, {
        icon: L.divIcon({
            className: 'custom-pulse-marker',
            html: `<div class="marker-pulse" style="background-color: rgba(16, 185, 129, 0.4)"></div><div class="marker-core" style="background-color: var(--accent)"></div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        })
    }).addTo(map);
    
    btnDrawRoute.disabled = false;
}

btnDrawRoute.addEventListener('click', async () => {
    if (!routingDestination) return;
    
    btnDrawRoute.disabled = true;
    btnDrawRoute.innerHTML = `<i data-lucide="loader"></i> Вычисление...`;
    lucide.createIcons();
    
    try {
        // Query OSRM Routing API (Free road routing service)
        const url = `https://router.project-osrm.org/route/v1/driving/${STATE.lng},${STATE.lat};${routingDestination.lng},${routingDestination.lat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const data = await res.json();
        
        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            const coords = data.routes[0].geometry.coordinates;
            
            // Map coordinates from [lng, lat] to L.LatLng
            STATE.routePoints = coords.map(c => L.latLng(c[1], c[0]));
            
            if (STATE.routePolyline) {
                map.removeLayer(STATE.routePolyline);
            }
            
            STATE.routePolyline = L.polyline(STATE.routePoints, {
                color: 'var(--primary)',
                weight: 4,
                opacity: 0.8,
                dashArray: '5, 10'
            }).addTo(map);
            
            map.fitBounds(STATE.routePolyline.getBounds(), { padding: [50, 50] });
            
            btnStartRoute.disabled = false;
            btnStartRoute.classList.add('pulse-glow');
            elStatus.textContent = "Маршрут построен. Нажмите 'Запуск'";
        } else {
            alert("Не удалось построить маршрут по дорогам. Используем прямую линию.");
            createStraightRoute();
        }
    } catch (e) {
        console.error("Ошибка маршрутизации OSRM:", e);
        createStraightRoute();
    } finally {
        btnDrawRoute.innerHTML = `<i data-lucide="route"></i> Построить маршрут`;
        btnDrawRoute.disabled = false;
        lucide.createIcons();
    }
});

function createStraightRoute() {
    STATE.routePoints = [L.latLng(STATE.lat, STATE.lng), routingDestination];
    if (STATE.routePolyline) {
        map.removeLayer(STATE.routePolyline);
    }
    STATE.routePolyline = L.polyline(STATE.routePoints, {
        color: 'var(--primary)',
        weight: 4,
        opacity: 0.8
    }).addTo(map);
    btnStartRoute.disabled = false;
}

function clearRoute() {
    stopRouteSimulation();
    if (STATE.routePolyline) {
        map.removeLayer(STATE.routePolyline);
        STATE.routePolyline = null;
    }
    if (routeTargetMarker) {
        map.removeLayer(routeTargetMarker);
        routeTargetMarker = null;
    }
    routingDestination = null;
    STATE.routePoints = [];
    STATE.routeIndex = 0;
    
    btnStartRoute.disabled = true;
    btnPauseRoute.disabled = true;
    btnStartRoute.innerHTML = `<i data-lucide="play"></i> Запуск`;
    lucide.createIcons();
}

btnClearRoute.addEventListener('click', clearRoute);

function stopRouteSimulation() {
    if (STATE.routeInterval) {
        clearInterval(STATE.routeInterval);
        STATE.routeInterval = null;
    }
    STATE.isRoutePlaying = false;
}

btnStartRoute.addEventListener('click', () => {
    if (STATE.isRoutePlaying) {
        // Pause
        stopRouteSimulation();
        btnStartRoute.innerHTML = `<i data-lucide="play"></i> Продолжить`;
        btnPauseRoute.disabled = true;
        elStatus.textContent = "Маршрут приостановлен";
        updateTelemetry(STATE.lat, STATE.lng, 0);
    } else {
        // Start/Resume
        STATE.isRoutePlaying = true;
        btnStartRoute.innerHTML = `<i data-lucide="pause"></i> Пауза`;
        btnPauseRoute.disabled = false;
        elStatus.textContent = "Маршрут симулируется...";
        
        const speedKmh = parseFloat(selectRouteSpeed.value);
        // Calculate dynamic step rate
        // We will advance coordinates along the line
        let currentPos = L.latLng(STATE.lat, STATE.lng);
        let nextPointIndex = STATE.routeIndex;
        
        if (nextPointIndex === 0) {
            nextPointIndex = 1;
        }

        const intervalMs = 100; // 10 ticks per second
        const speedMs = (speedKmh * 1000) / 3600; // speed in meters per second
        const stepDistance = speedMs * (intervalMs / 1000); // meters per tick
        
        STATE.routeInterval = setInterval(() => {
            if (nextPointIndex >= STATE.routePoints.length) {
                // Route finished
                stopRouteSimulation();
                updateTelemetry(STATE.routePoints[STATE.routePoints.length - 1].lat, STATE.routePoints[STATE.routePoints.length - 1].lng, 0);
                elStatus.textContent = "Маршрут завершен";
                clearRoute();
                return;
            }
            
            let targetPt = STATE.routePoints[nextPointIndex];
            let dist = currentPos.distanceTo(targetPt); // Distance in meters
            
            if (dist <= stepDistance) {
                currentPos = targetPt;
                nextPointIndex++;
                STATE.routeIndex = nextPointIndex;
            } else {
                // Move towards target
                let ratio = stepDistance / dist;
                let newLat = currentPos.lat + (targetPt.lat - currentPos.lat) * ratio;
                let newLng = currentPos.lng + (targetPt.lng - currentPos.lng) * ratio;
                currentPos = L.latLng(newLat, newLng);
            }
            
            // Calculate bearing/heading
            let bearing = 0;
            if (nextPointIndex < STATE.routePoints.length) {
                const nextPt = STATE.routePoints[nextPointIndex];
                const y = Math.sin(nextPt.lng - currentPos.lng) * Math.cos(nextPt.lat);
                const x = Math.cos(currentPos.lat) * Math.sin(nextPt.lat) - Math.sin(currentPos.lat) * Math.cos(nextPt.lat) * Math.cos(nextPt.lng - currentPos.lng);
                bearing = Math.atan2(y, x) * 180 / Math.PI;
            }
            
            updateTelemetry(currentPos.lat, currentPos.lng, speedKmh, bearing);
            map.panTo(currentPos);
        }, intervalMs);
    }
    lucide.createIcons();
});

btnPauseRoute.addEventListener('click', () => {
    clearRoute();
});


// --- Joystick Controls ---
const joyBase = document.getElementById('joy-base');
const joyStick = document.getElementById('joy-stick');
const joySpeedSlider = document.getElementById('joystick-speed');
const joySpeedVal = document.getElementById('joystick-speed-val');

joySpeedSlider.addEventListener('input', (e) => {
    STATE.joySpeed = parseInt(e.target.value);
    joySpeedVal.textContent = `${STATE.joySpeed} км/ч`;
});

// Joystick Drag
let stickMaxRadius = 45; // limit drag boundary

joyStick.addEventListener('mousedown', initJoystickDrag);
joyStick.addEventListener('touchstart', initJoystickDrag, { passive: true });

function initJoystickDrag(e) {
    e.preventDefault();
    STATE.joyActive = true;
    document.addEventListener('mousemove', dragJoystick);
    document.addEventListener('mouseup', endJoystickDrag);
    document.addEventListener('touchmove', dragJoystick, { passive: false });
    document.addEventListener('touchend', endJoystickDrag);
}

function dragJoystick(e) {
    if (!STATE.joyActive) return;
    
    let clientX, clientY;
    if (e.touches) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
        e.preventDefault();
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }
    
    const rect = joyBase.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    let deltaX = clientX - centerX;
    let deltaY = clientY - centerY;
    
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    if (distance > stickMaxRadius) {
        deltaX = (deltaX / distance) * stickMaxRadius;
        deltaY = (deltaY / distance) * stickMaxRadius;
    }
    
    joyStick.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    
    // Normalized vectors (-1 to 1)
    STATE.joyDelta.x = deltaX / stickMaxRadius;
    STATE.joyDelta.y = deltaY / stickMaxRadius;
}

function endJoystickDrag() {
    STATE.joyActive = false;
    joyStick.style.transform = `translate(0px, 0px)`;
    STATE.joyDelta = { x: 0, y: 0 };
    document.removeEventListener('mousemove', dragJoystick);
    document.removeEventListener('mouseup', endJoystickDrag);
    document.removeEventListener('touchmove', dragJoystick);
    document.removeEventListener('touchend', endJoystickDrag);
}

// Keyboards controls (WASD/Arrows)
const keysDown = {};
document.addEventListener('keydown', (e) => {
    if (STATE.activeMode !== 'joystick') return;
    
    // Prevent default scroll actions
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(e.key.toLowerCase())) {
        if (document.activeElement.tagName !== 'INPUT') {
            e.preventDefault();
            keysDown[e.key.toLowerCase()] = true;
        }
    }
});

document.addEventListener('keyup', (e) => {
    keysDown[e.key.toLowerCase()] = false;
});

// Joystick updates frame loop
function startJoystickLoop() {
    if (STATE.joyAnimationId) return;
    
    let lastTime = performance.now();
    
    function loop(time) {
        if (STATE.activeMode !== 'joystick') {
            STATE.joyAnimationId = null;
            return;
        }
        
        let dt = (time - lastTime) / 1000; // seconds
        lastTime = time;
        
        let dx = STATE.joyDelta.x;
        let dy = STATE.joyDelta.y;
        
        // Add keyboard influence if keyboard inputs are active
        if (keysDown['w'] || keysDown['arrowup']) dy = -1;
        if (keysDown['s'] || keysDown['arrowdown']) dy = 1;
        if (keysDown['a'] || keysDown['arrowleft']) dx = -1;
        if (keysDown['d'] || keysDown['arrowright']) dx = 1;
        
        const isMoving = dx !== 0 || dy !== 0;
        
        if (isMoving) {
            // Speed in degrees/sec (rough approximation: 1 degree latitude = 111 km)
            const speedKmh = STATE.joySpeed;
            const speedDegPerSec = (speedKmh / 3600) / 111; // speed in degrees/second
            
            // Calc distance to move
            const moveLat = -dy * speedDegPerSec * dt;
            // Adjust longitude move by latitude cosine
            const moveLng = dx * speedDegPerSec * dt / Math.cos(STATE.lat * Math.PI / 180);
            
            const newLat = STATE.lat + moveLat;
            const newLng = STATE.lng + moveLng;
            
            // Calculate angle
            const angle = Math.atan2(dx, -dy) * 180 / Math.PI;
            
            updateTelemetry(newLat, newLng, speedKmh, angle);
            map.panTo([newLat, newLng]);
        } else {
            // Decelerating if not moving
            if (STATE.speed > 0) {
                updateTelemetry(STATE.lat, STATE.lng, 0);
            }
        }
        
        STATE.joyAnimationId = requestAnimationFrame(loop);
    }
    
    STATE.joyAnimationId = requestAnimationFrame(loop);
}

function stopJoystickLoop() {
    if (STATE.joyAnimationId) {
        cancelAnimationFrame(STATE.joyAnimationId);
        STATE.joyAnimationId = null;
    }
}

// --- Clipboard Copy Snippet ---
document.getElementById('btn-copy-code').addEventListener('click', () => {
    const code = elCodeBlock.textContent;
    navigator.clipboard.writeText(code).then(() => {
        const btn = document.getElementById('btn-copy-code');
        btn.innerHTML = `<i data-lucide="check"></i> Скопировано`;
        lucide.createIcons();
        setTimeout(() => {
            btn.innerHTML = `<i data-lucide="copy"></i> Копировать`;
            lucide.createIcons();
        }, 2000);
    });
});

// --- Theme Switcher & Map Style Logic ---
const themeToggle = document.getElementById('theme-toggle');
const themeIconSun = document.getElementById('theme-icon-sun');
const themeIconMoon = document.getElementById('theme-icon-moon');
const mapStyleSelect = document.getElementById('map-style-select');

// Toggle theme handler
themeToggle.addEventListener('click', () => {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('fakegps_ui_theme', isDark ? 'dark' : 'light');
    if (isDark) {
        themeIconSun.classList.remove('hidden');
        themeIconMoon.classList.add('hidden');
        // If user is switching to dark mode dashboard, we can optionally switch map style to dark too
        if (mapStyleSelect.value === 'light' || mapStyleSelect.value === 'positron') {
            mapStyleSelect.value = 'dark';
            switchMapLayer('dark');
        }
    } else {
        themeIconSun.classList.add('hidden');
        themeIconMoon.classList.remove('hidden');
        if (mapStyleSelect.value === 'dark') {
            mapStyleSelect.value = 'light';
            switchMapLayer('light');
        }
    }
});

// Load theme on start
const savedTheme = localStorage.getItem('fakegps_ui_theme') || 'light';
if (savedTheme === 'dark') {
    document.body.classList.add('dark-mode');
    themeIconSun.classList.remove('hidden');
    themeIconMoon.classList.add('hidden');
}

// Switch map style function
function switchMapLayer(styleName) {
    if (mapLayers[styleName]) {
        map.removeLayer(currentLayer);
        currentLayer = mapLayers[styleName];
        currentLayer.addTo(map);
        localStorage.setItem('fakegps_map_style', styleName);
    }
}

mapStyleSelect.addEventListener('change', (e) => {
    switchMapLayer(e.target.value);
});

// Load bookmarks on load
loadBookmarks();
