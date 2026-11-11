// The generation queue: one request at a time, saved to disk, never resubmitted on its own.
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,createWriteStream} from "node:fs";
import {randomUUID} from "node:crypto";
import path from "node:path";
import {Readable} from "node:stream";
import {pipeline} from "node:stream/promises";
import {aspectKey,type ModelEntry,type Size,type State} from "@trsr-video/core";
import {ProviderError,type ProviderAdapter} from "./providers/types";

export type JobStatus="queued"|"submitting"|"generating"|"downloading"|"done"|"failed"|"canceled";
export interface Job{
  id:string;createdAt:string;startedAt?:string;finishedAt?:string;status:JobStatus;
  title:string;modelId:string;modelLabel:string;provider:string;resolution:string;size:Size;durationS:number;audio:boolean;
  prompt:string;promptKind?:"full"|"compact";state:State;
  estimateUSD:number;priceAsOf:string;realUSD?:number;seed?:number;
  taskId?:string;progress?:number;waiting?:string;videoFile?:string;
  error?:{kind:string;message:string;code?:string;allowedValues?:unknown};
}
export interface QueueDeps{
  dataDir:string;
  adapters:Record<string,ProviderAdapter>;
  model:(id:string)=>ModelEntry|undefined;
  apiKey:(provider:string)=>string;
  sleep?:(ms:number)=>Promise<void>;
  now?:()=>Date;
  download?:(url:string,dest:string)=>Promise<void>;
  /** Poll schedule in ms; the last value repeats. */
  pollMs?:number[];
  timeoutMs?:number;
  retryWaitMs?:number;
  maxRetries?:number;
}
const TERMINAL:JobStatus[]=["done","failed","canceled"];

async function downloadTo(url:string,dest:string){
  const res=await fetch(url);
  if(!res.ok||!res.body)throw new Error("download failed: HTTP "+res.status);
  await pipeline(Readable.fromWeb(res.body as any),createWriteStream(dest+".part"));
  renameSync(dest+".part",dest);
}

export class JobQueue{
  private jobs:Job[]=[];
  private running=false;
  /** Set when a key or the balance stops everything; cleared by resume(). */
  paused:{reason:"auth"|"balance";provider:string;message:string}|null=null;
  private file:string;private videos:string;
  private sleep:(ms:number)=>Promise<void>;private now:()=>Date;private download:(u:string,d:string)=>Promise<void>;
  constructor(private d:QueueDeps){
    this.file=path.join(d.dataDir,"jobs.json");this.videos=path.join(d.dataDir,"videos");
    mkdirSync(this.videos,{recursive:true});
    this.sleep=d.sleep??(ms=>new Promise(r=>setTimeout(r,ms)));this.now=d.now??(()=>new Date());this.download=d.download??downloadTo;
    if(existsSync(this.file))try{this.jobs=JSON.parse(readFileSync(this.file,"utf8"))}catch{this.jobs=[]}
    // After a restart: a job that was being sent may or may not have reached the provider.
    // It is never sent again automatically, so nothing can be charged twice.
    for(const j of this.jobs)if(j.status==="submitting"||(j.status==="generating"&&!j.taskId)||j.status==="downloading"&&!j.taskId)
      this.fail(j,new ProviderError("network","The app closed while this request was being sent. Check the provider dashboard before trying again.","interrupted"));
    this.save();
  }
  private save(){const t=this.file+".tmp";writeFileSync(t,JSON.stringify(this.jobs,null,1));renameSync(t,this.file)}
  private stamp(){return this.now().toISOString()}
  private fail(j:Job,e:unknown){
    const pe=e instanceof ProviderError?e:new ProviderError("provider",(e as Error)?.message||String(e));
    j.status="failed";j.finishedAt=this.stamp();j.waiting=undefined;
    j.error={kind:pe.kind,message:pe.message,code:pe.code,allowedValues:pe.extra.allowedValues};
  }
  list():Job[]{return [...this.jobs].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}
  get(id:string){return this.jobs.find(j=>j.id===id)}
  videoPath(j:Job){return j.videoFile?path.join(this.videos,j.videoFile):null}
  /** What was committed today: real cost when known, the estimate otherwise. Unsent and canceled jobs do not count. */
  spentToday():number{
    const day=this.stamp().slice(0,10);
    return Math.round(this.jobs.filter(j=>j.createdAt.slice(0,10)===day&&j.status!=="canceled"&&(j.taskId||!TERMINAL.includes(j.status)))
      .reduce((a,j)=>a+(j.realUSD??j.estimateUSD),0)*10000)/10000;
  }
  add(input:Omit<Job,"id"|"createdAt"|"status">):Job{
    const j:Job={...input,id:randomUUID(),createdAt:this.stamp(),status:"queued"};
    this.jobs.push(j);this.save();void this.kick();return j;
  }
  resume(){this.paused=null;void this.kick()}
  async cancel(id:string):Promise<"canceled"|"notSupported"|"tooLate"|"finished"|"notFound">{
    const j=this.get(id);if(!j)return "notFound";
    if(TERMINAL.includes(j.status))return "finished";
    if(j.status==="queued"){j.status="canceled";j.finishedAt=this.stamp();j.waiting=undefined;this.save();return "canceled"}
    const a=this.d.adapters[j.provider];
    if(!a?.cancel||!j.taskId)return "notSupported";
    // Providers that can cancel often only do it before the work starts.
    try{await a.cancel(j.taskId,this.d.apiKey(j.provider))}catch{return "tooLate"}
    j.status="canceled";j.finishedAt=this.stamp();this.save();return "canceled";
  }
  /** Resolves when nothing is left to run (used by tests). */
  idle():Promise<void>{return this.loop??Promise.resolve()}
  private loop:Promise<void>|null=null;
  private kick():Promise<void>{
    if(!this.loop)this.loop=this.run().finally(()=>{this.loop=null;if(!this.paused&&this.next())void this.kick()});
    return this.loop;
  }
  private next(){return this.jobs.find(j=>j.status==="generating"&&j.taskId)??this.jobs.filter(j=>j.status==="queued").sort((a,b)=>a.createdAt.localeCompare(b.createdAt))[0]}
  private async run(){
    if(this.running)return;this.running=true;
    try{for(let j=this.next();j&&!this.paused;j=this.next())await this.process(j)}
    finally{this.running=false}
  }
  private async process(j:Job){
    const adapter=this.d.adapters[j.provider],model=this.d.model(j.modelId);
    try{
      if(!adapter||!model)throw new ProviderError("invalid","Unknown provider or model: "+j.provider+" / "+j.modelId);
      const key=this.d.apiKey(j.provider);
      if(!j.taskId){
        const max=this.d.maxRetries??40;
        for(let attempt=0;;attempt++){
          if((j.status as JobStatus)==="canceled")return;
          j.status="submitting";j.startedAt??=this.stamp();this.save();
          try{j.taskId=(await adapter.submit({model,prompt:j.prompt,size:j.size,resolution:j.resolution,aspect:aspectKey(j.state.aspect),durationS:j.durationS,audio:j.audio},key)).taskId;break}
          catch(e){
            // The provider holds the credit of a request while it runs; with a low balance the next one is refused.
            // Wait and try again. Anything else is final.
            if(!(e instanceof ProviderError&&e.retryable)||attempt>=max)throw e;
            j.status="queued";j.waiting=e.kind;this.save();
            await this.sleep(e.extra.retryAfterS?e.extra.retryAfterS*1000:this.d.retryWaitMs??15000);
          }
        }
        j.waiting=undefined;
      }
      j.status="generating";this.save();
      const sched=this.d.pollMs??[5000,5000,8000,10000],deadline=this.now().getTime()+(this.d.timeoutMs??30*60*1000);
      let netErrors=0;
      for(let i=0;;i++){
        await this.sleep(sched[Math.min(i,sched.length-1)]);
        if((j.status as JobStatus)==="canceled")return;
        let r;
        try{r=await adapter.poll(j.taskId!,key);netErrors=0}
        catch(e){
          if(e instanceof ProviderError&&(e.kind==="network"||e.kind==="busy")&&++netErrors<=5)continue;
          throw e;
        }
        if(r.status==="error")throw r.error;
        if(r.status==="success"){
          j.realUSD=r.costUSD;j.seed=r.seed;j.status="downloading";j.progress=100;this.save();
          const file=j.id+".mp4";
          await this.download(r.videoUrl,path.join(this.videos,file));
          j.videoFile=file;j.status="done";j.finishedAt=this.stamp();this.save();return;
        }
        if(typeof r.progress==="number")j.progress=r.progress;
        if(this.now().getTime()>deadline)throw new ProviderError("provider","No result after "+Math.round((this.d.timeoutMs??30*60*1000)/60000)+" minutes. The request may still finish at the provider; check its dashboard.","timeout");
        this.save();
      }
    }catch(e){
      if((j.status as JobStatus)==="canceled"){this.save();return}
      this.fail(j,e);
      // A bad key or an empty balance fails every request the same way: stop instead of retrying in a loop.
      if(e instanceof ProviderError&&(e.kind==="auth"||e.kind==="balance"))this.paused={reason:e.kind,provider:j.provider,message:e.message};
      this.save();
    }
  }
}
