// Generation, settings and library: everything here talks to the local server (/api).
// When there is no server (the page published as a static site), these parts stay hidden
// and the generator keeps working as before: fill the form, copy the prompt.
import {resolutionsFor,estimateCost,costDiff,aspectKey,total,fitToModel} from "@trsr-video/core";

const ACTIVE=["queued","submitting","generating","downloading"];

export function initGenerate({get,apply,t,esc,save}){
  const $=s=>document.querySelector(s);
  const genDlg=$("#genDlg"),setDlg=$("#setDlg");
  let online=false,models=[],providers=[],limits={},paused=null,jobs=[],plugPrompts=[];
  let quote=null,quoteMsg="",overOk=false,sending=false,timer=null,quoteSeq=0;

  const api=async(method,url,body)=>{
    const r=await fetch(url,{method,headers:body===undefined?{}:{"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
    let json=null;try{json=await r.json()}catch(_){}
    return {status:r.status,ok:r.ok,json};
  };
  const money=v=>t("money")(v);
  const sel=()=>{const S=get();S.gen=S.gen||{};return S.gen};
  const model=()=>models.find(m=>m.id===sel().modelId);
  const provider=id=>providers.find(p=>p.id===id);

  async function loadModels(){
    const r=await api("GET","/api/models");
    if(!r.ok)throw new Error("offline");
    ({models,providers,limits,paused}=r.json);
    // Plugins may bring other ways of writing the prompt; they are listed with the app's own.
    const pr=await api("GET","/api/plugins").catch(()=>null);plugPrompts=pr&&pr.ok?pr.json.plugins.flatMap(p=>(p.prompts||[]).map(x=>["plugin:"+p.id+":"+x.id,x.label+" \u00b7 "+p.name])):[];
  }
  /** The cheapest model and resolution that can make this film: the "cheap draft". */
  function cheapest(){
    const S=get(),d=+S.dur||0;let best=null;
    for(const m of models)for(const r of resolutionsFor(m,S.aspect)){
      const e=estimateCost(m,r,Math.min(Math.max(d,m.duration.minS),m.duration.maxS));
      const fits=m.duration.allowedS?m.duration.allowedS.includes(d):d>=m.duration.minS&&d<=m.duration.maxS;
      // A provider whose key is saved comes first, then a model that fits the duration, then the price.
      const rank=(m.keyConfigured?2:0)+(fits?1:0);
      if(e&&(!best||rank>best.rank||(rank===best.rank&&e.perSecond<best.perSecond)))best={m,r,perSecond:e.perSecond,fits,rank};
    }
    return best;
  }
  function ensureSelection(){
    const S=get(),g=sel();
    if(!model()){const c=cheapest();g.modelId=(c?c.m:models[0]||{}).id;g.resolution=c?c.r:undefined}
    const m=model();if(!m)return;
    const rs=resolutionsFor(m,S.aspect);
    if(!rs.includes(g.resolution))g.resolution=rs[0];
    if(g.audio===undefined)g.audio=true;
    if(!g.promptMode)g.promptMode="auto";
  }

  /* ---------- platform, model and resolution, chosen next to the Generate button ---------- */
  let pickKey="";
  function renderPick(){
    const box=$("#pick");if(!box)return;
    box.hidden=!online||!models.length;if(box.hidden)return;
    ensureSelection();
    const S=get(),g=sel(),m=model();if(!m)return;
    const rs=resolutionsFor(m,S.aspect),d=+S.dur||0,e=g.resolution?estimateCost(m,g.resolution,d):null,pv=provider(m.provider)||{label:m.provider,configured:false};
    const key=JSON.stringify([S.lang,S.aspect,d,total(S),g.modelId,g.resolution,providers.map(p=>p.configured)]);
    if(key===pickKey)return;pickKey=key;
    const a=m.duration.allowedS;
    const warn=m.durationControl===false?"":a&&!a.includes(d)?t("iss").durationNotAllowed(d,a.join(", ")):d>m.duration.maxS?t("iss").durationTooLong(d,m.duration.maxS):d<m.duration.minS?t("iss").durationTooShort(d,m.duration.minS):"";
    // The shots must add up to the duration; when they do not, or the duration does not fit the model, offer the fix right here.
    const tot=total(S),sumWarn=tot!==d?t("iss").shotsDontAddUp(tot,d):"",timeWarn=warn||sumWarn;
    let fit=null;try{const F=fitToModel(S,m);if(F.dur!==d||tot!==F.dur)fit=F}catch(_){}
    const note=!rs.length?t("gNoRes"):!pv.configured?t("gNoKey")(pv.label):timeWarn;
    box.innerHTML='<div><label for="pPlat">'+esc(t("pPlatform"))+'</label><select id="pPlat">'+providers.filter(p=>models.some(x=>x.provider===p.id)).map(p=>'<option value="'+esc(p.id)+'"'+(p.id===m.provider?" selected":"")+">"+esc(p.label+(p.configured?"":" ("+t("gNoKeyShort")+")"))+"</option>").join("")+"</select></div>"
      +'<div><label for="pModel">'+esc(t("gModel"))+'</label><select id="pModel">'+models.filter(x=>x.provider===m.provider).map(x=>'<option value="'+esc(x.id)+'"'+(x.id===m.id?" selected":"")+">"+esc(x.label)+"</option>").join("")+"</select></div>"
      +'<div><label for="pRes">'+esc(t("gRes"))+'</label><select id="pRes"'+(rs.length?"":" disabled")+">"+(rs.length?rs.map(r=>"<option"+(r===g.resolution?" selected":"")+">"+esc(r)+"</option>").join(""):"<option>—</option>")+"</select></div>"
      +'<div class="est" title="'+esc(t("gCost"))+'">'+(e&&!timeWarn?"≈ "+esc(money(e.usd)):"")+"</div>"
      +(note?'<div class="pnote">'+esc(note)+(fit&&timeWarn&&note===timeWarn?' <button type="button" class="btn sm" id="pFit">'+esc(t("pFit")(fit.dur))+"</button>":"")+"</div>":"");
  }
  $("#pick").addEventListener("change",e=>{
    const g=sel(),id=e.target.id;
    if(id==="pPlat"){
      // A new platform: take its first model that can make this format.
      const list=models.filter(x=>x.provider===e.target.value),first=list.find(x=>resolutionsFor(x,get().aspect).length)||list[0];
      if(!first)return;g.modelId=first.id;g.resolution=undefined;
    }else if(id==="pModel"){g.modelId=e.target.value;g.resolution=undefined}
    else if(id==="pRes")g.resolution=e.target.value;
    else return;
    ensureSelection();save();renderPick();
  });
  // One click: same number of shots, same proportions, a total that matches the duration and fits the model.
  $("#pick").addEventListener("click",e=>{
    if(e.target.id!=="pFit")return;
    const m=model();if(!m)return;
    try{apply(fitToModel(get(),m))}catch(_){}
  });

  /* ---------- generate dialog ---------- */
  async function openGen(){
    try{await loadModels()}catch(_){online=false;refresh();return}
    quote=null;quoteMsg="";overOk=false;sending=false;
    ensureSelection();renderGen();genDlg.showModal();askQuote();
  }
  async function askQuote(){
    const g=sel(),seq=++quoteSeq;
    if(!model()||!g.resolution){quote=null;renderGen();return}
    const r=await api("POST","/api/estimate",{state:get(),modelId:g.modelId,resolution:g.resolution,audio:g.audio,promptMode:g.promptMode}).catch(()=>null);
    if(seq!==quoteSeq)return;
    quote=r&&r.ok?r.json:null;if(!r)quoteMsg=t("gOffline");
    renderGen();
  }
  function issueText(i){const f=t("iss")[i.code];return f?f(i.value,i.limit):i.code}
  function renderGen(){
    const S=get(),g=sel(),m=model(),rs=m?resolutionsFor(m,S.aspect):[],p=m&&provider(m.provider),c=cheapest();
    const blocking=!quote||!quote.estimate||quote.issues.some(i=>i.blocking);
    const noKey=p&&!p.configured,over=quote?quote.limits.over:[];
    const lim=quote?quote.limits:limits;
    let h='<h2>'+esc(t("gTitle"))+'</h2><p class="hint">'+esc(t("gHint"))+'</p>';
    h+='<div class="row"><div><label for="gModel">'+esc(t("gModel"))+'</label><select id="gModel">'+providers.map(pv=>'<optgroup label="'+esc(pv.label+(pv.configured?"":" ("+t("gNoKeyShort")+")"))+'">'+models.filter(x=>x.provider===pv.id).map(x=>'<option value="'+esc(x.id)+'"'+(x.id===g.modelId?" selected":"")+">"+esc(x.label)+"</option>").join("")+"</optgroup>").join("")+"</select></div>";
    h+='<div><label for="gRes">'+esc(t("gRes"))+'</label><select id="gRes"'+(rs.length?"":" disabled")+">"+rs.map(r=>'<option'+(r===g.resolution?" selected":"")+">"+esc(r)+"</option>").join("")+"</select></div></div>";
    if(m)h+='<p class="note">'+esc(rs.length?(m.duration.allowedS?t("gModelFixed")(m.duration.allowedS,rs.join(", ")):t("gModelLimits")(m.duration.minS,m.duration.maxS,rs.join(", "))):t("gNoRes"))+"</p>";
    if(m&&m.audio&&m.audioParam)h+='<label class="check"><input type="checkbox" id="gAudio"'+(g.audio?" checked":"")+">"+esc(t("gAudio"))+"</label>";
    h+='<label for="gPrompt">'+esc(t("gPromptMode"))+'</label><select id="gPrompt">'+[...["auto","full","compact"].map(k=>[k,t("gPromptModes")[k]]),...plugPrompts].map(o=>'<option value="'+esc(o[0])+'"'+(o[0]===g.promptMode?" selected":"")+">"+esc(o[1])+"</option>").join("")+"</select>";
    // A prompt written by a plugin, or a film sent with reference images, goes through the film window: it shows the images, the prompt and the cost before the OK.
    const viaFilm=String(g.promptMode||"").startsWith("plugin:"),takesRefs=!!(m&&m.inputs&&m.inputs.referenceImages);
    if(viaFilm)h+='<p class="note">'+esc(t("gPlugNote"))+"</p>";
    else if(takesRefs)h+='<div class="actions" style="margin-top:8px"><button type="button" class="btn sm" id="gRefs">'+esc(t("gRefs"))+"</button></div>";
    if(c&&(c.m.id!==g.modelId||c.r!==g.resolution))h+='<div class="actions" style="margin-top:8px"><button type="button" class="btn sm" id="gCheap">'+esc(t("gCheap")(c.m.label,c.r))+"</button></div>";
    if(quote&&!viaFilm){
      for(const i of quote.issues)h+='<div class="alert'+(i.blocking?"":" soft")+'">'+esc(issueText(i))
        +(quote.fit&&i===quote.issues.find(x=>x.blocking&&/^(duration|shotsDontAddUp)/.test(x.code))?'<br><button type="button" class="btn sm" id="gFit">'+esc(t("gFit")(quote.fit.dur,quote.fit.lens.join(" + ")+" s"))+"</button>":"")+"</div>";
      h+='<table class="quote"><tbody>'
        +"<tr><th>"+esc(t("gModel"))+"</th><td>"+esc(quote.model.label+" · "+quote.model.providerLabel)+"</td></tr>"
        +"<tr><th>"+esc(t("gRes"))+"</th><td>"+esc(quote.resolution)+"</td></tr>"
        +"<tr><th>"+esc(t("gSize"))+"</th><td>"+(quote.size?(quote.model.sizesNominal?"≈ ":"")+quote.size[0]+" × "+quote.size[1]+" ("+esc(aspectKey(S.aspect))+")":"—")+"</td></tr>"
        +"<tr><th>"+esc(t("gDur"))+"</th><td>"+quote.durationS+" s</td></tr>"
        +"<tr><th>"+esc(t("gShots"))+"</th><td>"+esc(quote.shots>1?t("gShotsN")(quote.shots):"1")+"</td></tr>"
        +"<tr><th>"+esc(t("gSound"))+"</th><td>"+esc(quote.audio?t("gYes"):t("gNo"))+"</td></tr>"
        +'<tr class="cost"><th>'+esc(t("gCost"))+"</th><td>"+(quote.estimate?esc(money(quote.estimate.usd)):"—")+"</td></tr></tbody></table>";
      if(quote.estimate)h+='<p class="note">'+esc(t("gPrice")(quote.estimate.perSecond,quote.estimate.asOf,quote.estimate.source))+"</p>";
      h+='<details><summary class="note" style="cursor:pointer">'+esc(t("gPrompt")(quote.promptChars,quote.promptKind))+". "+esc(t("gSeePrompt"))+'</summary><pre style="max-height:220px;min-height:0;color:#E9E6F7;margin-top:6px">'+esc(quote.prompt||"")+"</pre></details>";
    }
    const L=v=>v===null||v===undefined?t("gNoLimit"):money(v);
    h+='<p class="note">'+esc(t("gLimits")(L(lim.perGeneration),L(lim.perDay)))+". "+esc(t("gSpent")(money(lim.spentToday||0)))+"</p>";
    if(noKey)h+='<div class="alert">'+esc(t("gNoKey")(p.label))+' <button type="button" class="btn sm" id="gKey">'+esc(t("gSetKey"))+"</button></div>";
    for(const o of over)h+='<div class="alert soft">'+esc(t("gOver")[o])+"</div>";
    if(over.length)h+='<label class="check"><input type="checkbox" id="gOver"'+(overOk?" checked":"")+">"+esc(t("gOverOk"))+"</label>";
    if(quoteMsg)h+='<div class="alert soft">'+esc(quoteMsg)+"</div>";
    const off=viaFilm?!m:blocking||noKey||sending||(over.length&&!overOk);
    h+='<div class="actions"><button type="button" class="btn" id="gCancel">'+esc(t("gCancel"))+'</button><button type="button" class="btn sun" id="gOk"'+(off?" disabled":"")+">"+esc(sending?t("gSending"):viaFilm?t("gNext"):t("gOk"))+"</button></div>";
    $("#genBody").innerHTML=h;
    renderPick();
  }
  async function confirm(){
    if(sending||!quote||!quote.estimate)return;
    sending=true;quoteMsg="";renderGen();
    const g=sel();
    // The amount the person saw travels with the OK; the server refuses if its own number differs.
    const r=await api("POST","/api/generate",{state:get(),modelId:g.modelId,resolution:g.resolution,audio:g.audio,promptMode:g.promptMode,confirmed:true,estimateUSD:quote.estimate.usd,confirmOverLimit:overOk}).catch(()=>null);
    sending=false;
    if(r&&r.status===202){genDlg.close();still=null;viewId=r.json.id;await poll();if(window.trsrShow)window.trsrShow($("#lib"));$("#stage").scrollIntoView({block:"nearest"});return}
    if(r&&r.json&&r.json.quote)quote=r.json.quote;
    quoteMsg=!r?t("gOffline"):r.json&&r.json.error==="estimateChanged"?t("gChanged"):r.json&&r.json.error==="noKey"?t("gNoKey")((provider(model().provider)||{}).label||""):"";
    if(r&&r.json&&r.json.error==="noKey")await loadModels().catch(()=>{});
    renderGen();
  }
  genDlg.addEventListener("change",e=>{
    const g=sel(),id=e.target.id;
    if(id==="gModel"){g.modelId=e.target.value;g.resolution=undefined;ensureSelection()}
    else if(id==="gRes")g.resolution=e.target.value;
    else if(id==="gAudio")g.audio=e.target.checked;
    else if(id==="gPrompt")g.promptMode=e.target.value;
    else if(id==="gOver"){overOk=e.target.checked;renderGen();return}
    else return;
    save();overOk=false;quoteMsg="";quote=null;renderGen();askQuote();
  });
  genDlg.addEventListener("click",e=>{
    const b=e.target.closest("button");if(!b)return;
    if(b.id==="gCancel")genDlg.close();
    else if(b.id==="gOk"||b.id==="gRefs"){if(b.id==="gRefs"||String(sel().promptMode||"").startsWith("plugin:")){genDlg.close();document.dispatchEvent(new CustomEvent("trsr:film"))}else confirm()}
    else if(b.id==="gKey"){genDlg.close();openSettings()}
    else if(b.id==="gCheap"){const c=cheapest(),g=sel();g.modelId=c.m.id;g.resolution=c.r;save();overOk=false;quote=null;renderGen();askQuote()}
    else if(b.id==="gFit"&&quote&&quote.fit){
      // Same number of shots, same proportions, new total: 5 × 4 s on a 15 s model become 5 × 3 s.
      const S=get(),next={...S,dur:quote.fit.dur,shots:S.shots.map((s,i)=>({...s,len:quote.fit.lens[i]}))};
      apply(next);quote=null;renderGen();askQuote();
    }
  });

  /* ---------- settings dialog ---------- */
  let setData=null,setMsg="",tests={};
  const TEST_COLOR={ok:"var(--ok)",invalid:"var(--danger)",unknown:"var(--warn)"};
  async function openSettings(){
    const r=await api("GET","/api/settings").catch(()=>null);
    if(!r||!r.ok){online=false;refresh();return}
    setData=r.json;setMsg="";renderSettings();setDlg.showModal();
  }
  function renderSettings(){
    const d=setData,keep={},lang=get().lang;
    // A test result arriving must not wipe a key that is being typed in another field.
    document.querySelectorAll('#setBody input[type="password"]').forEach(i=>{keep[i.id]=i.value});
    let h='<div class="dlg-head"><h2>'+esc(t("sTitle"))+'</h2><button type="button" class="btn ghost" id="sClose" aria-label="'+esc(t("sClose"))+'">✕</button></div><div class="dlg-scroll">';
    // Language lives here, not in the top bar.
    h+='<section class="card"><div class="card-head" style="margin:0"><h3>'+esc(t("sLang"))+'</h3><div class="seg" role="group" aria-label="'+esc(t("sLang"))+'">'+[["pt","Português"],["en","English"]].map(([k,n])=>'<button type="button" data-lang="'+k+'" aria-pressed="'+(lang===k)+'">'+n+"</button>").join("")+"</div></div></section>";
    h+='<p class="hint">'+esc(t("sHint"))+"</p>";
    for(const p of d.providers){
      const tr=tests[p.id];
      h+='<section class="card"><div class="card-head"><h3>'+esc(p.label)+'</h3><span class="kstat'+(p.configured?" on":"")+'">'+esc(p.configured?t("sKeySet")(p.last4?"••••"+p.last4:"••••"):t("sKeyNone"))+"</span></div>"
        +'<div class="keyrow"><input type="password" id="k-'+esc(p.id)+'" autocomplete="off" spellcheck="false" aria-label="'+esc(t("sKey")(p.label))+'" placeholder="'+esc(p.keyHint||t("sKeyPh"))+'">'
        +'<button type="button" class="btn sun" data-savekey="'+esc(p.id)+'">'+esc(t("sSave"))+"</button>"
        +(p.configured?'<button type="button" class="btn" data-testkey="'+esc(p.id)+'">'+esc(t("sTest"))+'</button><button type="button" class="btn ghost danger" data-delkey="'+esc(p.id)+'">'+esc(t("sRemove"))+"</button>":"")+"</div>"
        +(tr?'<p class="note" role="status" style="margin-bottom:0;color:'+(TEST_COLOR[tr.state]||"inherit")+'">'+esc(tr.text)+"</p>":"")+"</section>";
    }
    h+='<section class="card" style="margin-bottom:0"><div class="card-head"><h3>'+esc(t("sLimits"))+'</h3></div><p class="hint">'+esc(t("sLimitsHint"))+"</p>"
      +'<div class="row"><div><label for="lGen" style="margin-top:0">'+esc(t("sPerGen"))+'</label><input id="lGen" type="number" min="0" step="0.5" inputmode="decimal" value="'+(d.limits.perGeneration??"")+'"></div>'
      +'<div><label for="lDay" style="margin-top:0">'+esc(t("sPerDay"))+'</label><input id="lDay" type="number" min="0" step="0.5" inputmode="decimal" value="'+(d.limits.perDay??"")+'"></div></div>'
      +'<div class="actions"><button type="button" class="btn" id="sLimits">'+esc(t("sSaveLimits"))+"</button>"+(setMsg?'<span class="note">'+esc(setMsg)+"</span>":"")+"</div></section></div>";
    $("#setBody").innerHTML=h;
    for(const k in keep){const el=document.getElementById(k);if(el&&keep[k])el.value=keep[k]}
  }
  async function runTest(id){
    tests[id]={state:"run",text:t("sTesting")};if(setDlg.open)renderSettings();
    const r=await api("POST","/api/settings/keys/test",{provider:id}).catch(()=>null),j=r&&r.json;
    const f=j&&t("sTestRes")[j.result];
    tests[id]=f?{state:j.result,text:f(j)}:{state:"unknown",text:t("gOffline")};
    if(setDlg.open)renderSettings();
  }
  setDlg.addEventListener("click",async e=>{
    const b=e.target.closest("button");if(!b)return;
    if(b.id==="sClose"){setDlg.close();return}
    if(b.dataset.testkey){runTest(b.dataset.testkey);return}
    let r=null;
    if(b.dataset.savekey){
      const inp=$("#k-"+b.dataset.savekey),key=inp.value.trim();if(!key){inp.focus();return}
      r=await api("PUT","/api/settings/keys",{provider:b.dataset.savekey,key});inp.value="";
      if(r.ok)runTest(b.dataset.savekey);   // a key that was just saved is tested right away
    }else if(b.dataset.delkey){delete tests[b.dataset.delkey];r=await api("PUT","/api/settings/keys",{provider:b.dataset.delkey,key:""})}
    else if(b.id==="sLimits"){const n=v=>v===""?null:parseFloat(v);r=await api("PUT","/api/settings/limits",{perGeneration:n($("#lGen").value),perDay:n($("#lDay").value)})}
    else return;
    const s=await api("GET","/api/settings").catch(()=>null);
    if(s&&s.ok)setData=s.json;
    setMsg=r&&r.ok?t("sSaved"):"";renderSettings();
    loadModels().then(()=>{renderPick();return poll()}).catch(()=>{});
  });

  /* ---------- library ---------- */
  const elapsed=j=>{const a=new Date(j.startedAt||j.createdAt).getTime(),b=j.finishedAt?new Date(j.finishedAt).getTime():Date.now(),s=Math.max(0,Math.round((b-a)/1000));return Math.floor(s/60)+":"+String(s%60).padStart(2,"0")};
  const when=j=>new Date(j.createdAt).toLocaleString(get().lang==="pt"?"pt-BR":"en-US",{dateStyle:"short",timeStyle:"short"});
  function jobCard(j){
    const active=ACTIVE.includes(j.status),cls=j.status==="done"?"done":j.status==="failed"?"failed":active?"run":"";
    const diff=j.realUSD!==undefined&&j.realUSD!==null?costDiff(j.estimateUSD,j.realUSD):null;
    let h='<article class="job'+(j.id===viewId?" sel":"")+'" data-id="'+esc(j.id)+'"><div class="job-head"><strong>'+esc(j.title)+'</strong><span class="pill '+cls+'">'+esc(t("st")[j.status]||j.status)+"</span></div>";
    if(j.videoUrl)h+='<button type="button" class="thumb" data-view="'+esc(j.id)+'"><video preload="metadata" muted src="'+esc(j.videoUrl)+'#t=0.5"></video><span>'+esc(t("jView"))+"</span></button>";
    else if(active)h+='<div class="bar2"><i style="width:'+(j.status==="downloading"?100:Math.max(4,j.progress||0))+'%"></i></div>'+(j.waiting?'<p class="note">'+esc(t("wait")[j.waiting]||j.waiting)+"</p>":"");
    if(j.error)h+='<p class="err">'+esc(t("err")[j.error.kind]||"")+" "+esc(j.error.message||"")+(j.error.allowedValues?"<br>"+esc(t("errAllowed")+[].concat(j.error.allowedValues).join(", ")):"")+"</p>";
    h+="<dl><dt>"+esc(t("jModel"))+"</dt><dd>"+esc(j.modelLabel)+"</dd>"
      +"<dt>"+esc(t("jSize"))+"</dt><dd>"+j.size[0]+"×"+j.size[1]+", "+j.durationS+" s"+(j.audio?", "+esc(t("gSound").toLowerCase()):"")+"</dd>"
      +"<dt>"+esc(t("jEst"))+"</dt><dd>"+esc(money(j.estimateUSD))+"</dd>"
      +(diff?"<dt>"+esc(t("jReal"))+"</dt><dd>"+esc(money(j.realUSD))+(diff.usd?esc(t("jDiff")(diff.usd,diff.pct)):"")+"</dd>":"")
      +(j.seed!==undefined&&j.seed!==null?"<dt>"+esc(t("jSeed"))+"</dt><dd>"+esc(j.seed)+"</dd>":"")
      +"<dt>"+esc(t("jTime"))+'</dt><dd data-elapsed="'+esc(j.id)+'">'+elapsed(j)+"</dd>"
      +"<dt>"+esc(t("jWhen"))+"</dt><dd>"+esc(when(j))+"</dd></dl>";
    h+='<div class="actions">';
    if(j.videoUrl)h+='<a class="btn sm sun" style="text-decoration:none" href="'+esc(j.videoUrl)+'" download="'+esc((j.title||"video").replace(/[^\w\- ]+/g,"").trim().replace(/\s+/g,"-")||"video")+"-"+esc(j.modelId)+'.mp4">'+esc(t("jDownload"))+"</a>";
    h+='<button type="button" class="btn sm" data-reuse="'+esc(j.id)+'">'+esc(t("jReuse"))+'</button><button type="button" class="btn sm" data-copyp="'+esc(j.id)+'">'+esc(t("jCopy"))+"</button>";
    if(j.status==="queued"||(ACTIVE.includes(j.status)&&(provider(j.provider)||{}).canCancel))h+='<button type="button" class="btn sm" data-cancel="'+esc(j.id)+'">'+esc(t("jCancel"))+"</button>";
    return h+"</div></article>";
  }
  /* ---------- monitor: the video being watched, the one being generated, or an empty frame ---------- */
  let viewId=null,stageKey="",still=null;
  function updateViewer(){
    const st=$("#stage"),S=get();if(!st)return;
    // A still image chosen in the Images tab stays on the monitor until a video is chosen.
    if(still){
      st.style.aspectRatio=still.ar;st.style.setProperty("--arn",String(still.ar.split("/").reduce((a,b)=>a/b)));
      const k="still:"+still.url;if(k===stageKey)return;stageKey=k;
      st.innerHTML='<img src="'+esc(still.url)+'" alt="'+esc(still.label)+'">';
      $("#stageMeta").innerHTML="<b>"+esc(still.label)+"</b> / "+esc(still.meta);return;
    }
    const j=jobs.find(x=>x.id===viewId)||jobs.find(x=>ACTIVE.includes(x.status))||jobs.find(x=>x.videoUrl)||null;
    const ar=j?j.size[0]+"/"+j.size[1]:(aspectKey(S.aspect)||"16:9").replace(":","/");
    st.style.aspectRatio=ar;
    st.style.setProperty("--arn",String(ar.split("/").reduce((a,b)=>a/b)));
    const key=JSON.stringify([S.lang,online,ar,j&&[j.id,j.status,j.progress,j.waiting,j.videoUrl]]);
    if(key===stageKey){if(j&&ACTIVE.includes(j.status)){const tc=st.querySelector(".tc");if(tc)tc.textContent=elapsed(j)}return}
    stageKey=key;
    let h;
    if(j&&j.videoUrl)h='<video controls src="'+esc(j.videoUrl)+'"></video>';
    else if(j&&ACTIVE.includes(j.status)){
      // Big running timecode, the model underneath, and the four steps with the current one lit.
      const order=["queued","submitting","generating","downloading"],cur=order.indexOf(j.status);
      h='<div class="stage-msg"><span class="pill run">'+esc(t("st")[j.status]||j.status)+'</span><span class="tc">'+elapsed(j)+'</span><span class="mono dim">'+esc(j.modelLabel)+" / "+j.size[0]+"×"+j.size[1]+'</span><div class="steps">'
        +order.map((s,i)=>'<span class="'+(i<cur?"past":i===cur?"now":"")+'">'+(i<cur?"✓ ":"")+esc(t("st")[s])+"</span>").join("")+"</div>"
        +(j.waiting?'<span class="dim">'+esc(t("wait")[j.waiting]||"")+"</span>":"")+'</div><div class="bar2"><i style="width:'+(j.status==="downloading"?100:Math.max(4,j.progress||0))+'%"></i></div>';
    }
    else if(j&&j.error)h='<div class="stage-msg"><b>'+esc(t("st").failed)+"</b>"+esc(t("err")[j.error.kind]||"")+" "+esc(j.error.message||"")+"</div>";
    else h='<div class="stage-msg"><b>'+esc(t("vEmpty"))+"</b>"+esc(t(online?"vHint":"vHintOffline"))+"</div>";
    st.innerHTML=h;
    $("#stageMeta").innerHTML=j?"<b>"+esc(j.title)+"</b> / "+esc(j.modelLabel)+" / "+j.size[0]+"×"+j.size[1]+" / "+j.durationS+" s / "+(j.realUSD!==undefined&&j.realUSD!==null?esc(money(j.realUSD)):"≈ "+esc(money(j.estimateUSD))):esc(t(online?"vNote":"vHintOffline"));
  }
  let lastKey="";
  function renderJobs(){
    const pausedHtml=paused?'<div class="alert">'+esc(t("paused")[paused.reason]||paused.message)+' <button type="button" class="btn sm" id="pKey">'+esc(t("gSetKey"))+'</button> <button type="button" class="btn sm" id="pResume">'+esc(t("pResume"))+"</button></div>":"";
    // Re-rendering replaces the <video> elements, so only do it when something other than the clock changed.
    const key=JSON.stringify([get().lang,viewId,paused,jobs.map(j=>[j.id,j.status,j.progress,j.waiting,j.realUSD,j.videoUrl])]);
    if(key!==lastKey){
      lastKey=key;
      $("#libHint").innerHTML=esc(t("libHint")(jobs.length))+pausedHtml;
      $("#jobs").innerHTML=jobs.map(jobCard).join("");
    }else for(const j of jobs)if(ACTIVE.includes(j.status)){const el=document.querySelector('[data-elapsed="'+j.id+'"]');if(el)el.textContent=elapsed(j)}
  }
  async function poll(){
    clearTimeout(timer);
    const r=await api("GET","/api/jobs").catch(()=>null);
    if(r&&r.ok){jobs=r.json.jobs;paused=r.json.paused;renderJobs();updateViewer()}
    if(jobs.some(j=>ACTIVE.includes(j.status)))timer=setTimeout(poll,r?2500:8000);
  }
  $("#lib").addEventListener("click",async e=>{
    const b=e.target.closest("button");if(!b)return;
    if(b.dataset.view){still=null;viewId=b.dataset.view;renderJobs();updateViewer();$("#stage").scrollIntoView({block:"nearest"});return}
    if(b.id==="pKey")return openSettings();
    if(b.id==="pResume"){await api("POST","/api/queue/resume",{});return poll()}
    const id=b.dataset.reuse||b.dataset.copyp||b.dataset.cancel;if(!id)return;
    if(b.dataset.cancel){const r=await api("POST","/api/jobs/"+id+"/cancel",{});if(r.json&&(r.json.error==="notSupported"||r.json.error==="tooLate"))b.replaceWith(Object.assign(document.createElement("span"),{className:"note",textContent:t("jNoCancel")}));return poll()}
    const r=await api("GET","/api/jobs/"+id);if(!r.ok)return;
    if(b.dataset.reuse){apply({...r.json.state,gen:{modelId:r.json.modelId,resolution:r.json.resolution,audio:r.json.audio}});window.scrollTo({top:0})}
    else{try{await navigator.clipboard.writeText(r.json.prompt)}catch(_){}}
  });

  $("#gen").addEventListener("click",openGen);
  $("#openSettings").addEventListener("click",openSettings);

  function refresh(){
    updateViewer();renderPick();
    $("#gen").hidden=!online;$("#openSettings").hidden=!online;$("#lib").hidden=!online;
    if(online){renderJobs();if(genDlg.open)renderGen();if(setDlg.open&&setData)renderSettings()}
  }
  // Is there a server behind this page?
  api("GET","/api/health").then(async r=>{
    online=!!(r.ok&&r.json&&r.json.app==="trsr-video");
    if(online){await loadModels().catch(()=>{online=false});}
    refresh();if(online)poll();
  }).catch(()=>{online=false;refresh()});

  return {refresh,poll,showStill(s){still=s;updateViewer();$("#stage").scrollIntoView({block:"nearest"})}};
}
