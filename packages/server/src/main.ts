import path from "node:path";
import {fileURLToPath} from "node:url";
import {mkdirSync,readFileSync,existsSync} from "node:fs";
import {EnvFile} from "./env";
import {loadRegistry} from "./registry";
import {JobQueue} from "./jobs";
import {createApp} from "./app";
import {runwareAdapter} from "./providers/runware";
import {higgsfieldAdapter} from "./providers/higgsfield";
import {runwayAdapter} from "./providers/runway";
import {pikaAdapter} from "./providers/pika";
import {kreaAdapter} from "./providers/krea";
import {xaiAdapter} from "./providers/xai";
import {ltxAdapter} from "./providers/ltx";
import {klingAdapter} from "./providers/kling";
import {googleAdapter} from "./providers/google";
import {comfyuiAdapter} from "./providers/comfyui";
import {checkKey} from "./providers/check";
import {Comfy} from "./local/comfy";
import {ImageStore} from "./local/images";
import {Ffmpeg} from "./local/ffmpeg";
import {runwareImage} from "./providers/runwareImage";
import type {CloudImageModel} from "./app";
import type {CloudMake} from "./local/images";
import {loadPlugins} from "./plugins";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
// TRSR_VIDEO_ENV points the server at another .env file; the end-to-end test uses it so it never touches the real one.
const env=new EnvFile(process.env.TRSR_VIDEO_ENV||path.join(root,".env"));
const registry=loadRegistry(path.join(root,"registry"));
const dataDir=path.resolve(root,env.get("DATA_DIR")||"data");
mkdirSync(dataDir,{recursive:true});

// RUNWARE_ENDPOINT exists for the end-to-end test (tools/e2e-generate.mjs), which points it at a fake Runware.
const P=registry.providers;
const adapters={
  runware:runwareAdapter(env.get("RUNWARE_ENDPOINT")||P.runware.endpoint),
  higgsfield:higgsfieldAdapter(P.higgsfield.endpoint),
  runway:runwayAdapter(P.runway.endpoint),
  pika:pikaAdapter(P.pika.endpoint),
  krea:kreaAdapter(P.krea.endpoint),
  xai:xaiAdapter(P.xai.endpoint),
  ltx:ltxAdapter(P.ltx.endpoint),
  kling:klingAdapter(P.kling.endpoint),
  google:googleAdapter(P.google.endpoint),
  // Video on this computer: the same ComfyUI as the local images (COMFYUI_URL).
  comfyui:comfyuiAdapter(()=>env.get("COMFYUI_URL")||P.comfyui.endpoint),
};
// Images on this computer: ComfyUI at COMFYUI_URL (http://127.0.0.1:8188 unless set in .env).
const comfy=new Comfy(()=>env.get("COMFYUI_URL"));
// Cloud image models (registry/images.json): the same images, made at the provider, for people without ComfyUI.
const cloudImages:CloudImageModel[]=JSON.parse(readFileSync(path.join(root,"registry","images.json"),"utf8"));
const rwImage=runwareImage(env.get("RUNWARE_ENDPOINT")||P.runware.endpoint);
const cloud:Record<string,CloudMake>=Object.fromEntries(cloudImages.filter(c=>c.provider==="runware").map(c=>[c.id,r=>rwImage({...r,apiModelId:c.apiModelId,steps:c.steps},env.get(P[c.provider].envKey))]));
// Plugins (PLUGINS_DIR, or the plugins folder next to this app): their image models are made the same way, with the images they need as references.
const plugins=await loadPlugins(path.resolve(root,env.get("PLUGINS_DIR")||"plugins"));
const dataUri=(b:Buffer)=>"data:image/"+(b[0]===0xff?"jpeg":"png")+";base64,"+b.toString("base64");
for(const p of plugins)for(const m of p.imageModels)if(m.provider==="runware")
  cloud[m.id]=r=>rwImage({prompt:r.prompt,width:r.width,height:r.height,apiModelId:m.apiModelId,referenceImages:r.refs.map(x=>dataUri(x.bytes)),settings:m.settings},env.get(P.runware.envKey));
if(plugins.length)console.log("Plugins: "+plugins.map(p=>p.name+" "+p.version).join(", "));
const images=new ImageStore({dataDir,comfy,cloud});
const ffmpeg=new Ffmpeg(()=>env.get("FFMPEG_PATH"));
// A reference goes to the provider as a JPEG data URI (smaller than the PNG); without ffmpeg, the PNG itself.
async function refImage(id:string){
  const i=images.get(id);if(!i?.file)throw new Error("Reference image not found: "+id);
  const src=path.join(images.dir,i.file),jpg=path.join(images.dir,i.id+".ref.jpg");
  if(!existsSync(jpg)&&await ffmpeg.available())await ffmpeg.toJpeg(src,jpg).catch(()=>{});
  return existsSync(jpg)?"data:image/jpeg;base64,"+readFileSync(jpg).toString("base64"):"data:image/png;base64,"+readFileSync(src).toString("base64");
}
async function lastFrame(video:string){
  const jpg=video+".last.jpg";
  if(!existsSync(jpg))await ffmpeg.lastFrame(video,jpg);
  return "data:image/jpeg;base64,"+readFileSync(jpg).toString("base64");
}
const queue=new JobQueue({dataDir,adapters,refImage,lastFrame,join:(files,out)=>ffmpeg.concat(files,out),model:id=>registry.models.find(m=>m.id===id),apiKey:p=>env.get(registry.providers[p]?.envKey||"")});
const version=JSON.parse(readFileSync(path.join(root,"package.json"),"utf8")).version;
const app=createApp({env,registry,queue,checkKey:(p,k)=>checkKey(p,k,(p==="runware"&&env.get("RUNWARE_ENDPOINT"))||P[p].endpoint),webDir:path.join(root,"packages/web/dist"),videosDir:path.join(dataDir,"videos"),version,local:{comfy,images,ffmpeg,cloudImages,plugins}});

// Local by default. Publishing on a server needs a login in front of it first: anyone who reaches this port can spend the credit.
const host=env.get("HOST")||"127.0.0.1",port=parseInt(env.get("PORT")||"4477",10);
app.listen(port,host,()=>console.log("TRSR Video "+version+" → http://"+(host==="0.0.0.0"?"127.0.0.1":host)+":"+port+"  (data: "+dataDir+")"));
