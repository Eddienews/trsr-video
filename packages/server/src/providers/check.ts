// "Test key": one read-only call per provider that shows whether the saved key is accepted.
// Nothing is generated. Most probes ask for a task that does not exist: a valid key gets "not found",
// a bad key gets "unauthorized". Runware also reports the account balance.
// "ok" means the provider accepted the key. It does not prove there is balance or access to every model.
import {randomUUID} from "node:crypto";
import type {FetchLike} from "./types";

export interface CheckResult{result:"ok"|"invalid"|"unknown";message?:string;balanceUSD?:number}
interface Probe{method?:string;url:string;headers:Record<string,string>;body?:unknown;
  /** Provider-specific reading of the answer; return undefined to fall back to the general rules. */
  read?:(status:number,body:any)=>CheckResult|undefined}

const KEY_WORDS=/api.?key|unauthori[sz]ed|authenticat|credential|invalid token|permission/i;
const msgOf=(body:any):string=>{
  const e=body?.error??body?.errors?.[0];
  const m=(typeof e==="string"?e:e?.message)??body?.message??body?.detail;
  return typeof m==="string"?m:"";
};

function probeFor(provider:string,key:string,endpoint:string):Probe|null{
  const root=endpoint.replace(/\/+$/,""),id=randomUUID(),json={"Content-Type":"application/json"};
  switch(provider){
    case "runware":return {method:"POST",url:endpoint,headers:{...json,Authorization:"Bearer "+key},body:[{taskType:"accountManagement",taskUUID:id,operation:"getDetails"}],
      read:(s,b)=>{
        const code=b?.errors?.[0]?.code;
        if(code==="invalidApiKey"||code==="missingApiKey")return {result:"invalid",message:msgOf(b)};
        const d=b?.data?.[0];
        if(s===200&&d)return {result:"ok",balanceUSD:typeof d.balance==="number"?d.balance:undefined};
        return undefined;
      }};
    case "higgsfield":return {url:root+"/requests/"+id+"/status",headers:{Authorization:"Key "+key}};
    case "runway":return {url:root+"/v1/tasks/"+id,headers:{Authorization:"Bearer "+key,"X-Runway-Version":"2024-11-06"}};
    case "pika":return {url:root+"/media/jobs/"+id,headers:{"X-API-Key":key}};
    case "xai":return {url:root+"/videos/"+id,headers:{Authorization:"Bearer "+key}};
    case "ltx":return {url:root+"/text-to-video/"+id,headers:{Authorization:"Bearer "+key}};
    case "krea":return {url:root+"/jobs/"+id,headers:{Authorization:"Bearer "+key}};
    case "kling":return {url:root+"/tasks?task_ids=1",headers:{...json,Authorization:"Bearer "+key},
      read:(s,b)=>{
        const c=Number(b?.code);
        if((c>=1000&&c<=1004)||c===1103)return {result:"invalid",message:msgOf(b)};
        if(c===1100||c===1101||c===1102)return {result:"ok",message:"The key is valid, but the account has no balance or active package: "+msgOf(b)};
        if(c===0||(c>=1200&&c<1300))return {result:"ok"};       // passed authentication; the task simply does not exist
        return undefined;
      }};
    // Google answers a bad key with 400, and a good one with the model's description.
    case "google":return {url:root+"/models/gemini-omni-1.1-flash",headers:{"x-goog-api-key":key},
      read:(s,b)=>s===200?{result:"ok"}:s===404?{result:"unknown",message:"The key was accepted, but this account does not list gemini-omni-1.1-flash."}:undefined};
    default:return null;
  }
}

export async function checkKey(provider:string,key:string,endpoint:string,fetchImpl:FetchLike=fetch as unknown as FetchLike,timeoutMs=15000):Promise<CheckResult>{
  if(provider==="higgsfield"&&!/^[^:\s]+:[^:\s]+$/.test(key))return {result:"invalid",message:"The Higgsfield key must be KEY_ID:KEY_SECRET (both parts, joined by a colon)."};
  const p=probeFor(provider,key,endpoint);
  if(!p)return {result:"unknown",message:"No test is available for this provider."};
  let status:number,body:any={};
  try{
    const res=await Promise.race([
      fetchImpl(p.url,{method:p.method||"GET",headers:p.headers,body:p.body===undefined?undefined:JSON.stringify(p.body)}),
      new Promise<never>((_,rej)=>setTimeout(()=>rej(new Error("no answer in "+Math.round(timeoutMs/1000)+" s")),timeoutMs)),
    ]);
    status=res.status;
    const text=await res.text();
    try{body=text?JSON.parse(text):{}}catch{/* not JSON */}
  }catch(e){return {result:"unknown",message:"Could not reach the provider: "+(e as Error).message}}
  const own=p.read?.(status,body);
  if(own)return own;
  const msg=msgOf(body);
  if(status===401||status===403)return {result:"invalid",message:msg||("HTTP "+status)};
  if(status===400&&KEY_WORDS.test(msg))return {result:"invalid",message:msg};
  if(status===200||status===404)return {result:"ok"};
  return {result:"unknown",message:"HTTP "+status+(msg?": "+msg:"")};
}
