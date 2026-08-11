(()=>{
'use strict';
const NativeImage=window.Image;
const descriptor=window.HTMLImageElement&&Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
if(!NativeImage||!descriptor?.get||!descriptor?.set)return;

function localTile(value){
  try{
    const url=new URL(String(value),location.href);
    if(url.origin!=='https://img.166.net')return value;
    let match=url.pathname.match(/^\/canonical\/h72\/tilemap\/v15\.0\/(3|5)\/(\d+)_(\d+)\.png$/);
    if(match)return `/dashen-cache/main/${match[1]}/${match[2]}_${match[3]}.png`;
    match=url.pathname.match(/^\/canonical\/h72\/tilemap\/subType4\/v2\/(3|5)\/(\d+)_(\d+)\.png$/);
    if(match)return `/dashen-cache/sub4/${match[1]}/${match[2]}_${match[3]}.png`;
  }catch(error){
    console.warn('[WWMSync Dashen cache] URL rewrite failed',error);
  }
  return value;
}

function CachedImage(width,height){
  const image=new NativeImage(width,height);
  Object.defineProperty(image,'src',{
    configurable:true,
    enumerable:true,
    get(){return descriptor.get.call(image)},
    set(value){descriptor.set.call(image,localTile(value))}
  });
  return image;
}
CachedImage.prototype=NativeImage.prototype;
Object.setPrototypeOf(CachedImage,NativeImage);
window.Image=CachedImage;
window.__WWMSYNC_DASHEN_CACHE__={rewrite:localTile};
})();
