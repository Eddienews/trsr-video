// Krea adapter. Docs: https://www.krea.ai/docs/developers/introduction.md,
// https://www.krea.ai/docs/developers/job-lifecycle.md
// Each model has its own path (/generate/video/google/veo-3.1). Takes resolution + aspect ratio.
import {ProviderError,type ProviderAdapter,type SubmitRequest,type PollResult,type FetchLike} from "./types";
import {callJson,kindFor,needKey} from "./http";

export function kreaAdapter(base:string,fetchImpl:FetchLike=fetch as unknown as FetchLike):ProviderAdapter{
  const root=base.replace(/\/+$/,"");
  const headers=(key:string)=>{needKey("Krea",key);return {"Content-Type":"application/json",Authorization:"Bearer "+key}};
  return {
    id:"krea",
    async submit(req:SubmitRequest,apiKey:string){
      const body:Record<string,unknown>={prompt:req.prompt,duration:req.durationS,aspect_ratio:req.aspect,resolution:req.resolution};
      const r=await callJson(fetchImpl,"Krea",root+"/generate/video/"+req.model.apiModelId,{method:"POST",headers:headers(apiKey),body});
      if(!r.body?.job_id)throw new ProviderError("provider","Krea did not return a job id.");
      return {taskId:String(r.body.job_id)};
    },
    async poll(taskId:string,apiKey:string):Promise<PollResult>{
      const {body}=await callJson(fetchImpl,"Krea",root+"/jobs/"+encodeURIComponent(taskId),{method:"GET",headers:headers(apiKey)});
      if(body?.status==="completed"){
        const url=body.result?.urls?.[0];
        return url?{status:"success",videoUrl:url}:{status:"error",error:new ProviderError("provider","Krea finished without a video URL.")};
      }
      if(body?.status==="failed"){
        const code=body.error?.code;
        return {status:"error",error:new ProviderError(code?kindFor(0,code):"provider",body.error?.message||(code==="content_policy"?"Rejected by Krea's content policy (not charged).":"Krea reported a failure."),code)};
      }
      if(body?.status==="cancelled")return {status:"error",error:new ProviderError("provider","Canceled at Krea.","canceled")};
      // queued, backlogged, scheduled, processing, sampling, intermediate-complete
      return {status:"processing",progress:typeof body?.progress==="number"?Math.round(body.progress<=1?body.progress*100:body.progress):undefined};
    },
    // Krea cancels jobs that are queued or processing; canceled jobs are not billed.
    async cancel(taskId:string,apiKey:string){
      await callJson(fetchImpl,"Krea",root+"/jobs/"+encodeURIComponent(taskId),{method:"DELETE",headers:headers(apiKey)});
    },
  };
}
