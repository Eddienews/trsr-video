// xAI and LTX adapters against scripted answers: no network, no credit.
import {describe,it,expect} from "vitest";
import {xaiAdapter} from "../src/providers/xai";
import {ltxAdapter} from "../src/providers/ltx";
import {ProviderError,type FetchLike,type SubmitRequest} from "../src/providers/types";
import {estimateCost,validateForModel,fitToModel,example,plain,resolutionsFor} from "@trsr-video/core";
import {registry,M} from "./helpers";

function fake(script:{status?:number;body:unknown;headers?:Record<string,string>}[]){
  const calls:{method:string;url:string;headers:Record<string,string>;body:any}[]=[];
  const fetchImpl:FetchLike=async(url,init)=>{
    calls.push({method:init?.method||"GET",url,headers:init?.headers||{},body:init?.body?JSON.parse(init.body):undefined});
    const r=script.shift();if(!r)throw new Error("unexpected extra call");
    const status=r.status??200;
    return {status,ok:status>=200&&status<300,headers:{get:n=>r.headers?.[n.toLowerCase()]??null},text:async()=>typeof r.body==="string"?r.body:JSON.stringify(r.body)};
  };
  return {fetchImpl,calls};
}
const req=(id:string,over:Partial<SubmitRequest>={}):SubmitRequest=>({model:M(id),prompt:"A test.",size:[1280,720],resolution:"720p",aspect:"16:9",durationS:8,audio:true,...over});
const fails=async(p:Promise<unknown>)=>{try{await p}catch(e){return e as ProviderError}throw new Error("expected a ProviderError")};
const KEY="secret-key-123";

describe("xAI",()=>{
  it("posts to /videos/generations with resolution and aspect ratio",async()=>{
    const f=fake([{body:{request_id:"x1"}}]);
    const r=await xaiAdapter("https://api.x.ai/v1",f.fetchImpl).submit(req("xai-grok-imagine-1.5-lite",{audio:false}),KEY);
    const c=f.calls[0];
    expect(c.method).toBe("POST");expect(c.url).toBe("https://api.x.ai/v1/videos/generations");expect(c.headers.Authorization).toBe("Bearer "+KEY);
    expect(c.body).toEqual({model:"grok-imagine-video-1.5-lite",prompt:"A test.",duration:8,aspect_ratio:"16:9",resolution:"720p",generate_audio:false});
    expect(r.taskId).toBe("x1");
  });
  it("maps pending, done and failed",async()=>{
    const f=fake([{body:{status:"pending"}},{body:{status:"done",video:{url:"https://vidgen.x.ai/v.mp4",duration:8},model:"m"}},
      {body:{status:"failed",error:{code:"invalid_argument",message:"prompt too long"}}},{body:{status:"failed",error:{code:"internal_error",message:"oops"}}}]);
    const a=xaiAdapter("https://api.x.ai/v1",f.fetchImpl);
    expect((await a.poll("x1",KEY)).status).toBe("processing");
    expect(await a.poll("x1",KEY)).toEqual({status:"success",videoUrl:"https://vidgen.x.ai/v.mp4"});
    const i=await a.poll("x1",KEY);expect(i.status==="error"&&[i.error.kind,i.error.message]).toEqual(["invalid","prompt too long"]);
    const p=await a.poll("x1",KEY);expect(p.status==="error"&&p.error.kind).toBe("provider");
    expect(f.calls[0]).toMatchObject({method:"GET",url:"https://api.x.ai/v1/videos/x1"});
  });
  it("a refused key stops; there is no cancel",async()=>{
    const f=fake([{status:401,body:{error:"Incorrect API key"}}]);
    const a=xaiAdapter("https://api.x.ai/v1",f.fetchImpl);
    const e=await fails(a.submit(req("xai-grok-imagine-1.5"),KEY));expect(e.kind).toBe("auth");expect(e.message).toBe("Incorrect API key");
    expect(a.cancel).toBeUndefined();
  });
});

describe("LTX",()=>{
  it("posts the size as WIDTHxHEIGHT",async()=>{
    const f=fake([{status:202,body:{id:"job1",created_at:"2026-11-10T00:00:00Z"}}]);
    const r=await ltxAdapter("https://api.ltx.io/v2",f.fetchImpl).submit(req("ltx-2.5-fast",{size:[1920,1080],resolution:"1080p"}),KEY);
    const c=f.calls[0];
    expect(c.url).toBe("https://api.ltx.io/v2/text-to-video");expect(c.headers.Authorization).toBe("Bearer "+KEY);
    expect(c.body).toEqual({prompt:"A test.",model:"ltx-2-5-fast",duration:8,resolution:"1920x1080",generate_audio:true});
    expect(r.taskId).toBe("job1");
  });
  it("maps pending, processing, completed and failed jobs",async()=>{
    const f=fake([{body:{status:"pending"}},{body:{status:"processing"}},{body:{status:"completed",result:{video_url:"https://storage/v.mp4"}}},
      {body:{status:"failed",error:{type:"insufficient_funds_error",message:"no credits"}}},{body:{status:"failed",error:{type:"content_filtered_error",message:"filtered"}}}]);
    const a=ltxAdapter("https://api.ltx.io/v2",f.fetchImpl);
    expect((await a.poll("job1",KEY)).status).toBe("processing");
    expect((await a.poll("job1",KEY)).status).toBe("processing");
    expect(await a.poll("job1",KEY)).toEqual({status:"success",videoUrl:"https://storage/v.mp4"});
    const b=await a.poll("job1",KEY);expect(b.status==="error"&&b.error.kind).toBe("balance");
    const c=await a.poll("job1",KEY);expect(c.status==="error"&&c.error.kind).toBe("invalid");
    expect(f.calls[0]).toMatchObject({method:"GET",url:"https://api.ltx.io/v2/text-to-video/job1"});
  });
  it("reads LTX's HTTP error shape",async()=>{
    const f=fake([{status:402,body:{type:"error",error:{type:"insufficient_funds_error",message:"Add credits"}}},{status:429,body:{type:"error",error:{type:"rate_limit_error",message:"queue full"}},headers:{"retry-after":"9"}},{status:401,body:{type:"error",error:{type:"authentication_error",message:"bad key"}}}]);
    const a=ltxAdapter("https://api.ltx.io/v2",f.fetchImpl);
    const e1=await fails(a.submit(req("ltx-2.3-fast"),KEY));expect([e1.kind,e1.message,e1.code]).toEqual(["balance","Add credits","insufficient_funds_error"]);
    const e2=await fails(a.submit(req("ltx-2.3-fast"),KEY));expect(e2.kind).toBe("busy");expect(e2.extra.retryAfterS).toBe(9);
    expect((await fails(a.submit(req("ltx-2.3-fast"),KEY))).kind).toBe("auth");
  });
});

describe("registry: xAI and LTX",()=>{
  it("both have a provider entry and no key means nothing is sent",async()=>{
    expect(registry.providers.xai.envKey).toBe("XAI_API_KEY");expect(registry.providers.ltx.envKey).toBe("LTX_API_KEY");
    expect((await fails(xaiAdapter("https://x").submit(req("xai-grok-imagine"),""))).kind).toBe("auth");
    expect((await fails(ltxAdapter("https://l").submit(req("ltx-2.3-pro"),""))).kind).toBe("auth");
  });
  it("prices",()=>{
    expect(estimateCost(M("xai-grok-imagine-1.5-lite"),"480p",15)!.usd).toBe(0.3);
    expect(estimateCost(M("xai-grok-imagine-1.5"),"1080p",10)!.usd).toBe(2.5);
    expect(estimateCost(M("ltx-2.3-fast"),"720p",20)!.usd).toBe(0.6);
    expect(estimateCost(M("ltx-2.5-pro"),"1080p",10)!.usd).toBe(1.7);
  });
  it("LTX: the 5000-character prompt limit and the even durations are enforced before sending",()=>{
    const S=example();
    expect(plain({...S,mode:"full"}).length).toBeGreaterThan(5000);
    expect(validateForModel(S,M("ltx-2.5-fast"),"720p","full").map(i=>i.code)).toEqual(["promptTooLong"]);
    expect(validateForModel(S,M("ltx-2.5-fast"),"720p")).toEqual([]);   // automatic mode switches to the compact prompt
    expect(validateForModel({...S,dur:15},M("ltx-2.5-fast"),"720p").map(i=>i.code)).toContain("durationNotAllowed");
    expect(fitToModel({...S,dur:15},M("ltx-2.5-fast")).dur).toBe(14);
    expect(fitToModel(S,M("ltx-2.5-pro")).dur).toBe(10);
    expect(resolutionsFor(M("ltx-2.3-fast"),"1:1")).toEqual([]);
    expect(resolutionsFor(M("ltx-2.5-fast"),"1:1")).toEqual(["720p","1080p"]);
  });
  it("xAI: 1 to 15 s, so the 20 s example needs rescaling",()=>{
    expect(validateForModel(example(),M("xai-grok-imagine-1.5-lite"),"480p")[0]).toMatchObject({code:"durationTooLong",limit:15});
  });
});
