// Cache decoded images, not URLs: serving a LAN asset with no-store can cause
// a second transfer if the displayed element is given the same src again.
export class ImageCache {
  constructor(factory=()=>new Image(),timeoutMs=8000,limit=4) {
    this.factory=factory;this.timeoutMs=timeoutMs;this.limit=limit;
    this.pending=new Map();this.warming=null;
  }
  load(url) {
    const hit=this.pending.get(url);
    if(hit){this.pending.delete(url);this.pending.set(url,hit);return hit;}
    const promise=new Promise((resolve,reject)=>{
      const image=this.factory();
      let settled=false;
      const finish=ok=>{
        if(settled)return;
        settled=true;clearTimeout(timer);image.onload=null;image.onerror=null;
        if(ok)resolve(image);else reject(Error('배경을 불러오지 못했어요. 다시 시도해주세요.'));
      };
      const timer=setTimeout(()=>finish(false),this.timeoutMs);
      image.onerror=()=>finish(false);
      image.onload=async()=>{
        try {await image.decode?.();finish(true);}
        catch {finish(false);}
      };
      image.src=url;
    });
    this.pending.set(url,promise);
    while(this.pending.size>this.limit)this.pending.delete(this.pending.keys().next().value);
    promise.catch(()=>{if(this.pending.get(url)===promise)this.pending.delete(url);});
    return promise;
  }
  warm(url) {
    const network=globalThis.navigator?.connection;
    if(this.warming||this.pending.has(url)||network?.saveData||/^(slow-)?2g$/.test(network?.effectiveType||''))return;
    const task=this.load(url);
    this.warming=task;
    task.catch(()=>{}).finally(()=>{if(this.warming===task)this.warming=null;});
  }
}
