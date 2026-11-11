// xAI (Grok Imagine) adapter. Docs: https://docs.x.ai/developers/model-capabilities/video/generation
// Takes resolution + aspect ratio. Result URLs are temporary, so the app downloads the file right away.
import {ProviderError,type ProviderAdapter,type SubmitRequest,type PollResult,type FetchLike} from "./types";
import {callJson,kindFor,needKey} from "./http";

export function xaiAdapter(base:string,fetchImpl:FetchLike=fetch as unknown as FetchLike):ProviderAdapter{
  const root=base.replace(/\/+$/,"");
  const headers=(key:string)=>{needKey("xAI",key);return {"Content-Type":"application/json",Authorization:"Bearer "+key}};
  return {
    id:"xai",
    async submit(req:SubmitRequest,apiKey:string){
      const body:Record<string,unknown>={model:req.model.apiModelId,prompt:req.prompt,duration:req.durationS,aspect_ratio:req.aspect,resolution:req.resolution};
      if(req.model.audioParam==="generate_audio")body.generate_audio=req.audio;
      const r=await callJson(fetchImpl,"xAI",root+"/videos/generations",{method:"POST",headers:headers(apiKey),body});
      if(!r.body?.request_id)throw new ProviderError("provider","xAI did not return a request id.");
      return {taskId:String(r.body.request_id)};
    },
    async poll(taskId:string,apiKey:string):Promise<PollResult>{
      const {body}=await callJson(fetchImpl,"xAI",root+"/videos/"+encodeURIComponent(taskId),{method:"GET",headers:headers(apiKey)});
      if(body?.status==="done"){
        const url=body.video?.url;
        return url?{status:"success",videoUrl:url}:{status:"error",error:new ProviderError("provider","xAI finished without a video URL.")};
      }
      if(body?.status==="failed"){
        const code=body.error?.code;
        // invalid_argument covers a prompt that is too long or refused; the others are on xAI's side.
        const kind=code==="invalid_argument"||code==="failed_precondition"?"invalid":code==="permission_denied"?"auth":code==="service_unavailable"?"busy":kindFor(0,code);
        return {status:"error",error:new ProviderError(kind,body.error?.message||"xAI reported a failure.",code)};
      }
      return {status:"processing"};
    },
    // xAI documents no way to cancel a video request.
  };
}
