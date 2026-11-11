import {describe,it,expect,beforeEach,afterEach} from "vitest";
import type {Server} from "node:http";
import {example,blank} from "@trsr-video/core";
import {EnvFile} from "../src/env";
import {JobQueue} from "../src/jobs";
import {createApp} from "../src/app";
import {runwareAdapter} from "../src/providers/runware";
import {fakeRunware,ack,success,registry,tmp,readFileSync,writeFileSync,path} from "./helpers";

let server:Server,base:string,env:EnvFile,queue:JobQueue,rw:ReturnType<typeof fakeRunware>,dir:string;
const KEY="rw-test-key-abcdef9876";
async function boot(script:Parameters<typeof fakeRunware>[0]=[],envText=""){
  dir=tmp();writeFileSync(path.join(dir,".env"),envText);
  env=new EnvFile(path.join(dir,".env"));rw=fakeRunware(script);
  queue=new JobQueue({dataDir:dir,adapters:{runware:runwareAdapter("https://api.runware.ai/v1",rw.fetchImpl)},model:id=>registry.models.find(m=>m.id===id),
    apiKey:p=>env.get(registry.providers[p].envKey),sleep:async()=>{},download:async()=>{}});
  const app=createApp({env,registry,queue,videosDir:path.join(dir,"videos"),version:"test"});
  await new Promise<void>(r=>{server=app.listen(0,"127.0.0.1",()=>r())});
  base="http://127.0.0.1:"+(server.address() as any).port;
}
const api=async(method:string,url:string,body?:unknown,headers:Record<string,string>={"content-type":"application/json"})=>{
  const r=await fetch(base+url,{method,headers:body===undefined?{}:headers,body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();return {status:r.status,text,json:text?JSON.parse(text):null};
};
const fit15=()=>{const S=example();S.dur=15;S.shots.forEach((s,i)=>s.len=[3,2,3,3,2,2][i]);return S};
beforeEach(()=>boot());
afterEach(()=>new Promise<void>(r=>server.close(()=>r())));

describe("keys never leave the server",()=>{
  it("saving a key writes .env and answers only with the last 4 characters",async()=>{
    const r=await api("PUT","/api/settings/keys",{provider:"runware",key:KEY});
    expect(r.json).toEqual({provider:"runware",configured:true,last4:"9876"});
    expect(readFileSync(path.join(dir,".env"),"utf8")).toContain("RUNWARE_API_KEY="+KEY);
    for(const u of ["/api/settings","/api/models","/api/jobs","/api/health"])expect((await api("GET",u)).text).not.toContain(KEY);
  });
  it("an empty key removes it; junk is refused",async()=>{
    await api("PUT","/api/settings/keys",{provider:"runware",key:KEY});
    expect((await api("PUT","/api/settings/keys",{provider:"runware",key:""})).json.configured).toBe(false);
    expect((await api("PUT","/api/settings/keys",{provider:"nope",key:"x"})).status).toBe(400);
    expect((await api("PUT","/api/settings/keys",{provider:"runware",key:"a b"})).status).toBe(400);
  });
  it("only JSON requests addressed to this machine are accepted",async()=>{
    expect((await api("PUT","/api/settings/keys",{provider:"runware",key:KEY},{"content-type":"text/plain"})).status).toBe(415);
    const {request}=await import("node:http");
    const status=await new Promise<number>(res=>request(base+"/api/health",{headers:{host:"evil.example"}},r=>{r.resume();res(r.statusCode!)}).end());
    expect(status).toBe(403);
  });
});
describe("estimate",()=>{
  it("picks the size, counts the cost and dates the price",async()=>{
    const r=await api("POST","/api/estimate",{state:example(),modelId:"seedance-2.5",resolution:"480p"});
    expect(r.json).toMatchObject({size:[854,480],durationS:20,audio:true,shots:6,issues:[],estimate:{usd:2.04,perSecond:0.102,asOf:"2026-11-10",source:"official"}});
    expect(r.json.promptChars).toBeGreaterThan(1000);
  });
  it("20 s on a 15 s model: says so and offers the rescaled shot times",async()=>{
    const r=await api("POST","/api/estimate",{state:blank(),modelId:"seedance-2.0-mini",resolution:"480p"});
    expect(r.json.issues[0]).toMatchObject({code:"durationTooLong",limit:15});
    expect(r.json.fit).toEqual({dur:15,lens:[3,3,3,3,3]});
  });
  it("flags the limits that would be passed",async()=>{
    await api("PUT","/api/settings/limits",{perGeneration:1,perDay:5});
    const r=await api("POST","/api/estimate",{state:example(),modelId:"seedance-2.5",resolution:"480p"});
    expect(r.json.limits).toMatchObject({perGeneration:1,perDay:5,over:["perGeneration"]});
  });
});
describe("generate: nothing is sent without the OK",()=>{
  const body=(over:object={})=>({state:fit15(),modelId:"seedance-2.0-mini",resolution:"480p",audio:true,confirmed:true,estimateUSD:0.54,...over});
  it("refuses without a key",async()=>{
    expect((await api("POST","/api/generate",body())).json.error).toBe("noKey");expect(rw.calls).toHaveLength(0);
  });
  it("refuses without confirmation, with a different estimate, or with a blocking issue",async()=>{
    await api("PUT","/api/settings/keys",{provider:"runware",key:KEY});
    expect((await api("POST","/api/generate",body({confirmed:false}))).json.error).toBe("notConfirmed");
    expect((await api("POST","/api/generate",body({confirmed:undefined}))).json.error).toBe("notConfirmed");
    expect((await api("POST","/api/generate",body({estimateUSD:0.10}))).json.error).toBe("estimateChanged");
    expect((await api("POST","/api/generate",body({state:example(),estimateUSD:0.72}))).json.error).toBe("invalid");
    expect(rw.calls).toHaveLength(0);expect(queue.list()).toHaveLength(0);
  });
  it("over a limit needs the second confirmation",async()=>{
    await api("PUT","/api/settings/keys",{provider:"runware",key:KEY});
    await api("PUT","/api/settings/limits",{perGeneration:0.5});
    expect((await api("POST","/api/generate",body())).json.error).toBe("overLimit");
    expect(rw.calls).toHaveLength(0);
  });
  it("with the OK it generates, records estimate and real cost, and serves the result",async()=>{
    await new Promise<void>(r=>server.close(()=>r()));
    await boot([ack(),success("T1",0.57)],"RUNWARE_API_KEY="+KEY+"\n");
    const r=await api("POST","/api/generate",body());
    expect(r.status).toBe(202);await queue.idle();
    const j=(await api("GET","/api/jobs/"+r.json.id)).json;
    expect(j).toMatchObject({status:"done",modelId:"seedance-2.0-mini",size:[864,496],durationS:15,estimateUSD:0.54,realUSD:0.57,seed:7,videoUrl:"/videos/"+r.json.id+".mp4"});
    expect(j.prompt.startsWith("==== SCENE CONTEXT ====")).toBe(true);expect(j.state.title).toBe("The Last Match");
    expect(rw.calls[0].tasks[0]).toMatchObject({positivePrompt:j.prompt,width:864,height:496,duration:15});
    const list=(await api("GET","/api/jobs")).json;
    expect(list.jobs).toHaveLength(1);expect(list.jobs[0].state).toBeUndefined();expect(list.spentToday).toBe(0.57);
    expect((await api("POST","/api/jobs/"+r.json.id+"/cancel",{})).json.error).toBe("finished");
  });
});
