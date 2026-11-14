import express from "express";
import path from "node:path";
import {existsSync} from "node:fs";
import {splitParts,partState,musicPrompt,imageTasks,imageSize,plain,total,promptFor,type PromptMode,validateForModel,estimateCost,pickSize,fitToModel,resolutionsFor,type State,type ModelEntry} from "@trsr-video/core";
import type {EnvFile} from "./env";
import type {Registry} from "./registry";
import type {JobQueue,Job} from "./jobs";
import {randomUUID} from "node:crypto";
import {type Comfy,localKind} from "./local/comfy";
import type {ImageStore,LocalImage} from "./local/images";
import type {Ffmpeg} from "./local/ffmpeg";
import type {Plugin,PluginModel} from "./plugins";

export interface AppDeps{env:EnvFile;registry:Registry;queue:JobQueue;checkKey?:(provider:string,key:string)=>Promise<{result:"ok"|"invalid"|"unknown";message?:string;balanceUSD?:number}>;webDir?:string;videosDir:string;version:string;local?:{comfy:Comfy;images:ImageStore;ffmpeg:Ffmpeg;cloudImages?:CloudImageModel[];plugins?:Plugin[]}}
/** An image model that runs at a provider (registry/images.json), for people without ComfyUI. */
export interface CloudImageModel{id:string;label:string;provider:string;apiModelId:string;kind:"text"|"edit";steps?:number;pricing:{estimatePerImage:number}}
const LIMITS={perGeneration:"LIMIT_PER_GENERATION_USD",perDay:"LIMIT_PER_DAY_USD"} as const;

export function createApp(d:AppDeps){
  const app=express();
  app.disable("x-powered-by");
  // Local app: only answer requests addressed to this machine, and only JSON bodies
  // (a page on another site cannot send those without permission this server never gives).
  app.use((req,res,next)=>{
    const host=(req.headers.host||"").replace(/:\d+$/,"");
    if(!["127.0.0.1","localhost","[::1]"].includes(host))return void res.status(403).json({error:"forbiddenHost"});
    if(["POST","PUT","DELETE","PATCH"].includes(req.method)&&req.path.startsWith("/api/")&&!/^application\/json/.test(req.headers["content-type"]||""))
      return void res.status(415).json({error:"jsonOnly"});
    next();
  });
  // A music file comes as base64 inside JSON, so this one route takes a bigger body.
  app.use("/api/local/music/upload",express.json({limit:"60mb"}));
  app.use(express.json({limit:"2mb"}));

  const model=(id:unknown)=>d.registry.models.find(m=>m.id===id);
  const pmode=(v:unknown):PromptMode=>v==="full"||v==="compact"?v:"auto";
  const limits=()=>({perGeneration:d.env.number(LIMITS.perGeneration),perDay:d.env.number(LIMITS.perDay),spentToday:d.queue.spentToday()});
  const pub=(j:Job)=>{const {state,...rest}=j;return {...rest,videoUrl:j.videoFile?"/videos/"+j.videoFile:null}};
  const isState=(s:any):s is State=>s&&typeof s==="object"&&Array.isArray(s.shots)&&Array.isArray(s.chars)&&typeof s.aspect==="string";

  // `custom` is a prompt written by a plugin: it replaces the app's own text, and only its length is checked against the model.
  function quote(S:State,m:ModelEntry,resolution:string,audio:boolean,mode:PromptMode="auto",custom?:string){
    const own=promptFor(S,m,mode),pr=custom?{text:custom,kind:"plugin" as typeof own.kind}:own;
    const issues=custom?[...validateForModel(S,m,resolution,mode).filter(i=>!/prompt/i.test(i.code)),...(m.maxPromptChars&&custom.length>m.maxPromptChars?[{code:"promptTooLong",blocking:true} as ReturnType<typeof validateForModel>[number]]:[])]:validateForModel(S,m,resolution,mode),size=pickSize(m,resolution,S.aspect),durationS=+S.dur||0;
    const estimate=estimateCost(m,resolution,durationS),lim=limits(),over:string[]=[];
    if(estimate&&lim.perGeneration!==null&&estimate.usd>lim.perGeneration)over.push("perGeneration");
    if(estimate&&lim.perDay!==null&&lim.spentToday+estimate.usd>lim.perDay)over.push("perDay");
    const needsFit=issues.some(i=>i.code==="shotsDontAddUp"||i.code==="durationNotAllowed"||i.code==="durationTooLong"||i.code==="durationTooShort"||i.code==="durationNotWhole");
    let fit=null;
    if(needsFit)try{const F=fitToModel(S,m);fit={dur:F.dur,lens:F.shots.map(s=>s.len)}}catch{/* too many shots for the model's shortest clip */}
    return {model:{id:m.id,label:m.label,provider:m.provider,providerLabel:d.registry.providers[m.provider].label,sizesNominal:!!m.sizesNominal},resolution,size,durationS,audio:m.audio&&audio,shots:S.shots.length,
      promptChars:pr.text.length,promptKind:pr.kind,prompt:pr.text,estimate,issues,fit,limits:{...lim,over}};
  }

  app.get("/api/health",(_q,res)=>void res.json({ok:true,app:"trsr-video",version:d.version}));
  app.get("/api/models",(_q,res)=>void res.json({
    models:d.registry.models.map(m=>({...m,keyConfigured:d.env.has(d.registry.providers[m.provider].envKey)})),
    providers:Object.entries(d.registry.providers).map(([id,p])=>({id,label:p.label,canCancel:p.capabilities.cancel,...d.env.mask(p.envKey)})),
    limits:limits(),paused:d.queue.paused}));

  app.get("/api/settings",(_q,res)=>void res.json({
    providers:Object.entries(d.registry.providers).map(([id,p])=>({id,label:p.label,envKey:p.envKey,keyHint:p.keyHint||"",docsUrl:p.docsUrl,...d.env.mask(p.envKey)})),limits:limits()}));
  // The key goes into .env and is never sent back: the answer only says that it exists and how it ends.
  app.put("/api/settings/keys",(req,res)=>{
    const p=d.registry.providers[req.body?.provider],key=typeof req.body?.key==="string"?req.body.key.trim():null;
    if(!p||key===null||/\s/.test(key)||key.length>400)return void res.status(400).json({error:"badRequest"});
    d.env.set(p.envKey,key);
    if(d.queue.paused?.provider===req.body.provider)d.queue.resume();
    res.json({provider:req.body.provider,...d.env.mask(p.envKey)});
  });
  // One read-only call to the provider; nothing is generated. The key itself never appears in the answer.
  app.post("/api/settings/keys/test",async(req,res)=>{
    const id=req.body?.provider,p=d.registry.providers[id];
    if(!p)return void res.status(400).json({error:"badRequest"});
    if(!d.env.has(p.envKey))return void res.json({provider:id,result:"noKey"});
    const key=d.env.get(p.envKey);
    const r=d.checkKey?await d.checkKey(id,key):{result:"unknown" as const,message:""};
    const scrub=(s?:string)=>s?key.split(":").concat(key).filter(x=>x.length>=6).reduce((t,x)=>t.split(x).join("***"),s).slice(0,300):undefined;
    res.json({provider:id,result:r.result,message:scrub(r.message),balanceUSD:r.balanceUSD});
  });
  app.put("/api/settings/limits",(req,res)=>{
    for(const k of ["perGeneration","perDay"] as const){
      if(!(k in (req.body||{})))continue;
      const v=req.body[k];
      if(v===null||v===""||v===0)d.env.set(LIMITS[k],"");
      else if(typeof v==="number"&&v>0&&v<100000)d.env.set(LIMITS[k],String(v));
      else return void res.status(400).json({error:"badRequest"});
    }
    res.json(limits());
  });

  app.post("/api/estimate",(req,res)=>{
    const m=model(req.body?.modelId),S=req.body?.state;
    if(!m||!isState(S))return void res.status(400).json({error:"badRequest"});
    res.json(quote(S,m,String(req.body.resolution||""),req.body.audio!==false,pmode(req.body.promptMode)));
  });

  // Nothing is sent to a provider without confirmed:true AND the estimate the person saw.
  app.post("/api/generate",(req,res)=>{
    const b=req.body||{},m=model(b.modelId),S=b.state;
    if(!m||!isState(S))return void res.status(400).json({error:"badRequest"});
    const prov=d.registry.providers[m.provider];
    if(!d.env.has(prov.envKey))return void res.status(409).json({error:"noKey",provider:m.provider});
    const q=quote(S,m,String(b.resolution||""),b.audio!==false,pmode(b.promptMode));
    if(q.issues.some(i=>i.blocking)||!q.estimate||!q.size)return void res.status(422).json({error:"invalid",quote:q});
    if(b.confirmed!==true)return void res.status(400).json({error:"notConfirmed",quote:q});
    if(typeof b.estimateUSD!=="number"||Math.abs(b.estimateUSD-q.estimate.usd)>0.00005)return void res.status(409).json({error:"estimateChanged",quote:q});
    if(q.limits.over.length&&b.confirmOverLimit!==true)return void res.status(409).json({error:"overLimit",quote:q});
    if(total(S)!==q.durationS)return void res.status(422).json({error:"invalid",quote:q});
    const job=d.queue.add({title:(S.title||"").trim()||"Untitled",modelId:m.id,modelLabel:m.label+" · "+prov.label,provider:m.provider,resolution:q.resolution,size:q.size,
      durationS:q.durationS,audio:q.audio,prompt:q.prompt,promptKind:q.promptKind,state:S,estimateUSD:q.estimate.usd,priceAsOf:q.estimate.asOf});
    res.status(202).json(pub(job));
  });

  /* ---------- a film longer than one generation: made in parts, the same references in every part ---------- */
  function filmPlan(b:any):{status:number;body:any;chain?:boolean;m?:ModelEntry;S?:State;ids?:string[];idsByPart?:string[][];quotes?:ReturnType<typeof quote>[];done?:boolean[]}{
    const m=model(b.modelId),S=b.state;
    if(!m||!isState(S))return {status:400,body:{error:"badRequest"}};
    // partS: a shorter limit per part chosen by the person (one scene per part), never longer than the model allows.
    const cap=typeof b.partS==="number"&&b.partS>=m.duration.minS?Math.min(m.duration.maxS,b.partS):m.duration.maxS;
    const parts=splitParts(S,cap,m.duration.minS);
    if(!parts)return {status:422,body:{error:"cannotSplit",maxS:cap,minS:m.duration.minS}};
    const ids:string[]=Array.isArray(b.refs)?b.refs.filter((x:unknown)=>typeof x==="string"):[],max=m.inputs?.referenceImages||0;
    const refs=ids.map(id=>d.local?.images.get(id));
    if(refs.some(r=>!r||r.status!=="done"||!r.file||r.kind==="music"))return {status:404,body:{error:"refNotFound"}};
    // chain:true — each part after the first also gets the last frame of the part before it, and starts from there.
    const chain=b.chain===true&&parts.length>1,room=(k:number)=>max-(chain&&k>0?1:0);
    if(ids.length>(chain?max-1:max))return {status:422,body:{error:max?"tooManyRefs":"refsUnsupported",max}};
    const labels=refs.map(r=>({kind:r!.kind==="plate"?"plate" as const:"reference" as const,label:r!.label}));
    // Plugins may add, to each part, images of the film that only that part needs (the face a character has in one shot)
    // and lines that say what they are for. They take the room the person's own references leave, never more than the model accepts.
    const proj=(S.title||"").trim()||"Untitled",token=m.inputs?.refToken,imgName=(i:number)=>token?token.replace("{n}",String(i+1)):"IMAGE "+(i+1);
    const extra=parts.map((p,k)=>{
      const out:{id:string;task:string;label:string}[]=[],lines:string[]=[];
      if(!max||!d.local)return {out,lines};
      for(const pl of d.local.plugins||[]){
        const x=pl.filmExtras(S,{index:k,count:parts.length,from:p.from,to:p.to});
        for(const r of x.refs){
          const im=d.local.images.latestDone(proj,r.task);
          if(!im||ids.includes(im.id)||out.some(o=>o.id===im.id)||ids.length+out.length>=room(k))continue;
          out.push({id:im.id,task:r.task,label:r.label});
        }
        for(const l of x.lines){
          let ok=true;const t=l.replace(/\{([^}]+)\}/g,(_m,task)=>{const i=out.findIndex(o=>o.task===task);if(i<0){ok=false;return ""}return imgName(ids.length+i)});
          if(ok)lines.push(t);
        }
      }
      return {out,lines};
    });
    const idsByPart=parts.map((_p,k)=>[...ids,...extra[k].out.map(o=>o.id)]);
    const LAST="the last frame of the previous part";
    const labelsOf=(k:number)=>[...labels,...extra[k].out.map(o=>({kind:"reference" as const,label:o.label})),...(chain&&k>0?[{kind:"reference" as const,label:LAST}]:[])];
    if(chain)extra.forEach((x,k)=>{if(k>0)x.lines.push(imgName(idsByPart[k].length)+" is "+LAST+": this part begins exactly on that picture — the same positions, the same objects in the same hands and places, the same light — and goes on from there. It is not a new character and not a new place.")});
    const quotes=parts.map((_p,k)=>{
      const P=partState(S,parts,k,labelsOf(k),token);
      if(extra[k].lines.length)P.refs=[P.refs,...extra[k].lines].filter(Boolean).join("\n");
      // promptMode "plugin:<plugin>:<prompt>": that plugin writes the text of each part, knowing how the images are named.
      const pm=typeof b.promptMode==="string"?/^plugin:([a-z0-9-]+):([a-z0-9-]+)$/.exec(b.promptMode):null,pl=pm?(d.local?.plugins||[]).find(x=>x.id===pm[1]):undefined;
      const custom=pl?pl.buildPrompt(pm![2],S,{part:{index:k,count:parts.length,from:parts[k].from,to:parts[k].to},durationS:parts[k].durationS,totalS:total(S),audio:b.audio!==false,
        refs:labelsOf(k).map((r,i)=>({name:imgName(i),label:r.label,kind:r.kind})),lines:extra[k].lines})||undefined:undefined;
      return quote(P,m,String(b.resolution||""),b.audio!==false,pmode(b.promptMode),custom);
    });
    // Resuming a film: the parts already generated are kept and not paid again; only the others are sent.
    const resume=typeof b.resume==="string"?b.resume:null,prev=resume?d.queue.list().filter(j=>j.film?.id===resume&&(j.film?.part||0)>0):[];
    if(resume&&(!prev.length||prev[0].film!.count!==parts.length||prev.some(j=>j.modelId!==m.id||j.resolution!==quotes[0].resolution)))return {status:409,body:{error:"resumeMismatch"}};
    // redo:[3] makes part 3 again on a film that is resumed, even though it is done: the newest clip of a part is the one joined.
    const redo:number[]=resume&&Array.isArray(b.redo)?b.redo.filter((x:unknown)=>Number.isInteger(x)):[];
    const done=parts.map((_p,k)=>!redo.includes(k+1)&&prev.some(j=>j.film!.part===k+1&&j.status==="done"&&!!j.videoFile)),todo=quotes.filter((_q,k)=>!done[k]);
    const known=todo.every(q=>q.estimate),totalUSD=known?Math.round(todo.reduce((a,q)=>a+q.estimate!.usd,0)*10000)/10000:null;
    const lim=limits(),over:string[]=[];
    if(totalUSD!==null&&lim.perGeneration!==null&&todo.some(q=>q.estimate!.usd>lim.perGeneration!))over.push("perGeneration");
    if(totalUSD!==null&&lim.perDay!==null&&lim.spentToday+totalUSD>lim.perDay)over.push("perDay");
    return {status:200,chain,m,S,ids,idsByPart,quotes,done,body:{resume,chain,model:quotes[0].model,resolution:quotes[0].resolution,size:quotes[0].size,refsMax:max,refs:refs.map(r=>({id:r!.id,label:r!.label,kind:r!.kind})),
      parts:quotes.map((q,k)=>({done:done[k],part:k+1,extraRefs:extra[k].out.map(o=>o.label),startS:parts[k].startS,durationS:q.durationS,shots:q.shots,promptChars:q.promptChars,promptKind:q.promptKind,prompt:q.prompt,estimate:q.estimate,issues:q.issues})),
      totalUSD,limits:{...lim,over}}};
  }
  app.post("/api/estimate-film",(req,res)=>{const p=filmPlan(req.body||{});res.status(p.status).json(p.body)});
  // Same rule as one generation: nothing is sent without confirmed:true AND the total the person saw.
  app.post("/api/generate-film",(req,res)=>{
    const b=req.body||{},p=filmPlan(b);
    if(p.status!==200||!p.m||!p.quotes)return void res.status(p.status).json(p.body);
    const prov=d.registry.providers[p.m.provider];
    if(!d.env.has(prov.envKey))return void res.status(409).json({error:"noKey",provider:p.m.provider});
    if(p.quotes.some(q=>q.issues.some(i=>i.blocking)||!q.estimate||!q.size)||p.body.totalUSD===null)return void res.status(422).json({error:"invalid",plan:p.body});
    if(b.confirmed!==true)return void res.status(400).json({error:"notConfirmed",plan:p.body});
    if(typeof b.estimateUSD!=="number"||Math.abs(b.estimateUSD-(p.body.totalUSD as number))>0.00005)return void res.status(409).json({error:"estimateChanged",plan:p.body});
    if((p.body.limits as any).over.length&&b.confirmOverLimit!==true)return void res.status(409).json({error:"overLimit",plan:p.body});
    const id=p.body.resume||randomUUID(),n=p.quotes.length;
    if(p.done!.every(Boolean))return void res.status(409).json({error:"nothingToDo"});
    const jobs=p.quotes.map((q,k)=>p.done![k]?null:d.queue.add({title:(p.S!.title||"").trim()||"Untitled",modelId:p.m!.id,modelLabel:p.m!.label+" · "+prov.label+(n>1?" · part "+(k+1)+"/"+n:""),provider:p.m!.provider,resolution:q.resolution,size:q.size!,
      durationS:q.durationS,audio:q.audio,prompt:q.prompt,promptKind:q.promptKind,state:p.S!,estimateUSD:q.estimate!.usd,priceAsOf:q.estimate!.asOf,film:n>1?{id,part:k+1,count:n}:undefined,refImages:p.idsByPart![k].length?p.idsByPart![k]:undefined,chain:p.chain&&k>0?true:undefined})).filter((j):j is Job=>!!j);
    res.status(202).json({filmId:id,jobs:jobs.map(pub)});
  });

  // The parts of a film joined again (the newest clip of each part): no generation, no cost.
  app.post("/api/films/:id/join",async(req,res)=>{const ok=await d.queue.rejoin(req.params.id);res.status(ok?201:404).json(ok?{joined:true}:{error:"notFound"})});
  app.get("/api/jobs",(_q,res)=>void res.json({jobs:d.queue.list().map(pub),paused:d.queue.paused,spentToday:d.queue.spentToday()}));
  app.get("/api/jobs/:id",(req,res)=>{const j=d.queue.get(req.params.id);j?res.json({...pub(j),state:j.state}):res.status(404).json({error:"notFound"})});
  app.post("/api/jobs/:id/cancel",async(req,res)=>{
    const r=await d.queue.cancel(req.params.id);
    if(r==="notFound")return void res.status(404).json({error:r});
    if(r==="canceled")return void res.json(pub(d.queue.get(req.params.id)!));
    res.status(409).json({error:r});
  });
  app.post("/api/queue/resume",(_q,res)=>{d.queue.resume();res.json({paused:d.queue.paused})});

  /* ---------- images made on this computer (ComfyUI): free, so no cost window ---------- */
  if(d.local){
    const {comfy,images,ffmpeg}=d.local,cloud=d.local.cloudImages||[];
    const cloudKey=(c:CloudImageModel)=>d.env.has(d.registry.providers[c.provider]?.envKey||"");
    const project=(S:State)=>(S.title||"").trim()||"Untitled";
    const pubI=(i:LocalImage)=>({...i,url:i.file?"/images/"+i.file:null});
    // What can make images: the models ComfyUI has on this computer, and the cloud models whose key is saved.
    app.get("/api/local/status",async(_q,res)=>{
      const st=await comfy.status();
      res.json({...st,ffmpeg:await ffmpeg.available(),models:[...st.models.map(m=>({...m,cloud:false})),
        ...cloud.map(c=>({id:c.id,label:c.label,kind:c.kind,available:cloudKey(c),missing:[],files:[],note:"≈ $"+c.pricing.estimatePerImage,cloud:true,provider:c.provider,providerLabel:d.registry.providers[c.provider]?.label||c.provider,estimateUSD:c.pricing.estimatePerImage}))]});
    });
    /* ---------- plugins: extra images of the film (a reference sheet, for instance), made in the cloud with the person's OK ---------- */
    const plugins=d.local.plugins||[];
    const plugKey=(m:PluginModel)=>d.env.has(d.registry.providers[m.provider]?.envKey||"");
    const provLabel=(p:string)=>d.registry.providers[p]?.label||p;
    const dim=(v:unknown):v is number=>Number.isInteger(v)&&(v as number)>=128&&(v as number)<=8192;
    const size=(t:{width?:number;height?:number},m:PluginModel)=>dim(t.width)&&dim(t.height)?{width:t.width,height:t.height}:{width:m.width,height:m.height};
    app.get("/api/plugins",(_q,res)=>void res.json({plugins:plugins.map(p=>({id:p.id,name:p.name,version:p.version,web:p.web?"/plugins/"+p.id+"/"+p.web:null,
      imageModels:p.imageModels.map(m=>({id:m.id,label:m.label,provider:m.provider,providerLabel:provLabel(m.provider),estimateUSD:m.estimateUSD,maxRefs:m.maxRefs,available:plugKey(m)})),prompts:p.prompts}))}));
    app.post("/api/plugins/:id/tasks",(req,res)=>{
      const p=plugins.find(x=>x.id===req.params.id),S=(req.body||{}).state;
      if(!p)return void res.status(404).json({error:"notFound"});
      if(!isState(S))return void res.status(400).json({error:"badRequest"});
      res.json({tasks:p.imageTasks(S)});
    });
    // The plugin says what to draw; the app draws it. Same rule as a cloud image of the app: it costs money, so it needs the OK.
    app.post("/api/plugins/:id/images",(req,res)=>{
      const p=plugins.find(x=>x.id===req.params.id),b=req.body||{},S=b.state;
      if(!p)return void res.status(404).json({error:"notFound"});
      if(!isState(S)||typeof b.taskId!=="string"||typeof b.modelId!=="string")return void res.status(400).json({error:"badRequest"});
      const task=p.imageTasks(S).find(t=>t.id===b.taskId),m=p.imageModels.find(x=>x.id===b.modelId);
      if(!task||!m)return void res.status(404).json({error:"notFound"});
      if(task.upload)return void res.status(422).json({error:"uploadOnly"});
      if(!task.prompt.trim())return void res.status(422).json({error:"emptyPrompt"});
      if(task.needs.length>m.maxRefs)return void res.status(422).json({error:"tooManyRefs",max:m.maxRefs});
      if(!plugKey(m))return void res.status(409).json({error:"noKey",provider:m.provider});
      if(b.confirmed!==true)return void res.status(400).json({error:"notConfirmed",estimateUSD:m.estimateUSD});
      const refs=task.needs.map(n=>images.latestDone(project(S),n)),lacking=task.needs.filter((_n,i)=>!refs[i]);
      if(lacking.length)return void res.status(409).json({error:"missingRefs",missing:lacking});
      res.status(202).json(pubI(images.add({project:project(S),taskId:task.id,kind:task.kind,label:task.label,modelId:m.id,modelLabel:m.label+" · "+provLabel(m.provider),prompt:task.prompt,...size(task,m),refs:refs.map(r=>r!.id)})));
    });
    // A page the plugin's page part put together from images of the film (panels, labels, palette): no provider, no cost.
    // It is only taken for a task the plugin marks as upload, and only when every image it is built from exists.
    app.post("/api/plugins/:id/pages",(req,res)=>{
      const p=plugins.find(x=>x.id===req.params.id),b=req.body||{},S=b.state;
      if(!p)return void res.status(404).json({error:"notFound"});
      if(!isState(S)||typeof b.taskId!=="string"||typeof b.image!=="string")return void res.status(400).json({error:"badRequest"});
      const task=p.imageTasks(S).find(t=>t.id===b.taskId);
      if(!task||!task.upload)return void res.status(404).json({error:"notFound"});
      const mt=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(b.image);
      if(!mt)return void res.status(400).json({error:"badImage"});
      const bytes=Buffer.from(mt[2],"base64"),jpg=bytes[0]===0xff&&bytes[1]===0xd8,png=bytes[0]===0x89&&bytes[1]===0x50;
      if(bytes.length<100||(mt[1]==="jpeg"?!jpg:!png))return void res.status(400).json({error:"badImage"});
      const refs=task.needs.map(n=>images.latestDone(project(S),n)),lacking=task.needs.filter((_n,i)=>!refs[i]);
      if(lacking.length)return void res.status(409).json({error:"missingRefs",missing:lacking});
      const w=Number.isInteger(b.width)&&b.width>0&&b.width<=8192?b.width:0,h=Number.isInteger(b.height)&&b.height>0&&b.height<=8192?b.height:0;
      res.status(201).json(pubI(images.addDone({project:project(S),taskId:task.id,kind:task.kind,label:task.label,modelLabel:p.name+" "+p.version,ext:jpg?"jpg":"png",bytes,width:w,height:h,refs:refs.map(r=>r!.id)})));
    });
    // The page part of a plugin: only the one file its plugin.json names.
    app.get("/plugins/:id/:file",(req,res)=>{
      const p=plugins.find(x=>x.id===req.params.id);
      if(!p||!p.web||req.params.file!==p.web)return void res.status(404).end();
      res.type("application/javascript").sendFile(path.join(p.dir,p.web));
    });
    app.get("/api/local/images",(req,res)=>void res.json({images:images.list(typeof req.query.project==="string"?req.query.project:undefined).filter(i=>i.kind!=="music").map(pubI)}));
    // The prompt is built here from the film, the same text the "per shot + keyframes" prompt shows.
    app.post("/api/local/images",async(req,res)=>{
      const b=req.body||{},S=b.state;
      if(!isState(S)||typeof b.taskId!=="string"||typeof b.modelId!=="string")return void res.status(400).json({error:"badRequest"});
      const task=imageTasks(S).find(t=>t.id===b.taskId);
      if(!task)return void res.status(404).json({error:"notFound"});
      if(task.unsupported)return void res.status(422).json({error:task.unsupported});
      if(!task.prompt.trim())return void res.status(422).json({error:"emptyPrompt"});
      const cm=cloud.find(c=>c.id===b.modelId);
      if((cm?cm.kind:localKind(b.modelId))!==(task.kind==="keyframe"?"edit":"text"))return void res.status(422).json({error:"wrongModel"});
      if(cm){
        // A cloud image costs money: like a video, it is only sent with the person's OK.
        if(!cloudKey(cm))return void res.status(409).json({error:"noKey",provider:cm.provider});
        if(b.confirmed!==true)return void res.status(400).json({error:"notConfirmed",estimateUSD:cm.pricing.estimatePerImage});
      }else{
        const st=await comfy.status();
        if(!st.reachable)return void res.status(503).json({error:"unreachable",url:st.url});
        const m=st.models.find(x=>x.id===b.modelId);
        if(!m||!m.available)return void res.status(409).json({error:"modelMissing",missing:m?m.missing:[]});
      }
      const refs=task.needs.map(n=>images.latestDone(project(S),n)),lacking=task.needs.filter((_n,i)=>!refs[i]);
      if(lacking.length)return void res.status(409).json({error:"missingRefs",missing:lacking});
      const [width,height]=imageSize(S.aspect);
      const seed=Number.isInteger(b.seed)&&b.seed>=0?b.seed:undefined;
      res.status(202).json(pubI(images.add({project:project(S),taskId:task.id,kind:task.kind,label:task.label,modelId:b.modelId,modelLabel:cm?cm.label+" · "+(d.registry.providers[cm.provider]?.label||cm.provider):undefined,prompt:task.prompt,width,height,refs:refs.map(r=>r!.id),seed})));
    });
    app.post("/api/local/images/:id/cancel",async(req,res)=>{
      const r=await images.cancel(req.params.id);
      if(r==="notFound")return void res.status(404).json({error:r});
      if(r==="tooLate")return void res.status(409).json({error:r});
      res.json(pubI(images.get(req.params.id)!));
    });
    /* ---------- music: made here to the tone of the film, or a file the person brings ---------- */
    const AUDIO=["mp3","wav","flac","ogg","m4a","aac"];
    app.get("/api/local/music",(req,res)=>void res.json({music:images.list(typeof req.query.project==="string"?req.query.project:undefined).filter(i=>i.kind==="music").map(pubI)}));
    app.post("/api/local/music",async(req,res)=>{
      const b=req.body||{},S=b.state;
      if(!isState(S)||(b.prompt!==undefined&&typeof b.prompt!=="string"))return void res.status(400).json({error:"badRequest"});
      const st=await comfy.status();
      if(!st.reachable)return void res.status(503).json({error:"unreachable",url:st.url});
      const m=st.models.find(x=>x.kind==="audio");
      if(!m||!m.available)return void res.status(409).json({error:"modelMissing",missing:m?m.missing:[]});
      const mp=musicPrompt(S,typeof b.prompt==="string"?b.prompt.slice(0,1500):undefined);
      const seed=Number.isInteger(b.seed)&&b.seed>=0?b.seed:undefined;
      res.status(202).json(pubI(images.add({project:project(S),taskId:"music",kind:"music",label:S.genre+" · "+mp.bpm+" BPM",modelId:m.id,prompt:mp.text,width:0,height:0,refs:[],seconds:mp.seconds,seed})));
    });
    app.post("/api/local/music/upload",(req,res)=>{
      const b=req.body||{},name=typeof b.name==="string"?b.name.trim().slice(0,120):"",ext=(name.split(".").pop()||"").toLowerCase();
      if(typeof b.project!=="string"||!b.project.trim()||!name||typeof b.data!=="string")return void res.status(400).json({error:"badRequest"});
      if(!AUDIO.includes(ext))return void res.status(415).json({error:"notAudio",allowed:AUDIO});
      const bytes=Buffer.from(b.data,"base64");
      if(!bytes.length||bytes.length>40*1024*1024)return void res.status(413).json({error:"tooBig"});
      res.status(201).json(pubI(images.addFile({project:b.project.trim(),label:name,ext,bytes})));
    });
    // The music goes under the video's own sound; the picture is copied untouched. The original MP4 stays as it is.
    app.post("/api/jobs/:id/mix",async(req,res)=>{
      const j=d.queue.get(req.params.id),mu=images.get(String(req.body?.musicId||""));
      if(!j||!j.videoFile||!mu||mu.kind!=="music"||mu.status!=="done"||!mu.file)return void res.status(404).json({error:"notFound"});
      if(!(await ffmpeg.available()))return void res.status(409).json({error:"noFfmpeg"});
      const v=typeof req.body.volume==="number"?Math.max(0.05,Math.min(1.5,req.body.volume)):0.6,out=j.id+"-music.mp4";
      try{await ffmpeg.mix(path.join(d.videosDir,j.videoFile),path.join(images.dir,mu.file),path.join(d.videosDir,out),{volume:v,durationS:j.durationS})}
      catch(e){return void res.status(500).json({error:"mixFailed",message:String((e as Error).message).slice(0,300)})}
      res.json({url:"/videos/"+out,name:(j.title||"video").replace(/[^\w.-]+/g,"_")+"-music.mp4"});
    });
    app.use("/images",express.static(images.dir,{fallthrough:false,index:false}));
  }

  app.use("/videos",express.static(d.videosDir,{fallthrough:false,index:false}));
  if(d.webDir&&existsSync(path.join(d.webDir,"index.html")))app.use(express.static(d.webDir));
  else app.get("/",(_q,res)=>void res.type("text/plain").send("TRSR Video server is running. Build the interface with: npm run build"));
  app.use("/api",(_q,res)=>void res.status(404).json({error:"notFound"}));
  return app;
}
export {resolutionsFor};
