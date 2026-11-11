// Music for the film: made on this computer to the tone of the film (ComfyUI, Stable Audio 3), or a file the person brings.
// The chosen track plays with the video on the monitor, and can be put into the MP4 (ffmpeg on this computer).
import {GENRES,musicText,musicPrompt} from "@trsr-video/core";

export function initMusic({get,t,esc,save}){
  const $=s=>document.querySelector(s);
  const box=$("#mus"),seg=$("#mseg"),imgBox=$("#img");
  if(!box||!seg)return {refresh(){}};
  let status=null,tracks=[],video=null,timer=null,lastKey="",lastProject=null,flash="",mixing=false;
  const ACTIVE=["queued","running"];
  const api=async(method,url,body)=>{
    const r=await fetch(url,{method,headers:body===undefined?{}:{"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
    let json=null;try{json=await r.json()}catch(_){}
    return {status:r.status,ok:r.ok,json};
  };
  const project=()=>(get().title||"").trim()||"Untitled";
  const prefs=()=>{const S=get();S.music=S.music||{};return S.music};
  const volume=()=>{const v=prefs().volume;return typeof v==="number"?v:0.6};
  const selected=()=>tracks.find(x=>x.id===prefs().trackId&&x.status==="done"&&x.url)||null;
  const model=()=>status&&status.reachable?status.models.find(m=>m.kind==="audio"):null;
  const clock=i=>{const s=Math.max(0,Math.round((Date.now()-new Date(i.startedAt||i.createdAt))/1000));return Math.floor(s/60)+":"+String(s%60).padStart(2,"0")};

  /* ---------- Images | Music switch inside the Media tab ---------- */
  function show(which){
    const mus=which==="mus";box.hidden=!mus;imgBox.hidden=mus;
    seg.querySelectorAll("[data-media]").forEach(b=>b.setAttribute("aria-pressed",String((b.dataset.media==="mus")===mus)));
    try{localStorage.setItem("trsr-media",mus?"mus":"img")}catch(_){}
    if(mus){check();load()}
  }
  seg.addEventListener("click",e=>{const b=e.target.closest("[data-media]");if(b)show(b.dataset.media)});

  /* ---------- the chosen track follows the video on the monitor ---------- */
  const player=new Audio();player.preload="auto";player.loop=true;
  let bound=null;
  function follow(){
    const v=bound,tr=selected();
    if(!v||!tr||v.paused){player.pause();return}
    const src=new URL(tr.url,location.href).href;
    if(player.src!==src)player.src=src;
    player.volume=Math.min(1,volume());
    const at=()=>{const d=player.duration;try{player.currentTime=d&&isFinite(d)?v.currentTime%d:v.currentTime}catch(_){}};
    if(player.readyState>0)at();else player.addEventListener("loadedmetadata",at,{once:true});
    player.play().catch(()=>{});
  }
  function bind(){
    const v=$("#stage video");if(v===bound)return;
    bound=v;player.pause();if(!v)return;
    for(const ev of ["play","pause","seeked","ended"])v.addEventListener(ev,follow);
  }
  new MutationObserver(bind).observe($("#stage"),{childList:true});bind();

  function row(x){
    const on=prefs().trackId===x.id,act=ACTIVE.includes(x.status);
    const meta=x.modelId==="upload"?t("musYours"):x.modelLabel+(x.seconds?" · "+x.seconds+" s":"")+" · seed "+x.seed;
    return '<div class="icard mtrack'+(on?" sel":"")+'"><div class="irow"><b>'+esc(x.label)+"</b>"
      +(act?'<span class="pill run">'+esc(t("imgSt")[x.status])+(x.status==="running"?" "+clock(x):"")+"</span>":x.status==="failed"?'<span class="pill failed">'+esc(t("imgSt").failed)+"</span>":on?'<span class="pill done">'+esc(t("musUsing"))+"</span>":"")+"</div>"
      +'<p class="note">'+esc(meta)+"</p>"
      +(x.url?'<audio controls preload="none" src="'+esc(x.url)+'"></audio>':"")
      +(x.status==="failed"?'<p class="err">'+esc((t("imgErr")[x.error&&x.error.kind]||"")+" "+((x.error&&x.error.message)||""))+"</p>":"")
      +'<div class="irow">'
      +(act?'<button type="button" class="btn sm" data-mcancel="'+x.id+'">'+esc(t("imgCancel"))+"</button>":"")
      +(x.url?'<button type="button" class="btn sm'+(on?"":" accent")+'" data-use="'+x.id+'">'+esc(t(on?"musStop":"musUse"))+'</button><a class="btn sm ghost" href="'+esc(x.url)+'" download="'+esc((project()+"-music").replace(/[^\w.-]+/g,"_"))+"."+esc(x.url.split(".").pop())+'">'+esc(t("imgDl"))+"</a>":"")
      +"</div></div>";
  }
  function info(){const S=get(),p=musicPrompt(S,prefs().prompt);return t("musInfo")(p.bpm,p.seconds)}
  function render(){
    const S=get(),custom=typeof prefs().prompt==="string"&&prefs().prompt.trim()!==""&&prefs().prompt.trim()!==musicText(S);
    const m=model(),sel=selected();
    const key=JSON.stringify([S.lang,S.genre,S.dur,custom,status,flash,mixing,prefs().trackId,volume(),video&&video.id,tracks.map(x=>[x.id,x.status,x.status==="running"?clock(x):0])]);
    if(key===lastKey)return;lastKey=key;
    const tone=(GENRES[S.genre]||{})[S.lang]||S.genre;
    const why=!status?"":!status.reachable?t("imgOff")(status.url):!m||!m.available?t("musNoModel")+(m&&m.missing.length?" "+m.missing.join(", "):""):"";
    box.innerHTML=
      '<p class="hint">'+esc(t("musHint"))+"</p>"
      +'<label class="mfield"><span class="lbl">'+esc(t("musDesc")(tone))+'</span><textarea id="mPrompt" rows="5" spellcheck="false">'+esc(custom?prefs().prompt:musicText(S))+"</textarea></label>"
      +'<div class="irow"><span class="note" id="mInfo">'+esc(info())+"</span>"+(custom?'<button type="button" class="btn sm ghost" id="mTone">'+esc(t("musUseTone"))+"</button>":"")+"</div>"
      +'<div class="actions"><button type="button" class="btn accent" id="mMake"'+(why||!status?" disabled":"")+">"+esc(t("musMake"))+'</button><label class="btn" for="mFile">'+esc(t("musAdd"))+'</label><input type="file" id="mFile" accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac" hidden></div>'
      +(why?'<p class="note">'+esc(why)+"</p>":"")
      +(flash?'<p class="err">'+esc(flash)+"</p>":"")
      +'<h4 class="ih">'+esc(t("musTracks"))+"</h4>"
      +(tracks.length?tracks.filter(x=>x.status!=="canceled").map(row).join(""):'<p class="note">'+esc(t("musNone"))+"</p>")
      +(sel?'<h4 class="ih">'+esc(t("musWith"))+"</h4>"
        +'<label class="mfield"><span class="lbl">'+esc(t("musVol"))+' <span id="mVolN">'+Math.round(volume()*100)+'%</span></span><input type="range" id="mVol" min="5" max="150" step="5" value="'+Math.round(volume()*100)+'"></label>'
        +'<p class="note">'+esc(t("musPlays"))+"</p>"
        +'<div class="actions"><button type="button" class="btn" id="mMix"'+(video&&status&&status.ffmpeg&&!mixing?"":" disabled")+">"+esc(t(mixing?"musMixing":"musMix"))+"</button></div>"
        +'<p class="note">'+esc(!video?t("musNoVideo"):status&&!status.ffmpeg?t("musNoFfmpeg"):t("musMixOf")(video.modelLabel,video.durationS))+"</p>":"");
  }

  async function load(){
    clearTimeout(timer);
    const p=project();lastProject=p;
    const [r,j]=await Promise.all([api("GET","/api/local/music?project="+encodeURIComponent(p)).catch(()=>null),api("GET","/api/jobs").catch(()=>null)]);
    if(p!==project())return;
    if(r&&r.ok)tracks=r.json.music;
    if(j&&j.ok)video=j.json.jobs.filter(x=>x.videoUrl&&x.title===p).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))[0]||null;
    render();
    if(tracks.some(x=>ACTIVE.includes(x.status)))timer=setTimeout(load,2000);
  }
  async function check(){const r=await api("GET","/api/local/status").catch(()=>null);if(r&&r.ok){status=r.json;render()}}
  const fail=(r,fallback)=>{const e=r&&r.json&&r.json.error;flash=(t("musErr")[e]||t("imgErr")[e]||t("musErr")[fallback])+(r&&r.json&&r.json.message?" "+r.json.message:"")};

  box.addEventListener("click",async e=>{
    const b=e.target.closest("button");if(!b)return;
    if(b.id==="mTone"){delete prefs().prompt;save();lastKey="";return render()}
    if(b.id==="mMake"){
      b.disabled=true;const S=get(),own=prefs().prompt;
      const r=await api("POST","/api/local/music",{state:S,prompt:typeof own==="string"&&own.trim()?own:undefined}).catch(()=>null);
      if(r&&r.status===202)flash="";else{fail(r,"failed");await check()}
      lastKey="";return load();
    }
    if(b.dataset.use){const p=prefs();if(p.trackId===b.dataset.use)delete p.trackId;else p.trackId=b.dataset.use;save();follow();return render()}
    if(b.dataset.mcancel){await api("POST","/api/local/images/"+b.dataset.mcancel+"/cancel",{});return load()}
    if(b.id==="mMix"){
      const sel=selected();if(!sel||!video)return;
      mixing=true;flash="";render();
      const r=await api("POST","/api/jobs/"+video.id+"/mix",{musicId:sel.id,volume:volume()}).catch(()=>null);
      mixing=false;
      if(r&&r.ok){const a=Object.assign(document.createElement("a"),{href:r.json.url+"?t="+Date.now(),download:r.json.name});document.body.appendChild(a);a.click();a.remove()}
      else fail(r,"mixFailed");
      return render();
    }
  });
  box.addEventListener("input",e=>{
    if(e.target.id==="mPrompt"){const v=e.target.value;if(v.trim()&&v.trim()!==musicText(get()))prefs().prompt=v;else delete prefs().prompt;save();$("#mInfo").textContent=info()}
    if(e.target.id==="mVol"){prefs().volume=e.target.value/100;save();$("#mVolN").textContent=e.target.value+"%";player.volume=Math.min(1,volume())}
  });
  box.addEventListener("change",async e=>{
    if(e.target.id==="mPrompt"||e.target.id==="mVol"){lastKey="";return render()}
    if(e.target.id!=="mFile")return;
    const f=e.target.files&&e.target.files[0];if(!f)return;
    if(f.size>40*1024*1024){flash=t("musErr").tooBig;lastKey="";return render()}
    const data=await new Promise(res=>{const fr=new FileReader();fr.onload=()=>res(String(fr.result).split(",")[1]||"");fr.onerror=()=>res("");fr.readAsDataURL(f)});
    const r=await api("POST","/api/local/music/upload",{project:project(),name:f.name,data}).catch(()=>null);
    if(r&&r.status===201){flash="";prefs().trackId=r.json.id;save()}else fail(r,"failed");
    lastKey="";load();
  });

  let start="img";try{start=localStorage.getItem("trsr-media")==="mus"?"mus":"img"}catch(_){}
  show(start);
  if(start!=="mus"){check();load()}
  return {refresh(){if(project()!==lastProject){tracks=[];video=null;lastProject=project();clearTimeout(timer);timer=setTimeout(load,400)}render();player.volume=Math.min(1,volume())}};
}
