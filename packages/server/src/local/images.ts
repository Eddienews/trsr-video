import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {Comfy,ComfyError,localLabel} from "./comfy";

export type ImageStatus="queued"|"running"|"done"|"failed"|"canceled";
export interface LocalImage{
  id:string;project:string;taskId:string;kind:string;label:string;modelId:string;modelLabel:string;prompt:string;seed:number;
  width:number;height:number;refs:string[];status:ImageStatus;error?:{kind:string;message:string};file?:string;
  createdAt:string;startedAt?:string;finishedAt?:string;
  /** Music only: its length. */
  seconds?:number;
  /** Cloud models only: what the provider charged for this image. */
  costUSD?:number;
}
export type NewImage=Pick<LocalImage,"project"|"taskId"|"kind"|"label"|"modelId"|"prompt"|"width"|"height"|"refs">&{seed?:number;seconds?:number;modelLabel?:string};
/** A cloud model makes the image instead of ComfyUI: same request, plus what it cost. */
export type CloudMake=(r:{prompt:string;width:number;height:number;seed:number})=>Promise<{bytes:Buffer;ext:string;costUSD?:number}>;

/* The local image queue: one image at a time (one GPU), kept in data/images.json, files in data/images/.
   Like the video queue, nothing is sent again on its own: what was waiting or running when the server
   stopped comes back as failed, and the person decides. */
export class ImageStore{
  private items:LocalImage[]=[];
  private file:string;readonly dir:string;
  private busy=false;private aborts=new Map<string,{aborted:boolean}>();private comfyIds=new Map<string,string>();
  constructor(private o:{dataDir:string;comfy:Comfy;cloud?:Record<string,CloudMake>}){
    this.file=path.join(o.dataDir,"images.json");this.dir=path.join(o.dataDir,"images");
    mkdirSync(this.dir,{recursive:true});
    if(existsSync(this.file))try{this.items=JSON.parse(readFileSync(this.file,"utf8"))}catch{this.items=[]}
    let changed=false;
    for(const i of this.items)if(i.status==="queued"||i.status==="running"){i.status="failed";i.error={kind:"interrupted",message:"The server stopped before this image was made."};i.finishedAt=new Date().toISOString();changed=true}
    if(changed)this.save();
  }
  private save(){const tmp=this.file+".tmp";writeFileSync(tmp,JSON.stringify(this.items,null,1));renameSync(tmp,this.file)}
  list(project?:string){return this.items.filter(i=>project===undefined||i.project===project).slice().reverse()}
  get(id:string){return this.items.find(i=>i.id===id)}
  /** The newest finished image of a task in a project: what a frame is drawn from. */
  latestDone(project:string,taskId:string){return this.list(project).find(i=>i.taskId===taskId&&i.status==="done"&&i.file&&existsSync(path.join(this.dir,i.file)))}
  add(n:NewImage):LocalImage{
    const seed=Number.isInteger(n.seed)?n.seed as number:Math.floor(Math.random()*2**31);
    const item:LocalImage={...n,seed,id:randomUUID(),modelLabel:n.modelLabel||localLabel(n.modelId),status:"queued",createdAt:new Date().toISOString()};
    this.items.push(item);this.save();queueMicrotask(()=>void this.pump());return item;
  }
  /** A file the person brought (their own music): kept as it is, already "done". */
  addFile(n:{project:string;label:string;ext:string;bytes:Buffer}):LocalImage{
    const id=randomUUID(),now=new Date().toISOString();
    writeFileSync(path.join(this.dir,id+"."+n.ext),n.bytes);
    const item:LocalImage={id,project:n.project,taskId:"music",kind:"music",label:n.label,modelId:"upload",modelLabel:"",prompt:"",seed:0,width:0,height:0,refs:[],status:"done",file:id+"."+n.ext,createdAt:now,finishedAt:now};
    this.items.push(item);this.save();return item;
  }
  async cancel(id:string):Promise<"canceled"|"notFound"|"tooLate">{
    const i=this.get(id);if(!i)return "notFound";
    if(i.status==="queued"){i.status="canceled";i.finishedAt=new Date().toISOString();this.save();return "canceled"}
    if(i.status!=="running")return "tooLate";
    const a=this.aborts.get(id);if(a)a.aborted=true;
    const cid=this.comfyIds.get(id);if(cid)await this.o.comfy.stop(cid).catch(()=>{});
    return "canceled";
  }
  /** Resolves when nothing is waiting or running (for tests). */
  async idle(){while(this.busy||this.items.some(i=>i.status==="queued"))await new Promise(r=>setTimeout(r,5))}
  private async pump(){
    if(this.busy)return;this.busy=true;
    try{
      for(;;){
        const i=this.items.find(x=>x.status==="queued");if(!i)break;
        i.status="running";i.startedAt=new Date().toISOString();this.save();
        const signal={aborted:false};this.aborts.set(i.id,signal);
        try{
          const refs=i.refs.map((rid,n)=>{const r=this.get(rid);if(!r?.file)throw new ComfyError("missing","A reference image is gone.");return {name:"ref-"+i.id+"-"+n+".png",bytes:readFileSync(path.join(this.dir,r.file))}});
          const cloud=this.o.cloud?.[i.modelId];
          const {bytes,ext,costUSD}:{bytes:Buffer;ext:string;costUSD?:number}=cloud?await cloud({prompt:i.prompt,width:i.width,height:i.height,seed:i.seed})
            :await this.o.comfy.make({modelId:i.modelId,prompt:i.prompt,width:i.width,height:i.height,seed:i.seed,refs,seconds:i.seconds},{signal,onStart:cid=>this.comfyIds.set(i.id,cid)});
          if(typeof costUSD==="number")i.costUSD=costUSD;
          if(signal.aborted)throw new ComfyError("canceled","Canceled.");
          i.file=i.id+"."+ext;writeFileSync(path.join(this.dir,i.file),bytes);i.status="done";
        }catch(e){
          const kind=typeof (e as any)?.kind==="string"?(e as any).kind as string:"failed";
          if(kind==="canceled")i.status="canceled";else{i.status="failed";i.error={kind,message:String((e as Error).message||e).slice(0,400)}}
        }
        i.finishedAt=new Date().toISOString();this.aborts.delete(i.id);this.comfyIds.delete(i.id);this.save();
      }
    }finally{this.busy=false}
  }
}
