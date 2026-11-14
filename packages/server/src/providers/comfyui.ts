// Video made on this computer: MiniMax H3 in ComfyUI (custom nodes ComfyUI-MiniMaxH3-Easy and ComfyUI-ClipProj).
// No key and no cost. The graph is the one NorthWindLab used for its local tests (2026-11): FL2VA + Ref2VA transformers,
// Qwen3-VL 4B text encoder through ClipProj, reference mode, 8 steps of euler. The files are found by name.
import {ProviderError,type ProviderAdapter,type PollResult} from "./types";

type Fetch=(url:string,init?:{method?:string;headers?:Record<string,string>;body?:any})=>Promise<{ok:boolean;status:number;json():Promise<any>;text():Promise<string>}>;
type Graph=Record<string,{class_type:string;inputs:Record<string,unknown>}>;

/** Which file each role needs, found by name among what ComfyUI lists. */
const NEEDS:Record<string,[node:string,input:string,pattern:RegExp,what:string]>={
  fl2va:["UNETLoader","unet_name",/minimax_h3_fl2va/i,"a MiniMax H3 FL2VA model in models/diffusion_models"],
  ref2va:["UNETLoader","unet_name",/minimax_h3_ref2va/i,"a MiniMax H3 Ref2VA model in models/diffusion_models"],
  text:["CLIPLoader","clip_name",/qwen3vl_4b/i,"the Qwen3-VL 4B text encoder in models/text_encoders"],
  video:["VAELoader","vae_name",/minimax_h3_video_vae/i,"the MiniMax H3 video VAE in models/vae"],
  audio:["VAELoader","vae_name",/minimax_h3_audio_vae/i,"the MiniMax H3 audio VAE in models/vae"],
  proj:["ClipProjApply","projection",/mmh3-4b-ClipProj-v3/i,"the ClipProj custom node with mmh3-4b-ClipProj-v3.1-mlp"],
};
const RES:Record<string,string>={"540p":"540P"};
const ASPECT:Record<string,string>={"16:9":"16:9","9:16":"9:16","1:1":"1:1"};

export function h3Graph(f:Record<string,string>,o:{prompt:string;refs:string[];resolution:string;aspect:string;seconds:number;seed:number;audio:boolean;prefix:string}):Graph{
  const g:Graph={
    "1":{class_type:"UNETLoader",inputs:{unet_name:f.fl2va,weight_dtype:"default"}},
    "1b":{class_type:"UNETLoader",inputs:{unet_name:f.ref2va,weight_dtype:"default"}},
    "2":{class_type:"CLIPLoader",inputs:{clip_name:f.text,type:"krea2",device:"default"}},
    "3":{class_type:"ClipProjApply",inputs:{clip:["2",0],projection:f.proj}},
    "4":{class_type:"VAELoader",inputs:{vae_name:f.video}},
    "5":{class_type:"VAELoader",inputs:{vae_name:f.audio}},
    "6":{class_type:"MiniMaxH3EasyModelAdapter",inputs:{text_encoder:["3",0],video_vae:["4",0],audio_vae:["5",0],fl2va_model:["1",0],ref2va_model:["1b",0]}},
    "7":{class_type:"MiniMaxH3Easy",inputs:{h3_bundle:["6",0],mode:"reference",prompt:o.prompt,resolution:RES[o.resolution]||"540P",aspect_ratio:ASPECT[o.aspect]||"16:9",
      width:1344,height:768,seconds:o.seconds,advanced:false,fps:24,keyframe_role:"first",ref_image_size:"1k",reference_mention_mode:"index",
      prompt_optimizer_settings:false,prompt_optimizer_scene_guide:"none"}},
    "9":{class_type:"ModelAttentionBackend",inputs:{model:["7",0],attention:"pytorch attention"}},
    "10":{class_type:"MiniMaxH3EasyOutput",inputs:{h3_context:["7",1]}},
    "11":{class_type:"RandomNoise",inputs:{noise_seed:o.seed}},
    "12":{class_type:"KSamplerSelect",inputs:{sampler_name:"euler"}},
    "13":{class_type:"BasicScheduler",inputs:{model:["9",0],scheduler:"simple",steps:8,denoise:1}},
    "14":{class_type:"BasicGuider",inputs:{model:["9",0],conditioning:["10",0]}},
    "15":{class_type:"SamplerCustomAdvanced",inputs:{noise:["11",0],guider:["14",0],sampler:["12",0],sigmas:["13",0],latent_image:["10",1]}},
    "16":{class_type:"VAEDecode",inputs:{samples:["15",0],vae:["10",2]}},
    "17":{class_type:"VAEDecodeAudio",inputs:{samples:["15",1],vae:["10",3]}},
    "18":{class_type:"CreateVideo",inputs:{images:["16",0],...(o.audio?{audio:["17",0]}:{}),fps:["10",4]}},
    "19":{class_type:"SaveVideo",inputs:{video:["18",0],filename_prefix:o.prefix,format:"mp4","format.codec":"h264"}},
  };
  o.refs.forEach((name,i)=>{
    g["2"+String(i+1).padStart(2,"0")]={class_type:"LoadImage",inputs:{image:name}};
    g["7"].inputs["media_"+(i+1)]=["2"+String(i+1).padStart(2,"0"),0];
    g["7"].inputs["media_type_"+(i+1)]="image";
  });
  return g;
}

/** Up to 9 reference images, named <Picture 1>... in the prompt, in the order they are sent. */
export function comfyuiAdapter(base:()=>string,fetchImpl:Fetch=fetch as unknown as Fetch,random:()=>number=Math.random):ProviderAdapter&{timeoutMs:number}{
  const url=()=>(base()||"http://127.0.0.1:8188").replace(/\/+$/,"");
  const ask=async(p:string,init?:Parameters<Fetch>[1])=>{
    let r;try{r=await fetchImpl(url()+p,init)}catch{throw new ProviderError("network","ComfyUI is not answering at "+url()+". Start ComfyUI and try again.","comfyOffline")}
    if(!r.ok)throw new ProviderError("provider","ComfyUI answered HTTP "+r.status+" on "+p+": "+(await r.text().catch(()=>"")).slice(0,300));
    return r;
  };
  async function files(){
    const out:Record<string,string>={},missing:string[]=[],info:Record<string,any>={};
    for(const [role,[node,input,pat,what]] of Object.entries(NEEDS)){
      info[node]??=(await (await ask("/object_info/"+node)).json())[node];
      const v=info[node]?.input?.required?.[input],list:string[]=Array.isArray(v?.[0])?v[0]:[];
      const hit=list.find(n=>pat.test(n.split(/[\\/]/).pop()||n));
      if(hit)out[role]=hit;else missing.push(what);
    }
    if(missing.length)throw new ProviderError("invalid","ComfyUI is missing "+missing.join("; ")+".","comfyMissing");
    return out;
  }
  async function upload(dataUri:string,i:number,stamp:string){
    const m=/^data:image\/(\w+);base64,(.*)$/s.exec(dataUri);
    if(!m)throw new ProviderError("invalid","A reference image is not a data URI.");
    const form=new FormData();
    form.append("image",new Blob([new Uint8Array(Buffer.from(m[2],"base64"))],{type:"image/"+m[1]}),stamp+"-ref-"+(i+1)+"."+(m[1]==="jpeg"?"jpg":m[1]));
    form.append("subfolder","trsr-video");form.append("type","input");form.append("overwrite","true");
    const s=await (await ask("/upload/image",{method:"POST",body:form})).json();
    return s.subfolder?s.subfolder+"/"+s.name:s.name;
  }
  return {
    id:"comfyui",
    // A take of 8 to 10 seconds at 540p takes 15 to 25 minutes on an 8 GB laptop GPU.
    timeoutMs:240*60*1000,
    async submit(req){
      if(!RES[req.resolution])throw new ProviderError("invalid","Resolution not available on this computer: "+req.resolution,"badResolution",{allowedValues:Object.keys(RES)});
      const refs=req.referenceImages||[];
      if(refs.length>9)throw new ProviderError("invalid","MiniMax H3 takes up to 9 reference images.","tooManyRefs");
      const f=await files(),stamp=String(Date.now());
      const names:string[]=[];for(let i=0;i<refs.length;i++)names.push(await upload(refs[i],i,stamp));
      const seed=req.seed??Math.floor(random()*2**31);
      const graph=h3Graph(f,{prompt:req.prompt,refs:names,resolution:req.resolution,aspect:req.aspect,seconds:req.durationS,seed,audio:req.audio,prefix:"trsr-video/"+stamp});
      const q=await (await ask("/prompt",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prompt:graph,client_id:"trsr-video"})})).json();
      if(q.node_errors&&Object.keys(q.node_errors).length)throw new ProviderError("invalid","ComfyUI refused the graph: "+JSON.stringify(q.node_errors).slice(0,400));
      return {taskId:q.prompt_id+":"+seed};
    },
    async poll(taskId):Promise<PollResult>{
      const [id,seed]=taskId.split(":");
      const h=(await (await ask("/history/"+id)).json())[id];
      if(!h)return {status:"processing"};
      if(h.status?.status_str&&h.status.status_str!=="success"){
        const msgs=h.status.messages??[];
        if(msgs.some((m:any)=>m[0]==="execution_interrupted"))return {status:"error",error:new ProviderError("provider","Canceled in ComfyUI.","canceled")};
        const fail=msgs.find((m:any)=>m[0]==="execution_error")?.[1];
        return {status:"error",error:new ProviderError("provider",("ComfyUI: "+(fail?.exception_message??"the run failed")).slice(0,400))};
      }
      if(!h.status?.completed&&h.status?.status_str!=="success")return {status:"processing"};
      const file=Object.values(h.outputs??{}).flatMap((o:any)=>Object.values(o).flat()).find((x:any)=>x&&typeof x.filename==="string"&&/\.mp4$/i.test(x.filename)) as any;
      if(!file)return {status:"error",error:new ProviderError("provider","ComfyUI made no video file.")};
      const p=new URLSearchParams({filename:file.filename,subfolder:file.subfolder??"",type:file.type??"output"});
      return {status:"success",videoUrl:url()+"/view?"+p,costUSD:0,seed:Number(seed)};
    },
    async cancel(taskId){
      const id=taskId.split(":")[0];
      let running=true;
      try{const q=await (await ask("/queue")).json();running=(q?.queue_running??[]).some((x:any)=>x?.[1]===id)}catch{/* not knowing, interrupt */}
      await ask("/queue",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({delete:[id]})});
      if(running)await ask("/interrupt",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prompt_id:id})});
    },
  };
}
