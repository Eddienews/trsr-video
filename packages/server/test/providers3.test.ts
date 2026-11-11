// Kling and Google adapters, and the compact prompt, against scripted answers: no network, no credit.
import {describe,it,expect} from "vitest";
import {klingAdapter} from "../src/providers/kling";
import {googleAdapter} from "../src/providers/google";
import {ProviderError,type FetchLike,type SubmitRequest} from "../src/providers/types";
import {estimateCost,validateForModel,example,blank,plain,promptFor,compactPrompt} from "@trsr-video/core";
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
const req=(id:string,over:Partial<SubmitRequest>={}):SubmitRequest=>({model:M(id),prompt:"A test.",size:[1280,720],resolution:"720p",aspect:"16:9",durationS:10,audio:true,...over});
const fails=async(p:Promise<unknown>)=>{try{await p}catch(e){return e as ProviderError}throw new Error("expected a ProviderError")};
const tick=()=>new Promise(r=>setTimeout(r,5));
const KEY="secret-key-123";

describe("Kling",()=>{
  const URL="https://api-singapore.klingai.com";
  it("posts the prompt as contents and the output as settings",async()=>{
    const f=fake([{body:{code:0,message:"ok",data:{id:"893605",status:"submitted"}}}]);
    const r=await klingAdapter(URL,f.fetchImpl).submit(req("kling-direct-4.0-flash"),KEY);
    const c=f.calls[0];
    expect(c.url).toBe(URL+"/omni-video/kling-4.0-flash");expect(c.headers.Authorization).toBe("Bearer "+KEY);
    expect(c.body).toEqual({contents:[{type:"prompt",text:"A test."}],settings:{resolution:"720p",aspect_ratio:"16:9",duration:10}});
    expect(r.taskId).toBe("893605");
  });
  it("queries the task and reads the video output",async()=>{
    const f=fake([{body:{code:0,data:[{id:"893605",status:"processing"}]}},
      {body:{code:0,data:[{id:"893605",status:"succeeded",outputs:[{type:"image",url:"https://k/i.png"},{type:"video",id:"v",url:"https://k/v.mp4",duration:"10"}]}]}},
      {body:{code:0,data:[{id:"893605",status:"failed",message:"content risk control"}]}}]);
    const a=klingAdapter(URL,f.fetchImpl);
    expect((await a.poll("893605",KEY)).status).toBe("processing");
    expect(await a.poll("893605",KEY)).toEqual({status:"success",videoUrl:"https://k/v.mp4"});
    const x=await a.poll("893605",KEY);expect(x.status==="error"&&x.error.message).toBe("content risk control");
    expect(f.calls[0]).toMatchObject({method:"GET",url:URL+"/tasks?task_ids=893605"});
  });
  it.each([[401,1002,"auth"],[429,1101,"balance"],[429,1102,"balance"],[403,1103,"auth"],[400,1201,"invalid"],[400,1301,"invalid"],[429,1302,"busy"],[429,1303,"concurrency"],[503,5001,"busy"],[500,5000,"provider"]])
  ("HTTP %i with service code %i → %s",async(status,code,kind)=>{
    const f=fake([{status:status as number,body:{code,message:"m"+code}}]);
    const e=await fails(klingAdapter(URL,f.fetchImpl).submit(req("kling-direct-4.0"),KEY));
    expect(e.kind).toBe(kind);expect(e.message).toBe("m"+code);
  });
  it("a service error on HTTP 200 is still an error; there is no cancel",async()=>{
    const f=fake([{body:{code:1102,message:"Resource pack exhausted"}}]);
    const a=klingAdapter(URL,f.fetchImpl);
    expect((await fails(a.submit(req("kling-direct-4.0"),KEY))).kind).toBe("balance");
    expect(a.cancel).toBeUndefined();
  });
  it("prices match the unit table",()=>{
    expect(estimateCost(M("kling-direct-4.0-flash"),"720p",20)!.usd).toBe(1.88);
    expect(estimateCost(M("kling-direct-4.0"),"1080p",10)!.usd).toBe(2.35);
  });
});

describe("Google (Gemini Omni Flash)",()=>{
  const URL="https://generativelanguage.googleapis.com/v1beta";
  const video=Buffer.from("fake mp4 bytes").toString("base64");
  it("starts one interaction with the key in a header, and hands back the inline video",async()=>{
    const f=fake([{body:{id:"i1",status:"completed",steps:[{type:"model_output",content:[{type:"video",mime_type:"video/mp4",data:video}]}]}}]);
    const a=googleAdapter(URL,f.fetchImpl);
    const {taskId}=await a.submit(req("google-gemini-omni-flash"),KEY);
    const c=f.calls[0];
    expect(c.url).toBe(URL+"/interactions");expect(c.url).not.toContain(KEY);expect(c.headers["x-goog-api-key"]).toBe(KEY);
    expect(c.body).toEqual({model:"gemini-omni-1.1-flash",input:"A test.",response_format:{type:"video",resolution:"720p",aspect_ratio:"16:9"}});
    expect("duration" in c.body).toBe(false);
    await tick();
    const r=await a.poll(taskId,KEY);
    expect(r.status).toBe("success");
    // The queue downloads with fetch(); a data: URL goes through the same path.
    const bytes=Buffer.from(await (await fetch((r as any).videoUrl)).arrayBuffer());
    expect(bytes.toString()).toBe("fake mp4 bytes");
    expect(f.calls).toHaveLength(1);
  });
  it("is 'processing' until the call comes back",async()=>{
    let release!:(v:any)=>void;
    const slow:FetchLike=()=>new Promise(r=>{release=r});
    const a=googleAdapter(URL,slow);
    const {taskId}=await a.submit(req("google-gemini-omni-flash"),KEY);
    expect((await a.poll(taskId,KEY)).status).toBe("processing");
    release({status:200,ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({steps:[]})});await tick();
    const r=await a.poll(taskId,KEY);expect(r.status==="error"&&r.error.code).toBe("noVideo");
  });
  it("errors of the open call arrive on the next poll, sorted by HTTP status",async()=>{
    const a=googleAdapter(URL,fake([{status:400,body:{error:{code:400,message:"API key not valid",status:"INVALID_ARGUMENT"}}}]).fetchImpl);
    const t1=(await a.submit(req("google-gemini-omni-flash"),KEY)).taskId;await tick();
    const r1=await a.poll(t1,KEY);expect(r1.status==="error"&&[r1.error.kind,r1.error.message]).toEqual(["invalid","API key not valid"]);
    const b=googleAdapter(URL,fake([{status:403,body:{error:{code:403,message:"denied"}}}]).fetchImpl);
    const t2=(await b.submit(req("google-gemini-omni-flash"),KEY)).taskId;await tick();
    const r2=await b.poll(t2,KEY);expect(r2.status==="error"&&r2.error.kind).toBe("auth");
  });
  it("without a key nothing starts; an unknown task (after a restart) is not retried",async()=>{
    const f=fake([]);const a=googleAdapter(URL,f.fetchImpl);
    expect((await fails(a.submit(req("google-gemini-omni-flash"),""))).kind).toBe("auth");
    const r=await a.poll("gone",KEY);expect(r.status==="error"&&r.error.code).toBe("interrupted");
    expect(f.calls).toHaveLength(0);
  });
  it("any duration passes, with a note that the model decides",()=>{
    const i=validateForModel(example(),M("google-gemini-omni-flash"),"720p");
    expect(i).toEqual([{code:"durationNotControlled",blocking:false,value:20}]);
    expect(estimateCost(M("google-gemini-omni-flash"),"720p",20)!.usd).toBe(2.028);
  });
});

describe("compact prompt",()=>{
  const S=example(),full=plain({...S,mode:"full"});
  it("is much shorter than the full prompt and keeps the essentials",()=>{
    const c=compactPrompt(S,{multiShot:true});
    expect(c.level).toBe(0);expect(c.text.length).toBeLessThan(full.length*0.6);expect(c.text.length).toBeLessThan(5000);
    for(const must of ["A 20-second comedy animated short.","THE KEEPER (","THE GULL (","6 SHOTS with HARD CUTS at 0:03 / 0:06 / 0:10 / 0:14 / 0:17:","In frame: ONLY THE KEEPER, THE GULL.","ONE match. ONE lamp. The gull lights it.","NO subtitles, NO watermark, NO logos."])expect(c.text).toContain(must);
    expect(c.text).not.toContain("====");
  });
  it("for a model without cuts the shots become one continuous action",()=>{
    const c=compactPrompt(S,{multiShot:false});
    expect(c.text).toContain("ONE continuous shot, no cuts.");expect(c.text).toContain("ACTION in order:");expect(c.text).toContain(" Then: ");
    expect(c.text).not.toContain("HARD CUTS");
  });
  it("drops the least important parts first and always fits the limit",()=>{
    for(const max of [3000,1500,900,400]){
      const c=compactPrompt(S,{multiShot:true,maxChars:max});
      expect(c.text.length).toBeLessThanOrEqual(max);expect(c.text.endsWith("NO subtitles, NO watermark, NO logos.")).toBe(true);
    }
    expect(compactPrompt(S,{multiShot:true,maxChars:400}).level).toBe(4);
    expect(compactPrompt(S,{multiShot:true,maxChars:900}).text).toContain("A 20-second comedy animated short.");
  });
  it("an empty form still gives a valid prompt",()=>{
    const c=compactPrompt(blank(),{multiShot:true});
    expect(c.text.startsWith("A 20-second comedy animated short.")).toBe(true);expect(c.text).toContain("5 SHOTS with HARD CUTS");
  });
  it("automatic choice: full where the model cuts and has room, compact otherwise; either can be forced",()=>{
    expect(promptFor(S,M("seedance-2.0-mini")).kind).toBe("full");
    expect(promptFor(S,M("kling-direct-4.0-flash")).kind).toBe("full");
    expect(promptFor(S,M("ltx-2.5-fast")).kind).toBe("compact");          // 5000-character limit
    expect(promptFor(S,M("ltx-2.5-fast")).text).toContain("HARD CUTS");
    expect(promptFor(S,M("pika-2.5")).text).toContain("ONE continuous shot");  // no cuts
    expect(promptFor(S,M("runway-gen4.5")).kind).toBe("compact");
    expect(promptFor(S,M("seedance-2.0-mini"),"compact").kind).toBe("compact");
    expect(promptFor(S,M("pika-2.5"),"full").text).toBe(full);
  });
  it("every model in the registry gets a prompt within its limit in automatic mode",()=>{
    for(const m of registry.models){const p=promptFor(S,m);if(m.maxPromptChars!==null)expect(p.text.length).toBeLessThanOrEqual(m.maxPromptChars)}
  });
});
