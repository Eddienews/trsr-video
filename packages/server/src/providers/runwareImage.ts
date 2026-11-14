// Images made in the cloud by Runware (imageInference), for people who have no ComfyUI on their computer.
// Docs: https://runware.ai/docs/models/alibaba-z-image-turbo (request fields, response fields, sync delivery).
import {randomUUID} from "node:crypto";
import {ProviderError,type FetchLike} from "./types";

/** `seed` is left out for models that do not take one; `referenceImages` (data URIs) are the images the new one is drawn from. */
export interface CloudImageRequest{apiModelId:string;prompt:string;width:number;height:number;seed?:number;steps?:number;referenceImages?:string[];settings?:Record<string,unknown>}
export interface CloudImageResult{bytes:Buffer;ext:string;costUSD?:number}
export type CloudImageMaker=(req:CloudImageRequest,apiKey:string)=>Promise<CloudImageResult>;

async function fetchBytes(url:string):Promise<Buffer>{
  const r=await fetch(url);
  if(!r.ok)throw new ProviderError("network","Could not download the image: HTTP "+r.status);
  return Buffer.from(await r.arrayBuffer());
}

export function runwareImage(endpoint:string,fetchImpl:FetchLike=fetch as unknown as FetchLike,download:(url:string)=>Promise<Buffer>=fetchBytes):CloudImageMaker{
  return async(req,apiKey)=>{
    if(!apiKey)throw new ProviderError("auth","No Runware API key configured.","missingApiKey");
    const task:Record<string,unknown>={taskType:"imageInference",taskUUID:randomUUID(),model:req.apiModelId,positivePrompt:req.prompt.slice(0,10000),
      width:req.width,height:req.height,numberResults:1,outputType:"URL",outputFormat:"PNG",includeCost:true};
    if(typeof req.seed==="number")task.seed=req.seed;
    if(req.steps)task.steps=req.steps;
    if(req.referenceImages?.length)task.inputs={referenceImages:req.referenceImages};
    if(req.settings&&Object.keys(req.settings).length)task.settings=req.settings;
    let res;
    try{res=await fetchImpl(endpoint,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+apiKey},body:JSON.stringify([task])})}
    catch(err){throw new ProviderError("network","Could not reach Runware: "+(err as Error).message)}
    const text=await res.text();let body:any={};
    try{body=text?JSON.parse(text):{}}catch{/* non-JSON error page */}
    const e=(body.errors??(body.error?[].concat(body.error):[]))[0];
    if(!res.ok||e){
      const code=e?.code as string|undefined;
      const kind=res.status===401||res.status===403||code==="invalidApiKey"||code==="missingApiKey"?"auth":res.status===402||/insufficient/i.test(code||"")?"balance":res.status===429||res.status===503?"busy":"invalid";
      throw new ProviderError(kind,e?.message||("Runware HTTP "+res.status),code);
    }
    const d=body.data?.[0];
    // Past 120 s Runware answers "processing" and keeps working; an image normally takes a few seconds.
    if(!d?.imageURL)throw new ProviderError("provider","Runware did not return the image in time. Try again.","noImage");
    return {bytes:await download(d.imageURL),ext:"png",costUSD:typeof d.cost==="number"?d.cost:undefined};
  };
}
