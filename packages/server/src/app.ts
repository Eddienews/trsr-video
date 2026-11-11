import express from "express";
import path from "node:path";
import {existsSync} from "node:fs";
import {plain,total,promptFor,type PromptMode,validateForModel,estimateCost,pickSize,fitToModel,resolutionsFor,type State,type ModelEntry} from "@trsr-video/core";
import type {EnvFile} from "./env";
import type {Registry} from "./registry";
import type {JobQueue,Job} from "./jobs";

export interface AppDeps{env:EnvFile;registry:Registry;queue:JobQueue;checkKey?:(provider:string,key:string)=>Promise<{result:"ok"|"invalid"|"unknown";message?:string;balanceUSD?:number}>;webDir?:string;videosDir:string;version:string}
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
  app.use(express.json({limit:"2mb"}));

  const model=(id:unknown)=>d.registry.models.find(m=>m.id===id);
  const pmode=(v:unknown):PromptMode=>v==="full"||v==="compact"?v:"auto";
  const limits=()=>({perGeneration:d.env.number(LIMITS.perGeneration),perDay:d.env.number(LIMITS.perDay),spentToday:d.queue.spentToday()});
  const pub=(j:Job)=>{const {state,...rest}=j;return {...rest,videoUrl:j.videoFile?"/videos/"+j.videoFile:null}};
  const isState=(s:any):s is State=>s&&typeof s==="object"&&Array.isArray(s.shots)&&Array.isArray(s.chars)&&typeof s.aspect==="string";

  function quote(S:State,m:ModelEntry,resolution:string,audio:boolean,mode:PromptMode="auto"){
    const pr=promptFor(S,m,mode),issues=validateForModel(S,m,resolution,mode),size=pickSize(m,resolution,S.aspect),durationS=+S.dur||0;
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

  app.get("/api/jobs",(_q,res)=>void res.json({jobs:d.queue.list().map(pub),paused:d.queue.paused,spentToday:d.queue.spentToday()}));
  app.get("/api/jobs/:id",(req,res)=>{const j=d.queue.get(req.params.id);j?res.json({...pub(j),state:j.state}):res.status(404).json({error:"notFound"})});
  app.post("/api/jobs/:id/cancel",async(req,res)=>{
    const r=await d.queue.cancel(req.params.id);
    if(r==="notFound")return void res.status(404).json({error:r});
    if(r==="canceled")return void res.json(pub(d.queue.get(req.params.id)!));
    res.status(409).json({error:r});
  });
  app.post("/api/queue/resume",(_q,res)=>{d.queue.resume();res.json({paused:d.queue.paused})});

  app.use("/videos",express.static(d.videosDir,{fallthrough:false,index:false}));
  if(d.webDir&&existsSync(path.join(d.webDir,"index.html")))app.use(express.static(d.webDir));
  else app.get("/",(_q,res)=>void res.type("text/plain").send("TRSR Video server is running. Build the interface with: npm run build"));
  app.use("/api",(_q,res)=>void res.status(404).json({error:"notFound"}));
  return app;
}
export {resolutionsFor};
