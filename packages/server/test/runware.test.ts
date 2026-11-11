import {describe,it,expect} from "vitest";
import {runwareAdapter} from "../src/providers/runware";
import {ProviderError} from "../src/providers/types";
import {fakeRunware,ack,processing,success,rwError,M} from "./helpers";

const URL="https://api.runware.ai/v1";
const req=(id:string,over:object={})=>({model:M(id),prompt:"==== SCENE CONTEXT ====\nA test.",size:[864,496] as [number,number],resolution:"480p",aspect:"16:9",durationS:15,audio:true,...over});
const fails=async(p:Promise<unknown>)=>{try{await p}catch(e){return e as ProviderError}throw new Error("expected a ProviderError")};

describe("Runware adapter: submit",()=>{
  it("sends one async videoInference task with the key in the header only",async()=>{
    const f=fakeRunware([ack("abc")]);
    const r=await runwareAdapter(URL,f.fetchImpl).submit(req("seedance-2.0-mini"),"KEY123");
    const c=f.calls[0],t=c.tasks[0];
    expect(c.url).toBe(URL);expect(c.auth).toBe("Bearer KEY123");
    expect(JSON.stringify(c.tasks)).not.toContain("KEY123");
    expect(t).toMatchObject({taskType:"videoInference",model:"bytedance:seedance@2.0-mini",width:864,height:496,duration:15,
      deliveryMethod:"async",includeCost:true,outputType:"URL",outputFormat:"MP4",numberResults:1,settings:{audio:true}});
    expect(t.taskUUID).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.taskId).toBe("abc");
  });
  it("leaves the audio switch out when the model's docs do not name it",async()=>{
    const f=fakeRunware([ack()]);
    await runwareAdapter(URL,f.fetchImpl).submit(req("kling-4.0-flash",{size:[1280,720],audio:false}),"K");
    expect(f.calls[0].tasks[0].settings).toBeUndefined();
    expect(f.calls[0].tasks[0].model).toBe("klingai:kling-video@4.0-flash");
  });
  it("without a key nothing is sent",async()=>{
    const f=fakeRunware([]);
    const e=await fails(runwareAdapter(URL,f.fetchImpl).submit(req("seedance-2.5"),""));
    expect(e.kind).toBe("auth");expect(f.calls).toHaveLength(0);
  });
  it.each([
    ["invalidApiKey",401,"auth",false],["whatever",403,"auth",false],["insufficientCredits",402,"balance",false],
    ["concurrentRequestLimitExceeded",400,"concurrency",true],["serviceOverloaded",503,"busy",true],["x",429,"busy",true],
    ["unsupportedModelResolution",400,"invalid",false],["unsupportedDuration",400,"invalid",false],["boom",500,"provider",false],
  ])("%s (HTTP %i) → %s",async(code,status,kind,retryable)=>{
    const f=fakeRunware([rwError(code as string,status as number)]);
    const e=await fails(runwareAdapter(URL,f.fetchImpl).submit(req("seedance-2.5"),"K"));
    expect(e).toBeInstanceOf(ProviderError);expect(e.kind).toBe(kind);expect(e.retryable).toBe(retryable);
  });
  it("keeps the list of sizes the API allows",async()=>{
    const f=fakeRunware([rwError("unsupportedModelResolution",400,{parameter:"width",allowedValues:["854x480","480x854"]})]);
    const e=await fails(runwareAdapter(URL,f.fetchImpl).submit(req("seedance-2.5"),"K"));
    expect(e.extra.allowedValues).toEqual(["854x480","480x854"]);expect(e.extra.parameter).toBe("width");
  });
  it("an errors array on HTTP 200 is still an error",async()=>{
    const f=fakeRunware([{status:200,body:{errors:[{code:"concurrentRequestLimitExceeded",message:"busy"}]}}]);
    expect((await fails(runwareAdapter(URL,f.fetchImpl).submit(req("seedance-2.5"),"K"))).kind).toBe("concurrency");
  });
  it("reads Retry-After, and survives a non-JSON error page",async()=>{
    const f=fakeRunware([{status:429,body:"<html>slow down</html>",headers:{"retry-after":"12"}}]);
    const e=await fails(runwareAdapter(URL,f.fetchImpl).submit(req("seedance-2.5"),"K"));
    expect(e.kind).toBe("busy");expect(e.extra.retryAfterS).toBe(12);
  });
  it("a network failure is reported as such",async()=>{
    const e=await fails(runwareAdapter(URL,async()=>{throw new Error("ECONNRESET")}).submit(req("seedance-2.5"),"K"));
    expect(e.kind).toBe("network");
  });
});
describe("Runware adapter: poll",()=>{
  it("asks with getResponse and reports progress",async()=>{
    const f=fakeRunware([processing("T1",47)]);
    expect(await runwareAdapter(URL,f.fetchImpl).poll("T1","K")).toEqual({status:"processing",progress:47});
    expect(f.calls[0].tasks).toEqual([{taskType:"getResponse",taskUUID:"T1"}]);
  });
  it("returns the video, the real cost and the seed",async()=>{
    const f=fakeRunware([success("T1",0.57)]);
    expect(await runwareAdapter(URL,f.fetchImpl).poll("T1","K")).toEqual({status:"success",videoUrl:"https://im.runware.ai/video/x.mp4",costUSD:0.57,seed:7});
  });
  it("an empty answer means still processing",async()=>{
    const f=fakeRunware([{body:{data:[]}}]);
    expect((await runwareAdapter(URL,f.fetchImpl).poll("T1","K")).status).toBe("processing");
  });
  it("a provider failure comes back as an error result",async()=>{
    const f=fakeRunware([{body:{errors:[{code:"timeoutProvider",status:"error",message:"The external provider did not respond",taskUUID:"T1"}]}}]);
    const r=await runwareAdapter(URL,f.fetchImpl).poll("T1","K");
    expect(r.status).toBe("error");if(r.status==="error"){expect(r.error.kind).toBe("provider");expect(r.error.code).toBe("timeoutProvider")}
  });
});
