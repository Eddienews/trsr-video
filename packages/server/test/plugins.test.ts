import {describe,it,expect,afterEach} from "vitest";
import http,{type Server} from "node:http";
import {mkdirSync,readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {example} from "@trsr-video/core";
import {EnvFile} from "../src/env";
import {JobQueue} from "../src/jobs";
import {createApp,type CloudImageModel} from "../src/app";
import {Comfy} from "../src/local/comfy";
import {ImageStore,type CloudMake} from "../src/local/images";
import {Ffmpeg} from "../src/local/ffmpeg";
import {runwareImage} from "../src/providers/runwareImage";
import {loadPlugins} from "../src/plugins";
import {fakeRunware,registry,tmp,writeFileSync,path} from "./helpers";

const Z:CloudImageModel={id:"runware-z-image-turbo",label:"Z-Image Turbo",provider:"runware",apiModelId:"runware:z-image@turbo",kind:"text",steps:8,pricing:{estimatePerImage:0.0032}};
const SERVER=`export default {
  imageModels:[{id:"demo-model",label:"Demo Model",provider:"runware",apiModelId:"demo:model@1",width:1376,height:768,estimateUSD:0.034,maxRefs:2},{id:"broken"}],
  prompts:[{id:"plain",label:"Plain",build(S,ctx){return "PART "+(ctx.part.index+1)+"/"+ctx.part.count+" "+ctx.durationS+"s of "+ctx.totalS+"s | "+ctx.refs.map(r=>r.name+"="+r.label).join(", ")+" | "+ctx.lines.join(" ")}},{id:"BAD id",label:"x",build(){return "x"}}],
  filmExtras(S,part){return {refs:[{task:"demo:face",label:"Face of part "+(part.index+1)},{task:"demo:nothing",label:"Not made"},{task:"other:x",label:"Not mine"}],lines:["SHOT 1 uses {demo:face}.","Dropped: {demo:nothing}."]}},
  imageTasks(S){return [
    {id:"demo:sheet-0",kind:"reference",label:S.chars[0].name+" (sheet)",prompt:"A sheet of "+S.chars[0].name,needs:["char-0"]},
    {id:"demo:free",kind:"plate",label:"Free",prompt:"A place",needs:[]},
    {id:"demo:face",kind:"panel",label:"Face",prompt:"A face",needs:["char-0"],width:1024,height:1024},
    {id:"demo:page",kind:"reference",label:"Page",prompt:"",needs:["demo:face"],upload:true},
    {id:"other:x",kind:"plate",label:"Not mine",prompt:"x",needs:[]},
    {id:"demo:bad",kind:"video",label:"Bad",prompt:"x",needs:[]}
  ]}
};`;
let server:Server,base:string,dir:string,images:ImageStore,rw:ReturnType<typeof fakeRunware>,logs:string[];
const img=(cost=0.034)=>({body:{data:[{taskType:"imageInference",imageUUID:"U",imageURL:"https://im.runware.ai/image/x.png",cost}]}});
async function boot(script:Parameters<typeof fakeRunware>[0]){
  dir=tmp();logs=[];writeFileSync(path.join(dir,".env"),"RUNWARE_API_KEY=rw-test-key-abcdef9876\n");
  const pd=path.join(dir,"plugins");mkdirSync(path.join(pd,"demo"),{recursive:true});mkdirSync(path.join(pd,"broken"));mkdirSync(path.join(pd,"empty"));
  writeFileSync(path.join(pd,"demo","plugin.json"),JSON.stringify({id:"demo",name:"Demo",version:"1.0.0",server:"server.mjs",web:"web.js"}));
  writeFileSync(path.join(pd,"demo","server.mjs"),SERVER);writeFileSync(path.join(pd,"demo","web.js"),"export function mount(){}");writeFileSync(path.join(pd,"demo","secret.txt"),"no");
  writeFileSync(path.join(pd,"broken","plugin.json"),"{not json");
  // The test runner cannot import a file from outside the project, so the same source is handed over as a data: module.
  const plugins=await loadPlugins(pd,m=>logs.push(m),u=>import(/* @vite-ignore */"data:text/javascript,"+encodeURIComponent(readFileSync(fileURLToPath(u),"utf8"))));
  const env=new EnvFile(path.join(dir,".env")),comfy=new Comfy(()=>"http://127.0.0.1:9");rw=fakeRunware(script);
  const make=runwareImage("https://api.runware.ai/v1",rw.fetchImpl,async u=>Buffer.from("PNG:"+u));
  const cloud:Record<string,CloudMake>={[Z.id]:r=>make({...r,apiModelId:Z.apiModelId,steps:Z.steps},env.get("RUNWARE_API_KEY"))};
  for(const p of plugins)for(const m of p.imageModels)cloud[m.id]=r=>make({prompt:r.prompt,width:r.width,height:r.height,apiModelId:m.apiModelId,referenceImages:r.refs.map(x=>"data:image/png;base64,"+x.bytes.toString("base64"))},env.get("RUNWARE_API_KEY"));
  images=new ImageStore({dataDir:dir,comfy,cloud});
  const queue=new JobQueue({dataDir:dir,adapters:{},model:id=>registry.models.find(m=>m.id===id),apiKey:()=>"",sleep:async()=>{},download:async()=>{}});
  server=http.createServer(createApp({env,registry,queue,videosDir:path.join(dir,"videos"),version:"test",local:{comfy,images,ffmpeg:new Ffmpeg(()=>"",async()=>({code:-1,out:""})),cloudImages:[Z],plugins}}));
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",()=>r()));base="http://127.0.0.1:"+(server.address() as any).port;
  return plugins;
}
const api=async(method:string,url:string,body?:unknown)=>{
  const r=await fetch(base+url,{method,headers:body===undefined?{}:{"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();let json:any=null;try{json=text?JSON.parse(text):null}catch{json=text}
  return {status:r.status,json};
};
afterEach(()=>new Promise<void>(r=>server.close(()=>r())));

describe("plugins",()=>{
  it("a good plugin is loaded, a broken one is skipped with a line in the log, a folder without plugin.json is ignored",async()=>{
    const plugins=await boot([]);
    expect(plugins.map(p=>p.id)).toEqual(["demo"]);
    expect(logs).toHaveLength(1);expect(logs[0]).toContain("broken");
    const l=(await api("GET","/api/plugins")).json.plugins;
    expect(l).toEqual([{id:"demo",name:"Demo",version:"1.0.0",web:"/plugins/demo/web.js",imageModels:[{id:"demo-model",label:"Demo Model",provider:"runware",providerLabel:"Runware",estimateUSD:0.034,maxRefs:2,available:true}],prompts:[{id:"plain",label:"Plain"}]}]);
  });
  it("only tasks that are well formed and carry the plugin's own id are offered",async()=>{
    await boot([]);
    const t=(await api("POST","/api/plugins/demo/tasks",{state:example()})).json.tasks;
    expect(t.map((x:any)=>x.id)).toEqual(["demo:sheet-0","demo:free","demo:face","demo:page"]);
  });
  it("only the page file named in plugin.json is served",async()=>{
    await boot([]);
    expect((await api("GET","/plugins/demo/web.js")).json).toContain("mount");
    expect((await api("GET","/plugins/demo/secret.txt")).status).toBe(404);
    expect((await api("GET","/plugins/demo/server.mjs")).status).toBe(404);
  });
  it("a plugin image costs money: nothing is sent without the OK, and it waits for the images it needs",async()=>{
    await boot([]);
    const body={state:example(),taskId:"demo:sheet-0",modelId:"demo-model"};
    expect((await api("POST","/api/plugins/demo/images",body)).json).toEqual({error:"notConfirmed",estimateUSD:0.034});
    expect((await api("POST","/api/plugins/demo/images",{...body,confirmed:true})).json).toEqual({error:"missingRefs",missing:["char-0"]});
    expect((await api("POST","/api/plugins/demo/images",{...body,taskId:"other:x",confirmed:true})).status).toBe(404);
    expect(rw.calls).toHaveLength(0);
  });
  it("with the OK, the app makes the image from the plugin's prompt, with the needed image as reference, and keeps it in the film",async()=>{
    await boot([img(0.0007),img(0.034)]);
    await api("POST","/api/local/images",{state:example(),taskId:"char-0",modelId:Z.id,confirmed:true});
    await images.idle();
    const r=await api("POST","/api/plugins/demo/images",{state:example(),taskId:"demo:sheet-0",modelId:"demo-model",confirmed:true});
    expect(r.status).toBe(202);expect(r.json.modelLabel).toBe("Demo Model · Runware");
    await images.idle();
    const sheet=images.list()[0],t=rw.calls[1].tasks[0];
    expect(sheet).toMatchObject({status:"done",taskId:"demo:sheet-0",kind:"reference",costUSD:0.034,width:1376,height:768});
    expect(t).toMatchObject({model:"demo:model@1",positivePrompt:"A sheet of "+example().chars[0].name,width:1376,height:768});
    expect(t.seed).toBeUndefined();
    expect(t.inputs.referenceImages).toEqual(["data:image/png;base64,"+Buffer.from("PNG:https://im.runware.ai/image/x.png").toString("base64")]);
    expect(rw.calls[1].auth).toBe("Bearer rw-test-key-abcdef9876");
  });
  it("a panel can ask for its own size, and a page built from panels is handed over by the plugin at no cost",async()=>{
    await boot([img(0.0007),img(0.034)]);
    const S=example(),JPG="data:image/jpeg;base64,"+Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),Buffer.alloc(200,1)]).toString("base64");
    await api("POST","/api/local/images",{state:S,taskId:"char-0",modelId:Z.id,confirmed:true});await images.idle();
    // The page is never made by a provider, and is not taken before its panels exist.
    expect((await api("POST","/api/plugins/demo/images",{state:S,taskId:"demo:page",modelId:"demo-model",confirmed:true})).json.error).toBe("uploadOnly");
    expect((await api("POST","/api/plugins/demo/pages",{state:S,taskId:"demo:page",image:JPG})).json).toEqual({error:"missingRefs",missing:["demo:face"]});
    await api("POST","/api/plugins/demo/images",{state:S,taskId:"demo:face",modelId:"demo-model",confirmed:true});await images.idle();
    expect(rw.calls[1].tasks[0]).toMatchObject({width:1024,height:1024});
    expect(images.list()[0]).toMatchObject({taskId:"demo:face",kind:"panel",status:"done"});
    // Only an image, only for a task marked as upload.
    expect((await api("POST","/api/plugins/demo/pages",{state:S,taskId:"demo:page",image:"data:text/html;base64,AAAA"})).json.error).toBe("badImage");
    expect((await api("POST","/api/plugins/demo/pages",{state:S,taskId:"demo:face",image:JPG})).status).toBe(404);
    const r=await api("POST","/api/plugins/demo/pages",{state:S,taskId:"demo:page",image:JPG,width:1920,height:1080});
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({taskId:"demo:page",kind:"reference",status:"done",modelLabel:"Demo 1.0.0",width:1920,height:1080,refs:[images.list()[1].id]});
    expect(r.json.url).toMatch(/\.jpg$/);expect(r.json.costUSD).toBeUndefined();
    expect(rw.calls).toHaveLength(2);
  });
  it("a plugin can add to each part of a film the images only that part needs, in the room the person's references leave",async()=>{
    await boot([img(0.0007),img(0.034)]);
    const S={...example(),dur:20,shots:[{...example().shots[0],len:10},{...example().shots[0],len:10}]};
    await api("POST","/api/local/images",{state:S,taskId:"char-0",modelId:Z.id,confirmed:true});await images.idle();
    await api("POST","/api/plugins/demo/images",{state:S,taskId:"demo:face",modelId:"demo-model",confirmed:true});await images.idle();
    const face=images.list()[0].id,char=images.list()[1].id,body={state:S,modelId:"seedance-2.0-mini",resolution:"480p",partS:10,refs:[char]};
    const r=await api("POST","/api/estimate-film",body);
    expect(r.status).toBe(200);expect(r.json.parts).toHaveLength(2);
    expect(r.json.parts[0].extraRefs).toEqual(["Face of part 1"]);expect(r.json.parts[1].extraRefs).toEqual(["Face of part 2"]);
    // The image is named after the person's own references; a line about an image that is not sent is left out.
    expect(r.json.parts[0].prompt).toContain("IMAGE 2 = the reference of FACE OF PART 1");
    expect(r.json.parts[0].prompt).toContain("SHOT 1 uses IMAGE 2.");
    expect(r.json.parts[0].prompt).not.toContain("Dropped");
    // A plugin can also write the prompt itself: it is told which part it is and how each image is named.
    const pp=await api("POST","/api/estimate-film",{...body,promptMode:"plugin:demo:plain"});
    expect(pp.json.parts[1].prompt).toBe("PART 2/2 10s of 20s | IMAGE 1="+images.list()[1].label+", IMAGE 2=Face of part 2 | SHOT 1 uses IMAGE 2.");
    expect(pp.json.parts[1].promptKind).toBe("plugin");
    // An unknown prompt of a plugin falls back to the app's own text.
    expect((await api("POST","/api/estimate-film",{...body,promptMode:"plugin:demo:nope"})).json.parts[0].prompt).toContain("SCENE CONTEXT");
    // No room left (the person already chose as many images as the model takes): nothing is added.
    const full=await api("POST","/api/estimate-film",{...body,refs:Array(9).fill(char)});
    expect(full.json.parts[0].extraRefs).toEqual([]);expect(full.json.parts[0].prompt).not.toContain("SHOT 1 uses");
  });
});
