import {mkdtempSync,readFileSync,writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import type {FetchLike} from "../src/providers/types";
import {loadRegistry} from "../src/registry";

export const registry=loadRegistry(path.join(__dirname,"../../../registry"));
export const M=(id:string)=>registry.models.find(m=>m.id===id)!;
export const tmp=()=>mkdtempSync(path.join(os.tmpdir(),"trsr-video-"));

/** A scripted Runware: each call takes the next canned answer. No network, no credit. */
export function fakeRunware(script:{status?:number;body:unknown;headers?:Record<string,string>}[]){
  const calls:{url:string;auth:string;tasks:any[]}[]=[];
  const fetchImpl:FetchLike=async(url,init)=>{
    calls.push({url,auth:init?.headers?.Authorization||"",tasks:JSON.parse(init?.body||"[]")});
    const r=script.shift();
    if(!r)throw new Error("fakeRunware: unexpected extra call");
    const status=r.status??200;
    return {status,ok:status>=200&&status<300,headers:{get:n=>r.headers?.[n.toLowerCase()]??null},text:async()=>typeof r.body==="string"?r.body:JSON.stringify(r.body)};
  };
  return {fetchImpl,calls,left:()=>script.length};
}
export const ack=(id="T1")=>({body:{data:[{taskType:"videoInference",taskUUID:id}]}});
export const processing=(id="T1",progress?:number)=>({body:{data:[{taskType:"videoInference",taskUUID:id,status:"processing",progress}]}});
export const success=(id="T1",cost=0.57)=>({body:{data:[{taskType:"videoInference",taskUUID:id,status:"success",videoUUID:"V",videoURL:"https://im.runware.ai/video/x.mp4",cost,seed:7}]}});
export const rwError=(code:string,status=400,extra:object={})=>({status,body:{errors:[{code,message:code+" message",...extra}]}});
export {readFileSync,writeFileSync,path};
