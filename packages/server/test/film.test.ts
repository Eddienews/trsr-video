import {describe,it,expect,afterEach} from "vitest";
import http,{type Server} from "node:http";
import {mkdirSync} from "node:fs";
import {example} from "@trsr-video/core";
import {EnvFile} from "../src/env";
import {JobQueue} from "../src/jobs";
import {createApp} from "../src/app";
import {runwareAdapter} from "../src/providers/runware";
import {Comfy} from "../src/local/comfy";
import {ImageStore} from "../src/local/images";
import {Ffmpeg} from "../src/local/ffmpeg";
import {fakeRunware,ack,success,rwError,registry,tmp,writeFileSync,path} from "./helpers";

let server:Server,base:string,queue:JobQueue,rw:ReturnType<typeof fakeRunware>,dir:string,joined:string[][];
const KEY="rw-test-key-abcdef9876";
// A 60-second film: 18 shots that break cleanly at 15, 30 and 45 seconds.
const film=()=>{const S=example();S.title="The Chase";S.shots=[4,3,3,3,2, 5,3,3,4, 4,3,4,4, 3,3,4,3,2].map((len,i)=>({...S.shots[i%6],len}));S.dur=60;return S};
const img=(id:string,kind:string,label:string)=>({id,project:"The Chase",taskId:id,kind,label,modelId:"z-image-turbo",modelLabel:"Z",prompt:"p",seed:1,width:1344,height:768,refs:[],status:"done",file:id+".png",createdAt:"2026-01-01T00:00:00Z"});
async function boot(script:Parameters<typeof fakeRunware>[0]){
  dir=tmp();writeFileSync(path.join(dir,".env"),"RUNWARE_API_KEY="+KEY+"\n");joined=[];
  mkdirSync(path.join(dir,"images"),{recursive:true});
  writeFileSync(path.join(dir,"images.json"),JSON.stringify([img("leo","reference","THE LEOPARD"),img("rab","reference","THE RABBIT"),img("sav","plate","SAVANNA")]));
  for(const f of ["leo","rab","sav"])writeFileSync(path.join(dir,"images",f+".png"),"png");
  const env=new EnvFile(path.join(dir,".env"));rw=fakeRunware(script);
  const images=new ImageStore({dataDir:dir,comfy:new Comfy(()=>"http://127.0.0.1:9")});
  queue=new JobQueue({dataDir:dir,adapters:{runware:runwareAdapter("https://api.runware.ai/v1",rw.fetchImpl)},model:id=>registry.models.find(m=>m.id===id),
    apiKey:p=>env.get(registry.providers[p].envKey),sleep:async()=>{},download:async()=>{},refImage:async id=>"data:image/jpeg;base64,"+id,join:async files=>{joined.push(files)},lastFrame:async f=>"data:image/jpeg;base64,last-of-"+path.basename(f)});
  const app=createApp({env,registry,queue,videosDir:path.join(dir,"videos"),version:"test",local:{comfy:new Comfy(()=>"http://127.0.0.1:9"),images,ffmpeg:new Ffmpeg(()=>"",async()=>({code:0,out:""}))}});
  server=http.createServer(app);await new Promise<void>(r=>server.listen(0,"127.0.0.1",()=>r()));
  base="http://127.0.0.1:"+(server.address() as any).port;
}
const api=async(method:string,url:string,body?:unknown)=>{
  const r=await fetch(base+url,{method,headers:body===undefined?{}:{"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();return {status:r.status,json:text?JSON.parse(text):null};
};
const settled=async()=>{for(let i=0;i<400&&queue.list().some(j=>!["done","failed","canceled"].includes(j.status));i++)await new Promise(r=>setTimeout(r,5))};
const ask={modelId:"seedance-2.0-mini",resolution:"480p",refs:["leo","rab","sav"]};
afterEach(()=>new Promise<void>(r=>server.close(()=>r())));

describe("a film longer than one generation",()=>{
  it("is planned in parts that break between shots, with the total cost",async()=>{
    await boot([]);
    const r=await api("POST","/api/estimate-film",{...ask,state:film()});
    expect(r.status).toBe(200);
    expect(r.json.parts.map((p:any)=>[p.part,p.startS,p.durationS,p.shots])).toEqual([[1,0,15,5],[2,15,15,4],[3,30,15,4],[4,45,15,5]]);
    expect(r.json.totalUSD).toBe(2.16);
    expect(r.json.parts[2].prompt).toContain("PART 3 OF 4 of a 60-second film (this part: 0:30–0:45).");
    expect(r.json.parts[2].prompt).toContain("IMAGE 1 = the reference of THE LEOPARD");
    expect(r.json.parts[2].prompt).toContain("IMAGE 3 = the place «SAVANNA»");
    expect(r.json.refsMax).toBe(9);
    expect(rw.calls).toHaveLength(0);
  });
  it("parts can be kept shorter than the model's longest clip, one scene per part",async()=>{
    await boot([]);
    const long=await api("POST","/api/estimate-film",{modelId:"kling-4.0-flash",resolution:"720p",refs:[],state:film()});
    expect(long.json.parts.map((p:any)=>p.durationS)).toEqual([20,17,18,5]);
    const short=await api("POST","/api/estimate-film",{modelId:"kling-4.0-flash",resolution:"720p",refs:["leo"],partS:15,state:film()});
    expect(short.json.parts.map((p:any)=>p.durationS)).toEqual([15,15,15,15]);
    expect(short.json.totalUSD).toBe(5.64);
    expect(short.json.parts[0].prompt).toContain("<<<image_1>>> = the reference of THE LEOPARD");
    expect((await api("POST","/api/estimate-film",{...ask,partS:99,state:film()})).json.parts).toHaveLength(4);
  });
  it("chained: each part after the first also carries the last frame of the part before it",async()=>{
    await boot([ack("A"),success("A",0.54),ack("B"),success("B",0.55),ack("C"),success("C",0.54),ack("D"),success("D",0.56)]);
    const plan=await api("POST","/api/estimate-film",{...ask,chain:true,state:film()});
    expect(plan.json.totalUSD).toBe(2.16);
    expect(plan.json.parts[0].prompt).not.toContain("last frame of the previous part");
    expect(plan.json.parts[1].prompt).toContain("IMAGE 4 is the last frame of the previous part");
    const r=await api("POST","/api/generate-film",{...ask,chain:true,state:film(),confirmed:true,estimateUSD:2.16});
    expect(r.status).toBe(202);await settled();
    const sent=rw.calls.map(c=>c.tasks[0]).filter(t=>t.taskType==="videoInference"),done=queue.list().filter(j=>j.film&&j.film.part>0).sort((a,b)=>a.film!.part-b.film!.part);
    expect(sent).toHaveLength(4);
    expect(JSON.stringify(sent[0])).not.toContain("last-of-");
    for(const k of [1,2,3])expect(JSON.stringify(sent[k])).toContain("last-of-"+done[k-1].videoFile);
    expect(joined).toHaveLength(1);
  });
  it("nothing is sent without the OK and the total the person saw",async()=>{
    await boot([]);
    expect((await api("POST","/api/generate-film",{...ask,state:film()})).json.error).toBe("notConfirmed");
    expect((await api("POST","/api/generate-film",{...ask,state:film(),confirmed:true,estimateUSD:1})).json.error).toBe("estimateChanged");
    expect(rw.calls).toHaveLength(0);expect(queue.list()).toHaveLength(0);
  });
  it("every part carries the same reference images, and the parts are joined at the end",async()=>{
    await boot([ack("A"),success("A",0.54),ack("B"),success("B",0.55),ack("C"),success("C",0.54),ack("D"),success("D",0.56)]);
    const r=await api("POST","/api/generate-film",{...ask,state:film(),confirmed:true,estimateUSD:2.16});
    expect(r.status).toBe(202);expect(r.json.jobs).toHaveLength(4);
    await settled();
    const sent=rw.calls.map(c=>c.tasks[0]).filter(t=>t.taskType==="videoInference");
    expect(sent).toHaveLength(4);
    for(const t of sent){
      expect(t.inputs).toEqual({referenceImages:["data:image/jpeg;base64,leo","data:image/jpeg;base64,rab","data:image/jpeg;base64,sav"]});
      expect(t.duration).toBe(15);expect(t.frameImages).toBeUndefined();
    }
    expect(sent.map(t=>/PART (\d) OF 4/.exec(t.positivePrompt)![1])).toEqual(["1","2","3","4"]);
    const jobs=queue.list(),parts=jobs.filter(j=>j.film&&j.film.part>0).sort((a,b)=>a.film!.part-b.film!.part),whole=jobs.find(j=>j.film?.part===0)!;
    expect(parts.map(j=>j.modelLabel)).toEqual([1,2,3,4].map(k=>"Seedance 2.0 Mini · Runware · part "+k+"/4"));
    expect(joined).toHaveLength(1);expect(joined[0]).toEqual(parts.map(j=>path.join(dir,"videos",j.id+".mp4")));
    expect(whole).toMatchObject({status:"done",durationS:60,realUSD:2.19,modelLabel:"Seedance 2.0 Mini · Runware · 4 parts joined",videoFile:parts[0].film!.id+"-film.mp4"});
    // The joined film repeats what its parts cost; it is not a new charge.
    expect(queue.spentToday()).toBe(2.19);
  });
  it("when a part fails, the parts still waiting are not sent",async()=>{
    await boot([ack("A"),success("A",0.54),rwError("invalidPositivePrompt",400)]);
    await api("POST","/api/generate-film",{...ask,state:film(),confirmed:true,estimateUSD:2.16});
    await settled();
    const st=queue.list().sort((a,b)=>a.film!.part-b.film!.part).map(j=>j.status);
    expect(st).toEqual(["done","failed","canceled","canceled"]);
    expect(rw.left()).toBe(0);expect(joined).toHaveLength(0);
    expect(queue.spentToday()).toBe(0.54);
  });
  it("a film that stopped halfway is resumed: finished parts are kept and not paid again",async()=>{
    await boot([ack("A"),success("A",0.54),rwError("invalidPositivePrompt",400),ack("B"),success("B",0.55),ack("C"),success("C",0.54),ack("D"),success("D",0.56)]);
    const first=await api("POST","/api/generate-film",{...ask,state:film(),confirmed:true,estimateUSD:2.16});
    await settled();
    const id=first.json.filmId,est=await api("POST","/api/estimate-film",{...ask,state:film(),resume:id});
    expect(est.json.parts.map((p:any)=>p.done)).toEqual([true,false,false,false]);expect(est.json.totalUSD).toBe(1.62);
    expect((await api("POST","/api/generate-film",{...ask,state:film(),resume:id,confirmed:true,estimateUSD:2.16})).json.error).toBe("estimateChanged");
    const again=await api("POST","/api/generate-film",{...ask,state:film(),resume:id,confirmed:true,estimateUSD:1.62});
    expect(again.status).toBe(202);expect(again.json.filmId).toBe(id);expect(again.json.jobs.map((j:any)=>j.film.part)).toEqual([2,3,4]);
    await settled();
    expect(rw.calls.filter(c=>c.tasks[0].taskType==="videoInference")).toHaveLength(5);
    const jobs=queue.list(),whole=jobs.find(j=>j.film?.part===0)!;
    expect(joined).toHaveLength(1);expect(joined[0]).toHaveLength(4);
    expect(joined[0][0]).toBe(path.join(dir,"videos",jobs.find(j=>j.film?.part===1)!.id+".mp4"));
    expect(whole).toMatchObject({status:"done",durationS:60,realUSD:2.19});
    expect((await api("POST","/api/generate-film",{...ask,state:film(),resume:id,confirmed:true,estimateUSD:0})).json.error).toBe("nothingToDo");
    expect((await api("POST","/api/estimate-film",{...ask,resolution:"720p",state:film(),resume:id})).json.error).toBe("resumeMismatch");
  });
  it("refuses references the model does not take, references that do not exist, and a film that cannot be split",async()=>{
    await boot([]);
    const S=film();
    expect((await api("POST","/api/estimate-film",{modelId:"higgsfield-kling-4.0-flash",resolution:"720p",refs:["leo"],state:S})).json.error).toBe("refsUnsupported");
    expect((await api("POST","/api/estimate-film",{...ask,refs:["nope"],state:S})).json.error).toBe("refNotFound");
    const L=film();L.shots[0].len=19;L.dur=75;
    expect((await api("POST","/api/estimate-film",{...ask,state:L})).json).toMatchObject({error:"cannotSplit",maxS:15});
    const ten=Array.from({length:10},()=>"leo");
    expect((await api("POST","/api/estimate-film",{...ask,refs:ten,state:S})).json).toMatchObject({error:"tooManyRefs",max:9});
  });
});
