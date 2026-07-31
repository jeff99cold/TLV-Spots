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

  // Keep the OS status bar / browser chrome color in sync with the theme —
  // otherwise it stays permanently dark and clashes with the light daytime page.
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  const meta = document.getElementById("theme-color-meta");
  if (meta && bg) meta.setAttribute("content", bg);

  if (radiusCircle) {
    radiusCircle.setStyle({ color: accentColor(), fillColor: accentColor() });
  }
}

function normalizeUrl(url) {
  if (!url) return null;
  const trimmed = String(url).trim();
  // Explicitly reject anything that isn't a plain http(s) link — blocks
  // javascript:/data:/vbscript: etc. schemes from ever ending up in an href.
  // (The https:// prefix below already made this safe by accident, but this
  // makes the protection deliberate instead of incidental.)
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    return null;
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed : "https://" + trimmed;
}

// Escapes user-visible text before it's inserted as HTML — defense in depth
// in case a venue name/address in places.json ever contained HTML-special
// characters (a copy-paste mistake, stray "<", etc.), so it always renders as
// plain text rather than being parsed as markup.
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
function revealLocationFallbackUI() {
  const skipBtn = document.getElementById("skip-location-btn");
  const hint = document.getElementById("whatsapp-hint");
  if (skipBtn) skipBtn.classList.remove("hidden");
  if (hint) hint.classList.remove("hidden");
}

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
    revealLocationFallbackUI();
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
      revealLocationFallbackUI();
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

// When two or more spots sit at (or very near) the same coordinates, their pins
// stack exactly on top of each other and the ones underneath become unclickable.
// This fans overlapping pins out in a small circle in screen-pixel space (so the
// separation looks right at any zoom level) while leaving the real p.lat/p.lon
// — used for distance, GO, and share — untouched.
function declutterPositions(matches) {
  const positions = new Map();
  const groups = new Map();

  matches.forEach(p => {
    const key = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`; // ~11m buckets
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  });

  groups.forEach(group => {
    if (group.length === 1) {
      positions.set(group[0], [group[0].lat, group[0].lon]);
      return;
    }
    const center = map.latLngToLayerPoint([group[0].lat, group[0].lon]);
    const radiusPx = 16;
    const angleStep = (2 * Math.PI) / group.length;
    group.forEach((p, i) => {
      const angle = i * angleStep - Math.PI / 2;
      const point = L.point(center.x + radiusPx * Math.cos(angle), center.y + radiusPx * Math.sin(angle));
      const latlng = map.layerPointToLatLng(point);
      positions.set(p, [latlng.lat, latlng.lng]);
    });
  });

  return positions;
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

  const displayPositions = declutterPositions(matches);

  matches.forEach(p => {
    const icon = L.divIcon({
      className: "",
      html: `<div class="place-pin" style="background:${categoryColor(p.category)}"><span>${categoryIconSvg(p.category, 16)}</span></div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 34]
    });
    const marker = L.marker(displayPositions.get(p), { icon }).addTo(map);
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

  const safeLink = p.link ? normalizeUrl(p.link) : null;

  const html = `
    <div class="sheet-title-row">
      <h2 class="sheet-title">${escapeHtml(p.name)}</h2>
    </div>
    <div class="sheet-cat"><span class="cat-icon" style="color:${categoryColor(p.category)}">${categoryIconSvg(p.category, 16)}</span> ${escapeHtml(p.category)}</div>
    <div class="sheet-address">${escapeHtml(p.address || "")}</div>
    <div class="sheet-meta-row">
      <div class="meta-pill distance">📍 ${dist}</div>
      <button id="sheet-share-btn-el" class="meta-pill share-pill" aria-label="שיתוף">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="2.8"/><circle cx="6" cy="12" r="2.8"/><circle cx="18" cy="19" r="2.8"/><path d="M8.5 10.5l7-4M8.5 13.5l7 4"/></svg>
        <span>שחרר</span>
      </button>
    </div>
    ${ratingsHtml ? `<div class="ratings-grid">${ratingsHtml}</div>` : ""}
    ${safeLink ? `<a class="sheet-link-btn" href="${safeLink}" target="_blank" rel="noopener">חַבֵּר</a>` : ""}
    <a class="sheet-nav-btn" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}" target="_blank" rel="noopener">יָאלללָה</a>
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
    "ניווט בגוגל מפות:",
    mapsUrl,
    "",
    "ניווט בוויז:",
    wazeUrl
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

// Shares the app itself (not a specific spot) — used by the button at the
// bottom of the picker screen.
async function shareApp() {
  // A short redirect link instead of the raw GitHub Pages URL, so the
  // username/host isn't visible when someone shares the app.
  const appUrl = "https://tinyurl.com/tlv-spots-app";
  const shareText = "שששש... לא מספרים על TLV Spots";

  if (navigator.share) {
    try {
      // Pass the URL only via the dedicated `url` field, not inside `text` too —
      // WhatsApp (and some other share targets) append the url field on its own
      // line, so including it in text as well made the link show up twice.
      await navigator.share({ title: "TLV Spots", text: shareText, url: appUrl });
    } catch (e) {
      // user cancelled the share sheet — nothing to do
    }
    return;
  }

  try {
    await navigator.clipboard.writeText(`${shareText}\n${appUrl}`);
    showToast("הקישור הועתק — אפשר להדביק בוואטסאפ");
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

// ===== Suggest a new spot =====
// Submissions are relayed through Formspree (a free static-site form-to-email
// service) since this app has no backend of its own. Replace the placeholder
// below with your real Formspree endpoint (formspree.io) once you've created one.
const SPOT_SUBMIT_ENDPOINT = "https://formspree.io/f/xrenvqyz";

function openAddSpotScreen() {
  document.getElementById("picker-screen").classList.add("hidden");
  document.getElementById("add-spot-screen").classList.remove("hidden");
}

function closeAddSpotScreen() {
  document.getElementById("add-spot-screen").classList.add("hidden");
  document.getElementById("picker-screen").classList.remove("hidden");
}

// Opens Google Maps already searched for whatever name was typed — using the
// "api=1&query=" deep-link format, which (unlike a generic maps.google.com
// link) reliably lands straight on the matching place's card instead of a
// blank map, so there's no need to type the name again once inside Maps.
function openGoogleMaps() {
  const query = document.getElementById("spot-search-input").value.trim();
  const url = query
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
    : "https://www.google.com/maps";
  window.open(url, "_blank", "noopener");
}

// One-tap paste from the clipboard, instead of long-pressing the field and
// picking "Paste" from the popup menu. Falls back silently if the browser
// blocks clipboard reads (e.g. no permission) — the user can still long-press
// and paste manually.
async function pasteFromClipboard() {
  const field = document.getElementById("spot-paste-input");
  try {
    const clip = await navigator.clipboard.readText();
    if (clip) field.value = clip;
  } catch (e) {
    // clipboard read blocked — user can still paste manually into the field
  }
}

// Pulls whatever the user pasted (name, address, link — all mixed together,
// exactly what "Share → Copy" gives you from Google Maps) and separates out
// the URL from a name guess, so they never have to type or match anything
// into separate boxes.
function extractFirstUrl(str) {
  if (!str) return "";
  const match = str.match(/https?:\/\/\S+/);
  return match ? match[0] : "";
}

function parsePastedSpot(raw) {
  const url = extractFirstUrl(raw);
  const nameGuess = raw
    .split("\n")
    .map(line => line.trim())
    .find(line => line && !line.startsWith("http")) || "";
  return { url, name: nameGuess };
}

// Only links on an actual Google domain are ever forwarded to DJ's inbox.
// This is a personal spot-suggestion box, not a general link box — someone
// could paste (accidentally or on purpose) an unrelated malicious link, or
// craft a fake "share" URL to this app with a bad link baked into the
// shared_url param. Either way, anything that isn't google.com/goo.gl gets
// silently dropped rather than relayed as a clickable link in an email.
const TRUSTED_LINK_HOSTS = ["google.com", "goo.gl", "g.co"];
function isTrustedMapsUrl(url) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return TRUSTED_LINK_HOSTS.some(h => host === h || host.endsWith("." + h));
  } catch (e) {
    return false;
  }
}

// Removes a rejected (untrusted) URL from the raw pasted text before it's
// sent anywhere, so no arbitrary link ever leaves the client even inside the
// free-text "what was pasted" field.
function scrubUntrustedUrl(raw, rawUrl, trusted) {
  if (!rawUrl || trusted) return raw;
  return raw.split(rawUrl).join("[קישור הוסר - לא זוהה כדומיין גוגל]");
}

// ===== Receiving a share from the Google Maps app (no copy/paste needed) =====
// TLV Spots is registered as a Web Share Target in manifest.json. On Android,
// once the app is installed to the home screen, it shows up as an option in
// the native share sheet — so instead of copying a link out of Google Maps,
// the user can just tap Share on a place there and pick "TLV Spots" directly.
// The shared data (title/text/url) arrives as query params on page load.
// (This isn't supported by iOS Safari — there's no PWA share-target API on
// iOS — so the paste-box flow above stays in place as a fallback there.)
// If the data does arrive via Web Share Target (Android, app installed), it's
// treated purely as a nice bonus that pre-fills the fields — never a required
// step. The name goes straight into the main required field, and a link (if
// present) is dropped into the optional "got a link?" section, which is
// auto-expanded so the user can see it was captured.
function handleIncomingShare() {
  const params = new URLSearchParams(window.location.search);
  const sharedTitle = params.get("shared_title") || "";
  const sharedText = params.get("shared_text") || "";
  const sharedUrl = params.get("shared_url") || "";

  if (!sharedTitle && !sharedText && !sharedUrl) return false;

  const rawMapsUrl = sharedUrl || extractFirstUrl(sharedText);
  const mapsUrl = isTrustedMapsUrl(rawMapsUrl) ? rawMapsUrl : "";
  const name = sharedTitle || sharedText.split("\n")[0] || "";

  // Clean the shared params out of the address bar so a page refresh doesn't
  // try to re-populate/resubmit the same shared spot.
  window.history.replaceState({}, "", window.location.pathname);

  document.getElementById("picker-screen").classList.add("hidden");
  document.getElementById("add-spot-screen").classList.remove("hidden");
  document.getElementById("spot-search-input").value = name;
  if (mapsUrl) {
    document.getElementById("spot-paste-input").value = mapsUrl;
    const details = document.querySelector(".add-spot-optional");
    if (details) details.open = true;
  }

  return true;
}

// The only thing a user must actually do is type a name (+ rough area) and
// tap send — everything else (opening Maps to double-check, pasting a link)
// is optional. DJ looks up the exact address/details by hand from the name
// when reviewing submissions, same as with a link.
async function submitNewSpot() {
  const name = document.getElementById("spot-search-input").value.trim();
  const status = document.getElementById("add-spot-status");

  if (!name) {
    status.textContent = "כתבו קודם את שם המקום";
    return;
  }

  const raw = document.getElementById("spot-paste-input").value.trim();
  const rawUrl = extractFirstUrl(raw);
  const trusted = isTrustedMapsUrl(rawUrl);
  const url = trusted ? rawUrl : "";
  const linkWasRejected = rawUrl && !trusted;

  const submitBtn = document.getElementById("spot-submit-btn");
  submitBtn.disabled = true;
  status.textContent = "שולח...";

  const formData = new FormData();
  formData.append("name_guess", name);
  formData.append("maps_url", url);
  formData.append("raw_paste", scrubUntrustedUrl(raw, rawUrl, trusted));
  formData.append("_subject", `new spot for spots - ${name}`);
  // Keep the "message" field free of a raw link — spam filters (including
  // Formspree's Formshield) score plain-text URLs in the message body highly,
  // which caused real submissions to land in Spam instead of the inbox. The
  // actual link still comes through fine in its own named field (maps_url).
  formData.append("message", `שם משוער: ${name}\n${url ? "יש קישור מגוגל מפות מצורף למטה (שדה נפרד)" : "לא צורף קישור"}`);

  try {
    const response = await fetch(SPOT_SUBMIT_ENDPOINT, {
      method: "POST",
      headers: { "Accept": "application/json" },
      body: formData
    });
    if (response.ok) {
      status.textContent = linkWasRejected
        ? "תודה! (הקישור שהודבק לא זוהה כקישור גוגל מפות ולכן לא נשלח) 🙌"
        : "תודה! נבדוק ונוסיף בקרוב 🙌";
      document.getElementById("spot-search-input").value = "";
      document.getElementById("spot-paste-input").value = "";
      setTimeout(closeAddSpotScreen, 1600);
    } else {
      status.textContent = "משהו השתבש — נסו שוב בעוד רגע";
    }
  } catch (e) {
    status.textContent = "משהו השתבש — נסו שוב בעוד רגע";
  } finally {
    submitBtn.disabled = false;
  }
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
  handleIncomingShare();

  document.getElementById("find-btn").addEventListener("click", () => {
    // If we already have a location (real GPS or a manually-moved pin from a
    // previous search), reuse it — only fetch fresh GPS the very first time.
    // Otherwise editing filters/distance and tapping יאללה again would snap
    // the pin back to the phone's GPS and discard the moved location.
    if (userLatLng) {
      goToMap();
    } else {
      requestLocation();
    }
  });
  document.getElementById("skip-location-btn").addEventListener("click", () => {
    userLatLng = DEFAULT_CENTER;
    goToMap();
  });
  document.getElementById("back-btn").addEventListener("click", () => {
    document.getElementById("map-screen").classList.add("hidden");
    document.getElementById("picker-screen").classList.remove("hidden");
    // Clear any leftover "requesting location..." status text from the
    // original GPS request — it has no reason to still be shown once we're
    // back editing filters with a location already established.
    document.getElementById("picker-status").textContent = "";
  });
  document.getElementById("locate-btn").addEventListener("click", () => {
    requestLocation();
  });
  document.getElementById("radius-select").addEventListener("change", (e) => setRadius(e.target.value));
  document.getElementById("radius-select-2").addEventListener("change", (e) => setRadius(e.target.value));
  document.getElementById("sheet-close").addEventListener("click", closeDetail);
  document.getElementById("sheet-backdrop").addEventListener("click", closeDetail);
  document.getElementById("share-app-btn").addEventListener("click", shareApp);
  document.getElementById("add-spot-btn").addEventListener("click", openAddSpotScreen);
  document.getElementById("add-spot-close").addEventListener("click", closeAddSpotScreen);
  document.getElementById("spot-open-maps-btn").addEventListener("click", openGoogleMaps);
  document.getElementById("spot-paste-btn").addEventListener("click", pasteFromClipboard);
  document.getElementById("spot-submit-btn").addEventListener("click", submitNewSpot);
});
