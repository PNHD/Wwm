const APP_STATE_KEY = 'wwm-atlas-state:v2';
const DATASET_KEY = 'wwm-atlas-dataset:v1';
const PROGRESS_SCHEMA_VERSION = 2;
const BASE_BOUNDS = [[-120, -70], [120, 70]];

const i18n = {
  vi: {
    brandTag: 'Independent map hub', mapSource: 'Nguồn bản đồ', reload: 'Tải lại', openNewTab: 'Mở tab mới',
    externalNoticeTitle: 'Không mirror dữ liệu bên thứ ba',
    externalNoticeBody: 'Trang này giữ UI và dữ liệu cá nhân của bạn độc lập. Nội dung bản đồ thật được tải trực tiếp từ nhà cung cấp đã chọn.',
    notes: 'Ghi chú nhanh', notesPlaceholder: 'Ghi vị trí, nhiệm vụ hoặc thứ cần quay lại…', notesSaved: 'Ghi chú được lưu chỉ trên trình duyệt này.',
    region: 'Khu vực', searchPoi: 'Tìm POI', searchPlaceholder: 'Tên hoặc mô tả…', categories: 'Danh mục', hideAll: 'Ẩn hết', showAll: 'Hiện hết',
    completed: 'Đã xong', hideCompleted: 'Ẩn đã xong', importData: 'Nhập POI', exportState: 'Xuất dữ liệu', importState: 'Nhập dữ liệu', resetView: 'Reset view',
    personalHint: 'Personal Overlay dùng dataset của bạn. Dataset mẫu đi kèm chỉ để test giao diện, không phải vị trí thật trong game.',
    localFirst: 'Local-first · Không tài khoản', loadingMap: 'Đang tải bản đồ…', iframeFallback: 'Nếu nguồn chặn iframe, dùng nút “Mở tab mới”.',
    visiblePoi: 'POI đang hiện', noPoi: 'Không có POI phù hợp bộ lọc.', markDone: 'Đánh dấu đã xong', markUndone: 'Bỏ đánh dấu',
    datasetImported: 'Đã nhập dataset POI.', datasetInvalid: 'Dataset không hợp lệ. Cần GeoJSON FeatureCollection với Point features.',
    stateImported: 'Đã nhập dữ liệu cá nhân.', stateInvalid: 'File dữ liệu không hợp lệ.', demo: 'Demo', imported: 'Imported',
  },
  en: {
    brandTag: 'Independent map hub', mapSource: 'Map source', reload: 'Reload', openNewTab: 'Open in new tab',
    externalNoticeTitle: 'No third-party data mirroring',
    externalNoticeBody: 'This site keeps its UI and your personal data independent. Real map content loads directly from the selected provider.',
    notes: 'Quick notes', notesPlaceholder: 'Write locations, quests or things to revisit…', notesSaved: 'Notes are stored only in this browser.',
    region: 'Region', searchPoi: 'Search POI', searchPlaceholder: 'Name or description…', categories: 'Categories', hideAll: 'Hide all', showAll: 'Show all',
    completed: 'Completed', hideCompleted: 'Hide completed', importData: 'Import POI', exportState: 'Export data', importState: 'Import data', resetView: 'Reset view',
    personalHint: 'Personal Overlay uses your own dataset. The bundled sample only tests the UI and is not real in-game location data.',
    localFirst: 'Local-first · No account', loadingMap: 'Loading map…', iframeFallback: 'If the provider blocks embedding, use “Open in new tab”.',
    visiblePoi: 'visible POIs', noPoi: 'No POIs match the current filters.', markDone: 'Mark completed', markUndone: 'Mark incomplete',
    datasetImported: 'POI dataset imported.', datasetInvalid: 'Invalid dataset. Use a GeoJSON FeatureCollection containing Point features.',
    stateImported: 'Personal data imported.', stateInvalid: 'Invalid personal data file.', demo: 'Demo', imported: 'Imported',
  },
};

const state = {
  lang: 'vi',
  sources: [],
  activeSource: 'official',
  notes: '',
  regions: [],
  categories: [],
  categoryRegistry: [],
  region: null,
  allFeatures: [],
  completed: new Set(),
  enabledCategories: new Set(),
  hideCompleted: false,
  query: '',
  map: null,
  maplibrePromise: null,
  sourceReady: false,
  popup: null,
  importedDataset: null,
};

const els = {
  sourceTabs: document.querySelector('#source-tabs'),
  activeSourceName: document.querySelector('#active-source-name'),
  activeSourceDescription: document.querySelector('#active-source-description'),
  sourceBadge: document.querySelector('#source-badge'),
  mapFrame: document.querySelector('#map-frame'),
  frameLoading: document.querySelector('#frame-loading'),
  reloadSource: document.querySelector('#reload-source'),
  openSource: document.querySelector('#open-source'),
  externalPanel: document.querySelector('#external-panel'),
  personalPanel: document.querySelector('#personal-panel'),
  externalStage: document.querySelector('#external-stage'),
  personalStage: document.querySelector('#personal-stage'),
  quickNotes: document.querySelector('#quick-notes'),
  languageSelect: document.querySelector('#language-select'),
  toggleSidebar: document.querySelector('#toggle-sidebar'),
  sidebar: document.querySelector('#sidebar'),
  regionSelect: document.querySelector('#region-select'),
  searchInput: document.querySelector('#search-input'),
  categoryList: document.querySelector('#category-list'),
  toggleAll: document.querySelector('#toggle-all'),
  hideCompleted: document.querySelector('#hide-completed'),
  progressCount: document.querySelector('#progress-count'),
  visibleCount: document.querySelector('#visible-count'),
  emptyState: document.querySelector('#empty-state'),
  exportProgress: document.querySelector('#export-progress'),
  importProgress: document.querySelector('#import-progress'),
  importFile: document.querySelector('#import-file'),
  importDataset: document.querySelector('#import-dataset'),
  datasetFile: document.querySelector('#dataset-file'),
  resetView: document.querySelector('#reset-view'),
  dataStatus: document.querySelector('#data-status'),
};

function t(key) { return i18n[state.lang]?.[key] || i18n.vi[key] || key; }

function registryItems(value, key) {
  const items = Array.isArray(value) ? value : value?.[key];
  if (!Array.isArray(items)) throw new Error(`Invalid ${key} registry`);
  return items;
}

async function loadJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  return response.json();
}

function loadPersistedState() {
  try {
    const raw = localStorage.getItem(APP_STATE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed.lang === 'vi' || parsed.lang === 'en') state.lang = parsed.lang;
    if (typeof parsed.activeSource === 'string') state.activeSource = parsed.activeSource;
    if (typeof parsed.notes === 'string') state.notes = parsed.notes;
    if (Array.isArray(parsed.completedIds)) state.completed = new Set(parsed.completedIds.filter((v) => typeof v === 'string'));
    state.hideCompleted = Boolean(parsed.hideCompleted);
  } catch { /* ignore corrupt local state */ }

  try {
    const datasetRaw = localStorage.getItem(DATASET_KEY);
    if (datasetRaw) {
      const parsed = JSON.parse(datasetRaw);
      if (isValidFeatureCollection(parsed)) state.importedDataset = parsed;
    }
  } catch { /* ignore */ }
}

function persistState() {
  localStorage.setItem(APP_STATE_KEY, JSON.stringify({
    schemaVersion: PROGRESS_SCHEMA_VERSION,
    lang: state.lang,
    activeSource: state.activeSource,
    notes: state.notes,
    completedIds: [...state.completed].sort(),
    hideCompleted: state.hideCompleted,
  }));
}

function applyTranslations() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  });
  syncToggleAllLabel();
  updateSourceSummary();
  if (state.popup) state.popup.remove();
}

function renderSourceTabs() {
  els.sourceTabs.replaceChildren();
  for (const source of state.sources) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'source-tab';
    button.dataset.source = source.id;
    button.textContent = source.name;
    button.addEventListener('click', () => selectSource(source.id));
    els.sourceTabs.append(button);
  }
}

function updateSourceSummary() {
  const source = state.sources.find((s) => s.id === state.activeSource);
  if (!source) return;
  els.activeSourceName.textContent = source.name;
  els.activeSourceDescription.textContent = state.lang === 'vi' ? source.descriptionVi : source.descriptionEn;
  els.sourceBadge.textContent = source.badge;
  document.querySelectorAll('.source-tab').forEach((node) => {
    node.classList.toggle('is-active', node.dataset.source === source.id);
  });
}

function selectSource(sourceId) {
  const source = state.sources.find((s) => s.id === sourceId);
  if (!source) return;
  state.activeSource = sourceId;
  const url = new URL(location.href);
  url.searchParams.set('source', sourceId);
  history.replaceState(null, '', url);
  persistState();
  updateSourceSummary();
  const personal = sourceId === 'personal';
  els.externalPanel.hidden = personal;
  els.personalPanel.hidden = !personal;
  els.externalStage.hidden = personal;
  els.personalStage.hidden = !personal;
  els.openSource.hidden = personal;
  els.reloadSource.hidden = personal;

  if (personal) {
    ensurePersonalMap().then(() => requestAnimationFrame(() => state.map?.resize()));
  } else {
    loadExternalSource(source);
  }
  if (window.innerWidth <= 820) els.sidebar.classList.remove('is-open');
}

function loadExternalSource(source) {
  els.frameLoading.hidden = false;
  els.openSource.href = source.url;
  els.mapFrame.src = source.url;
}

function isValidFeatureCollection(value) {
  if (!value || value.type !== 'FeatureCollection' || !Array.isArray(value.features)) return false;
  return value.features.every((feature) => feature && feature.type === 'Feature' && feature.geometry?.type === 'Point' && Array.isArray(feature.geometry.coordinates) && feature.geometry.coordinates.length >= 2);
}

function normalizeImportedDataset(value) {
  if (!isValidFeatureCollection(value)) return null;
  const features = value.features.map((feature, index) => {
    const properties = { ...(feature.properties || {}) };
    const id = String(feature.id ?? properties.id ?? `custom-${index + 1}`);
    properties.id = id;
    properties.name = String(properties.name || properties.title || `POI ${index + 1}`);
    properties.description = String(properties.description || '');
    properties.category = String(properties.category || 'custom');
    return { ...feature, id, properties };
  });
  return { type: 'FeatureCollection', features };
}

function categoryById(id) { return state.categories.find((category) => category.id === id); }

function effectiveCategories(features = state.allFeatures) {
  const configured = new Map(state.categoryRegistry.map((c) => [c.id, c]));
  const palette = ['#d6b57a', '#8ec5ff', '#c9a4ff', '#88d7a8', '#f39a91', '#ffd56c', '#9fd3c7', '#e3a7d6'];
  let colorIndex = 0;
  for (const feature of features) {
    const id = String(feature.properties?.category || 'custom');
    if (!configured.has(id)) {
      configured.set(id, { id, name: id.replace(/[-_]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()), color: palette[colorIndex++ % palette.length] });
    }
  }
  return [...configured.values()];
}

function featureMatches(feature) {
  const props = feature.properties || {};
  const category = String(props.category || 'custom');
  if (!state.enabledCategories.has(category)) return false;
  if (state.hideCompleted && state.completed.has(String(feature.id))) return false;
  if (!state.query) return true;
  const haystack = `${props.name || ''} ${props.description || ''}`.toLocaleLowerCase();
  return haystack.includes(state.query);
}

function filteredCollection() {
  return {
    type: 'FeatureCollection',
    features: state.allFeatures.filter(featureMatches).map((feature) => ({
      ...feature,
      properties: { ...feature.properties, done: state.completed.has(String(feature.id)) },
    })),
  };
}

function refreshCounts(collection = filteredCollection()) {
  const regionIds = new Set(state.allFeatures.map((feature) => String(feature.id)));
  const done = [...state.completed].filter((id) => regionIds.has(id)).length;
  els.progressCount.textContent = `${done} / ${state.allFeatures.length}`;
  els.visibleCount.textContent = String(collection.features.length);
  els.emptyState.hidden = collection.features.length !== 0;
  document.querySelectorAll('[data-category-count]').forEach((node) => {
    node.textContent = String(state.allFeatures.filter((feature) => String(feature.properties?.category || 'custom') === node.dataset.categoryCount).length);
  });
}

function updateMapData() {
  const collection = filteredCollection();
  refreshCounts(collection);
  if (state.sourceReady) state.map.getSource('poi')?.setData(collection);
}

function renderCategories() {
  state.categories = effectiveCategories();
  const validIds = new Set(state.categories.map((category) => category.id));
  state.enabledCategories = new Set([...state.enabledCategories].filter((id) => validIds.has(id)));

  els.categoryList.replaceChildren();
  for (const category of state.categories) {
    const label = document.createElement('label');
    label.className = 'category-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.enabledCategories.has(category.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.enabledCategories.add(category.id); else state.enabledCategories.delete(category.id);
      syncToggleAllLabel(); updateMapData();
    });
    const dot = document.createElement('span'); dot.className = 'category-dot'; dot.style.setProperty('--category-color', category.color);
    const name = document.createElement('span'); name.textContent = category.name;
    const count = document.createElement('span'); count.className = 'category-count'; count.dataset.categoryCount = category.id;
    label.append(checkbox, dot, name, count); els.categoryList.append(label);
  }
  syncToggleAllLabel(); refreshCounts();
}

function syncToggleAllLabel() {
  if (!els.toggleAll) return;
  els.toggleAll.textContent = state.enabledCategories.size === 0 ? t('showAll') : t('hideAll');
}

function renderRegions() {
  els.regionSelect.replaceChildren();
  for (const region of state.regions) {
    const option = document.createElement('option');
    option.value = region.id; option.textContent = region.name;
    els.regionSelect.append(option);
  }
  if (state.importedDataset) {
    const option = document.createElement('option'); option.value = '__imported__'; option.textContent = state.lang === 'vi' ? 'Dataset đã nhập' : 'Imported dataset';
    els.regionSelect.prepend(option);
  }
  if (state.region?.id && [...els.regionSelect.options].some((option) => option.value === state.region.id)) {
    els.regionSelect.value = state.region.id;
  }
}

async function selectRegion(regionId) {
  let region;
  let geojson;
  if (regionId === '__imported__' && state.importedDataset) {
    region = { id: '__imported__', name: 'Imported Dataset', demo: false, status: t('imported'), bounds: calculateBounds(state.importedDataset.features) };
    geojson = state.importedDataset;
  } else {
    region = state.regions.find((item) => item.id === regionId);
    if (!region) return;
    geojson = await loadJson(region.geojson);
  }
  state.region = region;
  state.allFeatures = Array.isArray(geojson.features) ? geojson.features : [];
  state.enabledCategories.clear();
  state.categories = effectiveCategories(state.allFeatures);
  state.categories.forEach((c) => state.enabledCategories.add(c.id));
  els.dataStatus.textContent = region.demo ? t('demo') : (region.status || t('imported'));
  renderCategories();

  if (state.map && state.sourceReady) {
    const base = state.map.getSource('base-map');
    if (base?.updateImage && region.mapImage) await base.updateImage({ url: region.mapImage, coordinates: region.mapCoordinates });
    if (state.map.getLayer('base-map')) state.map.setLayoutProperty('base-map', 'visibility', region.mapImage ? 'visible' : 'none');
    const bounds = region.bounds || BASE_BOUNDS;
    state.map.fitBounds(bounds, { padding: 42, duration: 0 });
  }
  updateMapData(); focusHashPoi();
}

function calculateBounds(features) {
  if (!features.length) return BASE_BOUNDS;
  const xs = [], ys = [];
  for (const feature of features) {
    const [x, y] = feature.geometry.coordinates;
    if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); }
  }
  if (!xs.length) return BASE_BOUNDS;
  const padX = Math.max((Math.max(...xs) - Math.min(...xs)) * .08, .01);
  const padY = Math.max((Math.max(...ys) - Math.min(...ys)) * .08, .01);
  return [[Math.min(...xs) - padX, Math.min(...ys) - padY], [Math.max(...xs) + padX, Math.max(...ys) + padY]];
}

function colorExpression() {
  const expression = ['match', ['get', 'category']];
  for (const category of state.categories) expression.push(category.id, category.color);
  expression.push('#d6b57a');
  return expression;
}

async function loadMapLibre() {
  if (window.maplibregl) return window.maplibregl;
  if (!state.maplibrePromise) {
    const cssId = 'maplibre-css';
    if (!document.getElementById(cssId)) {
      const link = document.createElement('link');
      link.id = cssId;
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/maplibre-gl@6.2.0/dist/maplibre-gl.css';
      document.head.append(link);
    }
    state.maplibrePromise = import('https://unpkg.com/maplibre-gl@6.2.0/dist/maplibre-gl.mjs')
      .then((module) => { window.maplibregl = module; return module; })
      .catch((error) => { state.maplibrePromise = null; throw error; });
  }
  return state.maplibrePromise;
}

async function ensurePersonalMap() {
  if (state.map) return state.map;
  try { await loadMapLibre(); } catch (error) {
    console.error(error);
    els.emptyState.hidden = false;
    els.emptyState.textContent = state.lang === 'vi'
      ? 'Không tải được MapLibre cho Personal Overlay. Các nguồn bản đồ thật vẫn hoạt động.'
      : 'MapLibre could not load for Personal Overlay. External map sources remain available.';
    return null;
  }
  const initialRegion = state.region || state.regions[0];
  state.map = new window.maplibregl.Map({
    container: 'map', attributionControl: false, renderWorldCopies: false, center: [0, 0], zoom: 1,
    minZoom: 0, maxZoom: 12, style: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#080c10' } }] },
  });
  state.map.addControl(new window.maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  state.map.addControl(new window.maplibregl.AttributionControl({ compact: true, customAttribution: 'WWM Atlas personal overlay' }));
  state.map.on('load', () => {
    state.map.addSource('base-map', { type: 'image', url: initialRegion?.mapImage || '/assets/map-placeholder.svg', coordinates: initialRegion?.mapCoordinates || [[-120,70],[120,70],[120,-70],[-120,-70]] });
    state.map.addLayer({ id: 'base-map', type: 'raster', source: 'base-map', paint: { 'raster-opacity': .96 } });
    state.map.addSource('poi', { type: 'geojson', data: filteredCollection(), cluster: true, clusterMaxZoom: 7, clusterRadius: 46, promoteId: 'id' });
    state.map.addLayer({ id: 'clusters', type: 'circle', source: 'poi', filter: ['has','point_count'], paint: { 'circle-color':'#d6b57a','circle-radius':['step',['get','point_count'],17,50,21,250,27],'circle-stroke-color':'#1a1410','circle-stroke-width':2 } });
    state.map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'poi', filter:['has','point_count'], layout:{'text-field':['get','point_count_abbreviated'],'text-size':11}, paint:{'text-color':'#15100a'} });
    state.map.addLayer({ id: 'poi-points', type:'circle', source:'poi', filter:['!', ['has','point_count']], paint:{'circle-color':colorExpression(),'circle-radius':['interpolate',['linear'],['zoom'],0,5,6,9,10,12],'circle-opacity':['case',['boolean',['get','done'],false],.35,.96],'circle-stroke-color':'#0a0d12','circle-stroke-width':1.5} });
    state.sourceReady = true;
    wireMapEvents(); updateMapData();
    const bounds = state.region?.bounds || BASE_BOUNDS; state.map.fitBounds(bounds, { padding: 42, duration: 0 });
    focusHashPoi();
  });
}

function wireMapEvents() {
  state.map.on('click', 'clusters', async (event) => {
    const feature = state.map.queryRenderedFeatures(event.point, { layers:['clusters'] })[0];
    if (!feature) return;
    const zoom = await state.map.getSource('poi').getClusterExpansionZoom(feature.properties.cluster_id);
    state.map.easeTo({ center: feature.geometry.coordinates, zoom });
  });
  state.map.on('click', 'poi-points', (event) => {
    const feature = event.features?.[0]; if (feature) openPoi(feature);
  });
  for (const layer of ['clusters','poi-points']) {
    state.map.on('mouseenter', layer, () => { state.map.getCanvas().style.cursor = 'pointer'; });
    state.map.on('mouseleave', layer, () => { state.map.getCanvas().style.cursor = ''; });
  }
}

function openPoi(feature) {
  const id = String(feature.id ?? feature.properties?.id ?? '');
  const props = feature.properties || {};
  const category = categoryById(String(props.category || 'custom'));
  const wrapper = document.createElement('article'); wrapper.className = 'poi-card';
  const meta = document.createElement('p'); meta.className='poi-meta'; meta.textContent=category?.name || props.category || 'POI';
  const title = document.createElement('h2'); title.className='poi-title'; title.textContent=props.name || id;
  const desc = document.createElement('p'); desc.className='poi-description'; desc.textContent=props.description || '';
  const button = document.createElement('button'); button.className='poi-done-button'; button.type='button';
  const syncButton = () => { const done = state.completed.has(id); button.dataset.done=String(done); button.textContent=done ? t('markUndone') : t('markDone'); };
  syncButton();
  button.addEventListener('click', () => { if (state.completed.has(id)) state.completed.delete(id); else state.completed.add(id); persistState(); syncButton(); updateMapData(); });
  wrapper.append(meta,title); if (desc.textContent) wrapper.append(desc); wrapper.append(button);
  state.popup?.remove(); state.popup = new window.maplibregl.Popup({ closeButton:true, maxWidth:'320px' }).setLngLat(feature.geometry.coordinates).setDOMContent(wrapper).addTo(state.map);
  if (id) history.replaceState(null,'',`#poi=${encodeURIComponent(id)}`);
}

function focusHashPoi() {
  if (!state.map || !state.sourceReady) return;
  const match = location.hash.match(/(?:^#|&)poi=([^&]+)/); if (!match) return;
  const id = decodeURIComponent(match[1]);
  const feature = state.allFeatures.find((f) => String(f.id) === id || String(f.properties?.id) === id); if (!feature) return;
  state.map.easeTo({ center: feature.geometry.coordinates, zoom: Math.max(state.map.getZoom(), 5), duration: 0 }); openPoi(feature);
}

function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url);
}

function exportPersonalState() {
  downloadJson(`wwm-atlas-backup-${new Date().toISOString().slice(0,10)}.json`, {
    schemaVersion: PROGRESS_SCHEMA_VERSION, exportedAt: new Date().toISOString(), lang: state.lang, notes: state.notes,
    completedIds: [...state.completed].sort(), hideCompleted: state.hideCompleted, dataset: state.importedDataset,
  });
}

async function importPersonalState(file) {
  try {
    const value = JSON.parse(await file.text());
    if (!value || !Array.isArray(value.completedIds)) throw new Error('invalid');
    state.completed = new Set(value.completedIds.filter((v) => typeof v === 'string'));
    if (typeof value.notes === 'string') state.notes = value.notes;
    if (value.lang === 'vi' || value.lang === 'en') state.lang = value.lang;
    state.hideCompleted = Boolean(value.hideCompleted);
    if (value.dataset) {
      const normalized = normalizeImportedDataset(value.dataset); if (normalized) { state.importedDataset = normalized; localStorage.setItem(DATASET_KEY, JSON.stringify(normalized)); }
    }
    els.quickNotes.value = state.notes; els.hideCompleted.checked = state.hideCompleted; els.languageSelect.value = state.lang;
    persistState(); applyTranslations(); renderRegions(); updateMapData(); alert(t('stateImported'));
  } catch { alert(t('stateInvalid')); }
}

async function importDatasetFile(file) {
  try {
    const value = JSON.parse(await file.text()); const normalized = normalizeImportedDataset(value); if (!normalized) throw new Error('invalid');
    state.importedDataset = normalized; localStorage.setItem(DATASET_KEY, JSON.stringify(normalized)); renderRegions(); els.regionSelect.value='__imported__'; await selectRegion('__imported__'); alert(t('datasetImported'));
  } catch { alert(t('datasetInvalid')); }
}

function wireUi() {
  els.mapFrame.addEventListener('load', () => { setTimeout(() => { els.frameLoading.hidden = true; }, 350); });
  els.reloadSource.addEventListener('click', () => { const source = state.sources.find((s) => s.id === state.activeSource); if (source) loadExternalSource(source); });
  els.quickNotes.addEventListener('input', () => { state.notes = els.quickNotes.value; persistState(); });
  els.languageSelect.addEventListener('change', () => { state.lang = els.languageSelect.value; persistState(); applyTranslations(); renderRegions(); });
  els.toggleSidebar.addEventListener('click', () => els.sidebar.classList.toggle('is-open'));
  els.regionSelect.addEventListener('change', () => selectRegion(els.regionSelect.value));
  els.searchInput.addEventListener('input', () => { state.query = els.searchInput.value.trim().toLocaleLowerCase(); updateMapData(); });
  els.toggleAll.addEventListener('click', () => { if (state.enabledCategories.size) state.enabledCategories.clear(); else state.categories.forEach((c) => state.enabledCategories.add(c.id)); renderCategories(); updateMapData(); });
  els.hideCompleted.addEventListener('change', () => { state.hideCompleted = els.hideCompleted.checked; persistState(); updateMapData(); });
  els.resetView.addEventListener('click', () => { state.map?.fitBounds(state.region?.bounds || BASE_BOUNDS, { padding:42, duration:450 }); });
  els.exportProgress.addEventListener('click', exportPersonalState);
  els.importProgress.addEventListener('click', () => els.importFile.click());
  els.importFile.addEventListener('change', () => { const [file] = els.importFile.files; if (file) importPersonalState(file); els.importFile.value=''; });
  els.importDataset.addEventListener('click', () => els.datasetFile.click());
  els.datasetFile.addEventListener('change', () => { const [file] = els.datasetFile.files; if (file) importDatasetFile(file); els.datasetFile.value=''; });
  window.addEventListener('hashchange', focusHashPoi);
}

async function boot() {
  loadPersistedState();
  const [sources, regions, categories] = await Promise.all([loadJson('/data/sources.json'), loadJson('/data/regions.json'), loadJson('/data/categories.json')]);
  state.sources = registryItems(sources, 'sources');
  state.regions = registryItems(regions, 'regions');
  state.categoryRegistry = registryItems(categories, 'categories');
  state.categories = [...state.categoryRegistry];
  const requestedSource = new URLSearchParams(location.search).get('source');
  if (requestedSource && state.sources.some((s) => s.id === requestedSource)) state.activeSource = requestedSource;
  if (!state.sources.some((s) => s.id === state.activeSource)) state.activeSource = 'official';
  state.region = state.regions[0] || null;
  if (state.region) {
    const demo = await loadJson(state.region.geojson); state.allFeatures = demo.features || [];
    state.categories = effectiveCategories(state.allFeatures); state.categories.forEach((c) => state.enabledCategories.add(c.id));
  }
  renderSourceTabs(); renderRegions(); renderCategories(); wireUi();
  els.quickNotes.value = state.notes; els.languageSelect.value = state.lang; els.hideCompleted.checked = state.hideCompleted;
  applyTranslations(); selectSource(state.activeSource);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
}

boot().catch((error) => {
  console.error(error);
  els.frameLoading.hidden = false;
  els.frameLoading.innerHTML = `<strong>WWM Atlas failed to initialize.</strong><small>${String(error.message || error)}</small>`;
});
