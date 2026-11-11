import {describe,it,expect,afterEach} from "vitest";
import http,{type Server} from "node:http";
import {example,imageTasks} from "@trsr-video/core";
import {EnvFile} from "../src/env";
import {JobQueue} from "../src/jobs";
import {createApp} from "../src/app";
import {Comfy} from "../src/local/comfy";
import {ImageStore} from "../src/local/images";
import {Ffmpeg} from "../src/local/ffmpeg";
import {musicPrompt} from "@trsr-video/core";
import {registry,tmp,readFileSync,writeFileSync,path} from "./helpers";

/** A ComfyUI that answers like the real one, makes nothing and records what it was asked. */
function fakeComfy(o:{unet?:string[];lora?:string[];fail?:string;ckpt?:string[]}={}){
  const lists:Record<string,[string,string[]]>={
    UNETLoader:["unet_name",o.unet??["z_image_turbo_int8.safetensors","qwen_image_edit_2511_int8.safetensors","wan2.2_ti2v_5B_fp16.safetensors","some_new_image_model.safetensors"]],
    CheckpointLoaderSimple:["ckpt_name",o.ckpt??["stable_audio_3_medium.safetensors"]],
    CLIPLoader:["clip_name",["qwen_3_4b_fp8_mixed.safetensors","qwen_2.5_vl_7b_fp8_scaled.safetensors","t5gemma_b_b_ul2.safetensors"]],
    VAELoader:["vae_name",["ae.safetensors","qwen_image_vae.safetensors"]],
    LoraLoaderModelOnly:["lora_name",o.lora??["Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors"]],
  };
  const graphs:any[]=[],uploads:number[]=[];
  const server=http.createServer((req,res)=>{
    const chunks:Buffer[]=[];req.on("data",c=>chunks.push(c));
    req.on("end",()=>{
      const body=Buffer.concat(chunks),u=new URL(req.url||"/","http://x"),json=(v:unknown)=>{res.setHeader("content-type","application/json");res.end(JSON.stringify(v))};
      const node=u.pathname.match(/^\/object_info\/(\w+)$/)?.[1];
      if(node)return json(lists[node]?{[node]:{input:{required:{[lists[node][0]]:[lists[node][1]]}}}}:{});
      if(u.pathname==="/upload/image"){uploads.push(body.length);return json({name:"ref"+uploads.length+".png",subfolder:"trsr-video",type:"input"})}
      if(u.pathname==="/prompt"){graphs.push(JSON.parse(body.toString()).prompt);return json({prompt_id:"P"+graphs.length})}
      const h=u.pathname.match(/^\/history\/(\w+)$/)?.[1];
      if(h)return json({[h]:o.fail?{status:{status_str:"error",messages:[["execution_error",{exception_message:o.fail}]]}}:{status:{status_str:"success"},outputs:{"10":{images:[{filename:"out.png",subfolder:"trsr-video",type:"output"}]},"8":{audio:[{filename:"out.flac",subfolder:"trsr-video",type:"output"}]}}}});
      if(u.pathname==="/view")return void res.end(Buffer.from("PNG-"+u.searchParams.get("filename")));
      if(u.pathname==="/queue")return json({queue_running:[],queue_pending:[]});
      res.statusCode=404;res.end("no");
    });
  });
  return {server,graphs,uploads};
}

let ffCalls:string[][]=[],ffOk=true;
let servers:Server[]=[],base="",dir="",images:ImageStore,fc:ReturnType<typeof fakeComfy>;
const listen=(s:Server)=>new Promise<string>(r=>{servers.push(s);s.listen(0,"127.0.0.1",()=>r("http://127.0.0.1:"+(s.address() as any).port))});
async function boot(o:Parameters<typeof fakeComfy>[0]={},comfyUrl?:string){
  dir=tmp();writeFileSync(path.join(dir,".env"),"");
  fc=fakeComfy(o);const url=comfyUrl??await listen(fc.server);
  const env=new EnvFile(path.join(dir,".env")),comfy=new Comfy(()=>url,fetch,async()=>{});
  images=new ImageStore({dataDir:dir,comfy});
  const queue=new JobQueue({dataDir:dir,adapters:{},model:id=>registry.models.find(m=>m.id===id),apiKey:()=>"",sleep:async()=>{},download:async()=>{}});
  base=await listen(http.createServer(createApp({env,registry,queue,videosDir:path.join(dir,"videos"),version:"test",local:{comfy,images,ffmpeg:new Ffmpeg(()=>"",async(_c,a)=>{ffCalls.push(a);return {code:ffOk?0:-1,out:""}})}})));
}
const api=async(method:string,url:string,body?:unknown)=>{
  const r=await fetch(base+url,{method,headers:body===undefined?{}:{"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();return {status:r.status,json:text?JSON.parse(text):null};
};
const make=(taskId:string,modelId:string,state=example())=>api("POST","/api/local/images",{state,taskId,modelId});
afterEach(async()=>{for(const s of servers)await new Promise<void>(r=>s.close(()=>r()));servers=[]});

describe("what this machine can make",()=>{
  it("lists the models whose files ComfyUI has, and what is missing for the others",async()=>{
    await boot();
    const s=(await api("GET","/api/local/status")).json;
    expect(s.reachable).toBe(true);
    expect(s.models.map((m:any)=>[m.id,m.kind,m.available])).toEqual([["z-image-turbo","text",true],["moss-image","text",false],["qwen-image-edit-2511","edit",true],["stable-audio-3-medium","audio",true]]);
    expect(s.models[1].missing).toEqual(["diffusion_models/moss_image*","text_encoders/qwen3.5_9b*","vae/flux2-vae*"]);
    // An image model with no recipe here is shown, not offered; video models are not listed at all.
    expect(s.others).toEqual(["some_new_image_model.safetensors"]);
  });
  it("says so when ComfyUI is not running",async()=>{
    await boot({},"http://127.0.0.1:9");
    const s=(await api("GET","/api/local/status")).json;
    expect(s.reachable).toBe(false);expect(s.models.every((m:any)=>!m.available)).toBe(true);
    expect((await make("char-0","z-image-turbo")).status).toBe(503);
  });
});

describe("making images",()=>{
  it("a character reference: text-to-image with the prompt of the film, saved on disk",async()=>{
    await boot();
    const r=await make("char-0","z-image-turbo");
    expect(r.status).toBe(202);expect(r.json.status).toBe("queued");
    await images.idle();
    const img=(await api("GET","/api/local/images?project=The%20Last%20Match")).json.images[0];
    expect(img.status).toBe("done");expect(img.url).toBe("/images/"+img.id+".png");
    expect(readFileSync(path.join(dir,"images",img.id+".png"),"utf8")).toBe("PNG-out.png");
    const g=fc.graphs[0];
    expect(g["5"].inputs.text).toBe(imageTasks(example()).find(t=>t.id==="char-0")!.prompt);
    expect(g["7"].inputs).toMatchObject({width:1344,height:768});
    expect(g["8"].inputs).toMatchObject({steps:8,cfg:1,seed:img.seed});
    expect(g["1"].inputs.unet_name).toBe("z_image_turbo_int8.safetensors");
    expect((await fetch(base+img.url)).status).toBe(200);
  });
  it("a shot frame needs its plate and its characters first",async()=>{
    await boot();
    const r=await make("shot-1-start","qwen-image-edit-2511");
    expect(r.status).toBe(409);expect(r.json).toEqual({error:"missingRefs",missing:["plate-0","char-1"]});
    expect(fc.graphs).toHaveLength(0);
  });
  it("a shot frame is drawn from the plate and the references, in the order the prompt names them",async()=>{
    await boot();
    await make("plate-0","z-image-turbo");await make("char-1","z-image-turbo");await images.idle();
    const r=await make("shot-1-start","qwen-image-edit-2511");
    expect(r.status).toBe(202);await images.idle();
    const done=images.list("The Last Match");
    expect(done[0].status).toBe("done");
    expect(done[0].refs).toEqual([done.find(i=>i.taskId==="plate-0")!.id,done.find(i=>i.taskId==="char-1")!.id]);
    expect(fc.uploads).toHaveLength(2);
    const g=fc.graphs[2];
    expect(g["10"].class_type).toBe("LoadImage");expect(g["11"].class_type).toBe("LoadImage");expect(g["12"]).toBeUndefined();
    expect(g["14"].inputs.image2).toEqual(["11",0]);
    expect(g["14"].inputs.prompt).toContain("Image 1 is the SET PLATE");
    expect(g["19"].inputs).toMatchObject({steps:4,cfg:1,model:["6",0]});
  });
  it("without the Lightning LoRA the editor runs its 40 steps",async()=>{
    await boot({lora:[]});
    await make("plate-0","z-image-turbo");await make("char-1","z-image-turbo");await images.idle();
    await make("shot-1-start","qwen-image-edit-2511");await images.idle();
    expect(fc.graphs[2]["19"].inputs).toMatchObject({steps:40,cfg:4,model:["5",0]});
    expect(fc.graphs[2]["6"]).toBeUndefined();
  });
  it("refuses the wrong kind of model, a model that is not installed and a frame with three characters",async()=>{
    await boot();
    expect((await make("char-0","qwen-image-edit-2511")).status).toBe(422);
    expect((await make("shot-1-start","z-image-turbo")).status).toBe(422);
    const m=await make("char-0","moss-image");expect(m.status).toBe(409);expect(m.json.error).toBe("modelMissing");
    const S=example();S.chars.push({name:"THE CAT",nick:"",look:"grey cat",ward:"",prop:"",pers:"lazy"});S.shots[2].who=[0,1,2];
    expect((await make("shot-3-start","qwen-image-edit-2511",S)).json.error).toBe("tooManyCharacters");
    expect((await make("nope","z-image-turbo")).status).toBe(404);
    expect(fc.graphs).toHaveLength(0);
  });
  it("a failure is reported once and never sent again",async()=>{
    await boot({fail:"CUDA out of memory"});
    await make("char-0","z-image-turbo");await images.idle();
    const img=images.list()[0];
    expect(img.status).toBe("failed");expect(img.error!.message).toContain("CUDA out of memory");
    expect(fc.graphs).toHaveLength(1);
  });
  it("what was waiting when the server stopped comes back as failed, not resubmitted",async()=>{
    await boot();
    const d=tmp();
    writeFileSync(path.join(d,"images.json"),JSON.stringify([{id:"a",project:"P",taskId:"char-0",kind:"reference",label:"X",modelId:"z-image-turbo",modelLabel:"Z",prompt:"p",seed:1,width:1344,height:768,refs:[],status:"queued",createdAt:"2026-01-01T00:00:00Z"}]));
    const store=new ImageStore({dataDir:d,comfy:new Comfy(()=>"http://127.0.0.1:9")});
    expect(store.get("a")!.status).toBe("failed");expect(store.get("a")!.error!.kind).toBe("interrupted");
    expect(fc.graphs).toHaveLength(0);
  });
  it("a waiting image can be canceled",async()=>{
    await boot();
    const a=images.add({project:"P",taskId:"char-0",kind:"reference",label:"A",modelId:"z-image-turbo",prompt:"p",width:1344,height:768,refs:[]});
    const b=images.add({project:"P",taskId:"char-1",kind:"reference",label:"B",modelId:"z-image-turbo",prompt:"p",width:1344,height:768,refs:[]});
    expect((await api("POST","/api/local/images/"+b.id+"/cancel",{})).json.status).toBe("canceled");
    await images.idle();
    expect(images.get(a.id)!.status).toBe("done");expect(images.get(b.id)!.status).toBe("canceled");
    expect((await api("POST","/api/local/images/"+a.id+"/cancel",{})).status).toBe(409);
  });
});

describe("music",()=>{
  const film=()=>{const S=example();S.genre="heartfelt";S.dur=15;return S};
  it("is made to the tone and the length of the film",async()=>{
    await boot();
    const r=await api("POST","/api/local/music",{state:film()});
    expect(r.status).toBe(202);await images.idle();
    const m=(await api("GET","/api/local/music?project=The%20Last%20Match")).json.music[0];
    expect(m).toMatchObject({status:"done",kind:"music",seconds:15,modelId:"stable-audio-3-medium"});
    expect(m.url).toBe("/images/"+m.id+".flac");
    const g=fc.graphs[0];
    expect(g["3"].inputs.text).toBe(musicPrompt(film()).text);
    expect(g["3"].inputs.text).toContain("BPM: 72. Length: 15 seconds");
    expect(g["5"].inputs.seconds).toBe(15);expect(g["1"].inputs.ckpt_name).toBe("stable_audio_3_medium.safetensors");
    // Music is not an image: the image list does not show it.
    expect((await api("GET","/api/local/images?project=The%20Last%20Match")).json.images).toHaveLength(0);
  });
  it("uses the description the person wrote",async()=>{
    await boot();
    await api("POST","/api/local/music",{state:film(),prompt:"Solo accordion waltz"});await images.idle();
    expect(fc.graphs[0]["3"].inputs.text).toBe("Solo accordion waltz. BPM: 72. Length: 15 seconds");
  });
  it("says what is missing when the music model is not installed",async()=>{
    await boot({ckpt:[]});
    const r=await api("POST","/api/local/music",{state:film()});
    expect(r.status).toBe(409);expect(r.json).toEqual({error:"modelMissing",missing:["checkpoints/stable_audio_3_medium*"]});
  });
  it("takes a file the person brings, and only audio",async()=>{
    await boot();
    const up=await api("POST","/api/local/music/upload",{project:"My film",name:"theme.MP3",data:Buffer.from("ID3-audio").toString("base64")});
    expect(up.status).toBe(201);expect(up.json).toMatchObject({status:"done",kind:"music",label:"theme.MP3",project:"My film"});
    expect(readFileSync(path.join(dir,"images",up.json.id+".mp3"),"utf8")).toBe("ID3-audio");
    expect((await api("POST","/api/local/music/upload",{project:"My film",name:"run.exe",data:"AAAA"})).status).toBe(415);
    expect((await api("POST","/api/local/music/upload",{project:"My film",name:"a.mp3",data:""})).status).toBe(413);
    expect((await api("GET","/api/local/music?project=My%20film")).json.music).toHaveLength(1);
  });
  it("the mix keeps the picture, puts the music under the video's sound and ends with the video",()=>{
    const a=Ffmpeg.args("v.mp4","m.flac","o.mp4",{volume:0.6,durationS:15,videoHasAudio:true});
    expect(a.join(" ")).toContain("-c:v copy");
    expect(a[a.indexOf("-filter_complex")+1]).toBe("[1:a]volume=0.60,afade=t=out:st=13.50:d=1.5[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]");
    const b=Ffmpeg.args("v.mp4","m.flac","o.mp4",{volume:1,durationS:8,videoHasAudio:false});
    expect(b[b.indexOf("-filter_complex")+1]).toBe("[1:a]volume=1.00,afade=t=out:st=6.50:d=1.5[a]");
    expect(b).toContain("-shortest");
  });
  it("mixing needs a finished video and a finished music",async()=>{
    await boot();
    expect((await api("POST","/api/jobs/nope/mix",{musicId:"x"})).status).toBe(404);
    expect(ffCalls.filter(a=>a.includes("-filter_complex"))).toHaveLength(0);
  });
});
