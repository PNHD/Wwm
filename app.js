const API_BASE='https://s2.easebar.com/39f12eda6b86452b';
const MAP_ASSET_ROOT='https://www.wherewindsmeetgame.com/pc/zt/20260526175803/';
const LANG_KEY='wwmsync:lang';
const UID_KEY='wwmsync:uid';
const FILTER_KEY='wwmsync:hide-completed';

const MAP_CONFIG={
  1:{name:'Qinghe',mapName:'qinghe',minZoom:8,maxZoom:13,initialZoom:11,center:[-.8166,1.49071],bounds:[[-2.8,0],[0,2.8]]},
  2:{name:'Kaifeng',mapName:'kaifeng',minZoom:8,maxZoom:13,initialZoom:11,center:[-1.22119,1.49886],bounds:[[-2.8,0],[0,2.8]]},
  3:{name:'Hexi',mapName:'hexiqian',minZoom:8,maxZoom:12,initialZoom:11,center:[-1.82411,1.85605],bounds:[[-2.8,0],[0,2.8]]},
  4:{name:'Kaifeng Palace',mapName:'kaifenghuanggong',minZoom:1,maxZoom:12,initialZoom:11,center:[-1.41034,.64615],bounds:[[-2.8,0],[0,2.8]]}
};

const I18N={
  vi:{
    tagline:'Where Winds Meet companion',officialSource:'Dữ liệu Official WWM',syncTitle:'Đồng bộ game',
    syncIntro:'Nhập UID nhân vật để lưu cấu hình. WWMSync không giả lập nút Allow: luồng UID → Allow cần một dịch vụ game-side đã được game tin cậy, và chưa có API công khai đã xác minh để WWMSync tự thực hiện.',
    uidLabel:'UID nhân vật',uidPlaceholder:'Nhập UID nhân vật',syncButton:'Sync',syncIdle:'Chưa kết nối game.',
    invalidUid:'UID phải là chuỗi số hợp lệ.',
    syncBlocked:'UID đã được lưu cục bộ. Chưa thể gửi yêu cầu Allow vào game một cách độc lập: cơ chế cũ cần backend/game-side transport riêng. WWMSync không gửi UID sang WWMMAP và không yêu cầu PIN hay mật khẩu.',
    progress:'Tiến độ game',completed:'Đã hoàn thành',totalPoints:'Tổng điểm',progressNote:'Hiện chỉ hiển thị catalog Official Map. Completion trong game chưa được auto-sync.',
    map:'Bản đồ',search:'Tìm kiếm',searchPlaceholder:'Tên địa điểm / loại điểm...',hideCompleted:'Ẩn điểm đã hoàn thành',categories:'Danh mục',all:'Tất cả',
    syncCheck:'Trạng thái sync',diagnosticBlocked:'UID-only sync độc lập: chưa khả dụng',diagnosticIntro:'Forensic xác nhận flow cũ cần backend xác thực riêng để gửi yêu cầu vào game, sau đó mới nhận full state và vị trí qua relay WebSocket. Không có transport đó thì web thuần không thể làm game hiện Allow chỉ bằng UID.',
    loadingMap:'Đang tải bản đồ…',fanMade:'Companion do fan làm',officialMap:'Official Map',mapLoadError:'Không tải được dữ liệu bản đồ.',openPopup:'Chưa đồng bộ trạng thái game',catalogLoaded:'Đã tải {count} điểm Official Map.'
  },
  en:{
    tagline:'Where Winds Meet companion',officialSource:'Official WWM data',syncTitle:'Game sync',
    syncIntro:'Enter a character UID to save the local profile. WWMSync does not fake an Allow prompt: UID → Allow requires a game-side service trusted by the game, and no verified public API is available for WWMSync to do this independently.',
    uidLabel:'Character UID',uidPlaceholder:'Enter character UID',syncButton:'Sync',syncIdle:'Game not connected.',
    invalidUid:'UID must be a valid numeric string.',
    syncBlocked:'UID saved locally. WWMSync cannot independently send an Allow request into the game: the legacy flow depends on its own backend/game-side transport. WWMSync does not send your UID to WWMMAP and never asks for its PIN or password.',
    progress:'Game progress',completed:'Completed',totalPoints:'Total points',progressNote:'Currently showing the Official Map catalog only. In-game completion is not auto-synced yet.',
    map:'Map',search:'Search',searchPlaceholder:'Place / point category...',hideCompleted:'Hide completed points',categories:'Categories',all:'All',
    syncCheck:'Sync status',diagnosticBlocked:'Independent UID-only sync: unavailable',diagnosticIntro:'Forensic verification shows the legacy flow requires a private authentication backend to send the in-game request, then receives full state and player position over a relay WebSocket. Without that transport, a pure web app cannot make the game show Allow from a UID alone.',
    loadingMap:'Loading map…',fanMade:'Fan-made companion',officialMap:'Official Map',mapLoadError:'Could not load map data.',openPopup:'Game state not synced',catalogLoaded:'Loaded {count} Official Map points.'
  }
};

const state={
  lang:localStorage.getItem(LANG_KEY)||'vi',
  uid:localStorage.getItem(UID_KEY)||'',
  maps:[],mapId:1,categories:[],points:[],activeCategories:new Set(),
  hideCompleted:localStorage.getItem(FILTER_KEY)==='1',search:'',
  map:null,pointLayer:null,pointRenderer:null,pointCache:new Map(),catalogTotal:0
};

const ids=['languageSelect','characterUid','syncButton','syncStatus','completedCount','totalCount','progressFill','progressNote','syncStateBadge','mapSelect','searchInput','hideCompleted','categoryList','toggleCategories','diagnosticBadge','diagnosticText','mapLoading','sidebar','sidebarToggle','toast'];
const el=Object.fromEntries(ids.map(id=>[id,document.getElementById(id)]));

function t(key,vars={}){
  let text=I18N[state.lang]?.[key]||I18N.en[key]||key;
  for(const [k,v] of Object.entries(vars))text=text.replaceAll(`{${k}}`,String(v));
  return text;
}
function escapeHtml(value=''){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function toast(message){el.toast.textContent=message;el.toast.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.toast.classList.remove('show'),3200)}
function setSyncStatus(message='',kind=''){el.syncStatus.textContent=message;el.syncStatus.className=`status-line ${kind}`.trim()}

function applyI18n(){
  document.documentElement.lang=state.lang;
  document.querySelectorAll('[data-i18n]').forEach(node=>node.textContent=t(node.dataset.i18n));
  document.querySelectorAll('[data-i18n-placeholder]').forEach(node=>node.placeholder=t(node.dataset.i18nPlaceholder));
  el.languageSelect.value=state.lang;
  el.syncStateBadge.textContent=t('syncIdle');
  el.diagnosticBadge.textContent=t('diagnosticBlocked');
  el.diagnosticText.textContent=t('diagnosticIntro');
  el.progressNote.textContent=t('progressNote');
  renderMapOptions();
  renderCategories();
  renderPoints();
}

async function officialApi(path){
  const url=new URL(API_BASE+path);
  url.searchParams.set('lang','en-US');
  const response=await fetch(url,{headers:{'Accept-Language':'en-US'},credentials:'omit'});
  const json=await response.json().catch(()=>null);
  if(!response.ok||!json?.success)throw new Error(json?.msg||`${response.status} ${response.statusText}`);
  return json.data;
}

async function loadMaps(){
  const data=await officialApi('/api/map/list');
  state.maps=(data?.maps||[]).filter(map=>MAP_CONFIG[map.id]);
  if(!state.maps.length)state.maps=Object.entries(MAP_CONFIG).map(([id,cfg])=>({id:+id,name:cfg.name}));
  if(!state.maps.some(map=>Number(map.id)===state.mapId))state.mapId=Number(state.maps[0]?.id||1);
  renderMapOptions();
}
function renderMapOptions(){
  if(!el.mapSelect)return;
  const current=String(state.mapId);
  el.mapSelect.innerHTML='';
  for(const map of state.maps){
    const option=document.createElement('option');
    option.value=String(map.id);
    option.textContent=map.name||MAP_CONFIG[map.id]?.name||`Map ${map.id}`;
    el.mapSelect.appendChild(option);
  }
  if([...el.mapSelect.options].some(option=>option.value===current))el.mapSelect.value=current;
}
function flattenPoints(data){
  const points=[],categories=[];
  for(const group of data?.categories||[]){
    for(const category of group.childCategories||[]){
      categories.push({id:category.id,name:category.name||group.name||`Category ${category.id}`,pointsNum:category.pointsNum||category.pointList?.length||0});
      for(const point of category.pointList||[])points.push({...point,finished:false,categoryId:category.id,categoryName:category.name||group.name||''});
    }
  }
  return{points,categories};
}
async function fetchMapPoints(mapId){
  const key=String(mapId);
  if(state.pointCache.has(key))return state.pointCache.get(key);
  const data=await officialApi(`/api/map/points?mapId=${encodeURIComponent(mapId)}`);
  const result=flattenPoints(data);
  state.pointCache.set(key,result);
  return result;
}
async function loadCatalogTotal(){
  const results=await Promise.all(state.maps.map(map=>fetchMapPoints(map.id)));
  state.catalogTotal=results.reduce((sum,result)=>sum+result.points.length,0);
  updateProgressUI();
  setSyncStatus(t('catalogLoaded',{count:state.catalogTotal}));
}
async function loadActiveMapPoints(){
  el.mapLoading.classList.remove('done');
  try{
    const result=await fetchMapPoints(state.mapId);
    state.points=result.points;
    state.categories=result.categories;
    state.activeCategories=new Set(result.categories.map(category=>String(category.id)));
    renderCategories();
    renderPoints();
  }finally{el.mapLoading.classList.add('done')}
}
function updateProgressUI(){
  el.completedCount.textContent='0';
  el.totalCount.textContent=Number(state.catalogTotal||0).toLocaleString();
  el.progressFill.style.width='0%';
  el.progressNote.textContent=t('progressNote');
}
function renderCategories(){
  if(!el.categoryList)return;
  el.categoryList.innerHTML='';
  for(const category of state.categories){
    const id=String(category.id),active=state.activeCategories.has(id);
    const button=document.createElement('button');
    button.type='button';button.className=`category-item ${active?'active':''}`;
    button.innerHTML=`<span>${escapeHtml(category.name)}</span><small>${Number(category.pointsNum||0).toLocaleString()}</small>`;
    button.onclick=()=>{active?state.activeCategories.delete(id):state.activeCategories.add(id);renderCategories();renderPoints()};
    el.categoryList.appendChild(button);
  }
}
function filteredPoints(){
  const query=state.search.trim().toLowerCase();
  return state.points.filter(point=>state.activeCategories.has(String(point.categoryId))&&(!query||`${point.name||''} ${point.categoryName||''}`.toLowerCase().includes(query)));
}
function pointCoordinates(point){
  const parse=value=>Number.isFinite(Number(value))?parseInt(String(value),8)/1e5:0;
  return[parse(point.lng),parse(point.lat)];
}
function leafletBounds(cfg){return window.L.latLngBounds([cfg.bounds[0][1],cfg.bounds[0][0]],[cfg.bounds[1][1],cfg.bounds[1][0]])}
async function ensureMap(){
  const L=window.L;
  if(!L)throw new Error('Leaflet failed to load');
  const cfg=MAP_CONFIG[state.mapId]||MAP_CONFIG[1];
  if(state.map){state.map.remove();state.map=null}
  const bounds=leafletBounds(cfg);
  state.map=L.map('map',{center:[cfg.center[1],cfg.center[0]],zoom:cfg.initialZoom,minZoom:cfg.minZoom,maxZoom:cfg.maxZoom,maxBounds:bounds,maxBoundsViscosity:.85,zoomControl:true,attributionControl:false,preferCanvas:true});
  L.tileLayer(`${MAP_ASSET_ROOT}data/map/${cfg.mapName}/en/{z}/{y}_{x}.jpg`,{tileSize:256,minZoom:cfg.minZoom,maxZoom:cfg.maxZoom,noWrap:true,bounds,keepBuffer:3}).addTo(state.map);
  state.pointRenderer=L.canvas({padding:.5});
  state.pointLayer=L.layerGroup().addTo(state.map);
}
function renderPoints(){
  if(!state.map||!state.pointLayer)return;
  const L=window.L;
  state.pointLayer.clearLayers();
  for(const point of filteredPoints()){
    const [lng,lat]=pointCoordinates(point);
    const marker=L.circleMarker([lat,lng],{renderer:state.pointRenderer,radius:5,color:'#101418',weight:1.2,fillColor:'#e4b55c',fillOpacity:.92});
    marker.bindPopup(`<div class="popup-title">${escapeHtml(point.name||'')}</div><div class="popup-meta">${escapeHtml(point.categoryName||'')}</div><div class="popup-open">${t('openPopup')}</div>`);
    marker.addTo(state.pointLayer);
  }
}
async function switchMap(id){
  state.mapId=Number(id);
  el.mapLoading.classList.remove('done');
  try{await ensureMap();await loadActiveMapPoints()}
  catch(error){console.error('[WWMSync] map',error);toast(t('mapLoadError'));el.mapLoading.classList.add('done')}
}
function handleSync(){
  const uid=el.characterUid.value.trim();
  if(!/^\d{5,24}$/.test(uid)){setSyncStatus(t('invalidUid'),'error');return}
  state.uid=uid;localStorage.setItem(UID_KEY,uid);
  setSyncStatus(t('syncBlocked'),'error');
  el.syncStateBadge.textContent=t('diagnosticBlocked');
  el.syncStateBadge.className='status-badge warn';
}
function bindEvents(){
  el.languageSelect.onchange=()=>{state.lang=el.languageSelect.value;localStorage.setItem(LANG_KEY,state.lang);applyI18n()};
  el.syncButton.onclick=handleSync;
  el.characterUid.onkeydown=event=>{if(event.key==='Enter')handleSync()};
  el.mapSelect.onchange=()=>switchMap(el.mapSelect.value);
  el.searchInput.oninput=()=>{state.search=el.searchInput.value;renderPoints()};
  el.hideCompleted.checked=state.hideCompleted;
  el.hideCompleted.onchange=()=>{state.hideCompleted=el.hideCompleted.checked;localStorage.setItem(FILTER_KEY,state.hideCompleted?'1':'0');renderPoints()};
  el.toggleCategories.onclick=()=>{const all=state.activeCategories.size!==state.categories.length;state.activeCategories=new Set(all?state.categories.map(category=>String(category.id)):[]);renderCategories();renderPoints()};
  el.sidebarToggle.onclick=()=>el.sidebar.classList.toggle('open');
}
async function boot(){
  bindEvents();
  el.characterUid.value=state.uid;
  applyI18n();
  updateProgressUI();
  try{
    await loadMaps();
    await switchMap(state.mapId);
    await loadCatalogTotal();
  }catch(error){console.error('[WWMSync] boot',error);toast(t('mapLoadError'));el.mapLoading.classList.add('done')}
  if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
}
boot();
