// Higgsfield, Runway, Pika and Krea adapters against scripted answers: no network, no credit.
import {describe,it,expect} from "vitest";
import {higgsfieldAdapter} from "../src/providers/higgsfield";
import {runwayAdapter} from "../src/providers/runway";
import {pikaAdapter} from "../src/providers/pika";
import {kreaAdapter} from "../src/providers/krea";
import {ProviderError,type FetchLike,type ProviderAdapter,type SubmitRequest} from "../src/providers/types";
import {estimateCost,validateForModel,fitToModel,resolutionsFor,example,blank,total} from "@trsr-video/core";
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
const req=(id:string,over:Partial<SubmitRequest>={}):SubmitRequest=>({model:M(id),prompt:"==== SCENE CONTEXT ====\nA test.",size:[1280,720],resolution:"720p",aspect:"16:9",durationS:5,audio:true,...over});
const fails=async(p:Promise<unknown>)=>{try{await p}catch(e){return e as ProviderError}throw new Error("expected a ProviderError")};
const KEY="secret-key-123";

describe("Higgsfield",()=>{
  const HK="kid123:sec456";
  it("posts to the model path with the Key header and an idempotency key",async()=>{
    const f=fake([{body:{status:"queued",request_id:"r1",status_url:"x",cancel_url:"y"}}]);
    const r=await higgsfieldAdapter("https://api.higgsfield.ai",f.fetchImpl).submit(req("higgsfield-seedance-2.5",{durationS:10}),HK);
    const c=f.calls[0];
    expect(c.method).toBe("POST");expect(c.url).toBe("https://api.higgsfield.ai/bytedance/seedance-2.5/text-to-video");
    expect(c.headers.Authorization).toBe("Key "+HK);expect(c.headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(c.body).toEqual({prompt:"==== SCENE CONTEXT ====\nA test.",duration:10,resolution:"720p",aspect_ratio:"16:9",generate_audio:true});
    expect(JSON.stringify(c.body)).not.toContain("sec456");expect(r.taskId).toBe("r1");
  });
  it("does not send an audio flag the model page does not name",async()=>{
    const f=fake([{body:{request_id:"r2"}}]);
    await higgsfieldAdapter("https://api.higgsfield.ai",f.fetchImpl).submit(req("higgsfield-kling-4.0-flash"),HK);
    expect(f.calls[0].url).toBe("https://api.higgsfield.ai/kling-video/v4.0-flash/text-to-video");
    expect("generate_audio" in f.calls[0].body).toBe(false);
  });
  it("refuses a key that is not KEY_ID:KEY_SECRET before calling anything",async()=>{
    const f=fake([]);
    const e=await fails(higgsfieldAdapter("https://api.higgsfield.ai",f.fetchImpl).submit(req("higgsfield-seedance-2.5"),"justonepart"));
    expect(e.kind).toBe("auth");expect(f.calls).toHaveLength(0);
  });
  it("polls the status URL and maps every state",async()=>{
    const f=fake([{body:{status:"queued"}},{body:{status:"in_progress"}},{body:{status:"completed",video:{url:"https://cdn/v.mp4"}}},{body:{status:"nsfw"}},{body:{status:"failed",error:"boom"}},{body:{status:"canceled"}}]);
    const a=higgsfieldAdapter("https://api.higgsfield.ai",f.fetchImpl);
    expect((await a.poll("r1",HK)).status).toBe("processing");
    expect((await a.poll("r1",HK)).status).toBe("processing");
    expect(await a.poll("r1",HK)).toEqual({status:"success",videoUrl:"https://cdn/v.mp4"});
    const n=await a.poll("r1",HK);expect(n.status==="error"&&n.error.kind).toBe("invalid");
    const x=await a.poll("r1",HK);expect(x.status==="error"&&x.error.message).toBe("boom");
    expect((await a.poll("r1",HK)).status).toBe("error");
    expect(f.calls[0]).toMatchObject({method:"GET",url:"https://api.higgsfield.ai/requests/r1/status"});
  });
  it("cancel posts to the cancel URL and fails once the work has started",async()=>{
    const f=fake([{status:202,body:""},{status:400,body:{message:"already started"}}]);
    const a=higgsfieldAdapter("https://api.higgsfield.ai",f.fetchImpl);
    await a.cancel!("r1",HK);expect(f.calls[0]).toMatchObject({method:"POST",url:"https://api.higgsfield.ai/requests/r1/cancel"});
    expect((await fails(a.cancel!("r1",HK))).kind).toBe("invalid");
  });
});

describe("Runway",()=>{
  it("sends text_to_video with the version header and the size as a ratio",async()=>{
    const f=fake([{body:{id:"t1"}}]);
    const r=await runwayAdapter("https://api.dev.runwayml.com",f.fetchImpl).submit(req("runway-gen4.5"),KEY);
    const c=f.calls[0];
    expect(c.url).toBe("https://api.dev.runwayml.com/v1/text_to_video");
    expect(c.headers).toMatchObject({Authorization:"Bearer "+KEY,"X-Runway-Version":"2024-11-06"});
    expect(c.body).toEqual({model:"gen4.5",promptText:"==== SCENE CONTEXT ====\nA test.",ratio:"1280:720",duration:5});
    expect(r.taskId).toBe("t1");
  });
  it("maps task states, including ones it does not know",async()=>{
    const f=fake([{body:{status:"THROTTLED"}},{body:{status:"RUNNING",progress:0.42}},{body:{status:"SOMETHING_NEW"}},{body:{status:"SUCCEEDED",output:["https://r/v.mp4"]}},{body:{status:"FAILED",failure:"bad",failureCode:"SAFETY.INPUT.TEXT"}},{body:{status:"CANCELLED"}}]);
    const a=runwayAdapter("https://api.dev.runwayml.com",f.fetchImpl);
    expect(await a.poll("t1",KEY)).toEqual({status:"processing",progress:undefined});
    expect(await a.poll("t1",KEY)).toEqual({status:"processing",progress:42});
    expect((await a.poll("t1",KEY)).status).toBe("processing");
    expect(await a.poll("t1",KEY)).toEqual({status:"success",videoUrl:"https://r/v.mp4"});
    const x=await a.poll("t1",KEY);expect(x.status==="error"&&x.error.code).toBe("SAFETY.INPUT.TEXT");
    expect((await a.poll("t1",KEY)).status).toBe("error");
    expect(f.calls[0]).toMatchObject({method:"GET",url:"https://api.dev.runwayml.com/v1/tasks/t1"});
  });
  it("cancel is DELETE on the task; errors are sorted by HTTP status",async()=>{
    const f=fake([{status:204,body:""},{status:401,body:{error:"Unauthorized"}},{status:400,body:{error:"promptText too long"}},{status:429,body:{error:"slow"},headers:{"retry-after":"7"}}]);
    const a=runwayAdapter("https://api.dev.runwayml.com",f.fetchImpl);
    await a.cancel!("t1",KEY);expect(f.calls[0]).toMatchObject({method:"DELETE",url:"https://api.dev.runwayml.com/v1/tasks/t1"});
    expect((await fails(a.submit(req("runway-gen4.5"),KEY))).kind).toBe("auth");
    const inv=await fails(a.submit(req("runway-gen4.5"),KEY));expect(inv.kind).toBe("invalid");expect(inv.message).toBe("promptText too long");
    const busy=await fails(a.submit(req("runway-gen4.5"),KEY));expect(busy.kind).toBe("busy");expect(busy.extra.retryAfterS).toBe(7);
  });
});

describe("Pika",()=>{
  it("posts to the model's media path with X-API-Key and duration_s",async()=>{
    const f=fake([{body:{id:"media_1",status:"queued"}}]);
    const r=await pikaAdapter("https://api.dev.pika.art/v1",f.fetchImpl).submit(req("pika-2.5",{resolution:"480p",size:[854,480]}),KEY);
    const c=f.calls[0];
    expect(c.url).toBe("https://api.dev.pika.art/v1/media/pika/pika-2.5/text-to-video");
    expect(c.headers["X-API-Key"]).toBe(KEY);expect(c.headers.Authorization).toBeUndefined();
    expect(c.body).toEqual({prompt:"==== SCENE CONTEXT ====\nA test.",resolution:"480p",duration_s:5,aspect_ratio:"16:9"});
    expect(r.taskId).toBe("media_1");
  });
  it("reads the video and the settled charge; an unsettled bill is not a cost",async()=>{
    const f=fake([{body:{id:"m",status:"running"}},{body:{id:"m",status:"completed",output:{media_type:"video",video:{url:"https://p/v.mp4"}},billing:{state:"settled",charge_micro_usd:100000}}},
      {body:{id:"m",status:"completed",output:{video:{url:"https://p/v.mp4"}},billing:{state:"pending"}}}]);
    const a=pikaAdapter("https://api.dev.pika.art/v1",f.fetchImpl);
    expect((await a.poll("m",KEY)).status).toBe("processing");
    expect(await a.poll("m",KEY)).toEqual({status:"success",videoUrl:"https://p/v.mp4",costUSD:0.1});
    expect(await a.poll("m",KEY)).toEqual({status:"success",videoUrl:"https://p/v.mp4",costUSD:undefined});
    expect(f.calls[0].url).toBe("https://api.dev.pika.art/v1/media/jobs/m");
  });
  it("no balance is told apart from a bad key, and Pika has no cancel",async()=>{
    const f=fake([{status:403,body:{id:"m",status:"failed",error:{code:"insufficient_balance",message:"top up"}}},{status:401,body:{message:"Invalid API key"}},{status:422,body:{message:"duration: Input should be less than or equal to 15"}}]);
    const a=pikaAdapter("https://api.dev.pika.art/v1",f.fetchImpl);
    expect((await fails(a.submit(req("pika-2.5"),KEY))).kind).toBe("balance");
    const e=await fails(a.submit(req("pika-2.5"),KEY));expect(e.kind).toBe("auth");expect(e.message).toBe("Invalid API key");
    expect((await fails(a.submit(req("pika-2.5"),KEY))).kind).toBe("invalid");
    expect(a.cancel).toBeUndefined();
  });
});

describe("Krea",()=>{
  it("posts to the model's own endpoint with a Bearer token",async()=>{
    const f=fake([{body:{job_id:"j1",status:"scheduled"}}]);
    const r=await kreaAdapter("https://api.krea.ai",f.fetchImpl).submit(req("krea-veo-3.1",{durationS:6}),KEY);
    const c=f.calls[0];
    expect(c.url).toBe("https://api.krea.ai/generate/video/google/veo-3.1");expect(c.headers.Authorization).toBe("Bearer "+KEY);
    expect(c.body).toEqual({prompt:"==== SCENE CONTEXT ====\nA test.",duration:6,aspect_ratio:"16:9",resolution:"720p"});
    expect(r.taskId).toBe("j1");
  });
  it("waits through every pending state and reads result.urls",async()=>{
    const pend=["queued","backlogged","scheduled","processing","sampling","intermediate-complete"].map(s=>({body:{status:s}}));
    const f=fake([...pend,{body:{status:"completed",result:{urls:["https://gen.krea.ai/v.mp4"]}}},{body:{status:"failed",error:{code:"content_policy"}}},{body:{status:"cancelled"}}]);
    const a=kreaAdapter("https://api.krea.ai",f.fetchImpl);
    for(const _ of pend)expect((await a.poll("j1",KEY)).status).toBe("processing");
    expect(await a.poll("j1",KEY)).toEqual({status:"success",videoUrl:"https://gen.krea.ai/v.mp4"});
    const x=await a.poll("j1",KEY);expect(x.status==="error"&&x.error.kind).toBe("invalid");
    expect((await a.poll("j1",KEY)).status).toBe("error");
    expect(f.calls[0]).toMatchObject({method:"GET",url:"https://api.krea.ai/jobs/j1"});
  });
  it("cancel is DELETE on the job; 402 means no API balance",async()=>{
    const f=fake([{status:200,body:{}},{status:402,body:{message:"Top up your API balance"}}]);
    const a=kreaAdapter("https://api.krea.ai",f.fetchImpl);
    await a.cancel!("j1",KEY);expect(f.calls[0]).toMatchObject({method:"DELETE",url:"https://api.krea.ai/jobs/j1"});
    expect((await fails(a.submit(req("krea-veo-3.1"),KEY))).kind).toBe("balance");
  });
});

describe("all providers",()=>{
  const adapters:Record<string,ProviderAdapter>={higgsfield:higgsfieldAdapter("https://h"),runway:runwayAdapter("https://r"),pika:pikaAdapter("https://p"),krea:kreaAdapter("https://k")};
  it("without a key nothing is sent",async()=>{
    for(const [id,a] of Object.entries(adapters)){
      const m=registry.models.find(x=>x.provider===id)!;
      expect((await fails(a.submit(req(m.id),""))).kind).toBe("auth");
    }
  });
  it("every model in the registry has a provider entry and an adapter capability that matches",()=>{
    for(const m of registry.models)expect(registry.providers[m.provider]).toBeTruthy();
    for(const [id,a] of Object.entries(adapters))expect(!!a.cancel).toBe(registry.providers[id].capabilities.cancel);
  });
});

describe("registry rules used by the new models",()=>{
  it("fixed durations: 20 s is refused and fitted to the longest length that exists",()=>{
    const S=example(),m=M("pika-2.5");
    expect(validateForModel(S,m,"720p")[0]).toMatchObject({code:"durationNotAllowed",limit:"5, 10"});
    const F=fitToModel(S,m);expect(F.dur).toBe(10);expect(total(F)).toBe(10);expect(F.shots).toHaveLength(6);
    expect(validateForModel(F,m,"720p").filter(i=>i.blocking)).toEqual([]);
    expect(fitToModel({...blank(),dur:3},m).dur).toBe(5);
  });
  it("price by duration and minimum charge",()=>{
    expect(estimateCost(M("pika-2.5"),"1080p",10)!.usd).toBe(0.6);
    expect(estimateCost(M("pika-2.5"),"1080p",5)!.usd).toBe(0.45);
    expect(estimateCost(M("runway-seedance-2.5"),"720p",2)!.usd).toBe(0.8);
    expect(estimateCost(M("runway-seedance-2.5"),"720p",10)!.usd).toBe(3);
    expect(estimateCost(M("higgsfield-kling-4.0-flash"),"720p",20)!.usd).toBe(1.88);
  });
  it("a model without a checked price is listed but not offered",()=>{
    expect(resolutionsFor(M("krea-seedance-2.5"),"16:9")).toEqual([]);
    expect(resolutionsFor(M("krea-veo-3.1"),"16:9")).toEqual(["720p"]);
    expect(resolutionsFor(M("higgsfield-seedance-2.5"),"9:16")).toEqual([]);
  });
});
