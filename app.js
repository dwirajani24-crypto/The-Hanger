/* =========================================================================
   THE HANGER — app.js
   All application logic lives in this one file, in plain (vanilla)
   JavaScript. No build step, no frameworks — this file is loaded
   directly by index.html with a normal <script> tag.

   SECTIONS IN THIS FILE
   1. Constants & in-memory state
   2. IndexedDB layer          — how your wardrobe data is actually stored
   3. Image handling           — compressing photos before they're saved
   4. Rendering: Outfit Builder (carousels)
   5. Rendering: My Wardrobe
   6. Rendering: Saved Outfits
   7. Rendering: Week Planner
   8. Rendering: Settings / Data (export, import, clear)
   9. Sheets (modals), toast, navigation, global click handling
   10. Boot sequence
   ========================================================================= */

/* =========================================================================
   1. CONSTANTS & STATE
   ========================================================================= */

const CATEGORIES = ['Top', 'Bottom', 'Shoes', 'Outerwear', 'Dress', 'Accessory'];
const CATEGORY_PLURAL = {
  Top: 'Tops', Bottom: 'Bottoms', Shoes: 'Shoes',
  Outerwear: 'Outerwear', Dress: 'Dresses', Accessory: 'Accessories'
};
const BUILDER_CATEGORIES = ['Top', 'Bottom', 'Shoes'];
const STYLE_OPTIONS = ['Smart', 'Casual', 'Formal', 'Sporty', 'Neutral', 'Colourful', 'Other'];
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS = {
  monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday',
  friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday'
};

// All app data lives in memory (loaded from IndexedDB at startup) so the
// UI can render instantly without waiting on the database each time.
// Every change is written to IndexedDB immediately after it's made here.
const state = {
  view: 'builder',
  items: [],                 // every clothing item
  outfits: [],                // every saved outfit
  weekPlan: {},               // { monday: {...}|undefined, tuesday: ... }
  builderIndex: { Top: 0, Bottom: 0, Shoes: 0 },
  wardrobeFilter: 'All',
  wardrobeSearch: '',
  editingItemId: null,        // set while the Add/Edit Clothing sheet is open in edit mode
  pendingImageData: null      // holds a newly captured/chosen photo until the form is saved
};

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

function itemsByCategory(cat) {
  return state.items.filter(function (i) { return i.category === cat; });
}

function findItem(id) {
  return state.items.find(function (i) { return i.id === id; }) || null;
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// "Shoes" is already plural and takes no article ("Add Shoes"), while
// Top/Bottom are singular and take one ("Add a Top") — handle that here
// rather than naively appending "s" or "a" everywhere.
function addItemLabel(cat) { return cat === 'Shoes' ? 'Add Shoes' : 'Add a ' + cat; }
function pluralLower(cat) { return CATEGORY_PLURAL[cat].toLowerCase(); }


/* =========================================================================
   2. INDEXEDDB LAYER
   -------------------------------------------------------------------------
   HOW THIS WORKS (in plain terms):
   IndexedDB is a database built into every modern browser. Anything saved
   here stays on THIS device, inside THIS browser, even after you close
   the tab or restart your phone — that's what lets "The Hanger" work
   without an account or a server. It is NOT shared between your iPhone,
   iPad and Mac automatically (see the README for backup/restore).

   We create one database called "TheHangerDB" with three "object stores"
   (think: three tables in a simple database):
     - items      -> every clothing item you add, including its photo
     - outfits    -> every outfit you save from the Outfit Builder
     - weekPlan   -> one record per day of the week (monday..sunday)

   All the functions below are small wrappers that turn IndexedDB's
   old-fashioned callback API into modern Promises, so the rest of the
   app can simply use `await`.
   ========================================================================= */

const DB_NAME = 'TheHangerDB';
const DB_VERSION = 1;
let dbInstance = null;

function openDatabase() {
  return new Promise(function (resolve, reject) {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    // This only runs the very first time (or when DB_VERSION increases).
    // It defines the shape of the database.
    request.onupgradeneeded = function (event) {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('items')) {
        db.createObjectStore('items', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('outfits')) {
        db.createObjectStore('outfits', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('weekPlan')) {
        db.createObjectStore('weekPlan', { keyPath: 'day' });
      }
    };

    request.onsuccess = function (event) { resolve(event.target.result); };
    request.onerror = function (event) { reject(event.target.error); };
  });
}

async function getDB() {
  if (!dbInstance) dbInstance = await openDatabase();
  return dbInstance;
}

function dbGetAll(storeName) {
  return getDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error); };
    });
  });
}

function dbPut(storeName, value) {
  return getDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = function () { resolve(value); };
      tx.onerror = function () { reject(tx.error); };
    });
  });
}

function dbDelete(storeName, key) {
  return getDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  });
}

function dbClear(storeName) {
  return getDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).clear();
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  });
}

async function loadAllData() {
  const [items, outfits, weekPlanRows] = await Promise.all([
    dbGetAll('items'), dbGetAll('outfits'), dbGetAll('weekPlan')
  ]);
  state.items = items.sort(function (a, b) { return b.createdAt - a.createdAt; });
  state.outfits = outfits.sort(function (a, b) { return b.createdAt - a.createdAt; });
  state.weekPlan = {};
  weekPlanRows.forEach(function (row) { state.weekPlan[row.day] = row; });
}


/* =========================================================================
   3. IMAGE HANDLING
   -------------------------------------------------------------------------
   Photos are resized and compressed on-device (using a <canvas>) before
   they're stored, so a full-resolution phone photo doesn't bloat the
   browser's storage. The result is saved as a "data URL" (a JPEG image
   encoded directly as text), which is convenient because it can be
   stored in IndexedDB AND included directly in the JSON export/import
   backup files with no extra work.
   ========================================================================= */

function fileToCompressedDataURL(file, maxDimension, quality) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onerror = function () { reject(new Error('Could not read that photo.')); };
    reader.onload = function () {
      const img = new Image();
      img.onerror = function () { reject(new Error('That file does not look like an image.')); };
      img.onload = function () {
        let w = img.width, h = img.height;
        const largest = Math.max(w, h);
        if (largest > maxDimension) {
          const scale = maxDimension / largest;
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}


/* =========================================================================
   9a. TOAST + SHEET (small helpers used throughout the file)
   ========================================================================= */

let toastTimer = null;
function showToast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
}

function openSheet(html) {
  document.getElementById('sheet-content').innerHTML = html;
  document.getElementById('sheet-backdrop').classList.add('open');
  document.getElementById('sheet').classList.add('open');
}

function closeSheet() {
  document.getElementById('sheet-backdrop').classList.remove('open');
  document.getElementById('sheet').classList.remove('open');
  state.editingItemId = null;
  state.pendingImageData = null;
}

function imgOrPlaceholder(item) {
  if (item && item.image) return item.image;
  return null;
}

function thumbHTML(item, sizeClasses) {
  if (!item) return '<div class="' + sizeClasses + ' flex items-center justify-center text-2xl">🪄</div>';
  return '<img src="' + item.image + '" alt="' + escapeHTML(item.name) + '" class="' + sizeClasses + '">';
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}


/* =========================================================================
   4. OUTFIT BUILDER
   ========================================================================= */

function mountBuilderView() {
  const el = document.getElementById('view-builder');
  let html = '<div class="px-4 pt-1 pb-2 flex items-center justify-between">' +
    '<p class="text-sm text-[var(--ink-soft)]">Swipe through your closet, one piece at a time.</p>' +
    '<button data-action="surprise-me" class="chip pill flex items-center gap-1">✨ Surprise&nbsp;me</button>' +
    '</div>';
  html += '<div class="builder-columns px-2">';
  BUILDER_CATEGORIES.forEach(function (cat) {
    html += categoryBlockHTML(cat);
  });
  html += '</div>';
  html += '<div class="px-4 pt-4 pb-6 flex flex-col gap-2">' +
    '<button data-action="open-save-outfit" class="btn-accent py-4 text-[15px]">Save Outfit</button>' +
    '<div class="flex gap-2">' +
    '<button data-action="randomize-outfit" class="btn-ghost py-3 flex-1 text-[14px]">🎲 Randomise Outfit</button>' +
    '<button data-action="clear-outfit" class="btn-ghost py-3 flex-1 text-[14px]">Clear Outfit</button>' +
    '</div></div>';
  el.innerHTML = html;
  BUILDER_CATEGORIES.forEach(function (cat) {
    const list = itemsByCategory(cat);
    if (list.length > 0) setupCarouselDrag(cat);
  });
}

function categoryBlockHTML(cat) {
  const list = itemsByCategory(cat);
  if (state.builderIndex[cat] >= list.length) state.builderIndex[cat] = Math.max(0, list.length - 1);
  const idx = state.builderIndex[cat];

  let inner;
  if (list.length === 0) {
    inner = '<div class="empty-state">' +
      '<div class="empty-emoji">🧺</div>' +
      '<p class="font-semibold">No ' + pluralLower(cat) + ' added yet</p>' +
      '<p class="text-sm text-[var(--ink-soft)]">Add one from your wardrobe to start building outfits.</p>' +
      '<button data-action="goto-wardrobe-add" data-category="' + cat + '" class="btn-primary px-5 py-2.5 text-sm mt-2">' + addItemLabel(cat) + '</button>' +
      '</div>';
  } else {
    const slides = list.map(function (item) {
      return '<div class="carousel-slide"><img src="' + item.image + '" alt="' + escapeHTML(item.name) + '" draggable="false"></div>';
    }).join('');
    const dots = list.length > 1 ? ('<div class="dot-row" id="dots-' + cat + '">' +
      list.map(function (_, i) {
        return '<button aria-label="Go to item ' + (i + 1) + '" class="dot' + (i === idx ? ' active' : '') + '" data-action="carousel-dot" data-category="' + cat + '" data-index="' + i + '"></button>';
      }).join('') + '</div>') : '';

    inner = '<div class="carousel-stage" id="stage-' + cat + '">' +
      (list.length > 1 ? '<button class="carousel-arrow left" aria-label="Previous ' + cat + '" data-action="carousel-prev" data-category="' + cat + '">‹</button>' : '') +
      '<div class="carousel-track" id="track-' + cat + '" style="transform:translateX(0px)">' + slides + '</div>' +
      (list.length > 1 ? '<button class="carousel-arrow right" aria-label="Next ' + cat + '" data-action="carousel-next" data-category="' + cat + '">›</button>' : '') +
      '</div>' +
      '<div class="carousel-meta">' +
      '<div class="carousel-item-name" id="name-' + cat + '">' + escapeHTML(list[idx].name) + '</div>' +
      '<div class="carousel-item-count" id="count-' + cat + '">Item ' + (idx + 1) + ' of ' + list.length + '</div>' +
      '</div>' + dots;
  }

  return '<div class="category-block">' +
    '<div class="category-label">' + cat + '</div>' + inner + '</div>';
}

function setupCarouselDrag(cat) {
  const track = document.getElementById('track-' + cat);
  if (!track) return;
  let dragging = false, startX = 0, deltaX = 0, stageWidth = 0;

  track.addEventListener('pointerdown', function (e) {
    const list = itemsByCategory(cat);
    if (list.length < 2) return;
    dragging = true; deltaX = 0;
    startX = e.clientX;
    stageWidth = track.parentElement.offsetWidth;
    track.classList.add('dragging');
    track.setPointerCapture(e.pointerId);
  });

  track.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    deltaX = e.clientX - startX;
    const base = -state.builderIndex[cat] * stageWidth;
    track.style.transform = 'translateX(' + (base + deltaX) + 'px)';
  });

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    track.classList.remove('dragging');
    const list = itemsByCategory(cat);
    const threshold = stageWidth * 0.18;
    if (deltaX < -threshold) {
      changeCarouselIndex(cat, 1, list.length);
    } else if (deltaX > threshold) {
      changeCarouselIndex(cat, -1, list.length);
    } else {
      updateCarouselUI(cat);
    }
    deltaX = 0;
  }

  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);
}

function changeCarouselIndex(cat, delta, count) {
  if (count === 0) return;
  state.builderIndex[cat] = ((state.builderIndex[cat] + delta) % count + count) % count;
  updateCarouselUI(cat);
}

function updateCarouselUI(cat) {
  const list = itemsByCategory(cat);
  const track = document.getElementById('track-' + cat);
  if (!track || list.length === 0) return;
  const idx = state.builderIndex[cat];
  const width = track.parentElement.offsetWidth;
  track.style.transform = 'translateX(' + (-idx * width) + 'px)';
  const nameEl = document.getElementById('name-' + cat);
  const countEl = document.getElementById('count-' + cat);
  if (nameEl) nameEl.textContent = list[idx].name;
  if (countEl) countEl.textContent = 'Item ' + (idx + 1) + ' of ' + list.length;
  const dotsWrap = document.getElementById('dots-' + cat);
  if (dotsWrap) {
    Array.prototype.forEach.call(dotsWrap.children, function (dot, i) {
      dot.classList.toggle('active', i === idx);
    });
  }
}

function randomizeOutfit(isSurprise) {
  const missing = BUILDER_CATEGORIES.filter(function (c) { return itemsByCategory(c).length === 0; });
  if (missing.length > 0) {
    showToast('Add ' + (missing[0] === 'Shoes' ? 'some shoes' : 'a ' + missing[0].toLowerCase()) + ' first');
    return;
  }
  BUILDER_CATEGORIES.forEach(function (cat) {
    const list = itemsByCategory(cat);
    state.builderIndex[cat] = Math.floor(Math.random() * list.length);
    updateCarouselUI(cat);
    const stage = document.getElementById('stage-' + cat);
    if (stage) {
      stage.classList.remove('shuffle-anim');
      void stage.offsetWidth; // restart the animation
      stage.classList.add('shuffle-anim');
    }
  });
  showToast(isSurprise ? '✨ Surprise outfit ready' : 'Outfit randomised');
}

function clearOutfitSelection() {
  BUILDER_CATEGORIES.forEach(function (cat) {
    state.builderIndex[cat] = 0;
    updateCarouselUI(cat);
  });
  showToast('Back to the start of each rail');
}

function currentBuilderSelection() {
  const sel = {};
  for (const cat of BUILDER_CATEGORIES) {
    const list = itemsByCategory(cat);
    sel[cat] = list.length ? list[state.builderIndex[cat]] : null;
  }
  return sel;
}

function openSaveOutfitSheet() {
  const missing = BUILDER_CATEGORIES.filter(function (c) { return itemsByCategory(c).length === 0; });
  if (missing.length > 0) {
    showToast('Add a top, bottom and shoes first');
    return;
  }
  const sel = currentBuilderSelection();
  const html = '<h2 class="font-display text-xl font-semibold mb-4">Save this outfit</h2>' +
    '<div class="outfit-triptych rounded-2xl mb-4">' +
    '<div class="slot">' + thumbHTML(sel.Top, 'w-full h-full object-contain p-1') + '</div>' +
    '<div class="slot">' + thumbHTML(sel.Bottom, 'w-full h-full object-contain p-1') + '</div>' +
    '<div class="slot">' + thumbHTML(sel.Shoes, 'w-full h-full object-contain p-1') + '</div>' +
    '</div>' +
    '<form id="save-outfit-form">' +
    '<label class="field-label" for="outfit-name-input">Outfit name</label>' +
    '<input id="outfit-name-input" class="field-input mb-4" placeholder="e.g. Monday Smart Casual" required>' +
    '<label class="field-label" for="outfit-day-select">Assign to a day (optional)</label>' +
    '<select id="outfit-day-select" class="field-input mb-5">' +
    '<option value="">Don\'t assign yet</option>' +
    DAYS.map(function (d) { return '<option value="' + d + '">' + DAY_LABELS[d] + '</option>'; }).join('') +
    '</select>' +
    '<button type="submit" class="btn-accent w-full py-3.5">Save Outfit</button>' +
    '</form>';
  openSheet(html);
}

async function handleSaveOutfitSubmit() {
  const sel = currentBuilderSelection();
  const name = document.getElementById('outfit-name-input').value.trim() || 'Untitled Outfit';
  const day = document.getElementById('outfit-day-select').value;
  const outfit = {
    id: uid(), name: name,
    topId: sel.Top.id, bottomId: sel.Bottom.id, shoesId: sel.Shoes.id,
    createdAt: Date.now()
  };
  await dbPut('outfits', outfit);
  state.outfits.unshift(outfit);

  if (day) {
    const record = { day: day, outfitId: outfit.id, topId: outfit.topId, bottomId: outfit.bottomId, shoesId: outfit.shoesId, label: outfit.name };
    await dbPut('weekPlan', record);
    state.weekPlan[day] = record;
  }
  closeSheet();
  showToast('Outfit saved' + (day ? ' and added to ' + DAY_LABELS[day] : ''));
}


/* =========================================================================
   5. MY WARDROBE
   ========================================================================= */

function mountWardrobeView() {
  const el = document.getElementById('view-wardrobe');
  const filters = ['All'].concat(CATEGORIES);
  let html = '<div class="px-4 pt-1 pb-3 flex flex-col gap-3">' +
    '<button data-action="open-add-item" class="btn-primary py-3.5 text-[15px]">+ Add Clothing</button>' +
    '<input id="wardrobe-search" class="field-input" placeholder="Search your wardrobe…" value="' + escapeHTML(state.wardrobeSearch) + '">' +
    '<div class="flex gap-2 overflow-x-auto pb-1" id="wardrobe-filters">' +
    filters.map(function (f) {
      const label = f === 'All' ? 'All' : CATEGORY_PLURAL[f];
      return '<button class="chip flex-none' + (state.wardrobeFilter === f ? ' active' : '') + '" data-action="filter-category" data-category="' + f + '">' + label + '</button>';
    }).join('') +
    '</div></div>' +
    '<div id="wardrobe-grid" class="px-4 grid grid-cols-2 gap-3 pb-4"></div>';
  el.innerHTML = html;

  document.getElementById('wardrobe-search').addEventListener('input', function (e) {
    state.wardrobeSearch = e.target.value;
    refreshWardrobeGrid();
  });

  refreshWardrobeGrid();
}

function refreshWardrobeGrid() {
  const grid = document.getElementById('wardrobe-grid');
  if (!grid) return;
  const q = state.wardrobeSearch.trim().toLowerCase();
  const list = state.items.filter(function (item) {
    const matchesFilter = state.wardrobeFilter === 'All' || item.category === state.wardrobeFilter;
    const matchesSearch = !q || item.name.toLowerCase().indexOf(q) !== -1;
    return matchesFilter && matchesSearch;
  });

  if (list.length === 0) {
    grid.className = 'px-4 pb-4';
    grid.innerHTML = '<div class="empty-state" style="aspect-ratio:auto;padding:48px 16px;">' +
      '<div class="empty-emoji">🧵</div>' +
      '<p class="font-semibold">No clothes to show here</p>' +
      '<p class="text-sm text-[var(--ink-soft)]">Try a different filter, or add a new item.</p>' +
      '</div>';
    return;
  }
  grid.className = 'px-4 grid grid-cols-2 gap-3 pb-4';
  grid.innerHTML = list.map(function (item) {
    return '<div class="wardrobe-card">' +
      '<button class="thumb" data-action="view-item" data-id="' + item.id + '" aria-label="View ' + escapeHTML(item.name) + '">' +
      '<img src="' + item.image + '" alt="' + escapeHTML(item.name) + '"></button>' +
      '<div class="p-3">' +
      '<p class="font-semibold text-[14px] leading-tight truncate">' + escapeHTML(item.name) + '</p>' +
      '<p class="text-[12px] text-[var(--ink-soft)] mb-2">' + item.category + '</p>' +
      '<div class="flex gap-2">' +
      '<button class="btn-ghost flex-1 py-1.5 text-[12px]" data-action="edit-item" data-id="' + item.id + '">Edit</button>' +
      '<button class="btn-danger flex-1 py-1.5 text-[12px]" data-action="delete-item" data-id="' + item.id + '">Delete</button>' +
      '</div></div></div>';
  }).join('');
}

function openAddItemSheet(presetCategory, editId) {
  state.editingItemId = editId || null;
  state.pendingImageData = null;
  const editing = editId ? findItem(editId) : null;
  const title = editing ? 'Edit clothing item' : 'Add clothing';
  const defaultCategory = (editing && editing.category) || presetCategory || 'Top';

  const html =
    '<h2 class="font-display text-xl font-semibold mb-4">' + title + '</h2>' +
    '<form id="item-form">' +
    '<div class="mb-4">' +
    '<div id="photo-preview-wrap" class="rounded-2xl overflow-hidden border border-[var(--line)] bg-[#fbfaf7] flex items-center justify-center" style="aspect-ratio:1/1;">' +
    (editing ? '<img id="photo-preview" src="' + editing.image + '" class="w-full h-full object-contain p-2">' :
      '<span id="photo-preview-empty" class="text-sm text-[var(--ink-soft)]">No photo yet</span>') +
    '</div>' +
    '<div class="flex gap-2 mt-2">' +
    '<button type="button" class="btn-ghost flex-1 py-2.5 text-sm" id="take-photo-btn">📷 Take Photo</button>' +
    '<button type="button" class="btn-ghost flex-1 py-2.5 text-sm" id="choose-photo-btn">🖼 Choose Photo</button>' +
    '</div>' +
    '<input type="file" accept="image/*" capture="environment" id="camera-input" class="hidden">' +
    '<input type="file" accept="image/*" id="library-input" class="hidden">' +
    '</div>' +

    '<label class="field-label" for="item-name-input">Name</label>' +
    '<input id="item-name-input" class="field-input mb-4" placeholder="e.g. White Shirt" required value="' + (editing ? escapeHTML(editing.name) : '') + '">' +

    '<label class="field-label" for="item-category-select">Category</label>' +
    '<select id="item-category-select" class="field-input mb-4">' +
    CATEGORIES.map(function (c) { return '<option value="' + c + '"' + (c === defaultCategory ? ' selected' : '') + '>' + c + '</option>'; }).join('') +
    '</select>' +

    '<label class="field-label" for="item-color-input">Colour (optional)</label>' +
    '<input id="item-color-input" class="field-input mb-4" placeholder="e.g. Ivory" value="' + (editing && editing.color ? escapeHTML(editing.color) : '') + '">' +

    '<label class="field-label" for="item-style-select">Style (optional)</label>' +
    '<select id="item-style-select" class="field-input mb-4">' +
    '<option value="">—</option>' +
    STYLE_OPTIONS.map(function (s) { return '<option value="' + s + '"' + (editing && editing.style === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') +
    '</select>' +

    '<label class="field-label" for="item-notes-input">Notes (optional)</label>' +
    '<textarea id="item-notes-input" class="field-input mb-5" rows="2" placeholder="Anything worth remembering…">' + (editing && editing.notes ? escapeHTML(editing.notes) : '') + '</textarea>' +

    '<button type="submit" class="btn-accent w-full py-3.5 mb-2">' + (editing ? 'Save Changes' : 'Add to Wardrobe') + '</button>' +
    (editing ? '<button type="button" class="btn-danger w-full py-3" data-action="delete-item" data-id="' + editing.id + '">Delete Item</button>' : '') +
    '</form>';

  openSheet(html);

  const cameraInput = document.getElementById('camera-input');
  const libraryInput = document.getElementById('library-input');
  document.getElementById('take-photo-btn').addEventListener('click', function () { cameraInput.click(); });
  document.getElementById('choose-photo-btn').addEventListener('click', function () { libraryInput.click(); });

  function handlePhoto(e) {
    const file = e.target.files[0];
    if (!file) return;
    fileToCompressedDataURL(file, 1000, 0.72).then(function (dataUrl) {
      state.pendingImageData = dataUrl;
      const wrap = document.getElementById('photo-preview-wrap');
      wrap.innerHTML = '<img id="photo-preview" src="' + dataUrl + '" class="w-full h-full object-contain p-2">';
    }).catch(function (err) {
      showToast(err.message || 'Could not use that photo');
    });
  }
  cameraInput.addEventListener('change', handlePhoto);
  libraryInput.addEventListener('change', handlePhoto);
}

async function handleItemFormSubmit() {
  const name = document.getElementById('item-name-input').value.trim();
  const category = document.getElementById('item-category-select').value;
  const color = document.getElementById('item-color-input').value.trim();
  const style = document.getElementById('item-style-select').value;
  const notes = document.getElementById('item-notes-input').value.trim();

  if (!name) { showToast('Please give this item a name'); return; }

  const editing = state.editingItemId ? findItem(state.editingItemId) : null;
  const image = state.pendingImageData || (editing ? editing.image : null);
  if (!image) { showToast('Please add a photo'); return; }

  const record = {
    id: editing ? editing.id : uid(),
    name: name, category: category, color: color, style: style, notes: notes,
    image: image,
    createdAt: editing ? editing.createdAt : Date.now()
  };

  await dbPut('items', record);
  if (editing) {
    const i = state.items.findIndex(function (it) { return it.id === record.id; });
    state.items[i] = record;
  } else {
    state.items.unshift(record);
  }

  closeSheet();
  showToast(editing ? 'Item updated' : 'Added to your wardrobe');
  if (state.view === 'wardrobe') mountWardrobeView();
  if (state.view === 'builder') mountBuilderView();
}

async function deleteItem(id) {
  const item = findItem(id);
  if (!item) return;
  const ok = window.confirm('Delete "' + item.name + '" from your wardrobe? This cannot be undone.');
  if (!ok) return;
  await dbDelete('items', id);
  state.items = state.items.filter(function (i) { return i.id !== id; });
  closeSheet();
  showToast('Item deleted');
  if (state.view === 'wardrobe') mountWardrobeView();
  if (state.view === 'builder') mountBuilderView();
}

function openViewItemSheet(id) {
  const item = findItem(id);
  if (!item) return;
  const html = '<div class="rounded-2xl overflow-hidden border border-[var(--line)] bg-[#fbfaf7] mb-4" style="aspect-ratio:1/1;">' +
    '<img src="' + item.image + '" class="w-full h-full object-contain p-3"></div>' +
    '<h2 class="font-display text-xl font-semibold">' + escapeHTML(item.name) + '</h2>' +
    '<p class="text-sm text-[var(--ink-soft)] mb-3">' + item.category +
    (item.color ? ' · ' + escapeHTML(item.color) : '') + (item.style ? ' · ' + item.style : '') + '</p>' +
    (item.notes ? '<p class="text-sm mb-4">' + escapeHTML(item.notes) + '</p>' : '') +
    '<div class="flex gap-2">' +
    '<button class="btn-ghost flex-1 py-3" data-action="edit-item" data-id="' + item.id + '">Edit</button>' +
    '<button class="btn-danger flex-1 py-3" data-action="delete-item" data-id="' + item.id + '">Delete</button>' +
    '</div>';
  openSheet(html);
}


/* =========================================================================
   6. SAVED OUTFITS
   ========================================================================= */

function mountSavedView() {
  const el = document.getElementById('view-saved');
  if (state.outfits.length === 0) {
    el.innerHTML = '<div class="empty-state" style="aspect-ratio:auto;padding:60px 24px;">' +
      '<div class="empty-emoji">❤️</div>' +
      '<p class="font-semibold">No outfits saved yet</p>' +
      '<p class="text-sm text-[var(--ink-soft)]">Build a look you like and tap Save Outfit.</p>' +
      '<button class="btn-primary px-5 py-2.5 text-sm mt-2" data-action="nav" data-view="builder">Go to Outfit Builder</button>' +
      '</div>';
    return;
  }
  el.innerHTML = '<div class="px-4 pt-1 pb-4 grid grid-cols-2 gap-3">' +
    state.outfits.map(outfitCardHTML).join('') + '</div>';
}

function outfitCardHTML(outfit) {
  const top = findItem(outfit.topId), bottom = findItem(outfit.bottomId), shoes = findItem(outfit.shoesId);
  return '<button class="wardrobe-card text-left" data-action="open-outfit-detail" data-id="' + outfit.id + '">' +
    '<div class="outfit-triptych">' +
    '<div class="slot">' + thumbHTML(top, 'w-full h-full object-contain p-1') + '</div>' +
    '<div class="slot">' + thumbHTML(bottom, 'w-full h-full object-contain p-1') + '</div>' +
    '<div class="slot">' + thumbHTML(shoes, 'w-full h-full object-contain p-1') + '</div>' +
    '</div>' +
    '<div class="p-3"><p class="font-semibold text-[14px] leading-tight truncate">' + escapeHTML(outfit.name) + '</p></div>' +
    '</button>';
}

function daysForOutfit(outfitId) {
  return DAYS.filter(function (d) { return state.weekPlan[d] && state.weekPlan[d].outfitId === outfitId; });
}

function openOutfitDetailSheet(id) {
  const outfit = state.outfits.find(function (o) { return o.id === id; });
  if (!outfit) return;
  const top = findItem(outfit.topId), bottom = findItem(outfit.bottomId), shoes = findItem(outfit.shoesId);
  const assignedDays = daysForOutfit(outfit.id);

  const html = '<h2 class="font-display text-xl font-semibold mb-4">' + escapeHTML(outfit.name) + '</h2>' +
    '<div class="outfit-triptych rounded-2xl mb-4">' +
    '<div class="slot">' + thumbHTML(top, 'w-full h-full object-contain p-1') + '</div>' +
    '<div class="slot">' + thumbHTML(bottom, 'w-full h-full object-contain p-1') + '</div>' +
    '<div class="slot">' + thumbHTML(shoes, 'w-full h-full object-contain p-1') + '</div>' +
    '</div>' +
    (assignedDays.length ? ('<p class="field-label">Assigned to</p><div class="flex flex-wrap gap-2 mb-4">' +
      assignedDays.map(function (d) {
        return '<span class="chip active flex items-center gap-2">' + DAY_LABELS[d] +
          '<button aria-label="Remove from ' + DAY_LABELS[d] + '" data-action="week-remove-outfit" data-day="' + d + '">✕</button></span>';
      }).join('') + '</div>') : '') +
    '<div class="flex flex-col gap-2">' +
    '<button class="btn-accent py-3" data-action="load-outfit-to-builder" data-id="' + outfit.id + '">Load into Outfit Builder</button>' +
    '<button class="btn-ghost py-3" data-action="assign-outfit-day" data-id="' + outfit.id + '">Assign to a day</button>' +
    '<button class="btn-danger py-3" data-action="delete-outfit" data-id="' + outfit.id + '">Delete Outfit</button>' +
    '</div>';
  openSheet(html);
}

function loadOutfitToBuilder(id) {
  const outfit = state.outfits.find(function (o) { return o.id === id; });
  if (!outfit) return;
  const map = { Top: outfit.topId, Bottom: outfit.bottomId, Shoes: outfit.shoesId };
  BUILDER_CATEGORIES.forEach(function (cat) {
    const list = itemsByCategory(cat);
    const idx = list.findIndex(function (i) { return i.id === map[cat]; });
    state.builderIndex[cat] = idx >= 0 ? idx : 0;
  });
  closeSheet();
  switchView('builder');
  showToast('Loaded into Outfit Builder');
}

async function deleteOutfit(id) {
  const outfit = state.outfits.find(function (o) { return o.id === id; });
  if (!outfit) return;
  const ok = window.confirm('Delete "' + outfit.name + '"? This cannot be undone.');
  if (!ok) return;
  await dbDelete('outfits', id);
  state.outfits = state.outfits.filter(function (o) { return o.id !== id; });

  const clearedDays = daysForOutfit(id);
  for (const d of clearedDays) {
    await dbDelete('weekPlan', d);
    delete state.weekPlan[d];
  }
  closeSheet();
  showToast('Outfit deleted');
  if (state.view === 'saved') mountSavedView();
  if (state.view === 'week') mountWeekView();
}

function openDayPickerSheet(outfitId, excludeDay) {
  const html = '<h2 class="font-display text-xl font-semibold mb-4">Choose a day</h2>' +
    '<div class="flex flex-col gap-2">' +
    DAYS.filter(function (d) { return d !== excludeDay; }).map(function (d) {
      const current = state.weekPlan[d];
      return '<button class="btn-ghost py-3 flex items-center justify-between px-4" data-action="week-assign-outfit" data-day="' + d + '" data-outfit-id="' + outfitId + '">' +
        '<span>' + DAY_LABELS[d] + '</span>' +
        (current ? '<span class="text-[12px] text-[var(--ink-soft)]">replaces ' + escapeHTML(current.label || 'a look') + '</span>' : '') +
        '</button>';
    }).join('') + '</div>';
  openSheet(html);
}

async function assignOutfitToDay(outfitId, day) {
  const outfit = state.outfits.find(function (o) { return o.id === outfitId; });
  if (!outfit) return;
  const record = { day: day, outfitId: outfit.id, topId: outfit.topId, bottomId: outfit.bottomId, shoesId: outfit.shoesId, label: outfit.name };
  await dbPut('weekPlan', record);
  state.weekPlan[day] = record;
  closeSheet();
  showToast(outfit.name + ' assigned to ' + DAY_LABELS[day]);
  if (state.view === 'week') mountWeekView();
}

async function removeOutfitFromDay(day) {
  await dbDelete('weekPlan', day);
  delete state.weekPlan[day];
  closeSheet();
  showToast('Removed from ' + DAY_LABELS[day]);
  if (state.view === 'week') mountWeekView();
  if (state.view === 'saved') mountSavedView();
}


/* =========================================================================
   7. WEEK PLANNER
   ========================================================================= */

function mountWeekView() {
  const el = document.getElementById('view-week');
  let html = '<div class="px-4 pt-1 pb-3 flex items-center justify-between">' +
    '<h2 class="font-display text-xl font-semibold">Plan My Week</h2>' +
    '<button class="btn-ghost px-4 py-2 text-sm" data-action="random-week">🎲 Random Week</button>' +
    '</div>' +
    '<div class="px-4 flex flex-col gap-3 pb-6">' +
    DAYS.map(dayCardHTML).join('') +
    '</div>';
  el.innerHTML = html;
}

function dayCardHTML(day) {
  const plan = state.weekPlan[day];
  let body;
  if (!plan) {
    body = '<div class="px-4 pb-4">' +
      '<p class="text-sm text-[var(--ink-soft)] mb-3">No outfit planned</p>' +
      '<button class="btn-primary w-full py-2.5 text-sm" data-action="week-choose-outfit" data-day="' + day + '">Choose Outfit</button>' +
      '</div>';
  } else {
    const top = findItem(plan.topId), bottom = findItem(plan.bottomId), shoes = findItem(plan.shoesId);
    body = '<div class="outfit-triptych">' +
      '<div class="slot">' + thumbHTML(top, 'w-full h-full object-contain p-1') + '</div>' +
      '<div class="slot">' + thumbHTML(bottom, 'w-full h-full object-contain p-1') + '</div>' +
      '<div class="slot">' + thumbHTML(shoes, 'w-full h-full object-contain p-1') + '</div>' +
      '</div>' +
      '<div class="px-4 py-3">' +
      '<p class="font-semibold text-[14px] mb-3">' + escapeHTML(plan.label || 'Outfit') + '</p>' +
      '<div class="flex gap-2">' +
      '<button class="btn-ghost flex-1 py-2 text-[12px]" data-action="week-choose-outfit" data-day="' + day + '">Change</button>' +
      '<button class="btn-ghost flex-1 py-2 text-[12px]" data-action="week-move-outfit" data-day="' + day + '">Move</button>' +
      '<button class="btn-danger flex-1 py-2 text-[12px]" data-action="week-remove-outfit" data-day="' + day + '">Remove</button>' +
      '</div></div>';
  }
  return '<div class="day-card">' +
    '<div class="day-card-head"><div class="day-name">' + DAY_LABELS[day] + '</div></div>' +
    body + '</div>';
}

function openOutfitPickerSheet(day) {
  if (state.outfits.length === 0) {
    showToast('Save an outfit first from the Outfit Builder');
    return;
  }
  const html = '<h2 class="font-display text-xl font-semibold mb-4">Choose an outfit for ' + DAY_LABELS[day] + '</h2>' +
    '<div class="grid grid-cols-2 gap-3">' +
    state.outfits.map(function (o) {
      return '<button class="wardrobe-card text-left" data-action="week-assign-outfit" data-day="' + day + '" data-outfit-id="' + o.id + '">' +
        '<div class="outfit-triptych">' +
        '<div class="slot">' + thumbHTML(findItem(o.topId), 'w-full h-full object-contain p-1') + '</div>' +
        '<div class="slot">' + thumbHTML(findItem(o.bottomId), 'w-full h-full object-contain p-1') + '</div>' +
        '<div class="slot">' + thumbHTML(findItem(o.shoesId), 'w-full h-full object-contain p-1') + '</div>' +
        '</div>' +
        '<div class="p-2"><p class="font-semibold text-[13px] truncate">' + escapeHTML(o.name) + '</p></div>' +
        '</button>';
    }).join('') + '</div>';
  openSheet(html);
}

async function randomWeek() {
  const tops = itemsByCategory('Top'), bottoms = itemsByCategory('Bottom'), shoes = itemsByCategory('Shoes');
  if (!tops.length || !bottoms.length || !shoes.length) {
    showToast('Add tops, bottoms and shoes first');
    return;
  }
  const maxCombos = tops.length * bottoms.length * shoes.length;
  const used = new Set();
  const writes = [];

  DAYS.forEach(function (day) {
    let combo, key, attempts = 0;
    do {
      combo = [
        tops[Math.floor(Math.random() * tops.length)],
        bottoms[Math.floor(Math.random() * bottoms.length)],
        shoes[Math.floor(Math.random() * shoes.length)]
      ];
      key = combo.map(function (i) { return i.id; }).join('|');
      attempts++;
    } while (used.has(key) && attempts < 30 && used.size < maxCombos);
    used.add(key);

    const record = {
      day: day, outfitId: null,
      topId: combo[0].id, bottomId: combo[1].id, shoesId: combo[2].id,
      label: DAY_LABELS[day] + ' pick'
    };
    state.weekPlan[day] = record;
    writes.push(dbPut('weekPlan', record));
  });

  await Promise.all(writes);
  showToast('Your week has been randomised');
  mountWeekView();
}


/* =========================================================================
   8. SETTINGS / DATA
   ========================================================================= */

function mountSettingsView() {
  const el = document.getElementById('view-settings');
  el.innerHTML =
    '<div class="px-4 pt-1 pb-6 flex flex-col gap-3">' +
    '<h2 class="font-display text-xl font-semibold mb-1">Settings &amp; Data</h2>' +
    '<div class="card p-4">' +
    '<p class="font-semibold mb-1">Your data stays on this device</p>' +
    '<p class="text-sm text-[var(--ink-soft)]">The Hanger stores everything — photos included — in this browser only. Nothing is uploaded anywhere. Use Export regularly to keep a backup, and to move your wardrobe to another device.</p>' +
    '</div>' +
    '<button class="btn-primary py-3.5" data-action="export-data">⬇️ Export Wardrobe Data</button>' +
    '<button class="btn-ghost py-3.5" data-action="import-data">⬆️ Import Wardrobe Data</button>' +
    '<input type="file" accept="application/json" id="import-file-input" class="hidden">' +
    '<div class="h-px bg-[var(--line)] my-2"></div>' +
    '<button class="btn-danger py-3.5" data-action="confirm-clear-all">🗑 Clear All Data</button>' +
    '<p class="text-xs text-[var(--ink-soft)] text-center mt-2">The Hanger · v1.0</p>' +
    '</div>';

  document.getElementById('import-file-input').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (file) importData(file);
    e.target.value = '';
  });
}

async function exportData() {
  const payload = {
    app: 'The Hanger',
    version: 1,
    exportedAt: new Date().toISOString(),
    items: state.items,
    outfits: state.outfits,
    weekPlan: DAYS.map(function (d) { return state.weekPlan[d]; }).filter(Boolean)
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = 'the-hanger-backup-' + stamp + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Backup downloaded');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = async function () {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch (err) {
      showToast('That file is not a valid backup');
      return;
    }
    if (!data || !Array.isArray(data.items) || !Array.isArray(data.outfits)) {
      showToast('That file does not look like a Hanger backup');
      return;
    }
    const ok = window.confirm('Importing will replace your current wardrobe, outfits and week plan with this backup. Continue?');
    if (!ok) return;

    await Promise.all([dbClear('items'), dbClear('outfits'), dbClear('weekPlan')]);
    await Promise.all(data.items.map(function (i) { return dbPut('items', i); }));
    await Promise.all(data.outfits.map(function (o) { return dbPut('outfits', o); }));
    await Promise.all((data.weekPlan || []).map(function (w) { return dbPut('weekPlan', w); }));

    await loadAllData();
    showToast('Backup restored');
    switchView(state.view); // re-render current tab with the restored data
  };
  reader.readAsText(file);
}

function openClearAllSheet() {
  const html = '<h2 class="font-display text-xl font-semibold mb-2">Clear all data?</h2>' +
    '<p class="text-sm text-[var(--ink-soft)] mb-4">This permanently deletes every clothing item, photo, saved outfit and your week plan from this device. This cannot be undone.</p>' +
    '<label class="field-label" for="clear-confirm-input">Type DELETE to confirm</label>' +
    '<input id="clear-confirm-input" class="field-input mb-4" autocapitalize="characters" autocomplete="off">' +
    '<div class="flex gap-2">' +
    '<button class="btn-ghost flex-1 py-3" data-action="close-sheet">Cancel</button>' +
    '<button class="btn-danger flex-1 py-3" id="clear-all-confirm-btn" disabled>Delete Everything</button>' +
    '</div>';
  openSheet(html);
  const input = document.getElementById('clear-confirm-input');
  const btn = document.getElementById('clear-all-confirm-btn');
  input.addEventListener('input', function () {
    btn.disabled = input.value.trim().toUpperCase() !== 'DELETE';
    btn.style.opacity = btn.disabled ? '0.5' : '1';
  });
  btn.addEventListener('click', clearAllData);
}

async function clearAllData() {
  await Promise.all([dbClear('items'), dbClear('outfits'), dbClear('weekPlan')]);
  state.items = [];
  state.outfits = [];
  state.weekPlan = {};
  state.builderIndex = { Top: 0, Bottom: 0, Shoes: 0 };
  closeSheet();
  showToast('All data cleared');
  switchView(state.view);
}


/* =========================================================================
   9. NAVIGATION + GLOBAL EVENT DELEGATION
   ========================================================================= */

function switchView(view) {
  state.view = view;
  document.querySelectorAll('.view-panel').forEach(function (panel) {
    panel.classList.toggle('hidden', panel.id !== 'view-' + view);
  });
  document.querySelectorAll('.nav-btn').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  const panel = document.getElementById('view-' + view);
  panel.classList.remove('view-enter');
  void panel.offsetWidth;
  panel.classList.add('view-enter');

  if (view === 'builder') mountBuilderView();
  else if (view === 'wardrobe') mountWardrobeView();
  else if (view === 'saved') mountSavedView();
  else if (view === 'week') mountWeekView();
  else if (view === 'settings') mountSettingsView();

  window.scrollTo(0, 0);
}

// A single delegated click listener handles nearly every button in the
// app. Each interactive element carries a `data-action` attribute; we
// look at that (plus any other data-* attributes) to decide what to do.
// This keeps the app working correctly even after sections of the page
// are rebuilt with innerHTML, since we never rely on listeners attached
// to elements that might have been replaced.
document.addEventListener('click', function (e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;

  switch (action) {
    case 'nav':
      switchView(el.dataset.view);
      break;
    case 'goto-wardrobe-add':
      switchView('wardrobe');
      openAddItemSheet(el.dataset.category, null);
      break;
    case 'open-add-item':
      openAddItemSheet(null, null);
      break;
    case 'edit-item':
      openAddItemSheet(null, el.dataset.id);
      break;
    case 'delete-item':
      deleteItem(el.dataset.id);
      break;
    case 'view-item':
      openViewItemSheet(el.dataset.id);
      break;
    case 'filter-category':
      state.wardrobeFilter = el.dataset.category;
      document.querySelectorAll('#wardrobe-filters .chip').forEach(function (c) {
        c.classList.toggle('active', c.dataset.category === state.wardrobeFilter);
      });
      refreshWardrobeGrid();
      break;
    case 'carousel-prev':
      changeCarouselIndex(el.dataset.category, -1, itemsByCategory(el.dataset.category).length);
      break;
    case 'carousel-next':
      changeCarouselIndex(el.dataset.category, 1, itemsByCategory(el.dataset.category).length);
      break;
    case 'carousel-dot':
      state.builderIndex[el.dataset.category] = parseInt(el.dataset.index, 10);
      updateCarouselUI(el.dataset.category);
      break;
    case 'open-save-outfit':
      openSaveOutfitSheet();
      break;
    case 'randomize-outfit':
      randomizeOutfit(false);
      break;
    case 'surprise-me':
      randomizeOutfit(true);
      break;
    case 'clear-outfit':
      clearOutfitSelection();
      break;
    case 'close-sheet':
      closeSheet();
      break;
    case 'open-outfit-detail':
      openOutfitDetailSheet(el.dataset.id);
      break;
    case 'load-outfit-to-builder':
      loadOutfitToBuilder(el.dataset.id);
      break;
    case 'delete-outfit':
      deleteOutfit(el.dataset.id);
      break;
    case 'assign-outfit-day':
      openDayPickerSheet(el.dataset.id, null);
      break;
    case 'week-assign-outfit':
      assignOutfitToDay(el.dataset.outfitId, el.dataset.day);
      break;
    case 'week-remove-outfit':
      removeOutfitFromDay(el.dataset.day);
      break;
    case 'week-choose-outfit':
      openOutfitPickerSheet(el.dataset.day);
      break;
    case 'week-move-outfit':
      openDayPickerSheet(null, el.dataset.day);
      // Special-case: moving reuses the day-picker but must carry the
      // *day's current plan* rather than an outfit id. Handle inline:
      (function () {
        const sourceDay = el.dataset.day;
        const plan = state.weekPlan[sourceDay];
        if (!plan) return;
        document.querySelectorAll('[data-action="week-assign-outfit"]').forEach(function (btn) {
          btn.dataset.action = 'week-move-target';
          btn.dataset.sourceDay = sourceDay;
        });
      })();
      break;
    case 'week-move-target':
      (function () {
        const sourceDay = el.dataset.sourceDay;
        const targetDay = el.dataset.day;
        const plan = state.weekPlan[sourceDay];
        if (!plan) return;
        const newRecord = { day: targetDay, outfitId: plan.outfitId, topId: plan.topId, bottomId: plan.bottomId, shoesId: plan.shoesId, label: plan.label };
        Promise.all([dbDelete('weekPlan', sourceDay), dbPut('weekPlan', newRecord)]).then(function () {
          delete state.weekPlan[sourceDay];
          state.weekPlan[targetDay] = newRecord;
          closeSheet();
          showToast('Moved to ' + DAY_LABELS[targetDay]);
          mountWeekView();
        });
      })();
      break;
    case 'random-week':
      randomWeek();
      break;
    case 'export-data':
      exportData();
      break;
    case 'import-data':
      document.getElementById('import-file-input').click();
      break;
    case 'confirm-clear-all':
      openClearAllSheet();
      break;
  }
});

document.getElementById('sheet-backdrop').addEventListener('click', closeSheet);

// Form submissions (Add/Edit item, Save outfit) are handled separately
// from the click delegation above because submitting a form is its own
// browser event.
document.addEventListener('submit', function (e) {
  if (e.target.id === 'item-form') {
    e.preventDefault();
    handleItemFormSubmit();
  } else if (e.target.id === 'save-outfit-form') {
    e.preventDefault();
    handleSaveOutfitSubmit();
  }
});

// Re-measure the open carousel on resize/orientation change so the drag
// math and the resting position stay correct.
window.addEventListener('resize', function () {
  if (state.view === 'builder') {
    BUILDER_CATEGORIES.forEach(function (cat) { updateCarouselUI(cat); });
  }
});


/* =========================================================================
   10. BOOT SEQUENCE
   ========================================================================= */

async function boot() {
  await loadAllData();
  switchView('builder');

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {
        // Offline support just won't be available; the app still works online.
      });
    });
  }
}

boot();
