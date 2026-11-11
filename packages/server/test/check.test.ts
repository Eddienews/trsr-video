// "Test key": what each provider's answer is taken to mean. Scripted answers, no network.
import {describe,it,expect,afterEach} from "vitest";
import type {Server} from "node:http";
import {checkKey} from "../src/providers/check";
import type {FetchLike} from "../src/providers/types";
import {EnvFile} from "../src/env";
import {JobQueue} from "../src/jobs";
import {createApp} from "../src/app";
import {registry,tmp,writeFileSync,path} from "./helpers";

function fake(status:number,body:unknown){
  const calls:{method:string;url:string;headers:Record<string,string>;body:any}[]=[];
  const f:FetchLike=async(url,init)=>{
    calls.push({method:init?.method||"GET",url,headers:init?.headers||{},body:init?.body?JSON.parse(init.body):undefined});
    return {status,ok:status>=200&&status<300,headers:{get:()=>null},text:async()=>typeof body==="string"?body:JSON.stringify(body)};
  };
  return {f,calls};
}
const P=registry.providers,KEY="test-key-abcdef123456";

describe("checkKey",()=>{
  it("Runware: asks for the account details and reports the balance",async()=>{
    const x=fake(200,{data:[{taskType:"accountManagement",operation:"getDetails",balance:12.3456}]});
    expect(await checkKey("runware",KEY,P.runware.endpoint,x.f)).toEqual({result:"ok",balanceUSD:12.3456});
    expect(x.calls[0]).toMatchObject({method:"POST",url:"https://api.runware.ai/v1",headers:{Authorization:"Bearer "+KEY}});
    expect(x.calls[0].body[0]).toMatchObject({taskType:"accountManagement",operation:"getDetails"});
    expect(JSON.stringify(x.calls[0].body)).not.toContain("videoInference");
    const bad=fake(401,{errors:[{code:"invalidApiKey",message:"Invalid API key"}]});
    expect(await checkKey("runware",KEY,P.runware.endpoint,bad.f)).toEqual({result:"invalid",message:"Invalid API key"});
  });
  it.each(["higgsfield","runway","pika","xai","ltx","krea"])("%s: 'not found' for a task that does not exist means the key passed; 401 means it did not",async id=>{
    const key=id==="higgsfield"?"kid123:sec456":KEY;
    const ok=fake(404,{message:"not found"});
    expect((await checkKey(id,key,P[id].endpoint,ok.f)).result).toBe("ok");
    expect(ok.calls[0].method).toBe("GET");expect(ok.calls[0].body).toBeUndefined();
    expect(ok.calls[0].url.startsWith(P[id].endpoint)).toBe(true);
    expect((await checkKey(id,key,P[id].endpoint,fake(401,{message:"Invalid API key"}).f))).toEqual({result:"invalid",message:"Invalid API key"});
    expect((await checkKey(id,key,P[id].endpoint,fake(500,"<html>oops</html>").f)).result).toBe("unknown");
  });
  it("each provider gets its own header",async()=>{
    const h=async(id:string,key=KEY)=>{const x=fake(404,{});await checkKey(id,key,P[id].endpoint,x.f);return x.calls[0].headers};
    expect((await h("higgsfield","kid123:sec456")).Authorization).toBe("Key kid123:sec456");
    expect(await h("runway")).toMatchObject({Authorization:"Bearer "+KEY,"X-Runway-Version":"2024-11-06"});
    expect((await h("pika"))["X-API-Key"]).toBe(KEY);
    expect((await h("google"))["x-goog-api-key"]).toBe(KEY);
  });
  it("Higgsfield: a key without the two parts is refused before any call",async()=>{
    const x=fake(404,{});
    expect((await checkKey("higgsfield","onlyonepart",P.higgsfield.endpoint,x.f)).result).toBe("invalid");expect(x.calls).toHaveLength(0);
  });
  it("Kling: service codes decide",async()=>{
    const k=(s:number,b:unknown)=>checkKey("kling",KEY,P.kling.endpoint,fake(s,b).f);
    expect((await k(200,{code:0,data:[]})).result).toBe("ok");
    expect((await k(400,{code:1201,message:"invalid task id"})).result).toBe("ok");
    expect((await k(401,{code:1002,message:"Authorization is invalid"}))).toEqual({result:"invalid",message:"Authorization is invalid"});
    const nb=await k(429,{code:1102,message:"Resource pack exhausted"});expect(nb.result).toBe("ok");expect(nb.message).toContain("no balance");
    expect((await k(429,{code:1302,message:"slow down"})).result).toBe("unknown");
  });
  it("Google: 200 is a good key, 400 'API key not valid' is a bad one",async()=>{
    const g=(s:number,b:unknown)=>checkKey("google",KEY,P.google.endpoint,fake(s,b).f);
    const ok=fake(200,{name:"models/gemini-omni-1.1-flash"});
    expect((await checkKey("google",KEY,P.google.endpoint,ok.f)).result).toBe("ok");
    expect(ok.calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-omni-1.1-flash");expect(ok.calls[0].url).not.toContain(KEY);
    expect((await g(400,{error:{code:400,message:"API key not valid. Please pass a valid API key.",status:"INVALID_ARGUMENT"}})).result).toBe("invalid");
    expect((await g(404,{error:{message:"model not found"}})).result).toBe("unknown");
  });
  it("no network or no answer is 'unknown', never 'invalid'",async()=>{
    expect((await checkKey("pika",KEY,P.pika.endpoint,async()=>{throw new Error("ENOTFOUND")})).result).toBe("unknown");
    const r=await checkKey("pika",KEY,P.pika.endpoint,()=>new Promise(()=>{}),30);expect(r.result).toBe("unknown");expect(r.message).toContain("no answer");
  });
  it("every provider in the registry has a test",async()=>{
    for(const id of Object.keys(P)){const x=fake(404,{});const r=await checkKey(id,id==="higgsfield"?"a123456:b123456":KEY,P[id].endpoint,x.f);expect(r.message||"").not.toContain("No test is available")}
  });
});

describe("POST /api/settings/keys/test",()=>{
  let server:Server;
  afterEach(()=>new Promise<void>(r=>server.close(()=>r())));
  async function boot(envText:string,check:(p:string,k:string)=>Promise<any>){
    const dir=tmp();writeFileSync(path.join(dir,".env"),envText);
    const env=new EnvFile(path.join(dir,".env"));
    const queue=new JobQueue({dataDir:dir,adapters:{},model:()=>undefined,apiKey:()=>""});
    const app=createApp({env,registry,queue,checkKey:check,videosDir:path.join(dir,"videos"),version:"test"});
    await new Promise<void>(r=>{server=app.listen(0,"127.0.0.1",()=>r())});
    const base="http://127.0.0.1:"+(server.address() as any).port;
    return (body:unknown)=>fetch(base+"/api/settings/keys/test",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}).then(async r=>({status:r.status,text:await r.text()}));
  }
  it("without a saved key nothing is called",async()=>{
    let called=0;const post=await boot("",async()=>{called++;return {result:"ok"}});
    expect(JSON.parse((await post({provider:"pika"})).text)).toEqual({provider:"pika",result:"noKey"});
    expect((await post({provider:"nope"})).status).toBe(400);expect(called).toBe(0);
  });
  it("passes the saved key to the test and never sends it back, even if the provider echoes it",async()=>{
    let got="";const post=await boot("PIKA_API_KEY="+KEY+"\n",async(p,k)=>{got=p+"|"+k;return {result:"invalid",message:"Incorrect API key provided: "+k}});
    const r=await post({provider:"pika"});
    expect(got).toBe("pika|"+KEY);expect(r.text).not.toContain(KEY);
    expect(JSON.parse(r.text)).toEqual({provider:"pika",result:"invalid",message:"Incorrect API key provided: ***"});
  });
});
