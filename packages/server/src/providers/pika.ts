// Pika adapter. Docs: https://dev.pika.art/llms/pika/pika-2.5/text-to-video
// Takes resolution + aspect ratio. The finished job carries the real charge (billing.charge_micro_usd).
import {randomUUID} from "node:crypto";
import {ProviderError,type ProviderAdapter,type SubmitRequest,type PollResult,type FetchLike} from "./types";
import {callJson,kindFor,needKey} from "./http";

export function pikaAdapter(base:string,fetchImpl:FetchLike=fetch as unknown as FetchLike):ProviderAdapter{
  const root=base.replace(/\/+$/,"");
  const headers=(key:string)=>{needKey("Pika",key);return {"Content-Type":"application/json","X-API-Key":key}};
  const jobError=(body:any)=>new ProviderError(kindFor(0,body?.error?.code)==="provider"?"provider":kindFor(0,body?.error?.code),body?.error?.message||"Pika reported a failure.",body?.error?.code);
  return {
    id:"pika",
    async submit(req:SubmitRequest,apiKey:string){
      const body:Record<string,unknown>={prompt:req.prompt,resolution:req.resolution,duration_s:req.durationS,aspect_ratio:req.aspect};
      if(req.seed!==undefined)body.seed=req.seed;
      const r=await callJson(fetchImpl,"Pika",root+"/media/"+req.model.apiModelId,{method:"POST",headers:{...headers(apiKey),"Idempotency-Key":randomUUID()},body});
      if(r.body?.status==="failed")throw jobError(r.body);
      if(!r.body?.id)throw new ProviderError("provider","Pika did not return a job id.");
      return {taskId:String(r.body.id)};
    },
    async poll(taskId:string,apiKey:string):Promise<PollResult>{
      const {body}=await callJson(fetchImpl,"Pika",root+"/media/jobs/"+encodeURIComponent(taskId),{method:"GET",headers:headers(apiKey)});
      if(body?.status==="completed"){
        const url=body.output?.video?.url;
        if(!url)return {status:"error",error:new ProviderError("provider","Pika finished without a video URL.")};
        // Only a settled bill is a real charge; pending or unavailable means "not known yet".
        const b=body.billing;
        const costUSD=b?.state==="settled"&&typeof b.charge_micro_usd==="number"?b.charge_micro_usd/1e6:undefined;
        return {status:"success",videoUrl:url,costUSD};
      }
      if(body?.status==="failed")return {status:"error",error:jobError(body)};
      if(body?.status==="cancelled")return {status:"error",error:new ProviderError("provider","Canceled at Pika.","canceled")};
      return {status:"processing"};
    },
    // Pika documents no cancel: DELETE on a job erases stored media, it does not stop the run.
  };
}
