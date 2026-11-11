import path from "node:path";
import {fileURLToPath} from "node:url";
import {mkdirSync,readFileSync} from "node:fs";
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
import {checkKey} from "./providers/check";
import {Comfy} from "./local/comfy";
import {ImageStore} from "./local/images";
import {Ffmpeg} from "./local/ffmpeg";

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
};
const queue=new JobQueue({dataDir,adapters,model:id=>registry.models.find(m=>m.id===id),apiKey:p=>env.get(registry.providers[p]?.envKey||"")});
// Images on this computer: ComfyUI at COMFYUI_URL (http://127.0.0.1:8188 unless set in .env).
const comfy=new Comfy(()=>env.get("COMFYUI_URL"));
const images=new ImageStore({dataDir,comfy});
const version=JSON.parse(readFileSync(path.join(root,"package.json"),"utf8")).version;
const app=createApp({env,registry,queue,checkKey:(p,k)=>checkKey(p,k,(p==="runware"&&env.get("RUNWARE_ENDPOINT"))||P[p].endpoint),webDir:path.join(root,"packages/web/dist"),videosDir:path.join(dataDir,"videos"),version,local:{comfy,images,ffmpeg:new Ffmpeg(()=>env.get("FFMPEG_PATH"))}});

// Local by default. Publishing on a server needs a login in front of it first: anyone who reaches this port can spend the credit.
const host=env.get("HOST")||"127.0.0.1",port=parseInt(env.get("PORT")||"4477",10);
app.listen(port,host,()=>console.log("TRSR Video "+version+" → http://"+(host==="0.0.0.0"?"127.0.0.1":host)+":"+port+"  (data: "+dataDir+")"));
