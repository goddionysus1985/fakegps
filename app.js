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
    } catch (e) { }
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
    routeStartMarker: null,
    routeStartPoint: null,
    routeEndPoint: null,

    // Joystick state
    joyActive: false,
    joyPos: { x: 0, y: 0 },
    joyDelta: { x: 0, y: 0 },
    joySpeed: 30, // km/h
    joyFollowMap: localStorage.getItem('fakegps_joy_follow') !== 'false',
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

// Map styles (Clean, keyless Apple Style layer)
const mapLayers = {
    mapboxLight: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    }),
    google: L.tileLayer('https://mt1.google.com/vt/lyrs=m&hl=en&gl=US&x={x}&y={y}&z={z}&scale=2', {
        attribution: '&copy; Google Maps',
        maxZoom: 20,
        tileSize: 256,
        zoomOffset: 0
    })
};

// Set saved or default layer
const savedStyle = localStorage.getItem('fakegps_map_style') || 'mapboxLight';
let currentLayer = mapLayers[savedStyle] || mapLayers.mapboxLight;
currentLayer.addTo(map);

// Update style select dropdown to match
document.getElementById('map-style-select').value = mapLayers[savedStyle] ? savedStyle : 'mapboxLight';

// Custom pulses/markers
const pulseIcon = L.divIcon({
    className: 'custom-pulse-marker',
    html: `<div class="marker-beam"></div><div class="marker-pulse"></div><div class="marker-core"></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
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
    width: 17px;
    height: 17px;
    background-color: #007aff;
    border: 2px solid white;
    border-radius: 50%;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
    z-index: 3;
}
.marker-pulse {
    position: absolute;
    width: 38px;
    height: 38px;
    background-color: rgba(0, 122, 255, 0.22);
    border-radius: 50%;
    animation: markerPulse 2s infinite ease-out;
    z-index: 2;
}
.marker-beam {
    position: absolute;
    width: 95px;
    height: 95px;
    background: linear-gradient(0deg, rgba(0, 122, 255, 0.4) 0%, rgba(0, 122, 255, 0) 80%);
    clip-path: polygon(50% 100%, 15% 0%, 85% 0%);
    bottom: 50%;
    left: calc(50% - 47.5px);
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
    STATE.lat = lat;
    STATE.lng = lng;
    STATE.speed = speed;
    STATE.heading = Math.round(heading) % 360;
    STATE.alt = Math.round(alt);

    // Save active position to localStorage (rounded for consistency)
    localStorage.setItem('fakegps_coords', JSON.stringify({ lat: parseFloat(STATE.lat.toFixed(6)), lng: parseFloat(STATE.lng.toFixed(6)) }));

    elLat.textContent = STATE.lat.toFixed(6);
    elLng.textContent = STATE.lng.toFixed(6);

    elSpeed.innerHTML = `${STATE.speed.toFixed(1)} <span class="unit">km/h</span>`;

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
    elAlt.innerHTML = `${STATE.alt} <span class="unit">m</span>`;
    elAccuracy.innerHTML = `${STATE.accuracy} <span class="unit">m</span>`;

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
    elCodeBlock.textContent = `// Geolocation API Override Script
const mockLat = ${STATE.lat.toFixed(6)};
const mockLng = ${STATE.lng.toFixed(6)};
const mockSpeed = ${STATE.speed > 0 ? (STATE.speed / 3.6).toFixed(2) : 'null'}; // m/s
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
    } else if (STATE.activeMode === 'route') {
        handleRouteMapClick(e.latlng);
    }
});

function handleRouteMapClick(latlng) {
    if (STATE.routeStartPoint && STATE.routeEndPoint) {
        clearRoute();
    }

    if (!STATE.routeStartPoint) {
        STATE.routeStartPoint = latlng;
        if (STATE.routeStartMarker) {
            map.removeLayer(STATE.routeStartMarker);
        }
        STATE.routeStartMarker = L.marker(latlng, {
            icon: L.divIcon({
                className: 'custom-pulse-marker',
                html: `<div class="marker-pulse" style="background-color: rgba(249, 115, 22, 0.4)"></div><div class="marker-core" style="background-color: #f97316"></div>`,
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            })
        }).addTo(map);
        elStatus.textContent = "Start point selected. Select end point (click 2)";
    } else if (!STATE.routeEndPoint) {
        STATE.routeEndPoint = latlng;
        routingDestination = latlng;
        if (routeTargetMarker) {
            map.removeLayer(routeTargetMarker);
        }
        routeTargetMarker = L.marker(latlng, {
            icon: L.divIcon({
                className: 'custom-pulse-marker',
                html: `<div class="marker-pulse" style="background-color: rgba(16, 185, 129, 0.4)"></div><div class="marker-core" style="background-color: var(--accent)"></div>`,
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            })
        }).addTo(map);
        btnDrawRoute.disabled = false;
        elStatus.textContent = "Points selected. Click 'Build Route'";
    }
}

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
            elStatus.textContent = "Control mode: Joystick / WASD";
        } else {
            stopJoystickLoop();
            if (mode === 'static') elStatus.textContent = "Simulation active (Static)";
            else elStatus.textContent = "Route mode";
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
            alert('Location not found');
        }
    } catch (e) {
        console.error('Search error:', e);
        alert('Search failed');
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
            { name: "Moscow (Kremlin)", lat: 55.7520, lng: 37.6175 },
            { name: "London (Big Ben)", lat: 51.5007, lng: -0.1246 },
            { name: "New York (Times Square)", lat: 40.7580, lng: -73.9855 },
            { name: "Tokyo (Shibuya)", lat: 35.6580, lng: 139.7016 }
        ];
        saveBookmarksToStorage();
    }
    renderBookmarks();
}

function renderBookmarks() {
    bookmarksList.innerHTML = '';
    if (STATE.bookmarks.length === 0) {
        bookmarksList.innerHTML = '<li class="empty-list-msg">No saved locations</li>';
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
            <button class="icon-btn delete-bm-btn" data-index="${idx}" title="Delete"><i data-lucide="x"></i></button>
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
    const name = prompt("Enter name for this location:", `Point ${STATE.bookmarks.length + 1}`);
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
const savedRouteSpeed = localStorage.getItem('fakegps_route_speed');
if (savedRouteSpeed && selectRouteSpeed) {
    selectRouteSpeed.value = savedRouteSpeed;
}
if (selectRouteSpeed) {
    selectRouteSpeed.addEventListener('change', (e) => {
        localStorage.setItem('fakegps_route_speed', e.target.value);
    });
}

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
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        })
    }).addTo(map);

    btnDrawRoute.disabled = false;
}

btnDrawRoute.addEventListener('click', async () => {
    if (!STATE.routeStartPoint || !STATE.routeEndPoint) return;

    btnDrawRoute.disabled = true;
    btnDrawRoute.innerHTML = `<i data-lucide="loader"></i> Calculating...`;
    lucide.createIcons();

    try {
        // Query OSRM Routing API (Free road routing service)
        const url = `https://router.project-osrm.org/route/v1/driving/${STATE.routeStartPoint.lng},${STATE.routeStartPoint.lat};${STATE.routeEndPoint.lng},${STATE.routeEndPoint.lat}?overview=full&geometries=geojson`;
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
            elStatus.textContent = "Route built. Click 'Start'";
        } else {
            alert("Could not build road route. Using straight line.");
            createStraightRoute();
        }
    } catch (e) {
        console.error("OSRM Routing Error:", e);
        createStraightRoute();
    } finally {
        btnDrawRoute.innerHTML = `<i data-lucide="route"></i> Build Route`;
        btnDrawRoute.disabled = false;
        lucide.createIcons();
    }
});

function createStraightRoute() {
    STATE.routePoints = [STATE.routeStartPoint, STATE.routeEndPoint];
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
    if (STATE.routeStartMarker) {
        map.removeLayer(STATE.routeStartMarker);
        STATE.routeStartMarker = null;
    }
    routingDestination = null;
    STATE.routeStartPoint = null;
    STATE.routeEndPoint = null;
    STATE.routePoints = [];
    STATE.routeIndex = 0;

    btnStartRoute.disabled = true;
    btnPauseRoute.disabled = true;
    btnStartRoute.innerHTML = `<i data-lucide="play"></i> Start`;
    elStatus.textContent = "Select start point on map (click 1)";
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
        btnStartRoute.innerHTML = `<i data-lucide="play"></i> Resume`;
        btnPauseRoute.disabled = true;
        elStatus.textContent = "Route paused";
        updateTelemetry(STATE.lat, STATE.lng, 0);
    } else {
        // Start/Resume
        STATE.isRoutePlaying = true;
        btnStartRoute.innerHTML = `<i data-lucide="pause"></i> Pause`;
        btnPauseRoute.disabled = false;
        elStatus.textContent = "Route simulation playing...";

        const speedKmh = parseFloat(selectRouteSpeed.value);
        // Calculate dynamic step rate
        // We will advance coordinates along the line
        let currentPos = STATE.routeIndex === 0 ? STATE.routeStartPoint : L.latLng(STATE.lat, STATE.lng);
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
                elStatus.textContent = "Route finished";
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

            // Calculate bearing/heading (convert to radians for trig functions)
            let bearing = 0;
            if (nextPointIndex < STATE.routePoints.length) {
                const nextPt = STATE.routePoints[nextPointIndex];
                const lat1 = currentPos.lat * Math.PI / 180;
                const lat2 = nextPt.lat * Math.PI / 180;
                const dLng = (nextPt.lng - currentPos.lng) * Math.PI / 180;

                const y = Math.sin(dLng) * Math.cos(lat2);
                const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
                bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
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

// Load saved joystick speed
const savedJoySpeed = localStorage.getItem('fakegps_joy_speed');
if (savedJoySpeed && joySpeedSlider) {
    joySpeedSlider.value = savedJoySpeed;
    STATE.joySpeed = parseInt(savedJoySpeed);
    if (joySpeedVal) joySpeedVal.textContent = `${STATE.joySpeed} km/h`;
}

joySpeedSlider.addEventListener('input', (e) => {
    STATE.joySpeed = parseInt(e.target.value);
    joySpeedVal.textContent = `${STATE.joySpeed} km/h`;
    localStorage.setItem('fakegps_joy_speed', STATE.joySpeed);
});

// Joystick Follow Map Toggle
const joyFollowCheckbox = document.getElementById('joystick-follow-map');
if (joyFollowCheckbox) {
    joyFollowCheckbox.checked = STATE.joyFollowMap;
    joyFollowCheckbox.addEventListener('change', (e) => {
        STATE.joyFollowMap = e.target.checked;
        localStorage.setItem('fakegps_joy_follow', STATE.joyFollowMap);
    });
}

// Joystick Drag
let stickMaxRadius = 45; // limit drag boundary

// Apple Design: Use Pointer Events for 1:1 tracking even outside bounds
joyStick.addEventListener('pointerdown', initJoystickDrag);

function initJoystickDrag(e) {
    e.preventDefault();
    STATE.joyActive = true;
    joyStick.classList.add('dragging');
    joyStick.setPointerCapture(e.pointerId);
    
    document.addEventListener('pointermove', dragJoystick);
    document.addEventListener('pointerup', endJoystickDrag);
    document.addEventListener('pointercancel', endJoystickDrag);
}

function dragJoystick(e) {
    if (!STATE.joyActive) return;

    let clientX = e.clientX;
    let clientY = e.clientY;

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

function endJoystickDrag(e) {
    STATE.joyActive = false;
    joyStick.classList.remove('dragging');
    if (e && e.pointerId) {
        try { joyStick.releasePointerCapture(e.pointerId); } catch(err) {}
    }
    
    joyStick.style.transform = `translate(0px, 0px)`;
    STATE.joyDelta = { x: 0, y: 0 };
    
    document.removeEventListener('pointermove', dragJoystick);
    document.removeEventListener('pointerup', endJoystickDrag);
    document.removeEventListener('pointercancel', endJoystickDrag);
}

// Keyboards controls (WASD/Arrows)
const keysDown = {};
document.addEventListener('keydown', (e) => {
    if (STATE.activeMode !== 'joystick') return;

    const key = e.key.toLowerCase();
    const code = e.code.toLowerCase();

    // Prevent default scroll actions
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(key) || ['keyw', 'keya', 'keys', 'keyd'].includes(code)) {
        if (document.activeElement.tagName !== 'INPUT') {
            e.preventDefault();
            keysDown[key] = true;
            keysDown[code] = true;
        }
    }
});

document.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    const code = e.code.toLowerCase();
    keysDown[key] = false;
    keysDown[code] = false;
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
        let kx = 0;
        let ky = 0;
        if (keysDown['w'] || keysDown['arrowup'] || keysDown['keyw']) ky -= 1;
        if (keysDown['s'] || keysDown['arrowdown'] || keysDown['keys']) ky += 1;
        if (keysDown['a'] || keysDown['arrowleft'] || keysDown['keya']) kx -= 1;
        if (keysDown['d'] || keysDown['arrowright'] || keysDown['keyd']) kx += 1;

        if (kx !== 0 || ky !== 0) {
            // Normalize keyboard input vector to ensure perfect diagonal motion
            const len = Math.sqrt(kx * kx + ky * ky);
            dx = kx / len;
            dy = ky / len;
        }

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
            if (STATE.joyFollowMap) {
                map.panTo([newLat, newLng]);
            }
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
        btn.innerHTML = `<i data-lucide="check"></i> Copied`;
        lucide.createIcons();
        setTimeout(() => {
            btn.innerHTML = `<i data-lucide="copy"></i> Copy`;
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
    } else {
        themeIconSun.classList.add('hidden');
        themeIconMoon.classList.remove('hidden');
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

// ==========================================
// TOP NAVBAR / TOOL VIEW SWITCHER
// ==========================================
const navBtnFakeGPS = document.getElementById('nav-btn-fakegps');
const navBtnCompatibility = document.getElementById('nav-btn-compatibility');
const viewLaunchpad = document.getElementById('view-launchpad');
const viewFakeGPS = document.getElementById('view-fakegps');
const viewCompatibility = document.getElementById('view-compatibility');

function switchToolView(viewName) {
    // Hide all views by default
    if (viewLaunchpad) {
        viewLaunchpad.classList.add('hidden');
        viewLaunchpad.classList.remove('active');
    }
    if (viewFakeGPS) {
        viewFakeGPS.classList.add('hidden');
        viewFakeGPS.classList.remove('active');
    }
    if (viewCompatibility) {
        viewCompatibility.classList.add('hidden');
        viewCompatibility.classList.remove('active');
    }

    const navMenu = document.querySelector('.nav-menu');

    if (viewName === 'launchpad') {
        if (navBtnFakeGPS) navBtnFakeGPS.classList.remove('active');
        if (navBtnCompatibility) navBtnCompatibility.classList.remove('active');
        if (navMenu) navMenu.style.display = 'none';

        if (viewLaunchpad) {
            viewLaunchpad.classList.remove('hidden');
            viewLaunchpad.classList.add('active');
        }
        localStorage.setItem('multitool_active_view', 'launchpad');
    } else if (viewName === 'fakegps') {
        if (navBtnFakeGPS) navBtnFakeGPS.classList.add('active');
        if (navBtnCompatibility) navBtnCompatibility.classList.remove('active');
        if (navMenu) navMenu.style.display = 'flex';

        if (viewFakeGPS) {
            viewFakeGPS.classList.remove('hidden');
            viewFakeGPS.classList.add('active');
        }
        localStorage.setItem('multitool_active_view', 'fakegps');

        // Refresh Leaflet map size on view switch
        setTimeout(() => {
            if (map) map.invalidateSize();
        }, 100);
    } else if (viewName === 'compatibility') {
        if (navBtnCompatibility) navBtnCompatibility.classList.add('active');
        if (navBtnFakeGPS) navBtnFakeGPS.classList.remove('active');
        if (navMenu) navMenu.style.display = 'flex';

        if (viewCompatibility) {
            viewCompatibility.classList.remove('hidden');
            viewCompatibility.classList.add('active');
        }
        localStorage.setItem('multitool_active_view', 'compatibility');
    }
}

if (navBtnFakeGPS) {
    navBtnFakeGPS.addEventListener('click', () => switchToolView('fakegps'));
}
if (navBtnCompatibility) {
    navBtnCompatibility.addEventListener('click', () => switchToolView('compatibility'));
}

// Brand Logo click returns to Launchpad
const navBrand = document.querySelector('.nav-brand');
if (navBrand) {
    navBrand.style.cursor = 'pointer';
    navBrand.addEventListener('click', () => switchToolView('launchpad'));
}

// Launchpad Cards Event Listeners
document.querySelectorAll('.app-card').forEach(card => {
    card.addEventListener('click', () => {
        const app = card.getAttribute('data-launch');
        switchToolView(app);
    });
});

// Restore saved view or default to Launchpad
const savedView = localStorage.getItem('multitool_active_view') || 'launchpad';
switchToolView(savedView);


// ==========================================
// COMPATIBILITY TESTER MODULE
// ==========================================
(function initCompatibilityTester() {
    // Inputs
    const manNameInput = document.getElementById('man-name');
    const manAgeInput = document.getElementById('man-age');
    const manPhotoInput = document.getElementById('man-photo');
    const womanNameInput = document.getElementById('woman-name');
    const womanAgeInput = document.getElementById('woman-age');
    const womanPhotoInput = document.getElementById('woman-photo');
    const compatibilityInput = document.getElementById('compatibility-pct');

    // Displays & Bars
    const pctDisplay = document.getElementById('pct-display');
    const imgMan = document.getElementById('img-man');
    const imgWoman = document.getElementById('img-woman');
    const labelMan = document.getElementById('label-man');
    const labelWoman = document.getElementById('label-woman');
    const barManComp = document.querySelector('#bar-man .compatibility');
    const barWomanComp = document.querySelector('#bar-woman .compatibility');

    // Indicators
    const indMan = document.getElementById('ind-man');
    const indWoman = document.getElementById('ind-woman');

    // Theme Switcher Logic inside Compatibility view
    const themeBtns = document.querySelectorAll('#view-compatibility .theme-btn');
    let currentTheme = localStorage.getItem('compatibility_theme') || 'midnight';

    function setCompatibilityTheme(theme) {
        if (!viewCompatibility) return;

        // Reset theme classes on body
        document.body.classList.remove('theme-slate', 'theme-vibrant');
        if (theme !== 'midnight') {
            document.body.classList.add(`theme-${theme}`);
        }

        themeBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === theme);
        });

        localStorage.setItem('compatibility_theme', theme);
        setTimeout(updateBars, 50); // Small delay to let CSS variables update
    }

    themeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            setCompatibilityTheme(btn.dataset.theme);
        });
    });

    // Handle initial theme state
    setCompatibilityTheme(currentTheme);

    function updateAuraAndBiorhythms(manName, manAge, womanName, womanAge, basePct) {
        const elOrb = document.getElementById('aura-orb');
        const elAuraTitle = document.getElementById('aura-title');
        const elAuraDesc = document.getElementById('aura-desc');

        const elBioValPhysical = document.getElementById('bio-val-physical');
        const elBioValEmotional = document.getElementById('bio-val-emotional');
        const elBioValIntellectual = document.getElementById('bio-val-intellectual');

        const elBioBarPhysical = document.getElementById('bio-bar-physical');
        const elBioBarEmotional = document.getElementById('bio-bar-emotional');
        const elBioBarIntellectual = document.getElementById('bio-bar-intellectual');

        if (!elOrb || !elBioValPhysical) return;

        // Hash function for deterministic calculation from names
        const str = (manName + womanName).toLowerCase().replace(/\s+/g, '');
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = (hash << 5) - hash + str.charCodeAt(i);
            hash |= 0;
        }
        const seed = Math.abs(hash);

        // Biorhythms calculation
        const mAge = parseInt(manAge) || 20;
        const wAge = parseInt(womanAge) || 20;
        const ageFactor = (mAge + wAge) % 50;

        let phys = Math.round(Math.abs(Math.sin((seed % 23 + ageFactor) * 0.2)) * 40 + (basePct * 0.6));
        let emot = Math.round(Math.abs(Math.sin((seed % 28 + ageFactor) * 0.18)) * 40 + (basePct * 0.6));
        let intel = Math.round(Math.abs(Math.sin((seed % 33 + ageFactor) * 0.15)) * 40 + (basePct * 0.6));

        if (str.length === 0) { phys = 50; emot = 50; intel = 50; }

        phys = Math.min(100, Math.max(10, phys));
        emot = Math.min(100, Math.max(10, emot));
        intel = Math.min(100, Math.max(10, intel));

        if (elBioValPhysical) elBioValPhysical.textContent = `${phys}%`;
        if (elBioValEmotional) elBioValEmotional.textContent = `${emot}%`;
        if (elBioValIntellectual) elBioValIntellectual.textContent = `${intel}%`;

        if (elBioBarPhysical) elBioBarPhysical.style.width = `${phys}%`;
        if (elBioBarEmotional) elBioBarEmotional.style.width = `${emot}%`;
        if (elBioBarIntellectual) elBioBarIntellectual.style.width = `${intel}%`;

        // Dynamic Aura Colors
        const hue1 = (seed * 137) % 360;
        const hue2 = (hue1 + 70) % 360;
        const hue3 = (hue2 + 90) % 360;

        elOrb.style.background = `radial-gradient(circle at 30% 30%, hsl(${hue1}, 85%, 60%), hsl(${hue2}, 85%, 55%), hsl(${hue3}, 85%, 45%))`;
        elOrb.style.boxShadow = `0 0 25px hsl(${hue1}, 85%, 50%, 0.5), inset 0 0 15px rgba(255, 255, 255, 0.4)`;

        const mName = manName ? manName : '';
        const wName = womanName ? womanName : '';
        const hasNames = mName || wName;

        let moodTitle = '✨ Cosmic Resonance';
        let moodDesc = `The energy field of ${hasNames ? `${mName} & ${wName}` : 'the couple'} forms a high-vibration aura stream.`;

        if (basePct > 80) {
            moodTitle = '🔥 Fiery Synchronicity';
            moodDesc = `Incredible aura burst! ${hasNames ? `${mName} & ${wName}` : 'The couple'} create a powerful resonant impulse of passion.`;
        } else if (basePct > 50) {
            moodTitle = '✨ Harmonious Flow';
            moodDesc = `The energies of ${hasNames ? `${mName} & ${wName}` : 'partners'} complement each other, creating a balanced mental field.`;
        } else if (str.length > 0) {
            moodTitle = '⚡ Intriguing Potential';
            moodDesc = `Attraction by contrast: ${hasNames ? `${mName} & ${wName}` : 'partners'} ignite a dynamic spark.`;
        } else {
            moodTitle = '🌌 Awaiting Input';
            moodDesc = 'Enter couple names to calculate aura energy and biorhythm synergy.';
        }

        if (elAuraTitle) elAuraTitle.textContent = moodTitle;
        if (elAuraDesc) elAuraDesc.textContent = moodDesc;
    }

    function updateBars() {
        if (!compatibilityInput) return;

        let percentage = parseFloat(compatibilityInput.value) || 0;
        if (percentage < 90) {
            percentage = Math.round(percentage);
            compatibilityInput.value = percentage;
        }

        const manName = manNameInput ? manNameInput.value || 'Man' : 'Man';
        const manAge = manAgeInput ? manAgeInput.value || '0' : '0';
        const DEFAULT_MAN_PHOTO = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500"><rect width="400" height="500" rx="16" fill="%23f4f6fa"/><path d="M200 170 C222 170 240 188 240 210 C240 232 222 250 200 250 C178 250 160 232 160 210 C160 188 178 170 200 170 Z M130 320 C130 270 160 260 200 260 C240 260 270 270 270 320" stroke="%23b0b8ca" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
        const manPhoto = (manPhotoInput && manPhotoInput.value.trim()) ? manPhotoInput.value.trim() : DEFAULT_MAN_PHOTO;
        const womanName = womanNameInput ? womanNameInput.value || 'Woman' : 'Woman';
        const womanAge = womanAgeInput ? womanAgeInput.value || '0' : '0';
        const womanPhoto = womanPhotoInput ? womanPhotoInput.value.trim() : '';

        // Calculate dynamic color based on theme
        let hueEnd = 120; // Emerald (Midnight)
        if (document.body.classList.contains('theme-slate')) { hueEnd = 240; } // Indigo
        if (document.body.classList.contains('theme-vibrant')) { hueEnd = 340; } // Rose

        const hue = Math.floor((percentage / 100) * hueEnd);
        const color = `hsl(${hue}, 80%, 45%)`;
        const colorGlow = `hsl(${hue}, 80%, 45%, 0.4)`;

        const displayPercentage = percentage >= 90 ? percentage.toFixed(1) : percentage;

        // Update Text
        if (pctDisplay) {
            pctDisplay.textContent = `${displayPercentage}%`;
            pctDisplay.style.color = color;
            if (percentage > 50) {
                pctDisplay.style.textShadow = `0 0 20px ${colorGlow}`;
            } else {
                pctDisplay.style.textShadow = `none`;
            }
        }

        if (labelMan) labelMan.textContent = `${manName}, ${manAge}`;
        if (labelWoman) labelWoman.textContent = `${womanName}, ${womanAge}`;

        if (imgMan) {
            imgMan.src = manPhoto;
            imgMan.style.display = 'block';
        }

        if (imgWoman) {
            if (womanPhoto) {
                imgWoman.src = womanPhoto;
                imgWoman.style.display = 'block';
            } else {
                imgWoman.style.display = 'none';
                imgWoman.src = '';
            }
        }

        // Update Bars
        if (barManComp) {
            barManComp.style.height = `${percentage}%`;
            barManComp.style.background = color;
        }
        if (barWomanComp) {
            barWomanComp.style.height = `${percentage}%`;
            barWomanComp.style.background = color;
        }

        // Update Indicators
        if (indMan) {
            indMan.textContent = `${displayPercentage}%`;
            indMan.style.bottom = `${percentage}%`;
            indMan.style.background = color;
        }
        if (indWoman) {
            indWoman.textContent = `${displayPercentage}%`;
            indWoman.style.bottom = `${percentage}%`;
            indWoman.style.background = color;
        }

        // Update Aura & Biorhythms dynamically on every input
        updateAuraAndBiorhythms(
            manNameInput ? manNameInput.value.trim() : '',
            manAge,
            womanNameInput ? womanNameInput.value.trim() : '',
            womanAge,
            percentage
        );

        // Save state to localStorage on every change
        saveCompatibilityState();
    }

    // Save compatibility form values to localStorage
    function saveCompatibilityState() {
        const data = {
            manName: manNameInput ? manNameInput.value : '',
            manAge: manAgeInput ? manAgeInput.value : '',
            manPhoto: manPhotoInput ? manPhotoInput.value : '',
            womanName: womanNameInput ? womanNameInput.value : '',
            womanAge: womanAgeInput ? womanAgeInput.value : '',
            womanPhoto: womanPhotoInput ? womanPhotoInput.value : '',
            pct: compatibilityInput ? compatibilityInput.value : '0'
        };
        localStorage.setItem('compatibility_form_data', JSON.stringify(data));
    }

    // Load saved compatibility values on startup
    function loadCompatibilityState() {
        const saved = localStorage.getItem('compatibility_form_data');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                if (manNameInput && data.manName !== undefined) manNameInput.value = data.manName;
                if (manAgeInput && data.manAge !== undefined) manAgeInput.value = data.manAge;
                if (manPhotoInput && data.manPhoto !== undefined) manPhotoInput.value = data.manPhoto;
                if (womanNameInput && data.womanName !== undefined) womanNameInput.value = data.womanName;
                if (womanAgeInput && data.womanAge !== undefined) womanAgeInput.value = data.womanAge;
                if (womanPhotoInput && data.womanPhoto !== undefined) womanPhotoInput.value = data.womanPhoto;
                if (compatibilityInput && data.pct !== undefined) compatibilityInput.value = data.pct;
            } catch(e) {}
        }
    }

    // Restore saved values & initial render
    loadCompatibilityState();
    updateBars();

    // Event Listeners
    [manNameInput, manAgeInput, manPhotoInput, womanNameInput, womanAgeInput, womanPhotoInput, compatibilityInput].forEach(input => {
        if (input) input.addEventListener('input', updateBars);
    });


    // ==========================================
    // HEART COLLAGE OVERLAY LOGIC
    // ==========================================

    const btnOpenCollage = document.getElementById('btn-open-collage');
    const btnCloseCollage = document.getElementById('btn-close-collage');
    const collageOverlay = document.getElementById('collage-overlay');
    const collageParticlesContainer = document.getElementById('collage-particles-container');
    const btnExportCollage = document.getElementById('btn-export-collage');

    // Controls
    const collageManNameInput = document.getElementById('collage-man-name');
    const collageManAgeInput = document.getElementById('collage-man-age');
    const collageManPhotoInput = document.getElementById('collage-man-photo');
    const collageWomanNameInput = document.getElementById('collage-woman-name');
    const collageWomanAgeInput = document.getElementById('collage-woman-age');
    const collageWomanPhotoInput = document.getElementById('collage-woman-photo');
    const collageCompatibilityPctInput = document.getElementById('collage-compatibility-pct');

    // File inputs
    const fileManPhoto = document.getElementById('file-man-photo');
    const fileWomanPhoto = document.getElementById('file-woman-photo');

    // Frames
    const frameManCollage = document.getElementById('frame-man-collage');
    const frameWomanCollage = document.getElementById('frame-woman-collage');

    // Display Elements
    const collageRenderCard = document.getElementById('collage-render-card');
    const displayImgMan = document.getElementById('display-img-man');
    const displayImgWoman = document.getElementById('display-img-woman');
    const displayNameMan = document.getElementById('display-name-man');
    const displayAgeMan = document.getElementById('display-age-man');
    const displayNameWoman = document.getElementById('display-name-woman');
    const displayAgeWoman = document.getElementById('display-age-woman');

    const glowBtns = document.querySelectorAll('.glow-btn');

    let particleInterval = null;
    let localManPhotoSrc = '';
    let localWomanPhotoSrc = '';

    // Initialize Collage Card Theme Class
    let currentCollageTheme = 'rose';
    if (collageRenderCard) {
        collageRenderCard.className = 'collage-card glow-rose';
    }

    // Toggle Collage View
    if (btnOpenCollage) {
        btnOpenCollage.addEventListener('click', () => {
            if (collageOverlay) {
                collageOverlay.style.display = 'flex';
                document.body.style.overflow = 'hidden';

                // Sync data from main page
                syncDataFromMain();

                // Start background floating hearts particle system
                startParticles();

                // Trigger an initial burst of hearts in the overlay
                for (let i = 0; i < 15; i++) {
                    setTimeout(() => spawnParticle(), i * 150);
                }

                // Staggered merging hearts stream from avatars to the center badge on launch!
                setTimeout(() => {
                    for (let i = 0; i < 3; i++) {
                        setTimeout(() => {
                            if (frameManCollage) launchMergingHeart(frameManCollage);
                        }, i * 250);
                        setTimeout(() => {
                            if (frameWomanCollage) launchMergingHeart(frameWomanCollage);
                        }, i * 250 + 120);
                    }
                }, 400);
            }
        });
    }

    if (btnCloseCollage) {
        btnCloseCollage.addEventListener('click', () => {
            if (collageOverlay) {
                collageOverlay.style.display = 'none';
                document.body.style.overflow = '';
                stopParticles();
            }
        });
    }

    function syncDataFromMain() {
        const percentage = compatibilityInput ? compatibilityInput.value : 0;
        const manName = manNameInput ? manNameInput.value.trim() : '';
        const manAge = manAgeInput ? manAgeInput.value : '';
        const manPhoto = manPhotoInput ? manPhotoInput.value.trim() : '';
        const womanName = womanNameInput ? womanNameInput.value.trim() : '';
        const womanAge = womanAgeInput ? womanAgeInput.value : '';
        const womanPhoto = womanPhotoInput ? womanPhotoInput.value.trim() : '';

        // Update Customizer form fields
        if (collageManNameInput) collageManNameInput.value = manName || 'Mike';
        if (collageManAgeInput) collageManAgeInput.value = manAge || '28';
        if (collageManPhotoInput) collageManPhotoInput.value = manPhoto === 'Local Uploaded File' ? '' : manPhoto;
        if (collageWomanNameInput) collageWomanNameInput.value = womanName || 'Inna';
        if (collageWomanAgeInput) collageWomanAgeInput.value = womanAge || '25';
        if (collageWomanPhotoInput) collageWomanPhotoInput.value = womanPhoto === 'Local Uploaded File' ? '' : womanPhoto;
        if (collageCompatibilityPctInput) collageCompatibilityPctInput.value = percentage;

        updateCollageManPhoto(localManPhotoSrc || manPhoto);
        updateCollageWomanPhoto(localWomanPhotoSrc || womanPhoto);

        updateCollagePreviewText();

        let matchedTheme = 'rose';
        if (document.body.classList.contains('theme-slate')) { matchedTheme = 'sapphire'; }
        else if (document.body.classList.contains('theme-vibrant')) { matchedTheme = 'rose'; }
        else { matchedTheme = 'emerald'; }

        setCollageTheme(matchedTheme);
    }

    function setCollageTheme(color) {
        if (!collageRenderCard) return;
        collageRenderCard.className = `collage-card glow-${color}`;
        currentCollageTheme = color;

        glowBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.color === color);
        });
    }

    glowBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            setCollageTheme(btn.dataset.color);
            spawnHeartBurst(btn, 6);
        });
    });

    function updateCollageManPhoto(src) {
        const DEFAULT_MAN_PHOTO = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500"><rect width="400" height="500" rx="16" fill="%23f4f6fa"/><path d="M200 170 C222 170 240 188 240 210 C240 232 222 250 200 250 C178 250 160 232 160 210 C160 188 178 170 200 170 Z M130 320 C130 270 160 260 200 260 C240 260 270 270 270 320" stroke="%23b0b8ca" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
        const photoSrc = src ? src : DEFAULT_MAN_PHOTO;
        const placeholder = frameManCollage ? frameManCollage.querySelector('.heart-placeholder') : null;
        if (displayImgMan) {
            displayImgMan.src = photoSrc;
            displayImgMan.style.display = 'block';
            if (placeholder) placeholder.style.display = 'none';
        }
    }

    function updateCollageWomanPhoto(src) {
        const placeholder = frameWomanCollage ? frameWomanCollage.querySelector('.heart-placeholder') : null;
        if (displayImgWoman) {
            if (src) {
                displayImgWoman.src = src;
                displayImgWoman.style.display = 'block';
                if (placeholder) placeholder.style.display = 'none';
            } else {
                displayImgWoman.style.display = 'none';
                displayImgWoman.src = '';
                if (placeholder) placeholder.style.display = 'flex';
            }
        }
    }

    function syncToMainForm() {
        if (manNameInput && collageManNameInput) manNameInput.value = collageManNameInput.value;
        if (manAgeInput && collageManAgeInput) manAgeInput.value = collageManAgeInput.value;
        if (womanNameInput && collageWomanNameInput) womanNameInput.value = collageWomanNameInput.value;
        if (womanAgeInput && collageWomanAgeInput) womanAgeInput.value = collageWomanAgeInput.value;

        if (manPhotoInput && collageManPhotoInput) {
            manPhotoInput.value = collageManPhotoInput.value.trim();
        }
        if (womanPhotoInput && collageWomanPhotoInput) {
            womanPhotoInput.value = collageWomanPhotoInput.value.trim();
        }

        updateBars();
    }

    function updateCollagePreviewText() {
        if (displayNameMan && collageManNameInput) {
            displayNameMan.textContent = collageManNameInput.value || 'Man';
        }
        if (displayAgeMan && collageManAgeInput) {
            const ageVal = collageManAgeInput.value;
            displayAgeMan.textContent = ageVal ? `Age ${ageVal}` : '';
        }

        if (displayNameWoman && collageWomanNameInput) {
            displayNameWoman.textContent = collageWomanNameInput.value || 'Woman';
        }
        if (displayAgeWoman && collageWomanAgeInput) {
            const ageVal = collageWomanAgeInput.value;
            displayAgeWoman.textContent = ageVal ? `Age ${ageVal}` : '';
        }

        syncToMainForm();
    }

    [collageManNameInput, collageManAgeInput, collageWomanNameInput, collageWomanAgeInput].forEach(input => {
        if (input) input.addEventListener('input', updateCollagePreviewText);
    });

    if (collageManPhotoInput) {
        collageManPhotoInput.addEventListener('input', () => {
            localManPhotoSrc = '';
            updateCollageManPhoto(collageManPhotoInput.value.trim());
            syncToMainForm();
        });
    }

    if (collageWomanPhotoInput) {
        collageWomanPhotoInput.addEventListener('input', () => {
            localWomanPhotoSrc = '';
            updateCollageWomanPhoto(collageWomanPhotoInput.value.trim());
            syncToMainForm();
        });
    }

    let alternateMergeSide = true;
    let lastLaunchTime = 0;
    if (collageCompatibilityPctInput) {
        collageCompatibilityPctInput.addEventListener('input', () => {
            let val = parseFloat(collageCompatibilityPctInput.value);
            if (val < 90) {
                val = Math.round(val);
                collageCompatibilityPctInput.value = val;
            }

            if (compatibilityInput) {
                compatibilityInput.value = val;
            }

            updateBars();

            if (val > 0) {
                const now = Date.now();
                if (now - lastLaunchTime > 60) {
                    if (alternateMergeSide && frameManCollage) {
                        launchMergingHeart(frameManCollage);
                    } else if (!alternateMergeSide && frameWomanCollage) {
                        launchMergingHeart(frameWomanCollage);
                    }
                    alternateMergeSide = !alternateMergeSide;
                    lastLaunchTime = now;
                }
            }
        });
    }

    if (frameManCollage && fileManPhoto) {
        frameManCollage.addEventListener('click', () => fileManPhoto.click());
    }
    if (frameWomanCollage && fileWomanPhoto) {
        frameWomanCollage.addEventListener('click', () => fileWomanPhoto.click());
    }

    if (fileManPhoto) {
        fileManPhoto.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    localManPhotoSrc = event.target.result;
                    updateCollageManPhoto(localManPhotoSrc);
                    if (manPhotoInput) manPhotoInput.value = 'Local Uploaded File';
                    if (collageManPhotoInput) collageManPhotoInput.value = '';
                    if (imgMan) {
                        imgMan.src = localManPhotoSrc;
                        imgMan.style.display = 'block';
                    }
                    spawnHeartBurst(frameManCollage, 12);
                };
                reader.readAsDataURL(file);
            }
        });
    }

    if (fileWomanPhoto) {
        fileWomanPhoto.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    localWomanPhotoSrc = event.target.result;
                    updateCollageWomanPhoto(localWomanPhotoSrc);
                    if (womanPhotoInput) womanPhotoInput.value = 'Local Uploaded File';
                    if (collageWomanPhotoInput) collageWomanPhotoInput.value = '';
                    if (imgWoman) {
                        imgWoman.src = localWomanPhotoSrc;
                        imgWoman.style.display = 'block';
                    }
                    spawnHeartBurst(frameWomanCollage, 12);
                };
                reader.readAsDataURL(file);
            }
        });
    }

    if (frameManCollage) {
        frameManCollage.addEventListener('mouseenter', () => spawnHeartBurst(frameManCollage, 4));
        frameManCollage.addEventListener('click', () => spawnHeartBurst(frameManCollage, 8));
    }
    if (frameWomanCollage) {
        frameWomanCollage.addEventListener('mouseenter', () => spawnHeartBurst(frameWomanCollage, 4));
        frameWomanCollage.addEventListener('click', () => spawnHeartBurst(frameWomanCollage, 8));
    }

    // PARTICLE ENGINE (Floating rising hearts)
    const HEART_CHARACTERS = ['♥', '💖', '💕', '💙', '💜', '💚', '💛', '💗', '💓'];
    const COLLAGE_THEME_COLORS = {
        rose: ['#fda4af', '#f43f5e', '#ec4899', '#f472b6'],
        amethyst: ['#d8b4fe', '#a855f7', '#c084fc', '#e9d5ff'],
        emerald: ['#6ee7b7', '#10b981', '#34d399', '#a7f3d0'],
        sapphire: ['#93c5fd', '#3b82f6', '#60a5fa', '#bfdbfe']
    };

    function startParticles() {
        stopParticles();
        particleInterval = setInterval(spawnParticle, 400);
    }

    function stopParticles() {
        if (particleInterval) {
            clearInterval(particleInterval);
            particleInterval = null;
        }
        if (collageParticlesContainer) {
            collageParticlesContainer.innerHTML = '';
        }
    }

    function spawnParticle(xPercent = null, yPercent = null, customSize = null, customVel = null) {
        if (!collageParticlesContainer) return;

        const particle = document.createElement('div');
        particle.className = 'heart-particle';
        particle.textContent = HEART_CHARACTERS[Math.floor(Math.random() * HEART_CHARACTERS.length)];

        const x = xPercent !== null ? xPercent : Math.random() * 100;
        particle.style.left = `${x}%`;

        if (yPercent !== null) {
            particle.style.bottom = `${yPercent}%`;
        }

        const colors = COLLAGE_THEME_COLORS[currentCollageTheme] || COLLAGE_THEME_COLORS.rose;
        particle.style.color = colors[Math.floor(Math.random() * colors.length)];

        const size = customSize !== null ? customSize : (12 + Math.random() * 24);
        particle.style.fontSize = `${size}px`;

        particle.style.transform = `rotate(${Math.random() * 40 - 20}deg)`;
        particle.style.opacity = (0.2 + Math.random() * 0.5).toString();

        const duration = customVel !== null ? customVel : (6 + Math.random() * 6);
        particle.style.animationDuration = `${duration}s`;

        collageParticlesContainer.appendChild(particle);

        setTimeout(() => {
            if (particle && particle.parentNode) {
                particle.parentNode.removeChild(particle);
            }
        }, duration * 1000);
    }

    function spawnHeartBurst(element, count = 8) {
        if (!collageParticlesContainer || !element) return;

        const rect = element.getBoundingClientRect();
        const containerRect = collageParticlesContainer.getBoundingClientRect();

        const elCenterX = rect.left + rect.width / 2;
        const elCenterY = rect.top + rect.height / 2;

        const xPercent = ((elCenterX - containerRect.left) / containerRect.width) * 100;
        const yPercent = 100 - (((elCenterY - containerRect.top) / containerRect.height) * 100);

        for (let i = 0; i < count; i++) {
            const size = 10 + Math.random() * 15;
            const duration = 2 + Math.random() * 3;
            const spreadX = xPercent + (Math.random() * 16 - 8);
            spawnParticle(spreadX, yPercent, size, duration);
        }
    }

    if (btnExportCollage) {
        btnExportCollage.addEventListener('click', () => {
            window.print();
        });
    }

    function triggerCenterBadgeSplash() {
        const centerElement = document.querySelector('.central-glow-heart');
        if (!centerElement || !collageParticlesContainer) return;

        const rect = centerElement.getBoundingClientRect();
        const containerRect = collageParticlesContainer.getBoundingClientRect();
        const xPercent = ((rect.left + rect.width / 2 - containerRect.left) / containerRect.width) * 100;
        const yPercent = 100 - (((rect.top + rect.height / 2 - containerRect.top) / containerRect.height) * 100);

        centerElement.classList.add('pulse-active');
        centerElement.style.transform = 'scale(1.25) rotate(8deg)';
        setTimeout(() => {
            centerElement.style.transform = '';
            centerElement.classList.remove('pulse-active');
        }, 180);

        for (let i = 0; i < 5; i++) {
            const size = 8 + Math.random() * 8;
            const duration = 1 + Math.random() * 1.5;
            const spreadX = xPercent + (Math.random() * 10 - 5);
            spawnParticle(spreadX, yPercent, size, duration);
        }
    }

    const MERGE_HEART_CHARACTERS = ['💖', '💕', '❤️', '💝', '💗', '💓'];
    function launchMergingHeart(fromElement) {
        if (!collageParticlesContainer || !fromElement) return;

        const fromRect = fromElement.getBoundingClientRect();
        const centerElement = document.querySelector('.central-glow-heart');
        if (!centerElement) return;
        const centerRect = centerElement.getBoundingClientRect();
        const containerRect = collageParticlesContainer.getBoundingClientRect();

        const startX = fromRect.left + fromRect.width / 2 - containerRect.left;
        const startY = fromRect.top + fromRect.height / 2 - containerRect.top;

        const targetX = centerRect.left + centerRect.width / 2 - containerRect.left;
        const targetY = centerRect.top + centerRect.height / 2 - containerRect.top;

        const heart = document.createElement('div');
        heart.className = 'merging-heart-particle';
        heart.textContent = MERGE_HEART_CHARACTERS[Math.floor(Math.random() * MERGE_HEART_CHARACTERS.length)];

        const colors = COLLAGE_THEME_COLORS[currentCollageTheme] || COLLAGE_THEME_COLORS.rose;
        heart.style.color = colors[Math.floor(Math.random() * colors.length)];

        const size = 16 + Math.random() * 10;
        heart.style.fontSize = `${size}px`;

        heart.style.left = `${startX - size / 2}px`;
        heart.style.top = `${startY - size / 2}px`;

        collageParticlesContainer.appendChild(heart);

        heart.style.setProperty('--target-x', `${targetX - startX}px`);
        heart.style.setProperty('--target-y', `${targetY - startY}px`);

        const curveX = (Math.random() * 40 - 20);
        const curveY = - (45 + Math.random() * 45);
        heart.style.setProperty('--curve-x', `${curveX}px`);
        heart.style.setProperty('--curve-y', `${curveY}px`);

        heart.style.animation = 'mergeToCenter 0.75s cubic-bezier(0.25, 1, 0.5, 1) forwards';

        setTimeout(() => {
            if (heart && heart.parentNode) {
                heart.parentNode.removeChild(heart);
            }
            triggerCenterBadgeSplash();
        }, 750);
    }

    updateBars();
})();

