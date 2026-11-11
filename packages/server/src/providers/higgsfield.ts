// Higgsfield adapter. Docs: https://docs.higgsfield.ai/docs/quickstart.md,
// https://docs.higgsfield.ai/docs/concepts/requests.md
// The model is the URL path (bytedance/seedance-2.5/text-to-video). It takes resolution + aspect ratio, not pixels.
import {randomUUID} from "node:crypto";
import {ProviderError,type ProviderAdapter,type SubmitRequest,type PollResult,type FetchLike} from "./types";
import {callJson,needKey} from "./http";

export function higgsfieldAdapter(base:string,fetchImpl:FetchLike=fetch as unknown as FetchLike):ProviderAdapter{
  const root=base.replace(/\/+$/,"");
  const headers=(key:string)=>{
    needKey("Higgsfield",key);
    // The key is the pair shown in the console, joined by a colon.
    if(!/^[^:\s]+:[^:\s]+$/.test(key))throw new ProviderError("auth","The Higgsfield key must be KEY_ID:KEY_SECRET (both parts, joined by a colon).","badKeyFormat");
    return {"Content-Type":"application/json",Authorization:"Key "+key};
  };
  return {
    id:"higgsfield",
    async submit(req:SubmitRequest,apiKey:string){
      const body:Record<string,unknown>={prompt:req.prompt,duration:req.durationS,resolution:req.resolution,aspect_ratio:req.aspect};
      if(req.model.audioParam==="generate_audio")body.generate_audio=req.audio;
      if(req.seed!==undefined)body.seed=req.seed;
      // The same Idempotency-Key on a retry returns the same request instead of charging twice.
      const r=await callJson(fetchImpl,"Higgsfield",root+"/"+req.model.apiModelId,{method:"POST",headers:{...headers(apiKey),"Idempotency-Key":randomUUID()},body});
      if(!r.body?.request_id)throw new ProviderError("provider","Higgsfield did not return a request id.");
      return {taskId:String(r.body.request_id)};
    },
    async poll(taskId:string,apiKey:string):Promise<PollResult>{
      const {body}=await callJson(fetchImpl,"Higgsfield",root+"/requests/"+encodeURIComponent(taskId)+"/status",{method:"GET",headers:headers(apiKey)});
      switch(body?.status){
        case "completed":{
          const url=body.video?.url;
          return url?{status:"success",videoUrl:url}:{status:"error",error:new ProviderError("provider","Higgsfield finished without a video URL.")};
        }
        case "failed":return {status:"error",error:new ProviderError("provider",(typeof body.error==="string"?body.error:body.error?.message)||"Higgsfield reported a failure.","failed")};
        case "nsfw":return {status:"error",error:new ProviderError("invalid","Rejected by Higgsfield content moderation (not charged).","nsfw")};
        case "canceled":return {status:"error",error:new ProviderError("provider","Canceled at Higgsfield.","canceled")};
        default:return {status:"processing"};
      }
    },
    // Only works while the request is still queued; once it starts, Higgsfield answers 400.
    async cancel(taskId:string,apiKey:string){
      await callJson(fetchImpl,"Higgsfield",root+"/requests/"+encodeURIComponent(taskId)+"/cancel",{method:"POST",headers:headers(apiKey)});
    },
  };
}
