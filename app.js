// ===== Config =====
const CATEGORY_EMOJI = {
  "בית קפה": "☕",
  "מסעדה": "🍽️",
  "בר": "🍸",
  "בר יינות": "🍷",
  "גלידריה": "🍦",
  "גלידריה וקינוחים": "🍨",
  "אוכל רחוב": "🌯",
  "מאפיה מעדנייה": "🥐",
  "מיצים ושייקים": "🥤"
};
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
  const cats = Object.keys(CATEGORY_EMOJI).filter(c =>
    ALL_PLACES.some(p => p.category === c)
  );
  grid.innerHTML = "";
  cats.forEach(cat => {
    const chip = document.createElement("div");
    chip.className = "cat-chip";
    chip.dataset.cat = cat;
    chip.innerHTML = `<span class="emoji">${CATEGORY_EMOJI[cat] || "📍"}</span><span>${cat}</span>`;
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
    status.textContent = "הדפדפן לא תומך במיקום. אפשר לבדוק על המפה באופן ידני.";
    userLatLng = DEFAULT_CENTER;
    goToMap();
    return;
  }
  status.textContent = "מבקש הרשאת מיקום...";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userLatLng = [pos.coords.latitude, pos.coords.longitude];
      goToMap();
    },
    (err) => {
      status.textContent = "לא הצלחנו לקבל מיקום (" + err.message + "). מציג את מרכז תל אביב במקום.";
      userLatLng = DEFAULT_CENTER;
      setTimeout(goToMap, 1200);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

// ===== Map screen =====
function goToMap() {
  document.getElementById("picker-screen").classList.add("hidden");
  document.getElementById("map-screen").classList.remove("hidden");
  if (!map) initMap();
  centerOnUser();
  renderMarkers();
}

function initMap() {
  map = L.map("map", { zoomControl: false }).setView(userLatLng || DEFAULT_CENTER, 15);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
}

function centerOnUser() {
  if (!userLatLng) return;
  map.setView(userLatLng, 16);
  if (userMarker) map.removeLayer(userMarker);
  userMarker = L.marker(userLatLng, {
    icon: L.divIcon({ className: "user-pin", iconSize: [18, 18] })
  }).addTo(map);

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
    const emoji = CATEGORY_EMOJI[p.category] || "📍";
    const icon = L.divIcon({
      className: "",
      html: `<div class="place-pin"><span>${emoji}</span></div>`,
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
  const emoji = CATEGORY_EMOJI[p.category] || "📍";
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
    </div>
    <div class="sheet-cat">${emoji} ${p.category}</div>
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
