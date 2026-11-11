// Google adapter: Gemini Omni Flash through the Interactions API. Docs: https://ai.google.dev/gemini-api/docs/omni
// Two things differ from the other providers:
//  - the call answers only when the video is ready, with the MP4 inside the JSON (base64), so "submit" starts the
//    call and "poll" just reports whether it has come back;
//  - there is no duration parameter: the model picks the length.
import {randomUUID} from "node:crypto";
import {ProviderError,type ProviderAdapter,type SubmitRequest,type PollResult,type FetchLike} from "./types";
import {callJson,needKey} from "./http";
import {longFetch} from "./longfetch";

export function googleAdapter(base:string,fetchImpl:FetchLike=longFetch):ProviderAdapter{
  const root=base.replace(/\/+$/,"");
  const running=new Map<string,{result?:PollResult}>();
  const read=(body:any):PollResult=>{
    const steps=Array.isArray(body?.steps)?body.steps:[];
    for(const st of steps)if(st?.type==="model_output")for(const c of st.content||[])if(c?.type==="video"){
      if(c.data)return {status:"success",videoUrl:"data:"+(c.mime_type||"video/mp4")+";base64,"+c.data};
      if(c.uri)return {status:"error",error:new ProviderError("provider","Google returned a file link instead of the video itself; this app only reads inline videos.","uriDelivery")};
    }
    return {status:"error",error:new ProviderError("provider","Google answered without a video"+(body?.status?" (status: "+body.status+")":"")+".","noVideo")};
  };
  return {
    id:"google",
    async submit(req:SubmitRequest,apiKey:string){
      needKey("Google",apiKey);
      const body={model:req.model.apiModelId,input:req.prompt,response_format:{type:"video",resolution:req.resolution,aspect_ratio:req.aspect}};
      const id=randomUUID(),slot:{result?:PollResult}={};
      running.set(id,slot);
      // The key travels in a header, never in the URL.
      callJson(fetchImpl,"Google",root+"/interactions",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":apiKey},body})
        .then(r=>{slot.result=read(r.body)})
        .catch(e=>{slot.result={status:"error",error:e instanceof ProviderError?e:new ProviderError("provider",(e as Error)?.message||String(e))}});
      return {taskId:id};
    },
    async poll(taskId:string):Promise<PollResult>{
      const slot=running.get(taskId);
      // The open call lives in this process. After a restart there is nothing to ask Google for.
      if(!slot)return {status:"error",error:new ProviderError("network","The app closed while Google was generating. The request may have been charged; it cannot be recovered.","interrupted")};
      if(!slot.result)return {status:"processing"};
      running.delete(taskId);
      return slot.result;
    },
    // An open Interactions call cannot be canceled from here.
  };
}
