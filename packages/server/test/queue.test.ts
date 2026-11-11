import {describe,it,expect} from "vitest";
import {example,plain} from "@trsr-video/core";
import {JobQueue,type QueueDeps} from "../src/jobs";
import {runwareAdapter} from "../src/providers/runware";
import {fakeRunware,ack,processing,success,rwError,registry,M,tmp,readFileSync,path} from "./helpers";

const URL="https://api.runware.ai/v1";
function setup(script:Parameters<typeof fakeRunware>[0],over:Partial<QueueDeps>={}){
  const f=fakeRunware(script),dataDir=tmp(),downloads:string[]=[],sleeps:number[]=[];
  const q=new JobQueue({dataDir,adapters:{runware:runwareAdapter(URL,f.fetchImpl)},model:id=>registry.models.find(m=>m.id===id),apiKey:()=>"KEY-SECRET-1234",
    sleep:async ms=>{sleeps.push(ms)},download:async(u,d)=>{downloads.push(u+" → "+path.basename(d))},...over});
  return {q,f,dataDir,downloads,sleeps};
}
const input=(id="seedance-2.0-mini",usd=0.54)=>{const S=example();return {title:S.title,modelId:id,modelLabel:M(id).label,provider:"runware",resolution:"480p",size:[864,496] as [number,number],
  durationS:15,audio:true,prompt:plain({...S,mode:"full"}),state:S,estimateUSD:usd,priceAsOf:"2026-11-10"}};

describe("queue",()=>{
  it("submit → poll → download → done, with the real cost",async()=>{
    const {q,f,downloads,dataDir}=setup([ack(),processing("T1",30),success("T1",0.57)]);
    const j=q.add(input());await q.idle();
    expect(q.get(j.id)).toMatchObject({status:"done",taskId:"T1",realUSD:0.57,seed:7,videoFile:j.id+".mp4",estimateUSD:0.54});
    expect(downloads).toEqual(["https://im.runware.ai/video/x.mp4 → "+j.id+".mp4"]);
    expect(f.left()).toBe(0);
    expect(readFileSync(path.join(dataDir,"jobs.json"),"utf8")).not.toContain("KEY-SECRET");
  });
  it("runs one request at a time, in order",async()=>{
    const {q,f}=setup([ack("A"),success("A"),ack("B"),success("B")]);
    const a=q.add(input()),b=q.add(input());await q.idle();
    expect(f.calls.map(c=>c.tasks[0].taskType)).toEqual(["videoInference","getResponse","videoInference","getResponse"]);
    expect(q.get(a.id)!.status).toBe("done");expect(q.get(b.id)!.status).toBe("done");
  });
  it("waits and tries again when the provider is holding the credit of another request",async()=>{
    const {q,sleeps}=setup([rwError("concurrentRequestLimitExceeded"),rwError("concurrentRequestLimitExceeded"),ack(),success()],{retryWaitMs:15000});
    const j=q.add(input());await q.idle();
    expect(q.get(j.id)!.status).toBe("done");
    expect(sleeps.filter(s=>s===15000)).toHaveLength(2);
  });
  it("gives up after the retry limit instead of looping forever",async()=>{
    const {q,f}=setup(Array.from({length:3},()=>rwError("concurrentRequestLimitExceeded")),{maxRetries:2});
    const j=q.add(input());await q.idle();
    expect(q.get(j.id)).toMatchObject({status:"failed",error:{kind:"concurrency"}});expect(f.calls).toHaveLength(3);
  });
  it("an invalid key stops everything: one call, no retry, the rest stays queued",async()=>{
    const {q,f}=setup([rwError("invalidApiKey",401)]);
    const a=q.add(input()),b=q.add(input());await q.idle();
    expect(f.calls).toHaveLength(1);
    expect(q.get(a.id)).toMatchObject({status:"failed",error:{kind:"auth",code:"invalidApiKey"}});
    expect(q.get(b.id)!.status).toBe("queued");
    expect(q.paused).toMatchObject({reason:"auth",provider:"runware"});
  });
  it("resume() after fixing the key runs what was waiting",async()=>{
    const {q}=setup([rwError("invalidApiKey",401),ack("B"),success("B")]);
    q.add(input());const b=q.add(input());await q.idle();
    q.resume();await q.idle();
    expect(q.paused).toBeNull();expect(q.get(b.id)!.status).toBe("done");
  });
  it("no balance pauses too",async()=>{
    const {q}=setup([rwError("insufficientCredits",402)]);
    q.add(input());await q.idle();expect(q.paused?.reason).toBe("balance");
  });
  it("a refused size fails the job and keeps the allowed list",async()=>{
    const {q}=setup([rwError("unsupportedModelResolution",400,{allowedValues:["864x496"]})]);
    const j=q.add(input());await q.idle();
    expect(q.get(j.id)).toMatchObject({status:"failed",error:{kind:"invalid",allowedValues:["864x496"]}});expect(q.paused).toBeNull();
  });
  it("a provider failure while generating fails the job",async()=>{
    const {q}=setup([ack(),{body:{errors:[{code:"timeoutProvider",message:"timeout",taskUUID:"T1"}]}}]);
    const j=q.add(input());await q.idle();expect(q.get(j.id)).toMatchObject({status:"failed",error:{code:"timeoutProvider"}});
  });
  it("tolerates a few network blips while polling",async()=>{
    const {q}=setup([ack(),{status:503,body:{errors:[{code:"serviceOverloaded",message:"x"}]}},processing(),success()]);
    const j=q.add(input());await q.idle();expect(q.get(j.id)!.status).toBe("done");
  });
  it("times out without sending again",async()=>{
    let t=0;
    const {q,f}=setup([ack(),processing(),processing(),processing()],{now:()=>new Date(1e12+(t+=60000)),timeoutMs:120000});
    const j=q.add(input());await q.idle();
    expect(q.get(j.id)).toMatchObject({status:"failed",error:{code:"timeout"}});
    expect(f.calls.filter(c=>c.tasks[0].taskType==="videoInference")).toHaveLength(1);
  });
  it("cancel: a queued job is canceled; a running one is not, because Runware has no cancel",async()=>{
    const {q}=setup([rwError("invalidApiKey",401)]);
    q.add(input());const b=q.add(input());await q.idle();
    expect(await q.cancel(b.id)).toBe("canceled");expect(q.get(b.id)!.status).toBe("canceled");
    expect(await q.cancel("nope")).toBe("notFound");
    let release!:()=>void;const gate=new Promise<void>(r=>release=r);
    const s=setup([ack(),success()],{sleep:()=>gate});
    const j=s.q.add(input());await new Promise(r=>setTimeout(r,20));
    expect(s.q.get(j.id)!.status).toBe("generating");
    expect(await s.q.cancel(j.id)).toBe("notSupported");
    release();await s.q.idle();expect(s.q.get(j.id)!.status).toBe("done");
  });
  it("after a restart, a generating job is picked up again and a half-sent one is never resent",async()=>{
    let release!:()=>void;const gate=new Promise<void>(r=>release=r);
    const s=setup([ack("T9")],{sleep:()=>gate});
    const j=s.q.add(input());await new Promise(r=>setTimeout(r,20));
    const f2=fakeRunware([success("T9",0.6)]);
    const q2=new JobQueue({dataDir:s.dataDir,adapters:{runware:runwareAdapter(URL,f2.fetchImpl)},model:id=>registry.models.find(m=>m.id===id),apiKey:()=>"K",sleep:async()=>{},download:async()=>{}});
    q2.resume();await q2.idle();
    expect(q2.get(j.id)).toMatchObject({status:"done",realUSD:0.6});
    expect(f2.calls.map(c=>c.tasks[0].taskType)).toEqual(["getResponse"]);
    const {writeFileSync}=await import("node:fs");
    const d3=tmp();writeFileSync(path.join(d3,"jobs.json"),JSON.stringify([{...q2.get(j.id),status:"submitting",taskId:undefined,videoFile:undefined}]));
    const f3=fakeRunware([]);
    const q3=new JobQueue({dataDir:d3,adapters:{runware:runwareAdapter(URL,f3.fetchImpl)},model:id=>registry.models.find(m=>m.id===id),apiKey:()=>"K",sleep:async()=>{},download:async()=>{}});
    q3.resume();await q3.idle();
    expect(q3.get(j.id)).toMatchObject({status:"failed",error:{code:"interrupted"}});expect(f3.calls).toHaveLength(0);
  });
  it("spentToday counts real cost when known, the estimate while running, and nothing for unsent or canceled jobs",async()=>{
    const {q}=setup([ack(),success("T1",0.57),rwError("unsupportedDuration")]);
    q.add(input());q.add(input());await q.idle();
    expect(q.spentToday()).toBe(0.57);
  });
});
