// A film longer than one generation of the chosen model: made in parts that break between shots,
// with the same reference images (characters and sets from Media > Images) sent with every part.
// One OK for the whole film, on the total cost. The parts are joined into one MP4 at the end.
export function initFilm({get,t,esc,save,onSent}){
  const $=s=>document.querySelector(s);
  const dlg=$("#filmDlg"),body=$("#filmBody");
  if(!dlg||!body)return {};
  let models=[],prompts=[],plan=null,err="",imgs=[],loading=false,busy=false,sending=false,overOk=false,seq=0,resume=null;
  const api=async(method,url,body)=>{
    const r=await fetch(url,{method,headers:body===undefined?{}:{"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
    let json=null;try{json=await r.json()}catch(_){}
    return {status:r.status,ok:r.ok,json};
  };
  const money=v=>t("money")(v);
  const tc=s=>Math.floor(s/60)+":"+String(Math.round(s%60)).padStart(2,"0");
  const project=()=>(get().title||"").trim()||"Untitled";
  const gen=()=>{const S=get();S.gen=S.gen||{};return S.gen};
  const model=()=>models.find(m=>m.id===gen().modelId);
  const needs=()=>{const m=model();return !!m&&(+get().dur||0)>m.duration.maxS};
  const maxRefs=()=>{const m=model();return (m&&m.inputs&&m.inputs.referenceImages)||0};
  // The references the person left ticked; the first time, every character and set there is, up to what the model takes.
  const chosen=()=>{const S=get(),ids=imgs.map(i=>i.id);
    // Ticks saved for another project (or none of them here any more) do not carry over: a new film starts with all of its own.
    const tasks=imgs.map(i=>i.taskId);
    const mine=S.film&&Array.isArray(S.film.refs)&&(S.film.project?S.film.project===project():!S.film.refs.length||S.film.refs.some(id=>ids.includes(id)))&&(!Array.isArray(S.film.tasks)||!S.film.tasks.length||S.film.tasks.some(x=>tasks.includes(x)));
    if(!mine)return ids.slice(0,maxRefs());
    // An image made again (same character or set) takes the place of the one that was ticked.
    if(Array.isArray(S.film.tasks))return imgs.filter(i=>S.film.tasks.includes(i.taskId)).map(i=>i.id).slice(0,maxRefs());
    return S.film.refs.filter(id=>ids.includes(id)).slice(0,maxRefs())};
  const loadModels=async()=>{const r=await api("GET","/api/models").catch(()=>null);if(r&&r.ok)models=r.json.models};

  async function ask(){
    const n=++seq;busy=true;render();
    const g=gen(),r=await api("POST","/api/estimate-film",{state:get(),modelId:g.modelId,resolution:g.resolution,audio:g.audio,promptMode:g.promptMode,refs:chosen(),chain:g.chain===true||undefined,resume:resume||undefined}).catch(()=>null);
    if(n!==seq)return;
    // A film that cannot be resumed as it is (other model, other number of parts) starts over.
    if(resume&&r&&r.json&&r.json.error==="resumeMismatch"){resume=null;return ask()}
    busy=false;plan=r&&r.ok?r.json:null;
    err=r&&r.ok?"":t("fErr")[r&&r.json&&r.json.error]||t("fErr").failed;
    if(r&&r.json&&r.json.error==="cannotSplit")err=t("fErr").cannotSplit(r.json.maxS,r.json.minS);
    render();
  }
  function render(){
    // Until the models, prompts and images are in, nothing is shown that could be wrong ("no images", another prompt).
    if(loading){body.innerHTML='<p class="note">'+esc(t("fLoading"))+'</p><div class="actions"><button type="button" class="btn" id="fCancel">'+esc(t("gCancel"))+'</button><button type="button" class="btn sun" id="fOk" disabled>'+esc(t("fOk1"))+"</button></div>";return}
    const S=get(),m=model(),picked=chosen(),max=maxRefs();
    const single=!!m&&(+S.dur||0)<=m.duration.maxS;
    let h="<h2>"+esc(single?t("fTitle1"):t("fTitle")(plan?plan.parts.length:"…"))+'</h2><p class="hint">'+esc(m?(single?t("fHint1")(m.label):t("fHint")(+S.dur||0,m.label,m.duration.maxS)):"")+"</p>";
    h+='<label for="fPromptSel">'+esc(t("gPromptMode"))+'</label><select id="fPromptSel">'+[...["auto","full","compact"].map(k=>[k,t("gPromptModes")[k]]),...prompts].map(o=>'<option value="'+esc(o[0])+'"'+(o[0]===(gen().promptMode||"auto")?" selected":"")+">"+esc(o[1])+"</option>").join("")+"</select>";
    h+='<h4 class="ih">'+esc(single?t("fRefs1"):t("fRefs"))+"</h4>";
    if(!max)h+='<p class="note">'+esc(t("fRefsNo"))+"</p>";
    else if(!imgs.length)h+='<p class="note">'+esc(t("fRefsNone"))+"</p>";
    else h+='<p class="note">'+esc(t("fRefsHint")(max))+'</p><div class="frefs">'+imgs.map(i=>'<label class="fref"><input type="checkbox" data-ref="'+i.id+'"'+(picked.includes(i.id)?" checked":"")+(!picked.includes(i.id)&&picked.length>=max?" disabled":"")+'><img src="'+esc(i.url)+'" alt=""><span>'+esc(i.label)+"</span></label>").join("")+"</div>";
    if(max&&plan&&plan.parts.length>1)h+='<label class="check"><input type="checkbox" id="fChain"'+(gen().chain?" checked":"")+">"+esc(t("fChain"))+"</label>";
    if(err)h+='<div class="alert">'+esc(err)+"</div>";
    let blocking=!plan||plan.totalUSD===null;
    if(plan){
      h+='<table class="quote"><tbody>'+plan.parts.map(p=>{
        const bad=p.issues.filter(i=>i.blocking);if(bad.length||!p.estimate)blocking=true;
        return "<tr><th>"+esc(t("fPart")(p.part))+"</th><td>"+tc(p.startS)+"–"+tc(p.startS+p.durationS)+" · "+esc(t("fShots")(p.shots))+" · "+(p.done?esc(t("fDone")):p.estimate?esc(money(p.estimate.usd)):"?")
          +(p.extraRefs&&p.extraRefs.length?'<br><span class="rs-sub" style="font-size:11px;opacity:.75">+ '+esc(p.extraRefs.join(" · "))+"</span>":"")
          +(bad.length?'<br><span class="bad">'+esc(bad.map(i=>(t("issue")&&t("issue")[i.code])||i.code).join("; "))+"</span>":"")+"</td></tr>"}).join("")
        +'<tr class="cost"><th>'+esc(t("fTotal"))+"</th><td>"+(plan.totalUSD===null?"?":esc(money(plan.totalUSD)))+"</td></tr></tbody></table>";
      h+='<p class="note">'+esc((plan.parts.length>1?t("fNote"):t("fNote1"))(plan.model.label+" · "+plan.model.providerLabel,plan.resolution))+"</p>";
      h+=plan.parts.map(p=>'<details class="card"><summary>'+esc(t("fPrompt")(p.part,p.promptChars))+"</summary><pre>"+esc(p.prompt)+"</pre></details>").join("");
      for(const o of plan.limits.over)h+='<div class="alert soft">'+esc(t("gOver")[o])+"</div>";
      if(plan.limits.over.length)h+='<label class="check"><input type="checkbox" id="fOver"'+(overOk?" checked":"")+">"+esc(t("gOverOk"))+"</label>";
    }else if(busy)h+='<p class="note">'+esc(t("fWorking"))+"</p>";
    const off=blocking||busy||sending||(plan&&plan.limits.over.length&&!overOk);
    h+='<div class="actions"><button type="button" class="btn" id="fCancel">'+esc(t("gCancel"))+'</button><button type="button" class="btn sun" id="fOk"'+(off?" disabled":"")+">"+esc(sending?t("gSending"):(plan&&plan.parts.length===1?t("fOk1"):t("fOk")(plan?plan.parts.length:"")))+"</button></div>";
    body.innerHTML=h;
  }
  async function open(){
    plan=null;err="";overOk=false;sending=false;imgs=[];loading=true;render();dlg.showModal();
    await loadModels();
    const pr=await api("GET","/api/plugins").catch(()=>null);prompts=pr&&pr.ok?pr.json.plugins.flatMap(p=>(p.prompts||[]).map(x=>["plugin:"+p.id+":"+x.id,x.label+" \u00b7 "+p.name])):[];
    const r=await api("GET","/api/local/images?project="+encodeURIComponent(project())).catch(()=>null);
    // A film of this project that stopped halfway (a part failed) is resumed: its finished parts are kept.
    const jr=await api("GET","/api/jobs").catch(()=>null);resume=null;
    if(jr&&jr.ok){const mine=jr.json.jobs.filter(j=>j.film&&j.title===project()),last=mine[0];
      if(last){const same=mine.filter(j=>j.film.id===last.film.id);if(!same.some(j=>j.film.part===0&&j.status==="done")&&same.some(j=>j.film.part>0&&j.status==="done")&&!same.some(j=>["queued","submitting","generating","downloading"].includes(j.status)))resume=last.film.id}}
    loading=false;
    if(r&&r.ok){const seen=new Set();imgs=r.json.images.filter(i=>i.status==="done"&&i.url&&(i.kind==="reference"||i.kind==="plate")&&!seen.has(i.taskId)&&seen.add(i.taskId)).sort((a,b)=>a.kind===b.kind?a.taskId.localeCompare(b.taskId):a.kind==="reference"?-1:1)}
    ask();
  }
  async function send(){
    if(!plan||sending)return;sending=true;render();
    const g=gen(),r=await api("POST","/api/generate-film",{state:get(),modelId:g.modelId,resolution:g.resolution,audio:g.audio,promptMode:g.promptMode,refs:chosen(),chain:g.chain===true||undefined,resume:resume||undefined,confirmed:true,estimateUSD:plan.totalUSD,confirmOverLimit:overOk}).catch(()=>null);
    sending=false;
    if(r&&r.status===202){dlg.close();if(onSent)onSent();return}
    const e=r&&r.json&&r.json.error;
    if(e==="estimateChanged"||e==="overLimit"||e==="invalid"){plan=r.json.plan||plan;err=t("fErr")[e]||""}
    else err=t("fErr")[e]||t("fErr").failed;
    render();
  }
  body.addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;if(b.id==="fCancel")dlg.close();else if(b.id==="fOk")send()});
  body.addEventListener("change",e=>{
    if(e.target.id==="fOver"){overOk=e.target.checked;return render()}
    if(e.target.id==="fChain"){gen().chain=e.target.checked;save();overOk=false;return ask()}
    if(e.target.id==="fPromptSel"){gen().promptMode=e.target.value;save();overOk=false;return ask()}
    if(!e.target.dataset.ref)return;
    const S=get(),cur=chosen().filter(id=>id!==e.target.dataset.ref);
    if(e.target.checked)cur.push(e.target.dataset.ref);
    {const on=imgs.filter(i=>cur.includes(i.id));S.film={project:project(),refs:on.map(i=>i.id),tasks:on.map(i=>i.taskId)}}save();overOk=false;ask();
  });
  // "Generate video" on a film longer than one generation of the chosen model opens this window instead of the usual one.
  document.addEventListener("click",e=>{
    if(!e.target.closest||!e.target.closest("#gen")||!needs())return;
    e.stopImmediatePropagation();e.preventDefault();open();
  },true);
  // The usual window sends the person here when the film goes with reference images or a plugin writes its prompt.
  document.addEventListener("trsr:film",()=>open());
  loadModels();
  return {refresh(){if(!models.length)loadModels()}};
}
