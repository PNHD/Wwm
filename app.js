const STORAGE_KEY = 'wwm-map-progress:v1';
const PROGRESS_SCHEMA_VERSION = 1;
const BASE_BOUNDS = [[-120, -70], [120, 70]];

const state = {
  regions: [],
  categories: [],
  region: null,
  allFeatures: [],
  completed: new Set(),
  enabledCategories: new Set(),
  hideCompleted: false,
  query: '',
  map: null,
  sourceReady: false,
  popup: null,
};

const els = {
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
  resetView: document.querySelector('#reset-view'),
  dataStatus: document.querySelector('#data-status'),
};

function assertMapLibre() {
  if (!window.maplibregl) throw new Error('MapLibre GL JS failed to load.');
}

async function loadJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  return response.json();
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (parsed.schemaVersion !== PROGRESS_SCHEMA_VERSION || !Array.isArray(parsed.completedIds)) return new Set();
    return new Set(parsed.completedIds.filter((value) => typeof value === 'string'));
  } catch {
    return new Set();
  }
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    schemaVersion: PROGRESS_SCHEMA_VERSION,
    completedIds: [...state.completed].sort(),
  }));
}

function categoryById(id) {
  return state.categories.find((category) => category.id === id);
}

function featureMatches(feature) {
  const props = feature.properties || {};
  const category = String(props.category || '');
  if (!state.enabledCategories.has(category)) return false;
  if (state.hideCompleted && state.completed.has(String(feature.id))) return false;
  if (!state.query) return true;
  const haystack = `${props.name || ''} ${props.description || ''}`.toLocaleLowerCase();
  return haystack.includes(state.query);
}

function filteredCollection() {
  return {
    type: 'FeatureCollection',
    features: state.allFeatures
      .filter(featureMatches)
      .map((feature) => ({
        ...feature,
        properties: {
          ...feature.properties,
          done: state.completed.has(String(feature.id)),
        },
      })),
  };
}

function refreshCounts(collection = filteredCollection()) {
  const regionFeatureIds = new Set(state.allFeatures.map((feature) => String(feature.id)));
  const doneInRegion = [...state.completed].filter((id) => regionFeatureIds.has(id)).length;
  els.progressCount.textContent = `${doneInRegion} / ${state.allFeatures.length}`;
  els.visibleCount.textContent = String(collection.features.length);
  els.emptyState.hidden = collection.features.length !== 0;

  document.querySelectorAll('[data-category-count]').forEach((node) => {
    const categoryId = node.dataset.categoryCount;
    const count = state.allFeatures.filter((feature) => feature.properties?.category === categoryId).length;
    node.textContent = String(count);
  });
}

function updateMapData() {
  const collection = filteredCollection();
  refreshCounts(collection);
  if (state.sourceReady) state.map.getSource('poi').setData(collection);
}

function renderCategories() {
  els.categoryList.replaceChildren();
  for (const category of state.categories) {
    const label = document.createElement('label');
    label.className = 'category-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.enabledCategories.has(category.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.enabledCategories.add(category.id);
      else state.enabledCategories.delete(category.id);
      syncToggleAllLabel();
      updateMapData();
    });

    const dot = document.createElement('span');
    dot.className = 'category-dot';
    dot.style.setProperty('--category-color', category.color);

    const name = document.createElement('span');
    name.textContent = category.name;

    const count = document.createElement('span');
    count.className = 'category-count';
    count.dataset.categoryCount = category.id;

    label.append(checkbox, dot, name, count);
    els.categoryList.append(label);
  }
  refreshCounts();
}

function syncToggleAllLabel() {
  els.toggleAll.textContent = state.enabledCategories.size === 0 ? 'Show all' : 'Hide all';
}

function renderRegions() {
  els.regionSelect.replaceChildren();
  for (const region of state.regions) {
    const option = document.createElement('option');
    option.value = region.id;
    option.textContent = `${region.name}${region.demo ? ' — demo' : ''}`;
    els.regionSelect.append(option);
  }
}

async function selectRegion(regionId) {
  const region = state.regions.find((item) => item.id === regionId);
  if (!region) throw new Error(`Unknown region: ${regionId}`);
  const geojson = await loadJson(region.geojson);
  state.region = region;
  state.allFeatures = Array.isArray(geojson.features) ? geojson.features : [];
  els.dataStatus.textContent = region.demo ? 'M0 demo' : region.status || 'Data';

  if (state.map && state.sourceReady) {
    const mapImage = state.map.getSource('base-map');
    if (mapImage && typeof mapImage.updateImage === 'function') {
      await mapImage.updateImage({ url: region.mapImage, coordinates: region.mapCoordinates });
    }
    state.map.fitBounds(region.bounds || BASE_BOUNDS, { padding: 28, duration: 0 });
  }
  updateMapData();
  focusHashPoi();
}

function colorExpression() {
  const expression = ['match', ['get', 'category']];
  for (const category of state.categories) expression.push(category.id, category.color);
  expression.push('#aeb7c0');
  return expression;
}

function initMap() {
  assertMapLibre();
  const region = state.region;
  state.map = new window.maplibregl.Map({
    container: 'map',
    attributionControl: false,
    renderWorldCopies: false,
    center: [0, 0],
    zoom: 1,
    minZoom: 0,
    maxZoom: 6,
    maxBounds: [[-170, -82], [170, 82]],
    style: {
      version: 8,
      sources: {},
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#080c10' } }],
    },
  });

  state.map.addControl(new window.maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  state.map.addControl(new window.maplibregl.AttributionControl({ compact: true, customAttribution: 'Independent WWM Map prototype' }));

  state.map.on('load', () => {
    state.map.addSource('base-map', {
      type: 'image',
      url: region.mapImage,
      coordinates: region.mapCoordinates,
    });
    state.map.addLayer({
      id: 'base-map',
      type: 'raster',
      source: 'base-map',
      paint: { 'raster-opacity': 0.96 },
    });

    state.map.addSource('poi', {
      type: 'geojson',
      data: filteredCollection(),
      cluster: true,
      clusterMaxZoom: 4,
      clusterRadius: 44,
      promoteId: 'id',
    });

    state.map.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'poi',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#d6b57a',
        'circle-radius': ['step', ['get', 'point_count'], 17, 50, 21, 250, 27],
        'circle-stroke-color': '#1a1410',
        'circle-stroke-width': 2,
      },
    });

    state.map.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: 'poi',
      filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 11 },
      paint: { 'text-color': '#15100a' },
    });

    state.map.addLayer({
      id: 'poi-points',
      type: 'circle',
      source: 'poi',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': colorExpression(),
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 5, 4, 8, 6, 10],
        'circle-opacity': ['case', ['boolean', ['get', 'done'], false], 0.38, 0.96],
        'circle-stroke-color': ['case', ['boolean', ['get', 'done'], false], '#6f7882', '#f5ead4'],
        'circle-stroke-width': ['case', ['boolean', ['get', 'done'], false], 1, 1.6],
      },
    });

    state.map.on('click', 'clusters', async (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const clusterId = feature.properties.cluster_id;
      const zoom = await state.map.getSource('poi').getClusterExpansionZoom(clusterId);
      state.map.easeTo({ center: feature.geometry.coordinates, zoom });
    });

    state.map.on('click', 'poi-points', (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      openPoi(feature);
    });

    for (const layerId of ['clusters', 'poi-points']) {
      state.map.on('mouseenter', layerId, () => { state.map.getCanvas().style.cursor = 'pointer'; });
      state.map.on('mouseleave', layerId, () => { state.map.getCanvas().style.cursor = ''; });
    }

    state.sourceReady = true;
    state.map.fitBounds(region.bounds || BASE_BOUNDS, { padding: 28, duration: 0 });
    updateMapData();
    focusHashPoi();
  });
}

function openPoi(feature) {
  const id = String(feature.id);
  const props = feature.properties || {};
  const category = categoryById(props.category);
  const node = document.createElement('article');
  node.className = 'poi-card';

  const meta = document.createElement('p');
  meta.className = 'poi-meta';
  meta.textContent = category?.name || props.category || 'POI';

  const title = document.createElement('h2');
  title.className = 'poi-title';
  title.textContent = props.name || id;

  const description = document.createElement('p');
  description.className = 'poi-description';
  description.textContent = props.description || 'No description yet.';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'poi-done-button';
  const syncButton = () => {
    const isDone = state.completed.has(id);
    button.dataset.done = String(isDone);
    button.textContent = isDone ? 'Completed ✓ — mark incomplete' : 'Mark as completed';
  };
  syncButton();
  button.addEventListener('click', () => {
    if (state.completed.has(id)) state.completed.delete(id);
    else state.completed.add(id);
    saveProgress();
    syncButton();
    updateMapData();
  });

  node.append(meta, title, description, button);
  state.popup?.remove();
  state.popup = new window.maplibregl.Popup({ offset: 14, closeButton: true })
    .setLngLat(feature.geometry.coordinates)
    .setDOMContent(node)
    .addTo(state.map);
  history.replaceState(null, '', `#poi=${encodeURIComponent(id)}`);
}

function focusHashPoi() {
  if (!state.map || !state.sourceReady) return;
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const id = params.get('poi');
  if (!id) return;
  const feature = state.allFeatures.find((item) => String(item.id) === id);
  if (!feature) return;
  state.map.easeTo({ center: feature.geometry.coordinates, zoom: Math.max(state.map.getZoom(), 4) });
}

function exportProgress() {
  const payload = {
    schemaVersion: PROGRESS_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    completedIds: [...state.completed].sort(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `wwm-map-progress-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importProgress(file) {
  const parsed = JSON.parse(await file.text());
  if (parsed.schemaVersion !== PROGRESS_SCHEMA_VERSION || !Array.isArray(parsed.completedIds)) {
    throw new Error('Unsupported progress file.');
  }
  state.completed = new Set(parsed.completedIds.filter((value) => typeof value === 'string'));
  saveProgress();
  updateMapData();
}

function bindUi() {
  els.regionSelect.addEventListener('change', () => selectRegion(els.regionSelect.value).catch(reportFatal));
  els.searchInput.addEventListener('input', () => {
    state.query = els.searchInput.value.trim().toLocaleLowerCase();
    updateMapData();
  });
  els.hideCompleted.addEventListener('change', () => {
    state.hideCompleted = els.hideCompleted.checked;
    updateMapData();
  });
  els.toggleAll.addEventListener('click', () => {
    if (state.enabledCategories.size === 0) state.categories.forEach((category) => state.enabledCategories.add(category.id));
    else state.enabledCategories.clear();
    renderCategories();
    syncToggleAllLabel();
    updateMapData();
  });
  els.exportProgress.addEventListener('click', exportProgress);
  els.importProgress.addEventListener('click', () => els.importFile.click());
  els.importFile.addEventListener('change', async () => {
    const file = els.importFile.files?.[0];
    if (!file) return;
    try { await importProgress(file); }
    catch (error) { alert(error instanceof Error ? error.message : 'Import failed.'); }
    finally { els.importFile.value = ''; }
  });
  els.resetView.addEventListener('click', () => state.map?.fitBounds(state.region?.bounds || BASE_BOUNDS, { padding: 28 }));
  window.addEventListener('hashchange', focusHashPoi);
}

function reportFatal(error) {
  console.error(error);
  els.emptyState.hidden = false;
  els.emptyState.textContent = error instanceof Error ? error.message : 'Map failed to initialize.';
}

async function main() {
  try {
    const [regionDoc, categoryDoc] = await Promise.all([
      loadJson('./data/regions.json'),
      loadJson('./data/categories.json'),
    ]);
    state.regions = regionDoc.regions || [];
    state.categories = categoryDoc.categories || [];
    state.completed = loadProgress();
    state.enabledCategories = new Set(state.categories.map((category) => category.id));
    if (!state.regions.length) throw new Error('No regions configured.');

    renderRegions();
    renderCategories();
    bindUi();
    await selectRegion(state.regions[0].id);
    initMap();
  } catch (error) {
    reportFatal(error);
  }
}

main();
