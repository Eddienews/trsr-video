// LTX adapter. Docs: https://docs.ltx.io/api-documentation/api-reference/async-video-generation/submit-text-to-video
// and https://docs.ltx.io/async-jobs. The size goes as "WIDTHxHEIGHT"; the prompt is limited to 5000 characters.
import {ProviderError,type ProviderAdapter,type SubmitRequest,type PollResult,type FetchLike} from "./types";
import {callJson,kindFor,needKey} from "./http";

export function ltxAdapter(base:string,fetchImpl:FetchLike=fetch as unknown as FetchLike):ProviderAdapter{
  const root=base.replace(/\/+$/,"");
  const headers=(key:string)=>{needKey("LTX",key);return {"Content-Type":"application/json",Authorization:"Bearer "+key}};
  return {
    id:"ltx",
    async submit(req:SubmitRequest,apiKey:string){
      const body:Record<string,unknown>={prompt:req.prompt,model:req.model.apiModelId,duration:req.durationS,resolution:req.size[0]+"x"+req.size[1]};
      if(req.model.audioParam==="generate_audio")body.generate_audio=req.audio;
      const r=await callJson(fetchImpl,"LTX",root+"/text-to-video",{method:"POST",headers:headers(apiKey),body});
      if(!r.body?.id)throw new ProviderError("provider","LTX did not return a job id.");
      return {taskId:String(r.body.id)};
    },
    async poll(taskId:string,apiKey:string):Promise<PollResult>{
      const {body}=await callJson(fetchImpl,"LTX",root+"/text-to-video/"+encodeURIComponent(taskId),{method:"GET",headers:headers(apiKey)});
      if(body?.status==="completed"){
        const url=body.result?.video_url;
        return url?{status:"success",videoUrl:url}:{status:"error",error:new ProviderError("provider","LTX finished without a video URL.")};
      }
      if(body?.status==="failed"){
        // Refused content and lack of credit arrive here, as a failed job, not as an HTTP error.
        const type=body.error?.type;
        return {status:"error",error:new ProviderError(type?kindFor(0,type):"provider",body.error?.message||"LTX reported a failure.",type)};
      }
      return {status:"processing"};
    },
    // LTX documents no cancel endpoint.
  };
}
