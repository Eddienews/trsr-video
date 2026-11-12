import {describe,it,expect,afterEach} from "vitest";
import http,{type Server} from "node:http";
import {example,imageTasks} from "@trsr-video/core";
import {EnvFile} from "../src/env";
import {JobQueue} from "../src/jobs";
import {createApp,type CloudImageModel} from "../src/app";
import {Comfy} from "../src/local/comfy";
import {ImageStore} from "../src/local/images";
import {Ffmpeg} from "../src/local/ffmpeg";
import {runwareImage} from "../src/providers/runwareImage";
import {fakeRunware,rwError,registry,tmp,readFileSync,writeFileSync,path} from "./helpers";

const Z:CloudImageModel={id:"runware-z-image-turbo",label:"Z-Image Turbo",provider:"runware",apiModelId:"runware:z-image@turbo",kind:"text",steps:8,pricing:{estimatePerImage:0.0032}};
let server:Server,base:string,dir:string,images:ImageStore,rw:ReturnType<typeof fakeRunware>;
const img=(cost=0.0007)=>({body:{data:[{taskType:"imageInference",imageUUID:"U",imageURL:"https://im.runware.ai/image/x.png",seed:5,cost}]}});
async function boot(script:Parameters<typeof fakeRunware>[0],key="rw-test-key-abcdef9876"){
  dir=tmp();writeFileSync(path.join(dir,".env"),key?"RUNWARE_API_KEY="+key+"\n":"");
  const env=new EnvFile(path.join(dir,".env")),comfy=new Comfy(()=>"http://127.0.0.1:9");rw=fakeRunware(script);
  const make=runwareImage("https://api.runware.ai/v1",rw.fetchImpl,async u=>Buffer.from("PNG:"+u));
  images=new ImageStore({dataDir:dir,comfy,cloud:{[Z.id]:r=>make({...r,apiModelId:Z.apiModelId,steps:Z.steps},env.get("RUNWARE_API_KEY"))}});
  const queue=new JobQueue({dataDir:dir,adapters:{},model:id=>registry.models.find(m=>m.id===id),apiKey:()=>"",sleep:async()=>{},download:async()=>{}});
  server=http.createServer(createApp({env,registry,queue,videosDir:path.join(dir,"videos"),version:"test",local:{comfy,images,ffmpeg:new Ffmpeg(()=>"",async()=>({code:-1,out:""})),cloudImages:[Z]}}));
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",()=>r()));base="http://127.0.0.1:"+(server.address() as any).port;
}
const api=async(method:string,url:string,body?:unknown)=>{
  const r=await fetch(base+url,{method,headers:body===undefined?{}:{"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();return {status:r.status,json:text?JSON.parse(text):null};
};
afterEach(()=>new Promise<void>(r=>server.close(()=>r())));

describe("images made in the cloud, without ComfyUI",()=>{
  it("the cloud model is offered when its key is saved, even with ComfyUI off",async()=>{
    await boot([]);
    const s=(await api("GET","/api/local/status")).json;
    expect(s.reachable).toBe(false);
    expect(s.models.find((m:any)=>m.id===Z.id)).toMatchObject({cloud:true,available:true,kind:"text",providerLabel:"Runware",estimateUSD:0.0032});
    await new Promise<void>(r=>server.close(()=>r()));
    await boot([],"");
    expect((await api("GET","/api/local/status")).json.models.find((m:any)=>m.id===Z.id).available).toBe(false);
    expect((await api("POST","/api/local/images",{state:example(),taskId:"char-0",modelId:Z.id,confirmed:true})).json.error).toBe("noKey");
  });
  it("costs money, so nothing is sent without the OK",async()=>{
    await boot([]);
    const r=await api("POST","/api/local/images",{state:example(),taskId:"char-0",modelId:Z.id});
    expect(r.status).toBe(400);expect(r.json).toEqual({error:"notConfirmed",estimateUSD:0.0032});
    expect(rw.calls).toHaveLength(0);
  });
  it("with the OK, the image is made at Runware with the prompt of the film, saved here with what it cost",async()=>{
    await boot([img(0.0007)]);
    const r=await api("POST","/api/local/images",{state:example(),taskId:"char-0",modelId:Z.id,confirmed:true});
    expect(r.status).toBe(202);expect(r.json.modelLabel).toBe("Z-Image Turbo · Runware");
    await images.idle();
    const i=images.list()[0],t=rw.calls[0].tasks[0];
    expect(i).toMatchObject({status:"done",costUSD:0.0007,file:i.id+".png"});
    expect(readFileSync(path.join(dir,"images",i.file!),"utf8")).toBe("PNG:https://im.runware.ai/image/x.png");
    expect(t).toMatchObject({taskType:"imageInference",model:"runware:z-image@turbo",width:1344,height:768,steps:8,numberResults:1,outputType:"URL",outputFormat:"PNG",includeCost:true,seed:i.seed});
    expect(t.positivePrompt).toBe(imageTasks(example()).find(x=>x.id==="char-0")!.prompt);
    expect(rw.calls[0].auth).toBe("Bearer rw-test-key-abcdef9876");
  });
  it("a refused key is reported, not retried",async()=>{
    await boot([rwError("invalidApiKey",401)]);
    await api("POST","/api/local/images",{state:example(),taskId:"plate-0",modelId:Z.id,confirmed:true});
    await images.idle();
    expect(images.list()[0]).toMatchObject({status:"failed",error:{kind:"auth"}});
    expect(rw.calls).toHaveLength(1);
  });
  it("a shot frame still needs an editing model: the cloud text model is refused for it",async()=>{
    await boot([]);
    expect((await api("POST","/api/local/images",{state:example(),taskId:"shot-1-start",modelId:Z.id,confirmed:true})).json.error).toBe("wrongModel");
  });
});
