// Shared HTTP plumbing for the JSON providers: one call, errors sorted into the kinds the queue acts on.
import {ProviderError,type ErrorKind,type FetchLike} from "./types";

const BY_CODE:Record<string,ErrorKind>={
  insufficient_balance:"balance",insufficient_credits:"balance",
  rate_limited:"busy",provider_unavailable:"busy",
  content_policy:"invalid",
  // LTX error types
  authentication_error:"auth",insufficient_funds_error:"balance",rate_limit_error:"busy",content_filtered_error:"invalid",
};
export function kindFor(status:number,code?:string):ErrorKind{
  if(code&&BY_CODE[code])return BY_CODE[code];
  if(status===401||status===403)return "auth";
  if(status===402)return "balance";
  if(status===429||status===503)return "busy";
  if(status>=400&&status<500)return "invalid";
  return "provider";
}
export async function callJson(fetchImpl:FetchLike,name:string,url:string,init:{method:string;headers:Record<string,string>;body?:unknown},kindOf?:(status:number,body:any)=>ErrorKind|undefined):Promise<{status:number;body:any}>{
  let res;
  try{res=await fetchImpl(url,{method:init.method,headers:init.headers,body:init.body===undefined?undefined:JSON.stringify(init.body)})}
  catch(err){throw new ProviderError("network","Could not reach "+name+": "+(err as Error).message)}
  const text=await res.text();
  let body:any={};
  try{body=text?JSON.parse(text):{}}catch{/* not JSON: an error page */}
  if(!res.ok){
    const e=body?.error,code=(e&&typeof e==="object"?(e.code??e.type):undefined)??body?.code;
    const msg=(typeof e==="string"?e:e?.message)??body?.message??body?.detail??(name+" HTTP "+res.status);
    const ra=parseFloat(res.headers.get("retry-after")||"");
    throw new ProviderError(kindOf?.(res.status,body)??kindFor(res.status,typeof code==="string"?code:undefined),typeof msg==="string"?msg:JSON.stringify(msg),typeof code==="string"?code:undefined,{retryAfterS:Number.isFinite(ra)?ra:undefined});
  }
  return {status:res.status,body};
}
export const needKey=(name:string,key:string)=>{if(!key)throw new ProviderError("auth","No "+name+" API key configured.","missingApiKey")};
