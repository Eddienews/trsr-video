// Images made on this computer (ComfyUI): one reference per character, one plate per set, and the first and
// last frame of each shot. Free, so there is no cost window: one click queues one image.
// The server builds each prompt from the film; this file only lists what exists and asks for what is missing.
import {imageTasks} from "@trsr-video/core";

export function initImages({get,t,esc,save,showStill}){
  const $=s=>document.querySelector(s);
  const pane=$("#img"),tab=$('[data-rtab="images"]');
  if(!pane||!tab)return {refresh(){}};
  let status=null,images=[],timer=null,lastKey="",lastProject=null,flash="";
  const ACTIVE=["queued","running"];
  const api=async(method,url,body)=>{
    const r=await fetch(url,{method,headers:body===undefined?{}:{"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
    let json=null;try{json=await r.json()}catch(_){}
    return {status:r.status,ok:r.ok,json};
  };
  const project=()=>(get().title||"").trim()||"Untitled";
  const prefs=()=>{const S=get();S.gen=S.gen||{};return S.gen};
  const avail=kind=>status&&status.reachable?status.models.filter(m=>m.kind===kind&&m.available):[];
  // The model chosen for each kind, or the first one this machine has.
  const chosen=kind=>{const a=avail(kind),k=kind==="text"?"localText":"localEdit";return (a.find(m=>m.id===prefs()[k])||a[0]||{}).id||""};
  const of=id=>images.filter(i=>i.taskId===id);
  const active=id=>of(id).find(i=>ACTIVE.includes(i.status));
  const done=id=>of(id).find(i=>i.status==="done"&&i.url);
  const lastFail=id=>{const n=of(id)[0];return n&&n.status==="failed"?n:null};
  const clock=i=>{const s=Math.max(0,Math.round((Date.now()-new Date(i.startedAt||i.createdAt))/1000));return Math.floor(s/60)+":"+String(s%60).padStart(2,"0")};

  function card(task,tasks){
    const a=active(task.id),d=done(task.id),f=lastFail(task.id);
    const lacking=task.needs.filter(n=>!done(n)).map(n=>(tasks.find(x=>x.id===n)||{label:n}).label);
    const model=chosen(task.kind==="keyframe"?"edit":"text");
    const why=task.unsupported?t("imgTooMany"):!status||!status.reachable?"":!model?t("imgNoModel"):lacking.length?t("imgNeeds")(lacking.join(", ")):"";
    const label=task.kind==="keyframe"?t(task.role==="start"?"imgStart":"imgEnd"):task.label;
    const st=a?'<span class="pill run">'+esc(t("imgSt")[a.status])+(a.status==="running"?" "+clock(a):"")+"</span>":d?'<span class="pill done">'+esc(t("imgSt").done)+"</span>":"";
    return '<div class="icard">'
      +(d?'<button type="button" class="ithumb" data-show="'+d.id+'" title="'+esc(t("vWatch")||"")+'"><img loading="lazy" src="'+esc(d.url)+'" alt="'+esc(task.label)+'"></button>':'<div class="ithumb empty">'+(a?'<i class="spin"></i>':"")+"</div>")
      +'<div class="irow"><b>'+esc(label)+"</b>"+st+"</div>"
      +'<div class="irow">'
      +(a?'<button type="button" class="btn sm" data-icancel="'+a.id+'">'+esc(t("imgCancel"))+"</button>"
         :'<button type="button" class="btn sm'+(d?"":" accent")+'" data-make="'+task.id+'"'+(why||!status||!status.reachable?" disabled":"")+">"+esc(t(d?"imgRedo":"imgMake"))+"</button>")
      +(d?'<a class="btn sm ghost" href="'+esc(d.url)+'" download="'+esc((project()+"-"+task.id).replace(/[^\w.-]+/g,"_"))+'.png">'+esc(t("imgDl"))+"</a>":"")
      +"</div>"
      +(why?'<p class="note">'+esc(why)+"</p>":"")
      +(f&&!a?'<p class="err">'+esc((t("imgErr")[f.error&&f.error.kind]||"")+" "+((f.error&&f.error.message)||""))+"</p>":"")
      +"</div>";
  }

  function render(){
    const S=get(),tasks=imageTasks(S);
    const key=JSON.stringify([S.lang,status,flash,prefs().localText,prefs().localEdit,tasks.map(x=>[x.id,x.label,x.needs,x.unsupported,x.prompt.length]),images.map(i=>[i.id,i.status,i.status==="running"?clock(i):0])]);
    if(key===lastKey)return;lastKey=key;
    if(!status){pane.innerHTML='<p class="hint">'+esc(t("imgChecking"))+"</p>";return}
    const opt=kind=>{const a=status.models.filter(m=>m.kind===kind),c=chosen(kind);
      return a.length?a.map(m=>'<option value="'+m.id+'"'+(m.id===c?" selected":"")+(m.available?"":" disabled")+">"+esc(m.label)+(m.available?" · "+esc(m.note):" · "+esc(t("imgNotHere")))+"</option>").join(""):""};
    const refs=tasks.filter(x=>x.kind==="reference"),plates=tasks.filter(x=>x.kind==="plate"),frames=tasks.filter(x=>x.kind==="keyframe");
    const missing=status.reachable?status.models.filter(m=>!m.available&&m.missing.length):[];
    const todoRefs=[...refs,...plates].filter(x=>!done(x.id)&&!active(x.id)).length;
    const todoFrames=frames.filter(x=>!x.unsupported&&!done(x.id)&&!active(x.id)&&x.needs.every(n=>done(n))).length;
    const shots=[...new Set(frames.map(x=>x.shot))];
    pane.innerHTML=
      '<p class="hint">'+esc(t("imgHint"))+"</p>"
      +'<div class="lstat '+(status.reachable?"ok":"off")+'"><span><i></i>'+esc(t(status.reachable?"imgOn":"imgOff")(status.url))+'</span><button type="button" class="btn sm ghost" id="iCheck">'+esc(t("imgRetry"))+"</button></div>"
      +(status.reachable?"":'<p class="note">'+esc(t("imgOffHelp"))+"</p>")
      +'<div class="grid2 imodels"><label><span class="lbl">'+esc(t("imgText"))+'</span><select id="iText"'+(avail("text").length?"":" disabled")+">"+opt("text")+'</select></label>'
      +'<label><span class="lbl">'+esc(t("imgEdit"))+'</span><select id="iEdit"'+(avail("edit").length?"":" disabled")+">"+opt("edit")+"</select></label></div>"
      +missing.map(m=>'<p class="note">'+esc(t("imgMissing")(m.label,m.missing.join(", ")))+"</p>").join("")
      +(status.others&&status.others.length?'<p class="note">'+esc(t("imgOthers")(status.others.join(", ")))+"</p>":"")
      +(flash?'<p class="err">'+esc(flash)+"</p>":"")
      +'<div class="actions"><button type="button" class="btn" id="iAllRefs"'+(todoRefs&&chosen("text")?"":" disabled")+">"+esc(t("imgAllRefs")(todoRefs))+'</button><button type="button" class="btn" id="iAllFrames"'+(todoFrames&&chosen("edit")?"":" disabled")+">"+esc(t("imgAllFrames")(todoFrames))+"</button></div>"
      +'<h4 class="ih">'+esc(t("imgChars"))+"</h4>"+(refs.length?'<div class="igrid">'+refs.map(x=>card(x,tasks)).join("")+"</div>":'<p class="note">'+esc(t("imgNoChars"))+"</p>")
      +'<h4 class="ih">'+esc(t("imgSets"))+'</h4><div class="igrid">'+plates.map(x=>card(x,tasks)).join("")+"</div>"
      +'<h4 class="ih">'+esc(t("imgFrames"))+"</h4>"
      +shots.map(n=>'<div class="ishot"><span class="lbl">'+esc(t("imgShot")(n))+'</span><div class="igrid">'+frames.filter(x=>x.shot===n).map(x=>card(x,tasks)).join("")+"</div></div>").join("");
  }

  async function load(){
    clearTimeout(timer);
    const p=project();lastProject=p;
    const r=await api("GET","/api/local/images?project="+encodeURIComponent(p)).catch(()=>null);
    if(r&&r.ok&&p===project()){images=r.json.images;render()}
    if(images.some(i=>ACTIVE.includes(i.status)))timer=setTimeout(load,2000);
  }
  async function check(){
    const r=await api("GET","/api/local/status").catch(()=>null);
    if(!r||!r.ok){tab.hidden=true;return}
    status=r.json;tab.hidden=false;render();
  }
  async function make(taskId){
    const S=get(),task=imageTasks(S).find(x=>x.id===taskId);if(!task)return false;
    const r=await api("POST","/api/local/images",{state:S,taskId,modelId:chosen(task.kind==="keyframe"?"edit":"text")}).catch(()=>null);
    if(r&&r.status===202){flash="";return true}
    const e=r&&r.json&&r.json.error;
    flash=t("imgErr")[e]||t("imgErr").failed;
    if(e==="unreachable"||e==="modelMissing")await check();
    return false;
  }
  async function makeAll(list){for(const x of list)if(!(await make(x.id)))break;lastKey="";await load();render()}

  pane.addEventListener("click",async e=>{
    const b=e.target.closest("button");if(!b)return;
    if(b.id==="iCheck"){b.disabled=true;await check();await load();return}
    if(b.dataset.show){const i=images.find(x=>x.id===b.dataset.show);if(i)showStill({url:i.url,label:project()+" · "+i.label,meta:i.modelLabel+" / "+i.width+"×"+i.height+" / seed "+i.seed,ar:i.width+"/"+i.height});return}
    if(b.dataset.make){b.disabled=true;await make(b.dataset.make);lastKey="";await load();render();return}
    if(b.dataset.icancel){await api("POST","/api/local/images/"+b.dataset.icancel+"/cancel",{});return load()}
    const tasks=imageTasks(get());
    if(b.id==="iAllRefs")return makeAll(tasks.filter(x=>x.kind!=="keyframe"&&!done(x.id)&&!active(x.id)));
    if(b.id==="iAllFrames")return makeAll(tasks.filter(x=>x.kind==="keyframe"&&!x.unsupported&&!done(x.id)&&!active(x.id)&&x.needs.every(n=>done(n))));
  });
  pane.addEventListener("change",e=>{
    if(e.target.id==="iText")prefs().localText=e.target.value;
    else if(e.target.id==="iEdit")prefs().localEdit=e.target.value;
    else return;
    save();render();
  });
  tab.addEventListener("click",()=>{check();load()});

  tab.hidden=true;
  check().then(()=>{if(!tab.hidden)load()});
  return {refresh(){if(tab.hidden)return;if(project()!==lastProject){images=[];lastProject=project();clearTimeout(timer);timer=setTimeout(load,400)}render()}};
}
