const $ = (id) => document.getElementById(id);

const STORE = {
  lang: 'wwm-atlas-lang:v2',
  creds: 'wwm-atlas-sync-creds:v1',
  completed: 'wwm-atlas-sync-completed:v1',
  settings: 'wwm-atlas-settings:v3',
};

const MAPS = {
  '1': { id:'1', names:{vi:'Bản đồ lớn Yến Nam',en:'Yannan Open World'}, worldRange:12288, gridSize:12, gameTileSize:1024, tileUrl:'https://wwmmapimgs.sangtacvietcdn.xyz/images/tiles/1/{s}{y}_{x}.png', minZoom:2, maxZoom:8 },
  '6': { id:'6', names:{vi:'Đại bản đồ Hà Tây',en:'Hexi Open World'}, worldRange:8192, gridSize:8, gameTileSize:1024, tileUrl:'https://wwmmapimgs.sangtacvietcdn.xyz/images/tiles/6/{s}{y}_{x}.png', minZoom:2, maxZoom:7 },
  '2': { id:'2', names:{vi:'Thế giới trong mơ',en:'Dream in Flames'}, worldRange:2544, gridSize:4, gameTileSize:636, tileUrl:'https://wwmmapimgs.sangtacvietcdn.xyz/images/tiles/2/{s}{y}_{x}.png', minZoom:1, maxZoom:6 },
  '14': { id:'14', names:{vi:'Hoàng cung Khai Phong',en:'Kaifeng Imperial Palace'}, worldRange:2048, gridSize:1, gameTileSize:2048, tileUrl:'https://wwmmapimgs.sangtacvietcdn.xyz/images/tiles/14/{s}{y}_{x}.png', minZoom:0, maxZoom:5 },
};

const I18N = {
  vi: {
    brandTag:'Auto-sync companion map', disconnected:'Chưa kết nối', waiting:'Đang chờ game', synced:'Đã đồng bộ', officialMap:'Bản đồ chính thức', autoSync:'AUTO SYNC', syncTitle:'Đồng bộ tiến độ game', syncIntro:'Nhập UID một lần. Sau khi xác nhận trong game, các điểm đã hoàn thành sẽ tự được đánh dấu — không cần mark lại thủ công.', linkedUid:'UID đã liên kết', unlink:'Gỡ liên kết', uidLabel:'UID nhân vật', checkUid:'Kiểm tra', boundAccount:'UID này đã từng liên kết với dịch vụ sync. Nhập mật khẩu sync đã tạo trước đây.', syncPassword:'Mật khẩu sync', rememberDevice:'Nhớ trên thiết bị này', link:'Liên kết', forgot:'Quên mật khẩu', verifyInGame:'Xác nhận trong game', verifyHelp:'Giữ game đang mở và chấp nhận yêu cầu xác nhận có mã bên dưới. Sau đó bấm “Tôi đã xác nhận”.', verificationCode:'Mã xác nhận', confirmed:'Tôi đã xác nhận', resetInGame:'Reset mật khẩu trong game', resetHelp:'Xác nhận yêu cầu reset có mã bên dưới trong game, rồi bấm hoàn tất.', finishReset:'Hoàn tất reset', gameSync:'Game Sync', relay:'Máy chủ relay', syncNow:'Đồng bộ ngay', stopSync:'Dừng sync', syncPrivacy:'Mật khẩu sync chỉ được giữ trong trình duyệt của bạn và chuyển qua adapter Cloudflare để gọi dịch vụ tương thích. WWM Atlas không lưu mật khẩu ở server.', autoCompleted:'Đã tự nhận diện', hideCompleted:'Ẩn đã xong', map:'Bản đồ', search:'Tìm địa điểm', searchPlaceholder:'Tên địa điểm…', compatTitle:'Compatibility mode', compatBody:'Auto-sync hiện tương thích với bridge công khai của WWM Map. Dữ liệu marker và tile được tải lúc chạy; WWM Atlas không mirror database hoặc artwork vào repository.', loadingData:'Đang tải dữ liệu bản đồ…', loadingNote:'Lần đầu có thể tải khoảng 15 MB dữ liệu marker.', mapLoadFailed:'Không tải được dữ liệu bản đồ.', retry:'Thử lại', fitMap:'Vừa bản đồ', checking:'Đang kiểm tra UID…', enterUid:'Nhập UID hợp lệ.', enterPassword:'Nhập mật khẩu sync.', accountBound:'UID đã liên kết. Nhập mật khẩu sync để tiếp tục.', accountUnbound:'UID chưa liên kết. Hãy xác nhận mã trong game.', authSuccess:'Liên kết thành công. Bạn có thể đồng bộ ngay.', authFailed:'Không xác thực được.', resetStarted:'Yêu cầu reset đã gửi. Xác nhận mã trong game.', serviceUnavailable:'Dịch vụ sync hiện không phản hồi.', startingSync:'Đang yêu cầu game gửi dữ liệu…', websocketConnecting:'Đã gửi yêu cầu. Đang kết nối relay…', waitApproval:'Chờ bạn chấp nhận yêu cầu trong game…', syncReceived:'Đã nhận tiến độ từ game.', syncTimeout:'Chưa nhận được dữ liệu. Kiểm tra game đang mở và đã chấp nhận yêu cầu, rồi thử lại.', syncDisconnected:'Relay đã ngắt kết nối.', unauthorized:'Phiên sync hết hạn. Hãy liên kết lại.', permissionDenied:'Tài khoản chưa đủ quyền sync theo dịch vụ tương thích.', markers:'điểm', completed:'Đã xong', notCompleted:'Chưa xong', noResults:'Không có kết quả.', noMapMarkers:'Không có marker trên bản đồ này.', lastSync:'Lần cuối', justNow:'vừa xong', dataSourceError:'Không tải được marker compatibility data.', close:'Đóng'
  },
  en: {
    brandTag:'Auto-sync companion map', disconnected:'Disconnected', waiting:'Waiting for game', synced:'Synced', officialMap:'Official map', autoSync:'AUTO SYNC', syncTitle:'Sync game progress', syncIntro:'Enter your UID once. After confirming in game, completed locations are marked automatically — no manual re-marking.', linkedUid:'Linked UID', unlink:'Unlink', uidLabel:'Character UID', checkUid:'Check', boundAccount:'This UID is already linked to the sync service. Enter the sync password created previously.', syncPassword:'Sync password', rememberDevice:'Remember on this device', link:'Link', forgot:'Forgot password', verifyInGame:'Confirm in game', verifyHelp:'Keep the game open and approve the confirmation request matching the code below. Then click “I confirmed”.', verificationCode:'Verification code', confirmed:'I confirmed', resetInGame:'Reset password in game', resetHelp:'Approve the reset request matching the code below in game, then finish the reset.', finishReset:'Finish reset', gameSync:'Game Sync', relay:'Relay server', syncNow:'Sync now', stopSync:'Stop sync', syncPrivacy:'Your sync password stays in your browser and only passes through the Cloudflare adapter to the compatibility service. WWM Atlas does not store it server-side.', autoCompleted:'Auto-detected', hideCompleted:'Hide completed', map:'Map', search:'Search locations', searchPlaceholder:'Location name…', compatTitle:'Compatibility mode', compatBody:'Auto-sync currently interoperates with WWM Map’s public bridge. Marker data and tiles are loaded at runtime; WWM Atlas does not mirror their database or artwork into this repository.', loadingData:'Loading map data…', loadingNote:'The first load may download about 15 MB of marker data.', mapLoadFailed:'Map data could not be loaded.', retry:'Retry', fitMap:'Fit map', checking:'Checking UID…', enterUid:'Enter a valid UID.', enterPassword:'Enter your sync password.', accountBound:'UID is linked. Enter the sync password to continue.', accountUnbound:'UID is not linked yet. Confirm the code in game.', authSuccess:'Linked successfully. You can sync now.', authFailed:'Authentication failed.', resetStarted:'Reset request sent. Confirm the code in game.', serviceUnavailable:'The sync service is not responding.', startingSync:'Requesting game data…', websocketConnecting:'Request sent. Connecting to relay…', waitApproval:'Waiting for you to approve the request in game…', syncReceived:'Game progress received.', syncTimeout:'No game data received. Make sure the game is open and the request was approved, then try again.', syncDisconnected:'Relay disconnected.', unauthorized:'Sync session expired. Link again.', permissionDenied:'This account does not currently have sync permission in the compatibility service.', markers:'markers', completed:'Completed', notCompleted:'Not completed', noResults:'No results.', noMapMarkers:'No markers on this map.', lastSync:'Last sync', justNow:'just now', dataSourceError:'Could not load compatibility marker data.', close:'Close'
  }
};

let lang = localStorage.getItem(STORE.lang) === 'en' ? 'en' : 'vi';
const t = (key) => I18N[lang][key] || key;

const state = {
  markers: [], markersByMap: new Map(), syncableIds: new Map(), completedIds: new Set(),
  mapId: '1', hideCompleted: false, query: '', relays: [], creds: null,
  pendingPassword: null, currentUid: null, websocket: null, connectionKey: null,
  pingTimer: null, timeoutTimer: null, chunkSessions: new Map(), lastSyncAt: null,
};

function setText() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { const key = el.dataset.i18n; if (I18N[lang][key]) el.textContent = I18N[lang][key]; });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { const key = el.dataset.i18nPlaceholder; if (I18N[lang][key]) el.placeholder = I18N[lang][key]; });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { const key = el.dataset.i18nTitle; if (I18N[lang][key]) el.title = I18N[lang][key]; });
  $('language-select').value = lang;
  renderMapSelect(); renderProgress(); renderSearchResults(); renderMapHud();
}

function message(text, kind='') { const el=$('auth-message'); el.textContent=text||''; el.className='inline-message'+(kind?` is-${kind}`:''); }
function setSyncStatus(mode, label) { const dot=$('sync-status-dot'); dot.className=`health-dot ${mode==='live'?'is-live':mode==='waiting'?'is-waiting':mode==='error'?'is-error':'is-idle'}`; $('sync-status-label').textContent=label||t(mode==='live'?'synced':mode==='waiting'?'waiting':'disconnected'); }
function showStep(id) { ['password-step','verify-step','reset-step'].forEach((x)=>$(x).hidden=x!==id); }
function sanitizeUid(v){ return String(v||'').replace(/\D/g,'').slice(0,20); }
function randomKey(){ const chars='abcdefghijklmnopqrstuvwxyz0123456789'; let out=''; crypto.getRandomValues(new Uint8Array(8)).forEach((n)=>out+=chars[n%chars.length]); return out; }

function getStoredCreds(){
  for (const storage of [sessionStorage, localStorage]) { try { const raw=storage.getItem(STORE.creds); if(raw){ const c=JSON.parse(raw); if(/^\d{4,20}$/.test(c.uid||'')&&c.password) return c; } } catch {} }
  return null;
}
function saveCreds(creds, remember){ sessionStorage.setItem(STORE.creds,JSON.stringify(creds)); if(remember) localStorage.setItem(STORE.creds,JSON.stringify(creds)); else localStorage.removeItem(STORE.creds); state.creds=creds; renderAuthReady(); }
function clearCreds(){ sessionStorage.removeItem(STORE.creds); localStorage.removeItem(STORE.creds); state.creds=null; stopSync(); renderAuthReady(); }
function renderAuthReady(){ const ready=!!state.creds; $('auth-ready').hidden=!ready; $('auth-form').hidden=ready; $('sync-btn').disabled=!ready; if(ready){ $('linked-uid').textContent=state.creds.uid; showStep(''); message(''); } }

async function apiJson(url, options={}){
  const res=await fetch(url,options); let data={}; try{data=await res.json();}catch{}
  if(!res.ok && !data.error && !data.message) data.error=`HTTP ${res.status}`;
  return {res,data};
}

async function checkUid(){
  const uid=sanitizeUid($('uid-input').value); $('uid-input').value=uid;
  if(!/^\d{4,20}$/.test(uid)){message(t('enterUid'),'error');return;}
  state.currentUid=uid; state.pendingPassword=null; showStep(''); message(t('checking'));
  $('check-uid-btn').disabled=true;
  try{
    const {data}=await apiJson('/api/sync/gameauth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({playerId:uid})});
    if(data.status==='bound'){ showStep('password-step'); message(t('accountBound')); $('password-input').focus(); }
    else if(data.status==='unbound' && data.verificationHash && data.generatedPassword){ state.pendingPassword=String(data.generatedPassword); $('verification-hash').textContent=String(data.verificationHash); showStep('verify-step'); message(t('accountUnbound')); }
    else message(data.message||data.error||t('authFailed'),'error');
  } catch { message(t('serviceUnavailable'),'error'); }
  finally{$('check-uid-btn').disabled=false;}
}

async function finishAuth(password, action=null){
  if(!state.currentUid||!password){message(t('enterPassword'),'error');return false;}
  const payload={playerId:state.currentUid,password}; if(action)payload.action=action;
  try{
    const {data}=await apiJson('/api/sync/gameauth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    if(data.status==='success'){ saveCreds({uid:state.currentUid,password},$('remember-credential').checked); message(t('authSuccess'),'success'); return true; }
    message(data.message||data.error||t('authFailed'),'error'); return false;
  } catch { message(t('serviceUnavailable'),'error'); return false; }
}

async function login(){ const password=$('password-input').value; if(!password){message(t('enterPassword'),'error');return;} $('login-btn').disabled=true; await finishAuth(password); $('login-btn').disabled=false; }
async function confirmBind(){ if(!state.pendingPassword){message(t('authFailed'),'error');return;} $('confirm-bind-btn').disabled=true; await finishAuth(state.pendingPassword); $('confirm-bind-btn').disabled=false; }
async function forgot(){ if(!state.currentUid)return; $('forgot-btn').disabled=true; try{ const {data}=await apiJson('/api/sync/gameauth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({playerId:state.currentUid,action:'forgot'})}); if(data.status==='reset_initiated'&&data.verificationHash&&data.generatedPassword){state.pendingPassword=String(data.generatedPassword);$('reset-hash').textContent=String(data.verificationHash);showStep('reset-step');message(t('resetStarted'));}else message(data.message||data.error||t('authFailed'),'error'); }catch{message(t('serviceUnavailable'),'error');} finally{$('forgot-btn').disabled=false;} }
async function confirmReset(){ if(!state.pendingPassword)return; $('confirm-reset-btn').disabled=true; await finishAuth(state.pendingPassword,'reset_confirm'); $('confirm-reset-btn').disabled=false; }

function loadCompleted(){ try{ const a=JSON.parse(localStorage.getItem(STORE.completed)||'[]'); if(Array.isArray(a)) state.completedIds=new Set(a.map(String)); }catch{} }
function saveCompleted(){ try{ localStorage.setItem(STORE.completed,JSON.stringify([...state.completedIds])); }catch{} }
function addCompleted(ids){ let changed=false; for(const id of ids){ const s=String(id); if(!state.completedIds.has(s)){state.completedIds.add(s);changed=true;} } if(changed){saveCompleted();renderProgress();mapView.renderMarkers();renderSearchResults();} return changed; }

function buildCompletedFromFull(full){
  const out=new Set(); if(!Array.isArray(full)) return out;
  const [, beings, knowledge, myriad, dark, beings2, beings3, museum] = full;
  if(beings&&typeof beings==='object') for(const [wType,typeData] of Object.entries(beings)){ if(!typeData||typeof typeData!=='object')continue; for(const [subtype,ids] of Object.entries(typeData)){ if(!Array.isArray(ids))continue; for(const id of ids) out.add(subtype==='default'?`cs_${wType}_${id}`:`cs_${wType}_${id}_${subtype}`); } }
  if(Array.isArray(knowledge)) for(const id of knowledge) out.add(`kv_${id}`);
  if(Array.isArray(dark)) for(const id of dark) out.add(`ma_${id}`);
  if(Array.isArray(myriad)) for(const id of myriad) out.add(`vst_${id}`);
  if(beings2&&typeof beings2==='object') for(const [wType,ids] of Object.entries(beings2)){ if(String(wType)==='1'||!Array.isArray(ids))continue; for(const id of ids) out.add(`cs_${wType}_${id}`); }
  if(beings3&&typeof beings3==='object') for(const [compound,ids] of Object.entries(beings3)){ if(!Array.isArray(ids))continue; const [wType,wSub]=compound.split('_'); for(const id of ids) out.add(`cs_${wType}_${id}_${wSub}`); }
  if(Array.isArray(museum)) for(const id of museum) out.add(`bv_${id}`);
  return out;
}
function unpackLoose(value){
  const ids=[]; const visit=(v)=>{ if(v==null)return; if(Array.isArray(v)){for(const x of v)visit(x);return;} if(typeof v==='number'||typeof v==='bigint'){ids.push(String(v));return;} if(typeof v==='string'){if(/^\d+$/.test(v))ids.push(v);return;} if(typeof v==='object'){for(const [k,val] of Object.entries(v)){if(/^\d+$/.test(k)&&val)ids.push(k);else visit(val);}} }; visit(value); return [...new Set(ids)];
}
function buildCompletedFromPacked(packed){ const out=new Set(); if(!Array.isArray(packed))return out; for(const id of unpackLoose(packed[0]))out.add(`t_${id}`); for(const id of unpackLoose(packed[1]))out.add(`rw_${id}`); return out; }

function reassembleChunk(packet){
  if(!packet||packet.t!=='c')return packet; const id=String(packet.id||''); const n=Number(packet.n); const i=Number(packet.i); if(!id||!Number.isInteger(n)||n<1||n>1000||!Number.isInteger(i)||i<0||i>=n||typeof packet.d!=='string')return null;
  let s=state.chunkSessions.get(id); if(!s||s.n!==n){s={n,parts:new Array(n),count:0};state.chunkSessions.set(id,s);} if(s.parts[i]===undefined){s.parts[i]=packet.d;s.count++;} if(s.count<n)return null; state.chunkSessions.delete(id); try{return JSON.parse(s.parts.join(''));}catch{return null;}
}

async function loadRelays(){
  try{ const {data}=await apiJson('/api/sync/relay-servers'); state.relays=Array.isArray(data.servers)?data.servers:[]; }catch{state.relays=[];}
  if(!state.relays.length) state.relays=[{id:'default',name:'Vietnam Main Server',location:'SG',webSocketDomain:'wwmmapsync-sg1.sangtacvietcdn.xyz',alternateDomains:['wwmsync-sg1.stv-appdomain-00000001.org']}];
  const select=$('relay-select'); const prev=select.value; select.innerHTML=''; for(const r of state.relays){const o=document.createElement('option');o.value=r.id;o.textContent=`${r.name}${r.location?` · ${r.location}`:''}`;select.append(o);} if([...select.options].some(o=>o.value===prev))select.value=prev;
}
function stopTimers(){ if(state.pingTimer)clearInterval(state.pingTimer); if(state.timeoutTimer)clearTimeout(state.timeoutTimer); state.pingTimer=state.timeoutTimer=null; }
function stopSync(){ stopTimers(); if(state.websocket){try{state.websocket.close(1000,'user');}catch{} state.websocket=null;} state.connectionKey=null; state.chunkSessions.clear(); $('sync-btn').lastElementChild.textContent=t('syncNow'); setSyncStatus('idle'); }
function scheduleTimeout(){ if(state.timeoutTimer)clearTimeout(state.timeoutTimer); state.timeoutTimer=setTimeout(()=>{ if(state.websocket){ message(t('syncTimeout'),'error'); setSyncStatus('error',t('syncTimeout')); stopSync(); } },22000); }

function connectRelay(relay, domains, index=0){
  if(index>=domains.length){ message(t('serviceUnavailable'),'error'); setSyncStatus('error'); return; }
  const host=domains[index]; const ws=new WebSocket(`wss://${host}/ws/game?uid=${encodeURIComponent(state.creds.uid)}-${state.connectionKey}`); state.websocket=ws; setSyncStatus('waiting',t('waitApproval')); scheduleTimeout();
  ws.onopen=()=>{ try{ws.send('ACTIVE');}catch{} stopTimers(); state.pingTimer=setInterval(()=>{if(ws.readyState===WebSocket.OPEN)try{ws.send('ACTIVE');}catch{}},4500); scheduleTimeout(); };
  ws.onmessage=(event)=>{
    try{
      let packet=JSON.parse(typeof event.data==='string'&&event.data[0]==='b'?event.data.slice(1):event.data); packet=reassembleChunk(packet); if(!packet)return; scheduleTimeout();
      let got=false;
      if(packet.t==='f'){ const ids=buildCompletedFromFull(packet.d); addCompleted(ids); got=true; }
      else if(packet.t==='tr'){ const ids=buildCompletedFromPacked(packet.d); addCompleted(ids); got=true; }
      else if(packet.t==='p'){ got=true; }
      if(got){state.lastSyncAt=new Date(); $('last-sync').textContent=`${t('lastSync')}: ${t('justNow')}`; setSyncStatus('live',t('synced')); message(t('syncReceived'),'success');}
    }catch{}
  };
  ws.onerror=()=>{};
  ws.onclose=(ev)=>{ if(state.websocket!==ws)return; stopTimers(); if(ev.code===1006&&index+1<domains.length){state.websocket=null;connectRelay(relay,domains,index+1);return;} state.websocket=null; if(ev.code!==1000){setSyncStatus('error',t('syncDisconnected'));message(t('syncDisconnected'),'error');} $('sync-btn').lastElementChild.textContent=t('syncNow'); };
}

async function startSync(){
  if(state.websocket){stopSync();return;} if(!state.creds)return;
  $('sync-btn').disabled=true; message(t('startingSync')); setSyncStatus('waiting',t('startingSync'));
  try{
    if(!state.relays.length)await loadRelays(); const relay=state.relays.find(r=>r.id===$('relay-select').value)||state.relays[0]; state.connectionKey=randomKey();
    const {data}=await apiJson('/api/sync/client-method',{method:'POST',headers:{'content-type':'application/json','X-WWM-UID':state.creds.uid,'X-WWM-PASS':state.creds.password,'Client-Lang':lang},body:JSON.stringify({method:'start_game_sync',args:{connectionKey:state.connectionKey,relayServerId:relay.id||'default'}})});
    if(data.status!=='success'){
      if(data.error==='Unauthorized'){clearCreds();message(t('unauthorized'),'error');} else if(data.controlCode==='show_bind_status')message(data.message||t('permissionDenied'),'error'); else message(data.message||data.error||t('serviceUnavailable'),'error'); setSyncStatus('error'); return;
    }
    message(t('websocketConnecting')); const domains=[relay.webSocketDomain,...(relay.alternateDomains||[])].filter(Boolean); connectRelay(relay,[...new Set(domains)]); $('sync-btn').lastElementChild.textContent=t('stopSync');
  }catch{message(t('serviceUnavailable'),'error');setSyncStatus('error');}
  finally{$('sync-btn').disabled=!state.creds;}
}

function nameFor(marker){ const n=marker?.name||{}; return String(n[lang]||n.en||n.vi||n.zh||marker.id||'POI'); }
function descriptionFor(marker){ const d=marker?.description; if(!d)return''; if(typeof d==='string')return d; return String(d[lang]||d.en||d.vi||d.zh||''); }
function isCompleted(marker){ return state.completedIds.has(String(marker.id)) || (marker.alId!=null&&state.completedIds.has(String(marker.alId))); }
function isSyncable(marker){ const id=String(marker.id||''); return /^(?:cs|kv|ma|vst|bv|t|rw)_/.test(id)||(marker.alId&&/^(?:cs|kv|ma|vst|bv|t|rw)_/.test(String(marker.alId))); }

async function loadMarkers(){
  $('map-loading').hidden=false; $('map-error').hidden=true;
  try{
    const res=await fetch('/api/map/markers',{headers:{accept:'application/json'}}); if(!res.ok)throw new Error('markers'); const data=await res.json(); const raw=Array.isArray(data?.markers)?data.markers:[];
    state.markers=raw.map((m)=>({id:String(m.id),alId:m.alId==null?null:String(m.alId),mapId:String(m.mapId),category:String(m.category||''),name:m.name||{},description:m.description||{},x:Number(m.x),y:Number(m.y),canNotComplete:!!m.canNotComplete})).filter(m=>Number.isFinite(m.x)&&Number.isFinite(m.y));
    state.markersByMap.clear(); state.syncableIds.clear();
    for(const m of state.markers){if(!state.markersByMap.has(m.mapId))state.markersByMap.set(m.mapId,[]);state.markersByMap.get(m.mapId).push(m);if(isSyncable(m)){state.syncableIds.set(m.id,m);if(m.alId)state.syncableIds.set(m.alId,m);}}
    if(!state.markersByMap.has(state.mapId))state.mapId=state.markersByMap.has('1')?'1':state.markers[0]?.mapId||'1'; renderMapSelect(); renderProgress(); mapView.setMap(state.mapId,true); $('map-loading').hidden=true;
  }catch(e){$('map-loading').hidden=true;$('map-error').hidden=false;message(t('dataSourceError'),'error');}
}

function renderProgress(){
  let matched=0; const seen=new Set(); for(const [,m] of state.syncableIds){if(seen.has(m.id))continue;seen.add(m.id);if(isCompleted(m))matched++;}
  $('progress-count').textContent=`${matched.toLocaleString()} / ${seen.size?seen.size.toLocaleString():'—'}`;
}
function renderMapSelect(){
  const select=$('map-select'); if(!select)return; const current=state.mapId; const ids=[...new Set([...Object.keys(MAPS),...state.markersByMap.keys()])]; ids.sort((a,b)=>{const aa=MAPS[a]?0:1,bb=MAPS[b]?0:1;return aa-bb||Number(a)-Number(b)}); select.innerHTML=''; for(const id of ids){const count=state.markersByMap.get(id)?.length||0;if(!count&&!MAPS[id])continue;const o=document.createElement('option');o.value=id;o.textContent=MAPS[id]?.names[lang]||`${lang==='vi'?'Bản đồ':'Map'} ${id}`;select.append(o);} if([...select.options].some(o=>o.value===current))select.value=current;
}
function renderMapHud(){ if(!$('map-name'))return; $('map-name').textContent=MAPS[state.mapId]?.names[lang]||`${lang==='vi'?'Bản đồ':'Map'} ${state.mapId}`; }
function currentFiltered(){ const q=state.query.trim().toLocaleLowerCase(); return (state.markersByMap.get(state.mapId)||[]).filter(m=>!state.hideCompleted||!isCompleted(m)).filter(m=>!q||nameFor(m).toLocaleLowerCase().includes(q)||descriptionFor(m).toLocaleLowerCase().includes(q)); }
function renderSearchResults(){
  const box=$('search-results'); if(!box)return; const q=state.query.trim(); if(!q){box.hidden=true;box.innerHTML='';return;} const results=currentFiltered().slice(0,30); box.hidden=false; box.innerHTML=''; if(!results.length){const d=document.createElement('div');d.className='search-result';d.textContent=t('noResults');box.append(d);return;} for(const m of results){const b=document.createElement('button');b.type='button';b.className='search-result';const strong=document.createElement('strong');strong.textContent=nameFor(m);const small=document.createElement('small');small.textContent=`${isCompleted(m)?'✓ ':''}${m.id}`;b.append(strong,small);b.onclick=()=>{mapView.focusMarker(m);box.hidden=true;};box.append(b);} }

class FlatMapView {
  constructor(){this.el=$('map-viewport');this.tiles=$('tile-layer');this.canvas=$('marker-canvas');this.ctx=this.canvas.getContext('2d');this.map=null;this.center=[0,0];this.zoom=2;this.tileNodes=new Map();this.drag=null;this.dpr=1;this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(this.el);this.bind();}
  bind(){
    this.el.addEventListener('pointerdown',(e)=>{if(e.button!==0)return;this.el.setPointerCapture(e.pointerId);this.drag={x:e.clientX,y:e.clientY};this.el.classList.add('is-dragging');$('poi-popover').hidden=true;});
    this.el.addEventListener('pointermove',(e)=>{if(!this.drag)return;const dx=e.clientX-this.drag.x,dy=e.clientY-this.drag.y;this.drag={x:e.clientX,y:e.clientY};this.panPixels(dx,dy);});
    const end=()=>{this.drag=null;this.el.classList.remove('is-dragging');}; this.el.addEventListener('pointerup',end);this.el.addEventListener('pointercancel',end);
    this.el.addEventListener('wheel',(e)=>{e.preventDefault();this.zoomAt(e.offsetX,e.offsetY,e.deltaY<0?.35:-.35);},{passive:false});
    this.canvas.addEventListener('click',(e)=>{this.pick(e.offsetX,e.offsetY);});
  }
  resize(){const r=this.el.getBoundingClientRect();this.dpr=Math.min(devicePixelRatio||1,2);this.canvas.width=Math.max(1,Math.round(r.width*this.dpr));this.canvas.height=Math.max(1,Math.round(r.height*this.dpr));this.canvas.style.width=`${r.width}px`;this.canvas.style.height=`${r.height}px`;this.render();}
  config(){return MAPS[state.mapId]||{id:state.mapId,names:{vi:`Bản đồ ${state.mapId}`,en:`Map ${state.mapId}`},worldRange:4096,gridSize:0,gameTileSize:1024,tileUrl:null,minZoom:1,maxZoom:7};}
  ws(z=this.zoom){return 256*Math.pow(2,z)}
  toWorld(x,y,z=this.zoom){const wr=this.config().worldRange,ws=this.ws(z);return [((x+wr/2)/wr)*ws,((wr/2-y)/wr)*ws];}
  fromWorld(px,py,z=this.zoom){const wr=this.config().worldRange,ws=this.ws(z);return [(px/ws)*wr-wr/2,wr/2-(py/ws)*wr];}
  toScreen(x,y){const [px,py]=this.toWorld(x,y),[cx,cy]=this.toWorld(this.center[0],this.center[1]);return [px-cx+this.el.clientWidth/2,py-cy+this.el.clientHeight/2];}
  setMap(id,fit=false){state.mapId=String(id);$('map-select').value=state.mapId;this.map=this.config();this.zoom=Math.max(this.map.minZoom,Math.min(this.zoom,this.map.maxZoom));if(fit)this.fit();else this.render();renderMapHud();renderSearchResults();}
  fit(){const ms=state.markersByMap.get(state.mapId)||[];if(!ms.length){this.center=[0,0];this.zoom=this.config().minZoom;this.render();return;}let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;for(const m of ms){minX=Math.min(minX,m.x);maxX=Math.max(maxX,m.x);minY=Math.min(minY,m.y);maxY=Math.max(maxY,m.y);}this.center=[(minX+maxX)/2,(minY+maxY)/2];const wr=this.config().worldRange,dx=Math.max(100,maxX-minX),dy=Math.max(100,maxY-minY),w=Math.max(320,this.el.clientWidth-80),h=Math.max(240,this.el.clientHeight-80);const zx=Math.log2((w*wr)/(dx*256)),zy=Math.log2((h*wr)/(dy*256));this.zoom=Math.max(this.config().minZoom,Math.min(this.config().maxZoom,Math.min(zx,zy)));this.render();}
  panPixels(dx,dy){const [cx,cy]=this.toWorld(this.center[0],this.center[1]);this.center=this.fromWorld(cx-dx,cy-dy);this.clampCenter();this.render();}
  clampCenter(){const wr=this.config().worldRange;this.center[0]=Math.max(-wr/2,Math.min(wr/2,this.center[0]));this.center[1]=Math.max(-wr/2,Math.min(wr/2,this.center[1]));}
  zoomAt(sx,sy,dz){const c=this.config(),old=this.zoom,nz=Math.max(c.minZoom,Math.min(c.maxZoom,old+dz));if(Math.abs(nz-old)<.001)return;const [cx,cy]=this.toWorld(this.center[0],this.center[1],old);const wx=cx+(sx-this.el.clientWidth/2),wy=cy+(sy-this.el.clientHeight/2);const coord=this.fromWorld(wx,wy,old);this.zoom=nz;const [nwx,nwy]=this.toWorld(coord[0],coord[1],nz);const ncx=nwx-(sx-this.el.clientWidth/2),ncy=nwy-(sy-this.el.clientHeight/2);this.center=this.fromWorld(ncx,ncy,nz);this.clampCenter();this.render();}
  render(){this.renderTiles();this.renderMarkers();renderMapHud();}
  renderTiles(){const c=this.config(),layer=this.tiles;if(!c.tileUrl||!c.gridSize){for(const n of this.tileNodes.values())n.remove();this.tileNodes.clear();layer.style.background='radial-gradient(circle at 50% 35%,#17212b,#070a0f 68%)';return;}layer.style.background='#080b0f';const ws=this.ws(),N=c.gridSize,tw=ws/N,T=c.gameTileSize||1024,ideal=Math.max(1,T/tw),lod=Math.min(8,Math.pow(2,Math.floor(Math.log2(ideal)))),prefix=lod<=1?'':`${lod}/`,[cx,cy]=this.toWorld(this.center[0],this.center[1]),w=this.el.clientWidth,h=this.el.clientHeight,minCol=Math.max(0,Math.floor((cx-w/2)/tw)),maxCol=Math.min(N-1,Math.floor((cx+w/2)/tw)),minRow=Math.max(0,Math.floor((cy-h/2)/tw)),maxRow=Math.min(N-1,Math.floor((cy+h/2)/tw)),keep=new Set();for(let row=minRow;row<=maxRow;row++)for(let col=minCol;col<=maxCol;col++){const url=c.tileUrl.replace('{s}',prefix).replace('{y}',row).replace('{x}',col),key=`${row}:${col}:${prefix}`;keep.add(key);let img=this.tileNodes.get(key);if(!img){img=new Image();img.className='map-tile';img.alt='';img.decoding='async';img.referrerPolicy='no-referrer';img.src=url;img.onerror=()=>img.classList.add('is-error');layer.append(img);this.tileNodes.set(key,img);}img.style.left=`${col*tw-cx+w/2}px`;img.style.top=`${row*tw-cy+h/2}px`;img.style.width=`${tw+1}px`;img.style.height=`${tw+1}px`;}for(const [k,n] of this.tileNodes)if(!keep.has(k)){n.remove();this.tileNodes.delete(k);}}
  renderMarkers(){const ctx=this.ctx;if(!ctx)return;const w=this.el.clientWidth,h=this.el.clientHeight;ctx.setTransform(this.dpr,0,0,this.dpr,0,0);ctx.clearRect(0,0,w,h);const list=currentFiltered();let visible=0;for(const m of list){const [x,y]=this.toScreen(m.x,m.y);if(x<-12||y<-12||x>w+12||y>h+12)continue;visible++;const done=isCompleted(m),r=this.zoom>=5?4.2:this.zoom>=3?3.2:2.4;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=done?'rgba(125,139,151,.48)':'rgba(236,196,119,.92)';ctx.fill();if(!done&&this.zoom>=4){ctx.strokeStyle='rgba(255,239,203,.65)';ctx.lineWidth=1;ctx.stroke();}}$('visible-count').textContent=`${visible.toLocaleString()} ${t('markers')}`;}
  pick(x,y){const list=currentFiltered();let best=null,bestD=14*14;for(const m of list){const [sx,sy]=this.toScreen(m.x,m.y),d=(sx-x)**2+(sy-y)**2;if(d<bestD){best=m;bestD=d;}}if(best)this.showPopover(best,x,y);else $('poi-popover').hidden=true;}
  showPopover(m,x,y){const p=$('poi-popover');p.className=`poi-popover${isCompleted(m)?' is-completed':''}`;p.innerHTML='';const close=document.createElement('button');close.className='close-popover';close.type='button';close.textContent='×';close.ariaLabel=t('close');close.onclick=()=>p.hidden=true;const h=document.createElement('h3');h.textContent=nameFor(m);const d=document.createElement('p');d.textContent=descriptionFor(m)||m.id;const meta=document.createElement('div');meta.className='poi-meta';const s=document.createElement('span');s.textContent=isCompleted(m)?`✓ ${t('completed')}`:t('notCompleted');const id=document.createElement('span');id.textContent=m.id;meta.append(s,id);p.append(close,h,d,meta);const maxX=this.el.clientWidth-Math.min(280,this.el.clientWidth-24)-12,maxY=this.el.clientHeight-150;p.style.left=`${Math.max(12,Math.min(maxX,x+12))}px`;p.style.top=`${Math.max(12,Math.min(maxY,y+12))}px`;p.hidden=false;}
  focusMarker(m){if(m.mapId!==state.mapId){this.setMap(m.mapId,false);renderMapSelect();}this.center=[m.x,m.y];this.zoom=Math.min(this.config().maxZoom,Math.max(this.zoom,5));this.render();const [x,y]=this.toScreen(m.x,m.y);this.showPopover(m,x,y);}
}

let mapView;
function bindUi(){
  $('language-select').onchange=()=>{lang=$('language-select').value==='en'?'en':'vi';localStorage.setItem(STORE.lang,lang);setText();mapView.render();};
  $('toggle-sidebar').onclick=()=>$('sidebar').classList.toggle('is-open');
  $('uid-input').oninput=()=>{$('uid-input').value=sanitizeUid($('uid-input').value);}; $('uid-input').onkeydown=(e)=>{if(e.key==='Enter')checkUid();};
  $('check-uid-btn').onclick=checkUid; $('login-btn').onclick=login; $('confirm-bind-btn').onclick=confirmBind; $('forgot-btn').onclick=forgot; $('confirm-reset-btn').onclick=confirmReset; $('logout-btn').onclick=clearCreds; $('sync-btn').onclick=startSync;
  $('hide-completed').onchange=()=>{state.hideCompleted=$('hide-completed').checked;localStorage.setItem(STORE.settings,JSON.stringify({hideCompleted:state.hideCompleted,mapId:state.mapId}));mapView.renderMarkers();renderSearchResults();};
  $('map-select').onchange=()=>{state.mapId=$('map-select').value;localStorage.setItem(STORE.settings,JSON.stringify({hideCompleted:state.hideCompleted,mapId:state.mapId}));state.query='';$('search-input').value='';mapView.setMap(state.mapId,true);};
  $('search-input').oninput=()=>{state.query=$('search-input').value;renderSearchResults();mapView.renderMarkers();};
  $('zoom-in').onclick=()=>mapView.zoomAt(mapView.el.clientWidth/2,mapView.el.clientHeight/2,.5);$('zoom-out').onclick=()=>mapView.zoomAt(mapView.el.clientWidth/2,mapView.el.clientHeight/2,-.5);$('fit-map').onclick=()=>mapView.fit();$('retry-map').onclick=loadMarkers;
}

async function init(){
  try{const s=JSON.parse(localStorage.getItem(STORE.settings)||'{}');state.hideCompleted=!!s.hideCompleted;if(s.mapId)state.mapId=String(s.mapId);}catch{}
  $('hide-completed').checked=state.hideCompleted; loadCompleted(); state.creds=getStoredCreds(); mapView=new FlatMapView(); bindUi(); setText(); renderAuthReady(); await Promise.all([loadRelays(),loadMarkers()]);
  if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
}

init();
