// ===== Config =====
// Minimal line-icon paths (24x24 viewBox) per category — rendered with currentColor
// so they pick up the chip/pin/theme color automatically.
const CATEGORY_ICONS = {
  "בית קפה": `<rect x="5" y="9" width="11" height="8" rx="2"/><path d="M16 11h2a2 2 0 0 1 0 4h-2"/><path d="M8 5v2M11 5v2M14 5v2"/>`,
  "מסעדה": `<path d="M6 2v7a2 2 0 0 0 2 2v11"/><path d="M6 2v4M8 2v4M10 2v4"/><path d="M17 2c-1.8 1.2-2 3.5-2 5.5 0 1.3.7 2.2 2 2.5v12"/>`,
  "בר": `<path d="M4 4h16l-8 8-8-8z"/><path d="M12 12v8M8 20h8"/>`,
  "גלידריה וקינוחים": `<circle cx="12" cy="7" r="4.5"/><path d="M8.2 10l3.8 11 3.8-11"/>`,
  "אוכל רחוב": `<rect x="2" y="9" width="13" height="6" rx="1.5"/><path d="M15 11h4l2.5 2.5V15h-6.5"/><circle cx="6.5" cy="17" r="1.8"/><circle cx="16.5" cy="17" r="1.8"/>`,
  "מאפיה מעדנייה": `<path d="M4 13c0-4.5 3.5-8 8-8s8 3.5 8 8-3.5 5-8 5-8-.5-8-5z"/><path d="M8.5 10.5l1 4M12 9.5v6M15.5 10.5l-1 4"/>`,
  "מיצים ושייקים": `<path d="M6.5 8h11l-1.2 11.5a2 2 0 0 1-2 1.8h-4.6a2 2 0 0 1-2-1.8L6.5 8z"/><path d="M9.5 8V5.5a2.5 2.5 0 0 1 5 0V8"/><path d="M14 3.5l1-2"/>`
};

function categoryIconSvg(cat, size = 20) {
  const path = CATEGORY_ICONS[cat] || `<circle cx="12" cy="12" r="8"/>`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

// Each category gets its own color, used for chips, map pins, and the sheet icon.
const CATEGORY_COLORS = {
  "מסעדה": "#EF4444",
  "בית קפה": "#F59E0B",
  "מאפיה מעדנייה": "#84CC16",
  "אוכל רחוב": "#10B981",
  "מיצים ושייקים": "#3B82F6",
  "בר": "#A855F7",
  "גלידריה וקינוחים": "#EC4899"
};
function categoryColor(cat) {
  return CATEGORY_COLORS[cat] || accentColor();
}

const DEFAULT_CENTER = [32.0853, 34.7818]; // Tel Aviv fallback

// ===== State =====
let ALL_PLACES = [];
let selectedCategories = new Set();
let userLatLng = null;
let radiusKm = 0.5;
let map, userMarker, radiusCircle;
let markers = []; // {marker, place}

// ===== Utils =====
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(km) {
  if (km < 1) return Math.round(km * 1000) + " מ'";
  return km.toFixed(1).replace(/\.0$/, "") + " ק\"מ";
}

function accentColor() {
  return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
}

function applyTimeTheme() {
  const hour = new Date().getHours();
  const isDay = hour >= 6 && hour < 19; // 06:00–19:00 = day, otherwise night
  document.documentElement.dataset.theme = isDay ? "day" : "night";
  if (radiusCircle) {
    radiusCircle.setStyle({ color: accentColor(), fillColor: accentColor() });
  }
}

function normalizeUrl(url) {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : "https://" + url;
}

// ===== Load data =====
async function loadPlaces() {
  const res = await fetch("places.json");
  ALL_PLACES = await res.json();
}

// ===== Build category picker =====
function buildCategoryGrid() {
  const grid = document.getElementById("category-grid");
  const cats = Object.keys(CATEGORY_ICONS).filter(c =>
    ALL_PLACES.some(p => p.category === c)
  );
  grid.innerHTML = "";
  cats.forEach(cat => {
    const chip = document.createElement("div");
    chip.className = "cat-chip";
    chip.dataset.cat = cat;
    chip.style.setProperty("--cat-color", categoryColor(cat));
    chip.innerHTML = `<span class="cat-icon">${categoryIconSvg(cat, 20)}</span><span>${cat}</span>`;
    chip.addEventListener("click", () => {
      if (selectedCategories.has(cat)) {
        selectedCategories.delete(cat);
        chip.classList.remove("selected");
      } else {
        selectedCategories.add(cat);
        chip.classList.add("selected");
      }
      updateFindBtn();
    });
    grid.appendChild(chip);
  });
}

function updateFindBtn() {
  const btn = document.getElementById("find-btn");
  btn.disabled = selectedCategories.size === 0;
}

// ===== Geolocation =====
function requestLocation() {
  const status = document.getElementById("picker-status");
  if (!navigator.geolocation) {
    status.textContent = "הדפדפן לא תומך במיקום. עוברים למרכז תל אביב.";
    userLatLng = DEFAULT_CENTER;
    goToMap();
    return;
  }

  status.textContent = "מבקש הרשאת מיקום...";
  let settled = false;

  // Hard fallback: some in-app browsers (e.g. links opened inside WhatsApp/Instagram)
  // silently block geolocation and never fire the browser's own success/error/timeout
  // callbacks. This guarantees the app doesn't get stuck waiting forever.
  const fallbackTimer = setTimeout(() => {
    if (settled) return;
    settled = true;
    status.textContent = "לא הצלחנו לקבל מיקום. אם פתחת את הקישור מתוך וואטסאפ/אינסטגרם, נסו לפתוח אותו בספארי או כרום. עוברים למרכז תל אביב.";
    userLatLng = DEFAULT_CENTER;
    setTimeout(goToMap, 1800);
  }, 8000);

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (settled) return;
      settled = true;
      clearTimeout(fallbackTimer);
      userLatLng = [pos.coords.latitude, pos.coords.longitude];
      goToMap();
    },
    (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(fallbackTimer);
      status.textContent = "לא הצלחנו לקבל מיקום (" + err.message + "). אם פתחת את הקישור מתוך וואטסאפ/אינסטגרם, נסו לפתוח אותו בספארי או כרום. עוברים למרכז תל אביב.";
      userLatLng = DEFAULT_CENTER;
      setTimeout(goToMap, 1800);
    },
    { enableHighAccuracy: true, timeout: 7000, maximumAge: 60000 }
  );
}

// ===== Map screen =====
let hintShown = false;

function goToMap() {
  document.getElementById("picker-screen").classList.add("hidden");
  document.getElementById("map-screen").classList.remove("hidden");
  if (!map) initMap();
  centerOnUser();
  renderMarkers();
  if (!hintShown) {
    hintShown = true;
    setTimeout(() => showToast("💡 גררו את הסיכה או הקישו על המפה כדי לחפש במקום אחר"), 400);
  }
}

function initMap() {
  map = L.map("map", { zoomControl: false }).setView(userLatLng || DEFAULT_CENTER, 15);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  // Tap anywhere on the map to move the search center there — lets you browse
  // spots around any location, not just where your phone's GPS says you are.
  map.on("click", (e) => updateSearchCenter(e.latlng.lat, e.latlng.lng));
}

// Moves the search pin + radius to a new point and re-filters results from there.
function updateSearchCenter(lat, lng) {
  userLatLng = [lat, lng];
  if (userMarker) userMarker.setLatLng(userLatLng);
  if (radiusCircle) radiusCircle.setLatLng(userLatLng);
  renderMarkers();
  showToast("מחפשים מהמיקום שסימנתם 📍");
}

function centerOnUser() {
  if (!userLatLng) return;
  map.setView(userLatLng, 16);
  if (userMarker) map.removeLayer(userMarker);
  userMarker = L.marker(userLatLng, {
    draggable: true,
    icon: L.divIcon({ className: "user-pin", iconSize: [24, 24] })
  }).addTo(map);
  userMarker.on("drag", () => {
    if (radiusCircle) radiusCircle.setLatLng(userMarker.getLatLng());
  });
  userMarker.on("dragend", () => {
    const pos = userMarker.getLatLng();
    updateSearchCenter(pos.lat, pos.lng);
  });

  if (radiusCircle) map.removeLayer(radiusCircle);
  radiusCircle = L.circle(userLatLng, {
    radius: radiusKm * 1000,
    color: accentColor(),
    fillColor: accentColor(),
    fillOpacity: 0.08,
    weight: 1.5
  }).addTo(map);
}

function renderMarkers() {
  markers.forEach(m => map.removeLayer(m.marker));
  markers = [];

  if (!userLatLng) return;

  const matches = ALL_PLACES.filter(p => {
    if (!p.lat || !p.lon) return false;
    if (selectedCategories.size && !selectedCategories.has(p.category)) return false;
    const d = haversineKm(userLatLng[0], userLatLng[1], p.lat, p.lon);
    p._distance = d;
    return d <= radiusKm;
  }).sort((a, b) => a._distance - b._distance);

  matches.forEach(p => {
    const icon = L.divIcon({
      className: "",
      html: `<div class="place-pin" style="background:${categoryColor(p.category)}"><span>${categoryIconSvg(p.category, 16)}</span></div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 34]
    });
    const marker = L.marker([p.lat, p.lon], { icon }).addTo(map);
    marker.on("click", () => openDetail(p));
    markers.push({ marker, place: p });
  });

  document.getElementById("result-count").textContent =
    matches.length ? `${matches.length} מקומות בסביבה` : "אין מקומות ברדיוס הזה";

  // total geocoded places available (for status when few results)
  const totalMatchingCategory = ALL_PLACES.filter(p => selectedCategories.has(p.category)).length;
  if (matches.length === 0) {
    document.getElementById("result-count").textContent =
      totalMatchingCategory > 0
        ? "אין מקומות ברדיוס - נסו להגדיל אותו"
        : "אין מקומות מהסוג הזה במאגר";
  }
}

// ===== Detail sheet =====
const RATING_BADGES = {
  google: { letter: "G", bg: "#4285F4", fg: "#ffffff" },
  wolt:   { letter: "W", bg: "#00C2E8", fg: "#0b3b46" },
  ta:     { letter: "T", bg: "#00AF87", fg: "#ffffff" },
  easy:   { letter: "E", bg: "#8B5CF6", fg: "#ffffff" }
};

function ratingCard(key, value, count) {
  if (value === null || value === undefined || value === "") return "";
  const b = RATING_BADGES[key];
  const countText = count ? `${count.toLocaleString("he-IL")} דירוגים` : "";
  return `<div class="rating-card">
    <div class="badge" style="background:${b.bg};color:${b.fg}">${b.letter}</div>
    <div class="rc-info">
      <div class="value">${value}</div>
      <div class="count">${countText}</div>
    </div>
  </div>`;
}

function openDetail(p) {
  const dist = p._distance !== undefined
    ? formatDistance(p._distance)
    : (userLatLng ? formatDistance(haversineKm(userLatLng[0], userLatLng[1], p.lat, p.lon)) : "");

  const ratingsHtml = [
    ratingCard("google", p.google_rating, p.google_count),
    ratingCard("wolt", p.wolt, null),
    ratingCard("ta", p.ta_score, p.ta_count),
    ratingCard("easy", p.easy_score, p.easy_count)
  ].filter(Boolean).join("");

  const html = `
    <div class="sheet-title-row">
      <h2 class="sheet-title">${p.name}</h2>
      <button id="sheet-share-btn-el" class="sheet-share-btn" aria-label="שיתוף">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg>
      </button>
    </div>
    <div class="sheet-cat"><span class="cat-icon" style="color:${categoryColor(p.category)}">${categoryIconSvg(p.category, 16)}</span> ${p.category}</div>
    <div class="sheet-address">${p.address || ""}</div>
    <div class="sheet-meta-row">
      <div class="meta-pill distance">📍 ${dist}</div>
    </div>
    ${ratingsHtml ? `<div class="ratings-grid">${ratingsHtml}</div>` : ""}
    ${p.link ? `<a class="sheet-link-btn" href="${normalizeUrl(p.link)}" target="_blank" rel="noopener">קישור למקום</a>` : ""}
    <a class="sheet-nav-btn" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}" target="_blank" rel="noopener">GO</a>
  `;
  document.getElementById("sheet-content").innerHTML = html;
  document.getElementById("detail-sheet").classList.remove("hidden");
  document.getElementById("sheet-backdrop").classList.remove("hidden");

  const shareBtn = document.getElementById("sheet-share-btn-el");
  if (shareBtn) shareBtn.addEventListener("click", () => sharePlace(p));
}

// ===== Share =====
async function sharePlace(p) {
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`;
  const wazeUrl = `https://waze.com/ul?ll=${p.lat},${p.lon}&navigate=yes`;
  const text = [
    `📍 ${p.name}`,
    [p.category, p.address].filter(Boolean).join(" — "),
    "",
    `ניווט בגוגל מפות: ${mapsUrl}`,
    `ניווט בוויז: ${wazeUrl}`
  ].join("\n");

  if (navigator.share) {
    try {
      await navigator.share({ title: p.name, text });
    } catch (e) {
      // user cancelled the share sheet — nothing to do
    }
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast("הטקסט הועתק — אפשר להדביק בוואטסאפ");
  } catch (e) {
    showToast("שיתוף לא נתמך במכשיר הזה");
  }
}

function showToast(msg) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 2500);
}

function closeDetail() {
  document.getElementById("detail-sheet").classList.add("hidden");
  document.getElementById("sheet-backdrop").classList.add("hidden");
}

// ===== Wire up events =====
function setRadius(value) {
  radiusKm = parseFloat(value);
  document.getElementById("radius-select").value = value;
  document.getElementById("radius-select-2").value = value;
  if (map && userLatLng) {
    if (radiusCircle) radiusCircle.setRadius(radiusKm * 1000);
    renderMarkers();
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  applyTimeTheme();
  setInterval(applyTimeTheme, 15 * 60 * 1000); // re-check every 15 min in case day/night flips mid-session

  await loadPlaces();
  buildCategoryGrid();

  document.getElementById("find-btn").addEventListener("click", requestLocation);
  document.getElementById("skip-location-btn").addEventListener("click", () => {
    userLatLng = DEFAULT_CENTER;
    goToMap();
  });
  document.getElementById("back-btn").addEventListener("click", () => {
    document.getElementById("map-screen").classList.add("hidden");
    document.getElementById("picker-screen").classList.remove("hidden");
  });
  document.getElementById("locate-btn").addEventListener("click", () => {
    requestLocation();
  });
  document.getElementById("radius-select").addEventListener("change", (e) => setRadius(e.target.value));
  document.getElementById("radius-select-2").addEventListener("change", (e) => setRadius(e.target.value));
  document.getElementById("sheet-close").addEventListener("click", closeDetail);
  document.getElementById("sheet-backdrop").addEventListener("click", closeDetail);
});
