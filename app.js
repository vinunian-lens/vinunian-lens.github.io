/* ============================================================
   My VinUni Journey — app.js  (Story edition, data-driven)
   All story & location data loaded from /data/*.json files.
   Edit those files to change content — no code changes needed.
   ============================================================ */

// Loaded from JSON
let ROUTES         = [];
let STORY_CHAPTERS = [];

// ── State ─────────────────────────────────────────────────────
const state = {
  chapterIndex: 0,
  currentScene: null,
  yaw: 0,
  pitch: 0,
  pendingYaw: null,
  pendingPitch: null,
  sidebarOpen: false,
  tab: "story",
  coverVisible: true,
  outroVisible: false,
  // When browsing a location without a chapter, the chapter panel
  // hides and we show location info instead.
  browseMode: false,
  browseLocation: null,
  noteVisible: true,
};

let viewer = null;
let rafId  = null;
let lastPinRender = 0;

// ── Helpers ───────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const el = (tag, cls, html = "") => {
  const e = document.createElement(tag);
  if (cls)  e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const esc = s => String(s)
  .replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const fmtDate = iso => {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });
};
function angleDiff(a, b) {
  let d = ((a - b) % 360 + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}
function locationName(id) {
  const r = ROUTES.find(r => r.id === id);
  return r ? r.name : id;
}
function locationDesc(id) {
  const r = ROUTES.find(r => r.id === id);
  return r ? r.desc : "";
}

// ── Data loading ──────────────────────────────────────────────
async function loadData() {
  const [locResp, storyResp] = await Promise.all([
    fetch("data/locations.json"),
    fetch("data/story.json"),
  ]);
  if (!locResp.ok || !storyResp.ok) {
    throw new Error(`Failed to load data: locations=${locResp.status}, story=${storyResp.status}`);
  }
  const locData   = await locResp.json();
  const storyData = await storyResp.json();

  ROUTES         = locData.locations || [];
  STORY_CHAPTERS = (storyData.chapters || []).sort((a, b) => a.order - b.order);

  // Resolve local image paths: if image starts with "assets/", prefix with nothing
  // (already relative to root). If it's a full URL, keep as-is. null stays null.
  STORY_CHAPTERS.forEach(ch => {
    if (ch.image && !ch.image.startsWith("http") && !ch.image.startsWith("/")) {
      // Already relative — leave as-is so "assets/photo.jpg" works from the root
    }
  });
}

// ── Cubemap assembly ──────────────────────────────────────────
const CUBEMAP_FACES  = ["f","r","b","l","u","d"];
const TILE_SIZE      = 512;
const TILES_PER_SIDE = 2;
let _loadSeq = 0;

async function assembleCubemap(sceneId, seq) {
  return Promise.all(CUBEMAP_FACES.map(face => new Promise(resolve => {
    const canvas = document.createElement("canvas");
    canvas.width  = TILE_SIZE * TILES_PER_SIDE;
    canvas.height = TILE_SIZE * TILES_PER_SIDE;
    const ctx = canvas.getContext("2d");

    const loads = [];
    for (let row = 0; row < TILES_PER_SIDE; row++) {
      for (let col = 0; col < TILES_PER_SIDE; col++) {
        loads.push(new Promise(res => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload  = () => { ctx.drawImage(img, col * TILE_SIZE, row * TILE_SIZE); res(); };
          img.onerror = res;
          img.src = `vtile/${sceneId}/${face}/1/${row}/${col}.jpg`;
        }));
      }
    }
    Promise.all(loads).then(() => {
      if (_loadSeq !== seq) { resolve(null); return; }
      canvas.toBlob(b => resolve(b ? URL.createObjectURL(b) : null), "image/jpeg", 0.92);
    });
  })));
}

async function initPannellum(sceneId) {
  const pano = $("panorama");
  pano.classList.add("pano-fading");

  if (viewer) { viewer.destroy(); viewer = null; }
  if (rafId)  { cancelAnimationFrame(rafId); rafId = null; }

  const seq = ++_loadSeq;
  const cubeMap = await assembleCubemap(sceneId, seq);
  if (_loadSeq !== seq) return;

  viewer = pannellum.viewer("panorama", {
    type:         "cubemap",
    cubeMap,
    autoLoad:     true,
    showControls: false,
    hotSpotDebug: false,
    compass:      false,
  });

  setTimeout(() => pano.classList.remove("pano-fading"), 220);

  function tick() {
    if (viewer) {
      if (state.pendingYaw !== null && viewer.isLoaded()) {
        viewer.setYaw(state.pendingYaw);
        if (state.pendingPitch !== null) viewer.setPitch(state.pendingPitch);
        state.pendingYaw   = null;
        state.pendingPitch = null;
        state.yaw   = ((viewer.getYaw() % 360) + 360) % 360;
        state.pitch = viewer.getPitch();
        if (!state.browseMode) renderPins();
      }
      const newYaw   = ((viewer.getYaw() % 360) + 360) % 360;
      const newPitch = viewer.getPitch();
      const now      = Date.now();
      if ((Math.abs(newYaw - state.yaw) > 0.3 || Math.abs(newPitch - state.pitch) > 0.3)
          && now - lastPinRender > 50) {
        state.yaw     = newYaw;
        state.pitch   = newPitch;
        lastPinRender = now;
        $("yaw-display").textContent = `${Math.round(newYaw)}° / ${Math.round(newPitch)}°`;
        if (!state.browseMode) renderPins();
      }
    }
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);
}

// ── Story navigation ──────────────────────────────────────────
function goToChapter(index) {
  if (state.outroVisible) hideOutro();

  if (index < 0) index = 0;
  if (index >= STORY_CHAPTERS.length) { showOutro(); return; }

  // Exit browse mode when returning to chapter navigation
  state.browseMode     = false;
  state.browseLocation = null;
  state.chapterIndex   = index;
  const ch = STORY_CHAPTERS[index];

  const chPitch = ch.pitch || 0;
  if (ch.location !== state.currentScene) {
    state.currentScene = ch.location;
    state.pendingYaw   = ch.yaw;
    state.pendingPitch = chPitch;
    initPannellum(ch.location);
  } else if (viewer && viewer.isLoaded()) {
    try {
      viewer.setYaw(ch.yaw);
      viewer.setPitch(chPitch);
    } catch (_) {
      state.pendingYaw   = ch.yaw;
      state.pendingPitch = chPitch;
    }
  } else {
    state.pendingYaw   = ch.yaw;
    state.pendingPitch = chPitch;
  }

  renderChapterPanel();
  renderScrubber();
  renderProgress();
  renderLocationPill();
  renderTOC();
  renderPins();
}
function nextChapter() {
  if (state.browseMode) { goToChapter(0); return; }
  goToChapter(state.chapterIndex + 1);
}
function prevChapter() {
  if (state.outroVisible) { hideOutro(); goToChapter(STORY_CHAPTERS.length - 1); return; }
  if (state.browseMode)  { goToChapter(STORY_CHAPTERS.length - 1); return; }
  goToChapter(state.chapterIndex - 1);
}

// ── Cover / Outro ─────────────────────────────────────────────
function hideCover() {
  state.coverVisible = false;
  document.body.classList.remove("cover-active");
  $("cover-screen").classList.add("cover-hidden");
}
function showCover() {
  state.coverVisible = true;
  document.body.classList.add("cover-active");
  $("cover-screen").classList.remove("cover-hidden");
  goToChapter(0);
}
function showOutro() {
  state.outroVisible = true;
  $("outro-screen").classList.remove("outro-hidden");
}
function hideOutro() {
  state.outroVisible = false;
  $("outro-screen").classList.add("outro-hidden");
}
function toggleNote(force) {
  state.noteVisible = force !== undefined ? force : !state.noteVisible;
  $("chapter-panel").classList.toggle("note-hidden", !state.noteVisible);
}

// ── Renderers ─────────────────────────────────────────────────
function renderChapterPanel() {
  const ch = STORY_CHAPTERS[state.chapterIndex];
  $("ch-title").textContent    = ch.title;
  $("ch-location").textContent = locationName(ch.location);
  $("ch-date").textContent     = fmtDate(ch.date);
  $("ch-body").textContent     = ch.body;

  const img = $("ch-image");
  const vid = $("ch-video");

  if (ch.video) {
    // Video takes priority over image
    img.onload = null; img.onerror = null;
    img.style.display  = "none";
    img.classList.remove("img-loading");
    img.removeAttribute("src");
    vid.src            = ch.video;
    vid.style.display  = "block";
    vid.load();
  } else if (ch.image) {
    vid.style.display  = "none";
    vid.removeAttribute("src");
    vid.pause();
    // Show shimmer skeleton immediately, swap to real image on load
    img.onload = null; img.onerror = null;
    img.removeAttribute("src");
    img.style.opacity = "";
    img.classList.add("img-loading");
    img.style.display = "block";
    img.onload = () => {
      img.classList.remove("img-loading");
    };
    img.onerror = () => {
      img.classList.remove("img-loading");
      img.style.display = "none";
    };
    img.src = ch.image;
  } else {
    img.onload = null; img.onerror = null;
    img.style.display  = "none";
    img.classList.remove("img-loading");
    img.removeAttribute("src");
    vid.style.display  = "none";
    vid.removeAttribute("src");
    vid.pause();
  }

  const panel = $("chapter-panel");
  panel.classList.toggle("note-hidden", !state.noteVisible);
  panel.classList.remove("chapter-pulse");
  void panel.offsetWidth;
  panel.classList.add("chapter-pulse");
}

function renderScrubber() {
  const sc = $("scrubber");
  sc.innerHTML = "";
  STORY_CHAPTERS.forEach((ch, i) => {
    const dot = el("button", "scrubber-dot" + (i === state.chapterIndex ? " active" : ""));
    dot.title = `Moment ${ch.order} — ${ch.title}`;
    dot.setAttribute("aria-label", dot.title);
    dot.addEventListener("click", () => goToChapter(i));
    sc.appendChild(dot);
  });
  $("ch-counter-num").textContent   = state.chapterIndex + 1;
  $("ch-counter-total").textContent = STORY_CHAPTERS.length;
}

function renderProgress() {
  const pct = ((state.chapterIndex + 1) / STORY_CHAPTERS.length) * 100;
  $("story-progress-fill").style.width = `${pct}%`;
}

function renderLocationPill() {
  if (state.browseMode) {
    $("current-scene-name").textContent = locationName(state.browseLocation);
  } else {
    const ch = STORY_CHAPTERS[state.chapterIndex];
    $("current-scene-name").textContent = ch ? locationName(ch.location) : "";
  }
}

// ── Pins (perspective-correct projection) ─────────────────────
function renderPins() {
  const layer = $("annotations-layer");
  layer.innerHTML = "";
  if (!viewer) return;
  const sceneId = STORY_CHAPTERS[state.chapterIndex].location;

  const vw   = layer.clientWidth;
  const vh   = layer.clientHeight;
  const hfov = viewer.getHfov() * Math.PI / 180;

  // Pre-compute camera rotation
  const cYaw   = state.yaw   * Math.PI / 180;
  const cPitch = state.pitch * Math.PI / 180;
  const cosY = Math.cos(-cYaw),  sinY = Math.sin(-cYaw);
  const cosP = Math.cos(cPitch), sinP = Math.sin(cPitch);

  STORY_CHAPTERS.forEach((m, idx) => {
    if (m.location !== sceneId) return;

    const isActive = idx === state.chapterIndex;

    // Point on unit sphere
    const pYaw   = m.yaw   * Math.PI / 180;
    const pPitch = (m.pitch || 0) * Math.PI / 180;
    const px =  Math.sin(pYaw) * Math.cos(pPitch);
    const py =  Math.sin(pPitch);
    const pz =  Math.cos(pYaw) * Math.cos(pPitch);

    // Rotate into camera space: yaw then pitch
    const x1 =  px * cosY + pz * sinY;
    const y1 =  py;
    const z1 = -px * sinY + pz * cosY;

    const x2 =  x1;
    const y2 =  y1 * cosP - z1 * sinP;
    const z2 =  y1 * sinP + z1 * cosP;

    // Behind camera — skip
    if (z2 <= 0.01) return;

    // Perspective projection
    const f = (vw / 2) / Math.tan(hfov / 2);
    const sx = (vw / 2) + (x2 / z2) * f;
    const sy = (vh / 2) - (y2 / z2) * f;

    // Clip: only show if on screen (with margin)
    const margin = 40;
    if (sx < -margin || sx > vw + margin || sy < -margin || sy > vh + margin) return;

    // Opacity: fade near edges
    const edgeFade = 80;
    const ox = Math.min(sx, vw - sx);
    const oy = Math.min(sy, vh - sy);
    const edgeDist = Math.min(ox, oy);
    const base = edgeDist < edgeFade ? Math.max(0.15, edgeDist / edgeFade) : 1;
    const op   = isActive ? 1 : base * 0.6;

    const pin = el("div", "annotation-pin visible" + (isActive ? " active" : ""));
    pin.style.cssText = `left:${sx.toFixed(1)}px;top:${sy.toFixed(1)}px;opacity:${op.toFixed(2)}`;
    pin.title = `Moment ${m.order} — ${m.title}`;
    pin.innerHTML = `<div class="pin-icon">${locationPinSVG}</div>`;
    pin.addEventListener("click", e => {
      e.stopPropagation();
      if (idx === state.chapterIndex) {
        toggleNote();
      } else {
        state.noteVisible = true;
        goToChapter(idx);
      }
    });
    layer.appendChild(pin);
  });
}

const locationPinSVG = `<svg viewBox="0 0 24 36" width="50" height="45" fill="none">
  <path d="M12 1C5.9 1 1 5.9 1 12c0 9 11 23 11 23s11-14 11-23c0-6.1-4.9-11-11-11z"
        fill="#a84520" stroke="#fff8b0" stroke-width="1.5" stroke-linejoin="round"/>
  <circle cx="12" cy="12" r="5" fill="#fff8b0"/>
</svg>`;

// ── Table of Contents (flat ordered list, location as tag) ────
function renderTOC() {
  const list = $("toc-list");
  if (!list) return;
  list.innerHTML = "";

  STORY_CHAPTERS.forEach((ch, i) => {
    const item = el("button", "toc-item" + (i === state.chapterIndex ? " active" : ""));
    item.innerHTML = `
      <span class="toc-num">${String(ch.order).padStart(2, "0")}</span>
      <span class="toc-info">
        <span class="toc-title">${esc(ch.title)}</span>
        <span class="toc-sub">
          <span class="toc-location-tag">${esc(locationName(ch.location))}</span>
          <span class="toc-date">${fmtDate(ch.date)}</span>
        </span>
      </span>`;
    item.addEventListener("click", () => { goToChapter(i); toggleSidebar(false); });
    list.appendChild(item);
  });
}

function goToLocation(locationId) {
  // If there's a chapter at this location, go to the first one
  const firstChapter = STORY_CHAPTERS.findIndex(c => c.location === locationId);
  if (firstChapter !== -1) {
    goToChapter(firstChapter);
    return;
  }

  // No chapter — enter browse mode: show the 360 view + location info
  state.browseMode     = true;
  state.browseLocation = locationId;
  state.chapterIndex   = -1;

  if (locationId !== state.currentScene) {
    state.currentScene = locationId;
    state.pendingYaw   = 0;
    initPannellum(locationId);
  }

  renderLocationPill();
  renderBrowsePanel();
  renderRoutes();

  // Clear story-specific UI
  const layer = $("annotations-layer");
  if (layer) layer.innerHTML = "";
  $("story-progress-fill").style.width = "0%";
  $("scrubber").innerHTML = "";
  $("ch-counter-num").textContent   = "—";
  $("ch-counter-total").textContent = STORY_CHAPTERS.length;
}

function renderBrowsePanel() {
  // Reuse the chapter panel but show location info instead of moment content
  const loc = ROUTES.find(r => r.id === state.browseLocation);
  $("ch-title").textContent    = loc ? loc.name : state.browseLocation;
  $("ch-location").textContent = loc ? loc.desc : "";
  $("ch-date").textContent     = "";
  $("ch-body").textContent     = "No stories here yet. Add a moment with this location in data/story.json to fill this space.";
  const img = $("ch-image");
  img.style.display = "none";
  img.removeAttribute("src");

  const panel = $("chapter-panel");
  panel.classList.remove("chapter-pulse");
  void panel.offsetWidth;
  panel.classList.add("chapter-pulse");
}

function renderRoutes() {
  const list = $("routes-list");
  list.innerHTML = "";
  ROUTES.forEach(r => {
    const hasChapter = STORY_CHAPTERS.some(c => c.location === r.id);
    const isCurrent  = r.id === state.currentScene;
    const card = el("div", "route-card" + (isCurrent ? " active" : "") + (!hasChapter ? " route-empty" : ""));
    card.innerHTML = `
      <div class="route-info">
        <div class="route-name">${esc(r.name)}</div>
        <div class="route-desc">${esc(r.desc)}</div>
      </div>
      ${!hasChapter ? '<span class="route-badge">No story yet</span>' : ''}`;
    card.addEventListener("click", () => {
      goToLocation(r.id);
      toggleSidebar(false);
    });
    list.appendChild(card);
  });
}

// ── Sidebar ───────────────────────────────────────────────────
function toggleSidebar(force) {
  state.sidebarOpen = force !== undefined ? force : !state.sidebarOpen;
  $("sidebar").classList.toggle("sidebar-closed", !state.sidebarOpen);
}
function setTab(tabId) {
  state.tab = tabId;
  document.querySelectorAll(".tab-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.tab === tabId));
  document.querySelectorAll(".tab-content").forEach(c =>
    c.classList.toggle("active", c.id === `tab-${tabId}`));
  if (tabId === "story")     renderTOC();
  if (tabId === "locations") renderRoutes();
}

// ── Events ────────────────────────────────────────────────────
function wire() {
  $("toggle-sidebar-btn").addEventListener("click", () => toggleSidebar());
  $("close-sidebar-btn" ).addEventListener("click", () => toggleSidebar(false));

  $("next-btn").addEventListener("click", () => nextChapter());
  $("prev-btn").addEventListener("click", () => prevChapter());

  document.querySelectorAll(".tab-btn").forEach(b =>
    b.addEventListener("click", () => setTab(b.dataset.tab)));

  $("begin-btn"  ).addEventListener("click", () => hideCover());
  $("restart-btn").addEventListener("click", () => { hideOutro(); showCover(); });
  $("browse-btn" ).addEventListener("click", () => { hideOutro(); toggleSidebar(true); setTab("story"); });

  document.addEventListener("keydown", e => {
    const tag = document.activeElement?.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;

    if (state.coverVisible) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); hideCover(); }
      return;
    }
    if (e.key === "Escape") {
      if (state.sidebarOpen)       toggleSidebar(false);
      else if (state.outroVisible) hideOutro();
    }
    if (e.key === "ArrowRight") nextChapter();
    if (e.key === "ArrowLeft")  prevChapter();
    if (e.key === "s" || e.key === "S") toggleSidebar();
  });
}

// ── Init ──────────────────────────────────────────────────────
async function init() {
  // Wire UI first — ensures Begin button always works even if data load fails
  wire();

  try {
    await loadData();
  } catch (err) {
    console.error("Failed to load data files:", err);
    $("toc-list").innerHTML = `<div class="empty-state"><div class="empty-text">Could not load story data. Check data/story.json and data/locations.json.</div></div>`;
    return;
  }

  // Normalize yaw values outside [0, 360)
  STORY_CHAPTERS.forEach(ch => {
    ch.yaw = ((ch.yaw % 360) + 360) % 360;
  });

  renderTOC();
  renderRoutes();
  renderScrubber();
  renderChapterPanel();
  renderProgress();
  renderLocationPill();

  // Wait for Service Worker control before loading tiles (tile proxy).
  if ("serviceWorker" in navigator) {
    try {
      const reg  = await navigator.serviceWorker.register("sw.js");
      const ctrl = navigator.serviceWorker.controller;
      const needsWait = reg.installing || reg.waiting
        || !ctrl
        || (reg.active && reg.active !== ctrl);
      if (needsWait) {
        await Promise.race([
          new Promise(r => navigator.serviceWorker.addEventListener("controllerchange", r, { once: true })),
          new Promise(r => setTimeout(r, 6000)),
        ]);
        if (!navigator.serviceWorker.controller) { window.location.reload(); return; }
      }
    } catch (err) { console.warn("SW:", err); }
  }

  goToChapter(0);
  console.log("%cMy VinUni Journey — story mode ready", "color:#b45309;font-weight:bold");
}

document.addEventListener("DOMContentLoaded", init);
