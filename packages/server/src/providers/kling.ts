// Kling adapter (official API). Docs: https://kling.ai/document-api/api/get-started/authentication,
// https://kling.ai/document-api/api/video/4-0-flash and https://kling.ai/document-api/api/get-started/error-codes
// Takes resolution + aspect ratio. The prompt is one item of "contents"; audio is always generated ("native").
import {ProviderError,type ProviderAdapter,type SubmitRequest,type PollResult,type FetchLike,type ErrorKind} from "./types";
import {callJson,needKey} from "./http";

// Kling's service codes say more than the HTTP status: 429 is used for "no balance" as well as "too many requests".
function kindOf(_status:number,body:any):ErrorKind|undefined{
  const c=Number(body?.code);
  if(c>=1000&&c<=1004)return "auth";
  if(c===1100||c===1101||c===1102)return "balance";
  if(c===1103||c===1304)return "auth";
  if(c===1302)return "busy";
  if(c===1303)return "concurrency";
  if(c>=1200&&c<=1301)return "invalid";
  if(c===5001||c===5002)return "busy";
  return undefined;
}
export function klingAdapter(base:string,fetchImpl:FetchLike=fetch as unknown as FetchLike):ProviderAdapter{
  const root=base.replace(/\/+$/,"");
  const headers=(key:string)=>{needKey("Kling",key);return {"Content-Type":"application/json",Authorization:"Bearer "+key}};
  const check=(body:any)=>{
    if(body&&typeof body.code==="number"&&body.code!==0)throw new ProviderError(kindOf(200,body)??"provider",body.message||("Kling error "+body.code),String(body.code));
  };
  return {
    id:"kling",
    async submit(req:SubmitRequest,apiKey:string){
      const body={contents:[{type:"prompt",text:req.prompt}],settings:{resolution:req.resolution,aspect_ratio:req.aspect,duration:req.durationS}};
      const r=await callJson(fetchImpl,"Kling",root+"/omni-video/"+req.model.apiModelId,{method:"POST",headers:headers(apiKey),body},kindOf);
      check(r.body);
      if(!r.body?.data?.id)throw new ProviderError("provider","Kling did not return a task id.");
      return {taskId:String(r.body.data.id)};
    },
    async poll(taskId:string,apiKey:string):Promise<PollResult>{
      const r=await callJson(fetchImpl,"Kling",root+"/tasks?task_ids="+encodeURIComponent(taskId),{method:"GET",headers:headers(apiKey)},kindOf);
      check(r.body);
      const t=Array.isArray(r.body?.data)?r.body.data.find((x:any)=>String(x?.id)===taskId)??r.body.data[0]:r.body?.data;
      if(t?.status==="succeeded"){
        const url=(t.outputs||[]).find((o:any)=>o?.type==="video"&&o.url)?.url;
        return url?{status:"success",videoUrl:url}:{status:"error",error:new ProviderError("provider","Kling finished without a video URL.")};
      }
      if(t?.status==="failed")return {status:"error",error:new ProviderError("provider",t.message||"Kling reported a failure.","failed")};
      return {status:"processing"};   // submitted, processing
    },
    // The Kling docs describe no way to cancel a task.
  };
}
