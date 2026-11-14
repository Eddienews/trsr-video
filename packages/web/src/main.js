import * as core from "@trsr-video/core";
import {T} from "./i18n.js";
import {G} from "./i18n-generate.js";
import {initGenerate} from "./generate.js";
import {initImages} from "./images.js";
import {I} from "./i18n-images.js";
import {initMusic} from "./music.js";
import {M} from "./i18n-music.js";
import {initFilm} from "./film.js";
import {initPlugins} from "./plugins.js";
import {F} from "./i18n-film.js";
Object.assign(T.pt,G.pt,I.pt,M.pt,F.pt);Object.assign(T.en,G.en,I.en,M.en,F.en);
let gen=null;
import {initUi} from "./ui.js";
initUi();
const {GENRES,DIALOGUE,STYLES,LIGHTS,blank,example,num,fmt,cName}=core;

/* ---------- state ---------- */
const KEY="nwl-animation-prompt-v1";
let S;
try{S=Object.assign(blank(),JSON.parse(localStorage.getItem(KEY)||"null")||{})}catch(e){S=blank()}
// Older versions saved a shot's length as text ("5"): read it back as a number.
(S.shots||[]).forEach(s=>{if(typeof s.len==="string"&&s.len.trim()!==""&&isFinite(+s.len))s.len=+s.len});
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}};

/* ---------- helpers ---------- */
const $=s=>document.querySelector(s);
const t=k=>T[S.lang][k];
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

/* ---------- the prompt builder lives in packages/core; these bind it to the current state ---------- */
const spans=()=>core.spans(S),total=()=>core.total(S),named=()=>core.named(S),lightOk=()=>core.lightOk(S);
const blocks=()=>core.blocks(S),plain=()=>core.plain(S),metaPrompt=()=>core.metaPrompt(S),checks=()=>core.checks(S);

// Where each check sends the cursor when clicked.
const FIX={k1:'[data-k="logline"]',k2:"#chars",k3:'[data-k="location"]',k4:'[data-k="blocking"]',k5:'[data-k="scale"]',k6:'[data-k="firstFrame"]',
  k7:"#shotsStep",k8:"#shotsStep",k9:"#shotsStep",k10:'[data-k="style"]',k11:"#shotsStep",k12:"#lightPreset"};
function goFix(k){
  const el=$(FIX[k]);if(!el)return;
  if(window.trsrShow)window.trsrShow(el);
  el.scrollIntoView({block:"center"});el.classList.add("miss");setTimeout(()=>el.classList.remove("miss"),1800);
  const f=el.matches("input,textarea,select")?el:el.querySelector("textarea,input");if(f)f.focus({preventScroll:true});
}
function copyLabels(){
  const miss=checks().filter(c=>!c[0]).length;
  ["#copy","#copy2"].forEach(id=>{const b=$(id);b.textContent=miss?t("copyMiss")(miss):t("copy");b.classList.toggle("warnb",!!miss);b.classList.toggle("sun",!miss)});
}

/* ---------- rendering ---------- */
const SF=["style","surface","physics"],LF=["lighting","grade"];
// Text that is not exactly a preset's (or a preset that does not exist) is "custom": the select says so instead of naming a preset.
function custom(map,key,fields){const p=map[key];return !p||fields.some(f=>String(S[f]||"").trim()&&S[f]!==p[f])}
function popts(id,map,val,fields){const c=custom(map,val,fields);$(id).innerHTML=(c?'<option value="" selected>'+esc(t("customOpt"))+"</option>":"")+Object.keys(map).map(k=>'<option value="'+k+'"'+(!c&&k===val?" selected":"")+">"+esc(map[k][S.lang])+"</option>").join("")}
function pick(kind,key,map,fields){
  const was=prev[kind],n=map[S[key]];
  if(!n){S[key]=was;renderStatic();return}
  if(custom(map,was,fields)&&fields.some(f=>String(S[f]||"").trim())){
    if(!confirm(t("confirmPreset"))){S[key]=was;renderStatic();return}
    fields.forEach(f=>S[f]=n[f]);
  }else{const o=map[was]||{};fields.forEach(f=>swap(f,o[f],n[f]))}
  prev[kind]=S[key];renderStatic();
}
// Every label that sits right before its field is tied to it, so the field has a name for screen readers.
let lblN=0;
function linkLabels(){document.querySelectorAll("label:not([for])").forEach(l=>{if(l.querySelector("input,select,textarea"))return;const c=l.nextElementSibling;if(!c||!/^(INPUT|TEXTAREA|SELECT)$/.test(c.tagName))return;if(!c.id)c.id="fld-"+(++lblN);l.htmlFor=c.id})}
new MutationObserver(()=>linkLabels()).observe(document.body,{childList:true,subtree:true});
function opts(id,map,val){$(id).innerHTML=Object.keys(map).map(k=>'<option value="'+k+'"'+(k===val?" selected":"")+">"+esc(map[k][S.lang])+"</option>").join("")}
function renderStatic(){
  document.documentElement.lang=S.lang==="pt"?"pt-BR":"en";
  document.title="TRSR Video | "+t("h1");
  document.querySelectorAll("[data-t]").forEach(e=>e.textContent=t(e.dataset.t));
  document.querySelectorAll("[data-ph]").forEach(e=>e.placeholder=t(e.dataset.ph));
  document.querySelectorAll("[data-lang]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.lang===S.lang));
  opts("#genre",GENRES,S.genre);opts("#dialogue",DIALOGUE,S.dialogue);popts("#stylePreset",STYLES,S.stylePreset,SF);popts("#lightPreset",LIGHTS,S.lightPreset,LF);
  document.querySelectorAll("[data-k]").forEach(e=>{if(e.tagName!=="SELECT"||e.dataset.k==="aspect")e.value=S[e.dataset.k]});
  renderToneNote();linkLabels();
}
function fld(list,i,f,label,ph,tag,extra){
  const v=esc(S[list][i][f]),a='data-list="'+list+'" data-i="'+i+'" data-f="'+f+'" placeholder="'+esc(ph||"")+'" '+(extra||"");
  return "<div><label>"+esc(label)+"</label>"+(tag==="ta"?"<textarea rows=\"3\" "+a+">"+v+"</textarea>":'<input value="'+v+'" '+a+">")+"</div>";
}
function renderLists(){
  $("#chars").innerHTML=S.chars.map((c,i)=>'<div class="item char"><div class="item-head"><strong>'+esc(t("char"))+" "+(i+1)+"</strong>"+(S.chars.length>1?'<button type="button" class="btn sm" data-del="chars" data-i="'+i+'">'+esc(t("remove"))+"</button>":"")+"</div>"
    +'<div class="row">'+fld("chars",i,"name",t("cName"),t("cNamePh"))+fld("chars",i,"nick",t("cNick"),t("cNickPh"))+"</div>"
    +fld("chars",i,"look",t("cLook"),t("cLookPh"))+fld("chars",i,"ward",t("cWard"),t("cWardPh"))+fld("chars",i,"prop",t("cProp"),t("cPropPh"))+fld("chars",i,"pers",t("cPers"),t("cPersPh"))+"</div>").join("");
  $("#shots").innerHTML=S.shots.map((s,i)=>'<div class="item" id="shot'+i+'"><div class="item-head"><strong>'+esc(t("shot"))+" "+(i+1)+' <span data-range="'+i+'"></span></strong>'+(S.shots.length>1?'<button type="button" class="btn sm" data-del="shots" data-i="'+i+'">'+esc(t("remove"))+"</button>":"")+"</div>"
    +'<div class="row3">'+fld("shots",i,"len",t("sLen"),"","in",'type="number" min="0.5" max="30" step="0.5" inputmode="decimal"')+fld("shots",i,"lens",t("sLens"),"35mm wide","in",'list="lenses"')+fld("shots",i,"move",t("sMove"),"LOCKED.","in",'list="moves"')+"</div>"
    +fld("shots",i,"act",t("sAct"),t("sActPh"),"ta")
    +"<label>"+esc(t("sWho"))+"</label><div class=\"who\">"+(named().length?named().map(([c,ci])=>'<label><input type="checkbox" data-who="'+i+'" data-ci="'+ci+'"'+((s.who||[]).includes(ci)?" checked":"")+">"+esc(cName(c))+"</label>").join(""):'<span class="none">'+esc(t("sWhoNone"))+"</span>")+"</div>"
    +plateSel(s,i)
    +'<div class="row">'+fld("shots",i,"start",t("sStart")+" ("+t("sKfS")+")",t("sStartPh"),"ta")+fld("shots",i,"end",t("sEnd"),t("sEndPh"),"ta")+"</div>"
    +"</div>").join("");
  S.plates=S.plates||[];
  $("#plates").innerHTML=S.plates.map((p,i)=>'<div class="item char" style="border-left-color:var(--dusk)"><div class="item-head"><strong>'+esc(t("plate"))+" "+(i+1)+'</strong><button type="button" class="btn sm" data-del="plates" data-i="'+i+'">'+esc(t("remove"))+"</button></div>"
    +fld("plates",i,"name",t("pName"),t("pNamePh"))+fld("plates",i,"desc",t("pDesc"),t("pDescPh"),"ta")+"</div>").join("");
}
function plateSel(s,i){
  const pl=(S.plates||[]).filter(p=>(p.name+p.desc).trim());
  if(!pl.length)return "";
  const cur=+(s.plate??-1);
  return "<label>"+esc(t("sPlate"))+'</label><select data-list="shots" data-i="'+i+'" data-f="plate"><option value="-1">'+esc(t("sPlateDefault"))+"</option>"
    +pl.map((p,j)=>'<option value="'+j+'"'+(cur===j?" selected":"")+">"+esc((p.name.trim()||t("plate")+" "+(j+1)).toUpperCase())+"</option>").join("")+"</select>";
}
function renderLive(){
  const sp=spans(),tot=total(),d=+S.dur||0;
  document.querySelectorAll("[data-range]").forEach(e=>{const x=sp[+e.dataset.range];e.textContent=x?"("+fmt(x[0])+"–"+fmt(x[1])+")":""});
  $("#strip").innerHTML=S.shots.map((s,i)=>'<button type="button" data-go="'+i+'" style="flex:'+Math.max(num(s.len),.5)+' 1 0" aria-label="'+esc(t("shot"))+" "+(i+1)+'"><b>'+(i+1)+"</b><span>"+fmt(sp[i][0])+"</span><em>"+esc(s.lens||"")+"</em></button>").join("")+(tot<d?'<span class="gap" style="flex:'+(d-tot)+' 1 0"></span>':"");
  // Time ruler above the clips: a tick per second, a label every 5.
  const rl=$("#ruler");if(rl){const n=Math.max(1,Math.ceil(Math.max(d,tot))),step=n>40?10:5;rl.innerHTML=Array.from({length:n+1},(_,k)=>'<i style="left:'+(k/n*100)+'%"'+(k%step===0?' class="maj"><b>'+fmt(k)+"</b>":">")+"</i>").join("")}
  const sum=$("#sum");sum.textContent=(tot===d?t("sumOk"):t("sumBad"))(tot,d);sum.classList.toggle("bad",tot!==d);
  const ck=checks();
  $("#checks").innerHTML=ck.map(([ok,k])=>"<li"+(ok?' class="ok"':"")+">"+(ok?esc(t(k)):'<button type="button" data-fix="'+k+'">'+esc(t(k))+"</button>")+"</li>").join("");
  $("#score").textContent=t("score")(ck.filter(c=>c[0]).length,ck.length);
  document.querySelectorAll("[data-mode]").forEach(b=>b.setAttribute("aria-selected",b.dataset.mode===(S.mode||"full")));
  $("#tabhint").textContent=(lightOk()?"":t("lightWarn")+" ")+t(S.mode==="shots"?"hintShots":"hintFull");
  $("#prompt").innerHTML=blocks().map(([h,l])=>'<span class="h">==== '+esc(h)+" ====</span>"+(l.length?"\n"+esc(l.join("\n")):"")).join("\n\n");
  copyLabels();
  save();
  if(gen){gen.refresh();if(gen.images)gen.images.refresh();if(gen.plugins)gen.plugins.refresh();if(gen.music)gen.music.refresh()}
}
function renderAll(){renderStatic();renderLists();renderLive()}

/* ---------- events ---------- */
function swap(field,oldV,newV){if(!S[field].trim()||S[field]===oldV)S[field]=newV}
let toneKept=false;
function renderToneNote(){
  const el=$("#toneNote");if(!el)return;
  const g=GENRES[S.genre],show=toneKept&&!!g&&S.performance!==g.perf;
  el.hidden=!show;
  el.innerHTML=show?esc(t("toneKept")(g[S.lang]||g.en))+' <button type="button" id="tonePerf">'+esc(t("toneUse"))+"</button>":"";
}
let prev={style:S.stylePreset,light:S.lightPreset,genre:S.genre};
document.addEventListener("input",e=>{
  const el=e.target;
  if(el.dataset.who!==undefined){
    const sh=S.shots[+el.dataset.who],ci=+el.dataset.ci;sh.who=(sh.who||[]).filter(x=>x!==ci);
    if(el.checked)sh.who.push(ci);sh.who.sort((a,b)=>a-b);renderLive();return;
  }
  if(el.dataset.k){
    const k=el.dataset.k;S[k]=k==="dur"?(parseInt(el.value)||0):el.value;
    if(k==="stylePreset")pick("style","stylePreset",STYLES,SF);
    if(k==="lightPreset")pick("light","lightPreset",LIGHTS,LF);
    if(SF.includes(k))popts("#stylePreset",STYLES,S.stylePreset,SF);
    if(LF.includes(k))popts("#lightPreset",LIGHTS,S.lightPreset,LF);
    // A performance text written by hand is kept on a tone change, but the person is told and can take the new tone's text.
    if(k==="genre"){const neu=GENRES[S.genre].perf;swap("performance",(GENRES[prev.genre]||{}).perf,neu);toneKept=S.performance!==neu;prev.genre=S.genre;renderStatic()}
  }else if(el.dataset.list){
    const v=el.value,isLen=el.dataset.list==="shots"&&el.dataset.f==="len";
    S[el.dataset.list][+el.dataset.i][el.dataset.f]=isLen&&v.trim()!==""&&isFinite(+v)?+v:v;
    // A new or renamed character must show up in the shots' "who" boxes.
    if((el.dataset.list==="chars"&&el.dataset.f==="name")||el.dataset.list==="plates"){const a=document.activeElement,id=[a.dataset.list,a.dataset.i,a.dataset.f],pos=a.selectionStart;renderLists();const b=document.querySelector('[data-list="'+id[0]+'"][data-i="'+id[1]+'"][data-f="'+id[2]+'"]');if(b){b.focus();try{b.setSelectionRange(pos,pos)}catch(_){}}}
  }
  else return;
  renderLive();
});
async function copyText(txt,btn,doneKey,baseKey){
  try{await navigator.clipboard.writeText(txt)}catch(e){const ta=document.createElement("textarea");ta.value=txt;document.body.appendChild(ta);ta.select();try{document.execCommand("copy")}catch(_){}ta.remove()}
  btn.textContent=t(doneKey);setTimeout(()=>{btn.textContent=t(baseKey);copyLabels()},1600);
}
document.addEventListener("click",e=>{
  const b=e.target.closest("button");if(!b)return;
  if(b.dataset.lang){S.lang=b.dataset.lang;renderAll();return}
  if(b.dataset.fix){goFix(b.dataset.fix);return}
  if(b.dataset.mode){S.mode=b.dataset.mode;renderLive();return}
  if(b.dataset.del){
    const i=+b.dataset.i;S[b.dataset.del].splice(i,1);
    if(b.dataset.del==="chars")S.shots.forEach(sh=>sh.who=(sh.who||[]).filter(x=>x!==i).map(x=>x>i?x-1:x));
    if(b.dataset.del==="plates")S.shots.forEach(sh=>{const v=+(sh.plate??-1);sh.plate=v===i?-1:v>i?v-1:v});
    renderLists();renderLive();return}
  if(b.dataset.go){const el=$("#shot"+b.dataset.go);if(el){if(window.trsrShow)window.trsrShow(el);el.scrollIntoView({block:"center"});const ta=el.querySelector("textarea");if(ta)ta.focus({preventScroll:true})}return}
  switch(b.id){
    case "tonePerf":{const g=GENRES[S.genre];if(g)S.performance=g.perf;toneKept=false;renderStatic();renderLive();break}
    case "addPlate":S.plates=S.plates||[];S.plates.push({name:"",desc:""});renderLists();renderLive();break;
    case "addChar":S.chars.push({name:"",nick:"",look:"",ward:"",prop:"",pers:""});renderLists();renderLive();break;
    case "addShot":{const left=Math.max(1,Math.min(8,(+S.dur||0)-total()));S.shots.push({len:left,lens:"50mm medium",move:"LOCKED.",act:"",who:[],start:"",end:""});renderLists();renderLive();break}
    case "even":{const n=S.shots.length,base=Math.floor((+S.dur||0)/n*2)/2;S.shots.forEach(s=>s.len=base);S.shots[n-1].len=num((+S.dur||0)-base*(n-1));renderLists();renderLive();break}
    case "example":{const l=S.lang;S=example();S.lang=l;prev={style:S.stylePreset,light:S.lightPreset,genre:S.genre};renderAll();break}
    case "reset":if(confirm(t("confirmReset"))){const l=S.lang;S=blank();S.lang=l;prev={style:S.stylePreset,light:S.lightPreset,genre:S.genre};renderAll()}break;
    case "copy":case "copy2":copyText(plain(),b,"copied","copy");break;
    case "meta":copyText(metaPrompt(),b,"metaDone","meta");break;
    case "see":if(window.trsrShow)window.trsrShow($("#prompt"));$("#out").scrollIntoView();break;
    case "dl":{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([plain()],{type:"text/plain"}));a.download=(S.title.trim().toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"animation-prompt")+(S.mode==="shots"?"-per-shot":"")+".txt";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);break}
  }
});
renderAll();

/* ---------- generation, settings and library (talks to the local server) ---------- */
gen=initGenerate({
  get:()=>S,t,esc,
  // Put a state into the form: from "rescale" or from a past generation.
  apply(next){const l=S.lang,g=S.gen;S=Object.assign(blank(),next);S.lang=l;if(g&&!next.gen)S.gen=g;prev={style:S.stylePreset,light:S.lightPreset,genre:S.genre};renderAll()},
  save
});
// Images made on this computer (ComfyUI): the tab only appears when the local server answers.
gen.images=initImages({get:()=>S,t,esc,save,showStill:gen.showStill});
gen.music=initMusic({get:()=>S,t,esc,save});
gen.plugins=initPlugins({get:()=>S,esc,save,showStill:gen.showStill});
// A film longer than one generation of the chosen model is generated in parts.
gen.film=initFilm({get:()=>S,t,esc,save,onSent:()=>{gen.poll();if(window.trsrShow)window.trsrShow(document.querySelector("#lib"))}});
