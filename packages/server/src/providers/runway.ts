// Runway adapter. Docs: https://docs.dev.runwayml.com/guides/using-the-api/ and https://docs.dev.runwayml.com/api
// The size goes as a ratio string ("1280:720"). One credit is US$ 0.01.
import {ProviderError,type ProviderAdapter,type SubmitRequest,type PollResult,type FetchLike} from "./types";
import {callJson,needKey} from "./http";

const VERSION="2024-11-06";
export function runwayAdapter(base:string,fetchImpl:FetchLike=fetch as unknown as FetchLike):ProviderAdapter{
  const root=base.replace(/\/+$/,"");
  const headers=(key:string)=>{needKey("Runway",key);return {"Content-Type":"application/json",Authorization:"Bearer "+key,"X-Runway-Version":VERSION}};
  return {
    id:"runway",
    async submit(req:SubmitRequest,apiKey:string){
      const body:Record<string,unknown>={model:req.model.apiModelId,promptText:req.prompt,ratio:req.size[0]+":"+req.size[1],duration:req.durationS};
      if(req.seed!==undefined)body.seed=req.seed;
      const r=await callJson(fetchImpl,"Runway",root+"/v1/text_to_video",{method:"POST",headers:headers(apiKey),body});
      if(!r.body?.id)throw new ProviderError("provider","Runway did not return a task id.");
      return {taskId:String(r.body.id)};
    },
    async poll(taskId:string,apiKey:string):Promise<PollResult>{
      const {body}=await callJson(fetchImpl,"Runway",root+"/v1/tasks/"+encodeURIComponent(taskId),{method:"GET",headers:headers(apiKey)});
      const s=String(body?.status||"").toUpperCase();
      if(s==="SUCCEEDED"){
        const url=Array.isArray(body.output)?body.output[0]:undefined;
        return url?{status:"success",videoUrl:url}:{status:"error",error:new ProviderError("provider","Runway finished without an output URL.")};
      }
      if(s==="FAILED")return {status:"error",error:new ProviderError("provider",body.failure||"Runway reported a failure.",body.failureCode)};
      if(s==="CANCELLED"||s==="CANCELED")return {status:"error",error:new ProviderError("provider","Canceled at Runway.","canceled")};
      // PENDING, THROTTLED, RUNNING and anything new: keep waiting.
      const p=typeof body?.progress==="number"?Math.round(body.progress*100):undefined;
      return {status:"processing",progress:p};
    },
    async cancel(taskId:string,apiKey:string){
      await callJson(fetchImpl,"Runway",root+"/v1/tasks/"+encodeURIComponent(taskId),{method:"DELETE",headers:headers(apiKey)});
    },
  };
}
