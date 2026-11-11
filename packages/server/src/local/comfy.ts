/* Images made on this computer by ComfyUI: no key, no cost per image.
   The graphs are the ones of ComfyUI's own workflow templates for each model. The model files are found by name
   in what ComfyUI has, so any precision of them works (bf16, fp8, int8...). Each model's own license applies
   to what it makes. */
export type Fetch=typeof fetch;
export type LocalKind="text"|"edit"|"audio";
export interface LocalModel{id:string;label:string;kind:LocalKind;available:boolean;missing:string[];files:string[];note:string}
export interface LocalStatus{url:string;reachable:boolean;error?:string;models:LocalModel[];others:string[]}
type Files=Record<string,string>;
type Graph=Record<string,{class_type:string;inputs:Record<string,unknown>}>;
type List="unet"|"clip"|"vae"|"lora"|"ckpt";

interface Recipe{
  id:string;label:string;kind:LocalKind;note:string;
  /** role → [loader list, pattern on the file name, where the file goes (for the "missing" message)]. */
  needs:Record<string,[List,RegExp,string]>;
  optional?:Record<string,[List,RegExp,string]>;
}
const RECIPES:Recipe[]=[
  {id:"z-image-turbo",label:"Z-Image Turbo",kind:"text",note:"8 steps",
    needs:{unet:["unet",/^z[-_]image[-_]turbo/i,"diffusion_models/z_image_turbo*"],clip:["clip",/^qwen[-_]3[-_]4b/i,"text_encoders/qwen_3_4b*"],vae:["vae",/^ae\.safetensors$/i,"vae/ae.safetensors"]}},
  {id:"moss-image",label:"MOSS-Image",kind:"text",note:"25 steps",
    needs:{unet:["unet",/^moss[-_]image/i,"diffusion_models/moss_image*"],clip:["clip",/^qwen3\.5[-_]9b/i,"text_encoders/qwen3.5_9b*"],vae:["vae",/^flux2[-_]vae/i,"vae/flux2-vae*"]}},
  {id:"qwen-image-edit-2511",label:"Qwen-Image-Edit 2511",kind:"edit",note:"4 steps with the Lightning LoRA, 40 without",
    needs:{unet:["unet",/^qwen[-_]image[-_]edit[-_]2511/i,"diffusion_models/qwen_image_edit_2511*"],clip:["clip",/^qwen[-_]2\.5[-_]vl[-_]7b/i,"text_encoders/qwen_2.5_vl_7b*"],vae:["vae",/^qwen[-_]image[-_]vae/i,"vae/qwen_image_vae*"]},
    optional:{lora:["lora",/^qwen[-_]image[-_]edit[-_]2511[-_]lightning[-_]4steps/i,"loras/Qwen-Image-Edit-2511-Lightning-4steps*"]}},
  {id:"stable-audio-3-medium",label:"Stable Audio 3 Medium",kind:"audio",note:"8 steps",
    needs:{ckpt:["ckpt",/^stable[-_]audio[-_]3/i,"checkpoints/stable_audio_3_medium*"],clip:["clip",/^t5gemma/i,"text_encoders/t5gemma_b_b_ul2*"]}},
];
// Files of video and audio models that also sit in diffusion_models: not image models, so not listed as "others".
const NOT_IMAGE=/minimax|wan\d|ltx|hunyuan[-_]?video|cogvideo|mochi|audio|animate|svd/i;

/** Stable Audio 3 Medium, from its ComfyUI template (without the prompt rewriting). It reads tempo and length from the prompt itself. */
export function audioGraph(f:Files,text:string,seconds:number,seed:number,prefix:string):Graph{
  return {
    1:{class_type:"CheckpointLoaderSimple",inputs:{ckpt_name:f.ckpt}},
    2:{class_type:"CLIPLoader",inputs:{clip_name:f.clip,type:"stable_audio",device:"default"}},
    3:{class_type:"CLIPTextEncode",inputs:{clip:["2",0],text}},
    4:{class_type:"CLIPTextEncode",inputs:{clip:["2",0],text:""}},
    5:{class_type:"EmptyLatentAudio",inputs:{seconds,batch_size:1}},
    6:{class_type:"KSampler",inputs:{model:["1",0],positive:["3",0],negative:["4",0],latent_image:["5",0],seed,steps:8,cfg:1,sampler_name:"lcm",scheduler:"simple",denoise:1}},
    7:{class_type:"VAEDecodeAudio",inputs:{samples:["6",0],vae:["1",2]}},
    8:{class_type:"SaveAudio",inputs:{audio:["7",0],filename_prefix:prefix}},
  };
}
export const MOSS_NEGATIVE="nsfw, worst quality, bad anatomy, watermark, jpeg artifact";

/** Z-Image Turbo, from its ComfyUI template: 8 steps, no negative prompt. */
export function zImageGraph(f:Files,prompt:string,width:number,height:number,seed:number,prefix:string):Graph{
  return {
    1:{class_type:"UNETLoader",inputs:{unet_name:f.unet,weight_dtype:"default"}},
    2:{class_type:"CLIPLoader",inputs:{clip_name:f.clip,type:"lumina2",device:"default"}},
    3:{class_type:"VAELoader",inputs:{vae_name:f.vae}},
    4:{class_type:"ModelSamplingAuraFlow",inputs:{model:["1",0],shift:3}},
    5:{class_type:"CLIPTextEncode",inputs:{clip:["2",0],text:prompt}},
    6:{class_type:"ConditioningZeroOut",inputs:{conditioning:["5",0]}},
    7:{class_type:"EmptySD3LatentImage",inputs:{width,height,batch_size:1}},
    8:{class_type:"KSampler",inputs:{model:["4",0],positive:["5",0],negative:["6",0],latent_image:["7",0],seed,steps:8,cfg:1,sampler_name:"res_multistep",scheduler:"simple",denoise:1}},
    9:{class_type:"VAEDecode",inputs:{samples:["8",0],vae:["3",0]}},
    10:{class_type:"SaveImage",inputs:{images:["9",0],filename_prefix:prefix}},
  };
}
/** MOSS-Image, from ComfyUI's "MOSS-Image: Text to Image" template: 25 steps, CFG 2.5, er_sde, skip-layer guidance on layer 22. */
export function mossGraph(f:Files,prompt:string,width:number,height:number,seed:number,prefix:string):Graph{
  return {
    1:{class_type:"UNETLoader",inputs:{unet_name:f.unet,weight_dtype:"default"}},
    2:{class_type:"CLIPLoader",inputs:{clip_name:f.clip,type:"moss_image",device:"default"}},
    3:{class_type:"VAELoader",inputs:{vae_name:f.vae}},
    4:{class_type:"CLIPTextEncode",inputs:{clip:["2",0],text:prompt}},
    5:{class_type:"CLIPTextEncode",inputs:{clip:["2",0],text:MOSS_NEGATIVE}},
    6:{class_type:"EmptyFlux2LatentImage",inputs:{width,height,batch_size:1}},
    7:{class_type:"SkipLayerGuidanceDiTSimple",inputs:{model:["1",0],double_layers:"",single_layers:"22",start_percent:0,end_percent:0.5}},
    8:{class_type:"KSampler",inputs:{model:["7",0],positive:["4",0],negative:["5",0],latent_image:["6",0],seed,steps:25,cfg:2.5,sampler_name:"er_sde",scheduler:"simple",denoise:1}},
    9:{class_type:"VAEDecode",inputs:{samples:["8",0],vae:["3",0]}},
    10:{class_type:"SaveImage",inputs:{images:["9",0],filename_prefix:prefix}},
  };
}
/** Qwen-Image-Edit-2511 with 1 to 3 reference images (names in ComfyUI's input folder), from its ComfyUI template. The size follows image 1. */
export function qwenEditGraph(f:Files,images:string[],prompt:string,seed:number,prefix:string):Graph{
  const fast=!!f.lora;
  const g:Graph={
    1:{class_type:"UNETLoader",inputs:{unet_name:f.unet,weight_dtype:"default"}},
    2:{class_type:"CLIPLoader",inputs:{clip_name:f.clip,type:"qwen_image",device:"default"}},
    3:{class_type:"VAELoader",inputs:{vae_name:f.vae}},
    4:{class_type:"ModelSamplingAuraFlow",inputs:{model:["1",0],shift:3.1}},
    5:{class_type:"CFGNorm",inputs:{model:["4",0],strength:1}},
    13:{class_type:"FluxKontextImageScale",inputs:{image:["10",0]}},
    18:{class_type:"VAEEncode",inputs:{pixels:["13",0],vae:["3",0]}},
    20:{class_type:"VAEDecode",inputs:{samples:["19",0],vae:["3",0]}},
    21:{class_type:"SaveImage",inputs:{images:["20",0],filename_prefix:prefix}},
  };
  if(fast)g[6]={class_type:"LoraLoaderModelOnly",inputs:{model:["5",0],lora_name:f.lora,strength_model:1}};
  images.forEach((name,i)=>{g[10+i]={class_type:"LoadImage",inputs:{image:name}}});
  for(const [id,text] of [[14,prompt],[15,""]] as const){
    const inputs:Record<string,unknown>={clip:["2",0],vae:["3",0],prompt:text,image1:["13",0]};
    for(let i=1;i<images.length;i++)inputs["image"+(i+1)]=[String(10+i),0];
    g[id]={class_type:"TextEncodeQwenImageEditPlus",inputs};
  }
  g[16]={class_type:"FluxKontextMultiReferenceLatentMethod",inputs:{conditioning:["14",0],reference_latents_method:"index_timestep_zero"}};
  g[17]={class_type:"FluxKontextMultiReferenceLatentMethod",inputs:{conditioning:["15",0],reference_latents_method:"index_timestep_zero"}};
  g[19]={class_type:"KSampler",inputs:{model:[fast?"6":"5",0],positive:["16",0],negative:["17",0],latent_image:["18",0],seed,steps:fast?4:40,cfg:fast?1:4,sampler_name:"euler",scheduler:"simple",denoise:1}};
  return g;
}

export class ComfyError extends Error{constructor(public kind:"unreachable"|"refused"|"failed"|"canceled"|"timeout"|"missing",message:string){super(message)}}
export interface RunHooks{signal?:{aborted:boolean};onStart?:(id:string)=>void;maxWaitMs?:number}
export interface MakeImage{modelId:string;prompt:string;width:number;height:number;seed:number;refs:{name:string;bytes:Buffer}[];seconds?:number}

export class Comfy{
  constructor(private url:()=>string,private fetchImpl:Fetch=fetch,private sleep:(ms:number)=>Promise<void>=ms=>new Promise(r=>setTimeout(r,ms))){}
  get base(){return (this.url()||"http://127.0.0.1:8188").replace(/\/+$/,"")}

  private async ask(path:string,init?:RequestInit){
    let res:Response;
    try{res=await this.fetchImpl(this.base+path,init)}catch{throw new ComfyError("unreachable","ComfyUI is not answering at "+this.base)}
    if(!res.ok)throw new ComfyError("failed","ComfyUI ("+res.status+"): "+(await res.text()).slice(0,300));
    return res;
  }
  private async choices(node:string,input:string):Promise<string[]>{
    const info=await (await this.ask("/object_info/"+node)).json() as any;
    const v=info?.[node]?.input?.required?.[input];
    return Array.isArray(v?.[0])?v[0]:Array.isArray(v?.[1]?.options)?v[1].options:[];
  }
  private async lists(){
    const [ckpt,unet,clip,vae,lora]=await Promise.all([this.choices("CheckpointLoaderSimple","ckpt_name"),this.choices("UNETLoader","unet_name"),this.choices("CLIPLoader","clip_name"),this.choices("VAELoader","vae_name"),this.choices("LoraLoaderModelOnly","lora_name")]);
    return {unet,clip,vae,lora,ckpt};
  }
  private static pick(lists:Record<List,string[]>,r:Recipe){
    const base=(n:string)=>n.split(/[\\/]/).pop()||n,files:Files={},missing:string[]=[];
    for(const [role,[list,pat,where]] of Object.entries(r.needs)){const hit=lists[list].find(n=>pat.test(base(n)));if(hit)files[role]=hit;else missing.push(where)}
    for(const [role,[list,pat]] of Object.entries(r.optional||{})){const hit=lists[list].find(n=>pat.test(base(n)));if(hit)files[role]=hit}
    return {files,missing};
  }

  /** What this machine can make: each known model with the files found (or what is missing), and other image-model files with no recipe here. */
  async status():Promise<LocalStatus>{
    try{
      const lists=await this.lists(),base=(n:string)=>n.split(/[\\/]/).pop()||n;
      const models=RECIPES.map(r=>{const {files,missing}=Comfy.pick(lists,r);return {id:r.id,label:r.label,kind:r.kind,available:!missing.length,missing,files:Object.values(files),note:r.optional?(files.lora?"4 steps (Lightning LoRA)":"40 steps"):r.note}});
      const known=RECIPES.filter(r=>r.needs.unet).map(r=>r.needs.unet[1]);
      const others=lists.unet.filter(n=>!known.some(p=>p.test(base(n)))&&!NOT_IMAGE.test(base(n)));
      return {url:this.base,reachable:true,models,others};
    }catch(e){
      return {url:this.base,reachable:false,error:(e as Error).message,models:RECIPES.map(r=>({id:r.id,label:r.label,kind:r.kind,available:false,missing:[],files:[],note:r.note})),others:[]};
    }
  }

  private async upload(ref:{name:string;bytes:Buffer}){
    const form=new FormData();
    form.append("image",new Blob([new Uint8Array(ref.bytes)],{type:"image/png"}),ref.name);
    form.append("subfolder","trsr-video");form.append("type","input");form.append("overwrite","true");
    const saved=await (await this.ask("/upload/image",{method:"POST",body:form})).json() as any;
    return saved.subfolder?saved.subfolder+"/"+saved.name:saved.name;
  }
  /** Takes a run of ours off ComfyUI's queue, and interrupts it when it is the one running. */
  async stop(id:string){
    const post=(p:string,body:unknown)=>this.fetchImpl(this.base+p,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}).catch(()=>null);
    let running=true;
    try{const q=await (await this.fetchImpl(this.base+"/queue")).json() as any;running=(q?.queue_running??[]).some((x:any)=>x?.[1]===id)}catch{/* not knowing, interrupt: ComfyUI runs one prompt at a time */}
    await post("/queue",{delete:[id]});
    if(running)await post("/interrupt",{prompt_id:id});
  }

  /** One image (PNG) or one piece of music (the file ComfyUI saved). Returns the bytes, their extension and the model files used. Throws ComfyError. */
  async make(job:MakeImage,hooks:RunHooks={}):Promise<{bytes:Buffer;files:string[];ext:string}>{
    const r=RECIPES.find(x=>x.id===job.modelId);
    if(!r)throw new ComfyError("missing","Unknown local model: "+job.modelId);
    const {files,missing}=Comfy.pick(await this.lists(),r);
    if(missing.length)throw new ComfyError("missing","ComfyUI is missing "+missing.join(", "));
    const prefix="trsr-video/"+Date.now();
    let graph:Graph;
    if(r.kind==="edit"){
      if(!job.refs.length||job.refs.length>3)throw new ComfyError("refused","This model takes 1 to 3 reference images.");
      const names:string[]=[];for(const ref of job.refs)names.push(await this.upload(ref));
      graph=qwenEditGraph(files,names,job.prompt,job.seed,prefix);
    }else if(r.kind==="audio")graph=audioGraph(files,job.prompt,job.seconds||20,job.seed,prefix);
    else graph=(r.id==="moss-image"?mossGraph:zImageGraph)(files,job.prompt,job.width,job.height,job.seed,prefix);
    if(hooks.signal?.aborted)throw new ComfyError("canceled","Canceled.");
    const queued=await (await this.ask("/prompt",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prompt:graph,client_id:"trsr-video"})})).json() as any;
    if(queued.node_errors&&Object.keys(queued.node_errors).length)throw new ComfyError("refused","ComfyUI refused the graph: "+JSON.stringify(queued.node_errors).slice(0,400));
    const id=queued.prompt_id as string;hooks.onStart?.(id);
    const started=Date.now(),maxWait=hooks.maxWaitMs??20*60_000;
    for(;;){
      await this.sleep(1000);
      if(hooks.signal?.aborted){await this.stop(id);throw new ComfyError("canceled","Canceled.")}
      const h=(await (await this.ask("/history/"+id)).json() as any)[id];
      if(!h){
        if(Date.now()-started>maxWait){await this.stop(id);throw new ComfyError("timeout","ComfyUI took more than "+Math.round(maxWait/60_000)+" minutes; the run was stopped.")}
        continue;
      }
      if(h.status?.status_str!=="success"){
        const msgs=h.status?.messages??[];
        if(msgs.some((m:any)=>m[0]==="execution_interrupted"))throw new ComfyError("canceled","Canceled.");
        const fail=msgs.find((m:any)=>m[0]==="execution_error")?.[1];
        throw new ComfyError("failed",("ComfyUI: "+(fail?.exception_message??"the run failed")).slice(0,400));
      }
      const file=Object.values(h.outputs??{}).flatMap((o:any)=>o[r.kind==="audio"?"audio":"images"]??[])[0] as any;
      if(!file)throw new ComfyError("failed","ComfyUI made no file.");
      const q=new URLSearchParams({filename:file.filename,subfolder:file.subfolder??"",type:file.type??"output"});
      return {bytes:Buffer.from(await (await this.ask("/view?"+q)).arrayBuffer()),files:Object.values(files),ext:r.kind==="audio"?(String(file.filename).split(".").pop()||"flac").toLowerCase():"png"};
    }
  }
}
export const localKind=(id:string):LocalKind|null=>RECIPES.find(r=>r.id===id)?.kind??null;
export const localLabel=(id:string):string=>RECIPES.find(r=>r.id===id)?.label??id;
