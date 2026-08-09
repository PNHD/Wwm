const STORAGE_KEY='wwmsync:official-completion:v1';
const HASH_PREFIX='#wwmsync-import=';
const OFFICIAL_HOST='www.wherewindsmeetgame.com';
const SUPPORTED_MAP_IDS=new Set([1,2,3,4]);

function sanitizePayload(input){
  if(!input||input.v!==1||input.source!=='official-map'||!Number.isFinite(input.at)||!Array.isArray(input.maps))throw new Error('Invalid Official Map snapshot');
  const maps=[];
  let totalIds=0;
  const seenMaps=new Set();
  for(const row of input.maps){
    if(!Array.isArray(row)||row.length!==2)throw new Error('Invalid map row');
    const mapId=Number(row[0]);
    if(!SUPPORTED_MAP_IDS.has(mapId)||seenMaps.has(mapId))continue;
    if(!Array.isArray(row[1])||row[1].length>20000)throw new Error('Invalid completion list');
    const ids=[];const seen=new Set();
    for(const raw of row[1]){
      const id=Number(raw);
      if(!Number.isInteger(id)||id<=0||id>1_000_000_000||seen.has(id))continue;
      seen.add(id);ids.push(id);
    }
    ids.sort((a,b)=>a-b);totalIds+=ids.length;
    if(totalIds>50000)throw new Error('Snapshot is too large');
    maps.push([mapId,ids]);seenMaps.add(mapId);
  }
  return{v:1,source:'official-map',at:Number(input.at),maps};
}

function decodeBase64Url(value){
  const normalized=value.replace(/-/g,'+').replace(/_/g,'/');
  const padding='='.repeat((4-normalized.length%4)%4);
  return decodeURIComponent(Array.from(atob(normalized+padding),c=>`%${c.charCodeAt(0).toString(16).padStart(2,'0')}`).join(''));
}

export function consumeOfficialImport(){
  if(!location.hash.startsWith(HASH_PREFIX))return null;
  const encoded=location.hash.slice(HASH_PREFIX.length);
  try{
    const payload=sanitizePayload(JSON.parse(decodeBase64Url(encoded)));
    localStorage.setItem(STORAGE_KEY,JSON.stringify(payload));
    return payload;
  }finally{
    history.replaceState(null,'',location.pathname+location.search);
  }
}

export function loadOfficialCompletion(){
  try{
    const raw=localStorage.getItem(STORAGE_KEY);
    return raw?sanitizePayload(JSON.parse(raw)):null;
  }catch{
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function completionSet(snapshot,mapId){
  const row=snapshot?.maps?.find(item=>Number(item[0])===Number(mapId));
  return new Set(row?.[1]||[]);
}

export function snapshotCompletionCount(snapshot){
  return(snapshot?.maps||[]).reduce((sum,row)=>sum+(Array.isArray(row?.[1])?row[1].length:0),0);
}

export function snapshotAgeMinutes(snapshot){
  if(!snapshot?.at)return null;
  return Math.max(0,Math.round((Date.now()-snapshot.at)/60000));
}

function runOfficialMapBridge(targetOrigin){
  (async()=>{
    let popup=null;
    try{
      if(location.hostname!=='www.wherewindsmeetgame.com'||!location.pathname.startsWith('/map/')){
        alert('WWMSync: open the official Where Winds Meet map first, log in, then run this bookmark.');
        return;
      }
      popup=window.open('about:blank','_blank');
      const cookie=document.cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('h72na_map_accessToken='));
      if(!cookie){if(popup)popup.close();alert('WWMSync: please log in on the official map first.');return;}
      const token=decodeURIComponent(cookie.slice(cookie.indexOf('=')+1));
      if(!token){if(popup)popup.close();alert('WWMSync: official map login token is empty. Please log in again.');return;}
      const API='https://s2.easebar.com/39f12eda6b86452b';
      const get=async(path,params={})=>{
        const url=new URL(API+path);
        url.searchParams.set('lang','en-US');
        for(const [key,value] of Object.entries(params))url.searchParams.set(key,String(value));
        const response=await fetch(url,{credentials:'include',headers:{'Accept-Language':'en-US','h72_map_accessToken':token}});
        const json=await response.json().catch(()=>null);
        if(!response.ok||!json?.success)throw new Error(json?.msg||`Official API HTTP ${response.status}`);
        return json.data;
      };
      const mapList=await get('/api/map/list');
      const mapIds=(mapList?.maps||[]).map(m=>Number(m.id)).filter(id=>[1,2,3,4].includes(id));
      const maps=[];
      for(const mapId of mapIds){
        const data=await get('/api/map/points',{mapId});
        const ids=[];
        for(const group of data?.categories||[])for(const category of group?.childCategories||[])for(const point of category?.pointList||[]){
          const id=Number(point?.id);
          if((point?.finished===true||point?.finished===1)&&Number.isInteger(id)&&id>0)ids.push(id);
        }
        ids.sort((a,b)=>a-b);maps.push([mapId,[...new Set(ids)]]);
      }
      const payload={v:1,source:'official-map',at:Date.now(),maps};
      const bytes=new TextEncoder().encode(JSON.stringify(payload));
      let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
      const encoded=btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
      const target=`${targetOrigin}/#wwmsync-import=${encoded}`;
      if(popup)popup.location.replace(target);else location.href=target;
    }catch(error){
      if(popup)popup.close();
      alert(`WWMSync sync failed: ${error?.message||error}`);
    }
  })();
}

export function buildOfficialMapBookmarklet(targetOrigin=location.origin){
  const safeOrigin=new URL(targetOrigin).origin;
  return`javascript:(${runOfficialMapBridge.toString()})(${JSON.stringify(safeOrigin)});void 0`;
}

export const OFFICIAL_MAP_URL='https://www.wherewindsmeetgame.com/map/en/';
export const OFFICIAL_SYNC_STORAGE_KEY=STORAGE_KEY;
export const OFFICIAL_SYNC_HOST=OFFICIAL_HOST;
