// Plugins add their own sections to the Media tab. The app gives each one a box and a few helpers;
// the plugin draws inside its box. With no plugin installed this does nothing.
export function initPlugins({get,esc,save,showStill}){
  const host=document.querySelector("#plug"),img=document.querySelector("#img");
  const mounted=[];
  if(!host)return {refresh(){}};
  const api=async(method,url,body)=>{
    const r=await fetch(url,{method,headers:body===undefined?{}:{"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
    let json=null;try{json=await r.json()}catch(_){}
    return {status:r.status,ok:r.ok,json};
  };
  // The plugin sections belong to Images: they hide when the Media tab shows Music.
  if(img)new MutationObserver(()=>{host.hidden=img.hidden}).observe(img,{attributes:true,attributeFilter:["hidden"]});
  (async()=>{
    const r=await api("GET","/api/plugins").catch(()=>null);
    if(!r||!r.ok)return;
    for(const p of r.json.plugins){
      if(!p.web)continue;
      const el=document.createElement("section");el.className="plugin";el.dataset.plugin=p.id;host.appendChild(el);
      try{
        const mod=await import(/* @vite-ignore */p.web);
        const m=mod.mount({el,plugin:p,get,esc,save,api,showStill,project:()=>(get().title||"").trim()||"Untitled"});
        if(m)mounted.push(m);
      }catch(e){el.remove();console.error("Plugin "+p.id+" could not start:",e)}
    }
  })();
  return {refresh(){for(const m of mounted)if(m.refresh)try{m.refresh()}catch(_){}}};
}
