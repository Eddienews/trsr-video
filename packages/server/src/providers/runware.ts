// Runware adapter. Docs: https://runware.ai/docs/platform/authentication,
// https://runware.ai/docs/models-api/task-polling, https://runware.ai/docs/models-api/errors
import {randomUUID} from "node:crypto";
import {ProviderError,type ProviderAdapter,type SubmitRequest,type PollResult,type FetchLike,type ErrorKind} from "./types";

interface RwError{code?:string;message?:string;parameter?:string;allowedValues?:unknown;retryAfter?:number;status?:string;taskUUID?:string}

const KIND:Record<string,ErrorKind>={
  invalidApiKey:"auth",missingApiKey:"auth",
  insufficientCredits:"balance",insufficientBalance:"balance",
  concurrentRequestLimitExceeded:"concurrency",
  serviceOverloaded:"busy",providerRateLimitExceeded:"busy",rateLimitExceeded:"busy",
  timeoutProvider:"provider",
};
function toError(status:number,e:RwError|undefined,retryAfterHeader:string|null):ProviderError{
  const code=e?.code,msg=e?.message||("Runware HTTP "+status);
  let kind:ErrorKind=(code&&KIND[code])||"provider";
  if(!(code&&KIND[code])){
    if(status===401||status===403)kind="auth";
    else if(status===402)kind="balance";
    else if(status===429||status===503)kind="busy";
    else if(status===400||(code&&/^(unsupported|invalid|missing)/.test(code)))kind="invalid";
  }
  const ra=e?.retryAfter??(retryAfterHeader?parseFloat(retryAfterHeader):undefined);
  return new ProviderError(kind,msg,code,{allowedValues:e?.allowedValues,parameter:e?.parameter,retryAfterS:Number.isFinite(ra as number)?ra as number:undefined});
}

export function runwareAdapter(endpoint:string,fetchImpl:FetchLike=fetch as unknown as FetchLike):ProviderAdapter{
  async function call(tasks:object[],apiKey:string):Promise<{data?:any[];errors?:RwError[]}>{
    if(!apiKey)throw new ProviderError("auth","No Runware API key configured.","missingApiKey");
    let res;
    try{res=await fetchImpl(endpoint,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+apiKey},body:JSON.stringify(tasks)})}
    catch(err){throw new ProviderError("network","Could not reach Runware: "+(err as Error).message)}
    const text=await res.text();
    let body:any={};
    try{body=text?JSON.parse(text):{}}catch{/* non-JSON error page */}
    const errors:RwError[]|undefined=body.errors??(body.error?[].concat(body.error):undefined);
    if(!res.ok)throw toError(res.status,errors?.[0],res.headers.get("retry-after"));
    return {data:body.data,errors};
  }
  return {
    id:"runware",
    async submit(req:SubmitRequest,apiKey:string){
      const taskUUID=randomUUID();
      const task:Record<string,unknown>={
        taskType:"videoInference",taskUUID,model:req.model.apiModelId,positivePrompt:req.prompt,
        width:req.size[0],height:req.size[1],duration:req.durationS,
        deliveryMethod:"async",includeCost:true,outputType:"URL",outputFormat:"MP4",numberResults:1,
      };
      if(req.seed!==undefined)task.seed=req.seed;
      // The audio switch is only sent where the model's docs name the parameter (registry: audioParam).
      if(req.model.audioParam==="settings.audio")task.settings={audio:req.audio};
      // Docs (model page, "inputs.referenceImages"): 1 to N images as UUID, URL or data URI; not together with frameImages.
      if(req.referenceImages?.length)task.inputs={referenceImages:req.referenceImages};
      const r=await call([task],apiKey);
      if(r.errors?.length)throw toError(200,r.errors[0],null);
      return {taskId:r.data?.[0]?.taskUUID||taskUUID};
    },
    async poll(taskId:string,apiKey:string):Promise<PollResult>{
      const r=await call([{taskType:"getResponse",taskUUID:taskId}],apiKey);
      const err=r.errors?.find(e=>!e.taskUUID||e.taskUUID===taskId);
      if(err)return {status:"error",error:toError(200,err,null)};
      const d=r.data?.find(x=>x.taskUUID===taskId&&x.status&&x.status!=="processing")??r.data?.find(x=>x.taskUUID===taskId);
      if(d?.status==="success"&&d.videoURL)return {status:"success",videoUrl:d.videoURL,costUSD:typeof d.cost==="number"?d.cost:undefined,seed:typeof d.seed==="number"?d.seed:undefined};
      if(d?.status==="error")return {status:"error",error:new ProviderError("provider",d.message||"Runware reported an error.",d.code)};
      return {status:"processing",progress:typeof d?.progress==="number"?d.progress:undefined};
    },
    // Runware documents no way to cancel a running task, so there is no cancel() here.
  };
}
