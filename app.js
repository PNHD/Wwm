import{buildOfficialMapBookmarklet,completionSet,consumeOfficialImport,loadOfficialCompletion,snapshotAgeMinutes,snapshotCompletionCount}from'./official-sync.js';

const API_BASE='https://s2.easebar.com/39f12eda6b86452b';
const MAP_ASSET_ROOT='https://www.wherewindsmeetgame.com/pc/zt/20260526175803/';
const LANG_KEY='wwmsync:lang';
const UID_KEY='wwmsync:uid';
const FILTER_KEY='wwmsync:hide-completed';
const POI_CALIBRATION_MODE=new URLSearchParams(location.search).get('gt-poi-calibration')==='1';

const MAP_CONFIG={
  1:{name:'Qinghe',mapName:'qinghe',minZoom:8,maxZoom:13,initialZoom:11,center:[-.8166,1.49071],bounds:[[-2.8,0],[0,2.8]]},
  2:{name:'Kaifeng',mapName:'kaifeng',minZoom:8,maxZoom:13,initialZoom:11,center:[-1.22119,1.49886],bounds:[[-2.8,0],[0,2.8]]},
  3:{name:'Hexi',mapName:'hexiqian',minZoom:8,maxZoom:12,initialZoom:11,center:[-1.82411,1.85605],bounds:[[-2.8,0],[0,2.8]]},
  4:{name:'Kaifeng Palace',mapName:'kaifenghuanggong',minZoom:1,maxZoom:12,initialZoom:11,center:[-1.41034,.64615],bounds:[[-2.8,0],[0,2.8]]}
};

const I18N={
  vi:{
    tagline:'Where Winds Meet companion',officialSource:'Dữ liệu Official WWM',syncTitle:'Đồng bộ game',
    syncIntro:'UID hiện chỉ dùng để lưu hồ sơ nhân vật cục bộ. WWMSync chưa có connector game-side đã xác minh; tiến độ Official Map có thể được nhập riêng bằng cầu nối read-only bên dưới.',
    uidLabel:'UID nhân vật',uidPlaceholder:'Nhập UID nhân vật',syncButton:'Lưu UID',syncIdle:'Chưa nhập snapshot.',
    invalidUid:'UID phải là chuỗi số hợp lệ.',syncSaved:'UID đã được lưu cục bộ. Không có kết nối hoặc handshake nào với game được thực hiện.',
    privacyNote:'WWMSync không yêu cầu PIN, mật khẩu, cookie hoặc token tài khoản.',
    bridgeTitle:'Nhập tiến độ từ Official Map',bridgeIntro:'Kéo nút WWMSync Official Sync lên thanh dấu trang. Sau đó mở Official Map, đăng nhập bình thường và bấm dấu trang đó. Token đăng nhập chỉ được dùng ngay trên trang Official Map; WWMSync chỉ nhận danh sách ID đã hoàn thành.',bridgeBookmarklet:'WWMSync Official Sync',copyBridge:'Sao chép nút',openOfficialMap:'Mở Official Map ↗',bridgeDrag:'Kéo nút này lên thanh dấu trang, rồi bấm nó khi đang ở Official Map.',bridgeCopied:'Đã sao chép URL bookmarklet.',
    importSuccess:'Đã nhập snapshot Official Map: {count} điểm hoàn thành.',importInvalid:'Snapshot Official Map không hợp lệ.',snapshotImportedBadge:'Official Map snapshot',
    progress:'Tiến độ game',completed:'Đã hoàn thành',totalPoints:'Tổng điểm',progressNote:'Chưa có snapshot completion. Catalog Official Map vẫn có thể xem bình thường.',progressImported:'Đã nhập {count} completion từ Official Map khoảng {age} phút trước. Chưa coi đây là game auto-sync cho đến khi test thay đổi trực tiếp trong game.',
    map:'Bản đồ',search:'Tìm kiếm',searchPlaceholder:'Tên địa điểm / loại điểm...',hideCompleted:'Ẩn điểm đã hoàn thành',categories:'Danh mục',all:'Tất cả',
    syncCheck:'Trạng thái sync',diagnosticBlocked:'Game connector: chưa kết nối',diagnosticReady:'Official Map bridge: sẵn sàng',diagnosticIntro:'Cầu nối Official Map chỉ đọc trạng thái completion từ phiên đăng nhập chính chủ và chuyển sang WWMSync dưới dạng ID điểm. Token không được chuyển sang WWMSync. Chưa có bằng chứng rằng Global Official Map tự phản chiếu mọi completion vừa nhặt trong game.',
    loadingMap:'Đang tải bản đồ…',fanMade:'Companion do fan làm',officialMap:'Official Map',mapLoadError:'Không tải được dữ liệu bản đồ.',pointCompleted:'Đã hoàn thành trên Official Map',pointNotCompleted:'Chưa hoàn thành trên Official Map',catalogLoaded:'Đã tải {count} điểm Official Map.'
  },
  en:{
    tagline:'Where Winds Meet companion',officialSource:'Official WWM data',syncTitle:'Game sync',
    syncIntro:'The UID currently only saves a local character profile. WWMSync does not yet have a verified game-side connector; Official Map completion can be imported separately through the read-only bridge below.',
    uidLabel:'Character UID',uidPlaceholder:'Enter character UID',syncButton:'Save UID',syncIdle:'No snapshot imported.',
    invalidUid:'UID must be a valid numeric string.',syncSaved:'UID saved locally. No connection or handshake with the game has been attempted.',
    privacyNote:'WWMSync never asks for an account PIN, password, cookie, or token.',
    bridgeTitle:'Import progress from Official Map',bridgeIntro:'Drag WWMSync Official Sync to your bookmarks bar. Then open the Official Map, log in normally, and click that bookmark. The login token is used only inside the Official Map page; WWMSync receives completed point IDs only.',bridgeBookmarklet:'WWMSync Official Sync',copyBridge:'Copy button',openOfficialMap:'Open Official Map ↗',bridgeDrag:'Drag this button to your bookmarks bar, then click it while you are on the Official Map.',bridgeCopied:'Bookmarklet URL copied.',
    importSuccess:'Imported Official Map snapshot: {count} completed points.',importInvalid:'The Official Map snapshot is invalid.',snapshotImportedBadge:'Official Map snapshot',
    progress:'Game progress',completed:'Completed',totalPoints:'Total points',progressNote:'No completion snapshot yet. The Official Map catalog remains available.',progressImported:'Imported {count} completions from Official Map about {age} minutes ago. This is not labeled game auto-sync until an in-game change is empirically verified.',
    map:'Map',search:'Search',searchPlaceholder:'Place / point category...',hideCompleted:'Hide completed points',categories:'Categories',all:'All',
    syncCheck:'Sync status',diagnosticBlocked:'Game connector: not connected',diagnosticReady:'Official Map bridge: ready',diagnosticIntro:'The Official Map bridge reads completion state from the first-party logged-in map and transfers only point IDs into WWMSync. No login token is transferred to WWMSync. It is not yet proven that the Global Official Map automatically mirrors every completion collected in-game.',
    loadingMap:'Loading map…',fanMade:'Fan-made companion',officialMap:'Official Map',mapLoadError:'Could not load map data.',pointCompleted:'Completed on Official Map',pointNotCompleted:'Not completed on Official Map',catalogLoaded:'Loaded {count} Official Map points.'
  }
};

let importError=null,importedSnapshot=null;
try{importedSnapshot=consumeOfficialImport()}catch(error){importError=error;console.warn('[WWMSync] Official Map import rejected',error)}

const state={
  lang:localStorage.getItem(LANG_KEY)||'vi',
  uid:localStorage.getItem(UID_KEY)||'',
  maps:[],mapId:1,categories:[],points:[],activeCategories:new Set(),
  hideCompleted:localStorage.getItem(FILTER_KEY)==='1',search:'',
  map:null,pointLayer:null,pointRenderer:null,pointCache:new Map(),catalogTotal:0,completedTotal:0,
  officialSnapshot:importedSnapshot||loadOfficialCompletion()
};

const ids=['languageSelect','characterUid','syncButton','syncStatus','completedCount','totalCount','progressFill','progressNote','syncStateBadge','mapSelect','searchInput','hideCompleted','categoryList','toggleCategories','diagnosticBadge','diagnosticText','mapLoading','sidebar','sidebarToggle','toast','officialBridgeBookmarklet','copyBridgeButton','openOfficialMap'];
const el=Object.fromEntries(ids.map(id=>[id,document.getElementById(id)]));

function t(key,vars={}){
  let text=I18N[state.lang]?.[key]||I18N.en[key]||key;
  for(const[k,v]of Object.entries(vars))text=text.replaceAll(`{${k}}`,String(v));
  return text;
}
function escapeHtml(value=''){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function toast(message){el.toast.textContent=message;el.toast.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.toast.classList.remove('show'),3200)}
function setSyncStatus(message='',kind=''){el.syncStatus.textContent=message;el.syncStatus.className=`status-line ${kind}`.trim()}

function updateSyncPresentation(){
  const hasSnapshot=!!state.officialSnapshot;
  el.syncStateBadge.textContent=hasSnapshot?t('snapshotImportedBadge'):t('syncIdle');
  el.syncStateBadge.className=`status-badge ${hasSnapshot?'good':''}`.trim();
  el.diagnosticBadge.textContent=hasSnapshot?t('diagnosticReady'):t('diagnosticBlocked');
  el.diagnosticBadge.className=`status-badge ${hasSnapshot?'good':'warn'}`;
  el.diagnosticText.textContent=t('diagnosticIntro');
}

function applyI18n(){
  document.documentElement.lang=state.lang;
  document.querySelectorAll('[data-i18n]').forEach(node=>node.textContent=t(node.dataset.i18n));
  document.querySelectorAll('[data-i18n-placeholder]').forEach(node=>node.placeholder=t(node.dataset.i18nPlaceholder));
  el.languageSelect.value=state.lang;
  if(el.officialBridgeBookmarklet)el.officialBridgeBookmarklet.href=buildOfficialMapBookmarklet(location.origin);
  updateSyncPresentation();
  updateProgressUI();
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
function flattenPoints(data,mapId){
  const points=[],categories=[],completed=completionSet(state.officialSnapshot,mapId);
  for(const group of data?.categories||[]){
    for(const category of group.childCategories||[]){
      categories.push({id:category.id,name:category.name||group.name||`Category ${category.id}`,pointsNum:category.pointsNum||category.pointList?.length||0});
      for(const point of category.pointList||[])points.push({...point,finished:completed.has(Number(point.id)),categoryId:category.id,categoryName:category.name||group.name||''});
    }
  }
  return{points,categories};
}
async function fetchMapPoints(mapId){
  const key=String(mapId);
  if(state.pointCache.has(key))return state.pointCache.get(key);
  const data=await officialApi(`/api/map/points?mapId=${encodeURIComponent(mapId)}`);
  const result=flattenPoints(data,mapId);
  state.pointCache.set(key,result);
  return result;
}
async function loadCatalogTotal(){
  const results=await Promise.all(state.maps.map(map=>fetchMapPoints(map.id)));
  state.catalogTotal=results.reduce((sum,result)=>sum+result.points.length,0);
  state.completedTotal=results.reduce((sum,result)=>sum+result.points.filter(point=>point.finished).length,0);
  updateProgressUI();
  if(importedSnapshot)setSyncStatus(t('importSuccess',{count:state.completedTotal}),'success');
  else setSyncStatus(t('catalogLoaded',{count:state.catalogTotal}));
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
  const total=Number(state.catalogTotal||0),done=Number(state.completedTotal||0),pct=total?Math.min(100,done/total*100):0;
  el.completedCount.textContent=done.toLocaleString();
  el.totalCount.textContent=total.toLocaleString();
  el.progressFill.style.width=`${pct}%`;
  if(state.officialSnapshot){
    el.progressNote.textContent=t('progressImported',{count:snapshotCompletionCount(state.officialSnapshot),age:snapshotAgeMinutes(state.officialSnapshot)??0});
  }else el.progressNote.textContent=t('progressNote');
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
  return state.points.filter(point=>state.activeCategories.has(String(point.categoryId))&&(!state.hideCompleted||!point.finished)&&(!query||`${point.name||''} ${point.categoryName||''}`.toLowerCase().includes(query)));
}
function pointCoordinates(point){
  const parse=value=>Number.isFinite(Number(value))?parseInt(String(value),8)/1e5:0;
  return[parse(point.lng),parse(point.lat)];
}
function catalogueSelection(point,lat,lng){
  if(!state.map)throw new Error('WWMSync map is unavailable.');
  const referenceZoom=window.__WWMSYNC_VISION_BRIDGE__?.state?.().referenceZoom??11;
  const projected=state.map.project(window.L.latLng(lat,lng),referenceZoom);
  return{id:point.id,name:point.name||'',type:point.type||point.categoryName||'',category:point.categoryName||point.type||'',mapId:state.mapId,catalogueCoordinate:{lat,lng},projected:{x:projected.x,y:projected.y}};
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
    const[lng,lat]=pointCoordinates(point);
    const marker=L.circleMarker([lat,lng],{renderer:state.pointRenderer,radius:5,color:'#101418',weight:1.2,fillColor:point.finished?'#62d6a8':'#e4b55c',fillOpacity:point.finished?0.65:0.92});
    marker.bindPopup(`<div class="popup-title">${escapeHtml(point.name||'')}</div><div class="popup-meta">${escapeHtml(point.categoryName||'')}</div><div class="${point.finished?'popup-done':'popup-open'}">${t(point.finished?'pointCompleted':'pointNotCompleted')}</div>`);
    if(POI_CALIBRATION_MODE)marker.on('click',()=>window.dispatchEvent(new CustomEvent('wwmsync:catalogue-point-selected',{detail:catalogueSelection(point,lat,lng)})));
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
  setSyncStatus(t('syncSaved'));
}
async function copyBridge(){
  const value=buildOfficialMapBookmarklet(location.origin);
  try{await navigator.clipboard.writeText(value);toast(t('bridgeCopied'))}
  catch{
    const textarea=document.createElement('textarea');textarea.value=value;textarea.style.position='fixed';textarea.style.opacity='0';document.body.appendChild(textarea);textarea.select();document.execCommand('copy');textarea.remove();toast(t('bridgeCopied'));
  }
}
async function consumeIncomingSnapshot(){
  let snapshot=null;
  try{snapshot=consumeOfficialImport()}catch(error){console.warn('[WWMSync] Official Map import rejected',error);toast(t('importInvalid'));return}
  if(!snapshot)return;
  state.officialSnapshot=snapshot;
  state.pointCache.clear();
  updateSyncPresentation();
  try{
    await loadActiveMapPoints();
    await loadCatalogTotal();
    setSyncStatus(t('importSuccess',{count:state.completedTotal}),'success');
  }catch(error){console.error('[WWMSync] import refresh',error);toast(t('mapLoadError'))}
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
  if(el.officialBridgeBookmarklet)el.officialBridgeBookmarklet.onclick=event=>{event.preventDefault();toast(t('bridgeDrag'))};
  if(el.copyBridgeButton)el.copyBridgeButton.onclick=copyBridge;
  window.addEventListener('hashchange',()=>{void consumeIncomingSnapshot()});
}
async function boot(){
  bindEvents();
  el.characterUid.value=state.uid;
  applyI18n();
  if(importError)setTimeout(()=>toast(t('importInvalid')),50);
  try{
    await loadMaps();
    await switchMap(state.mapId);
    await loadCatalogTotal();
  }catch(error){console.error('[WWMSync] boot',error);toast(t('mapLoadError'));el.mapLoading.classList.add('done')}
  if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
}
boot();
