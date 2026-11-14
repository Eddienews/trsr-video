import {spawn} from "node:child_process";
import {writeFileSync,rmSync} from "node:fs";

/* Putting the music under a finished video is done by ffmpeg on this computer.
   The picture is copied as it is; only the sound is written again. */
export type Run=(cmd:string,args:string[])=>Promise<{code:number;out:string}>;
export const run:Run=(cmd,args)=>new Promise(res=>{
  let out="";
  try{
    const p=spawn(cmd,args,{windowsHide:true});
    p.stdout.on("data",d=>{out+=d});p.stderr.on("data",d=>{out+=d});
    p.on("error",()=>res({code:-1,out}));p.on("close",code=>res({code:code??-1,out}));
  }catch{res({code:-1,out})}
});

export class Ffmpeg{
  private ok:boolean|null=null;
  constructor(private bin:()=>string,private exec:Run=run){}
  private get cmd(){return this.bin()||"ffmpeg"}
  async available(){if(this.ok===null)this.ok=(await this.exec(this.cmd,["-version"])).code===0;return this.ok}
  /** ffmpeg prints the streams of a file to stderr when asked to read it without an output. */
  private async hasAudio(file:string){return /Stream #\d+:\d+.*: Audio:/.test((await this.exec(this.cmd,["-hide_banner","-i",file])).out)}

  /** The arguments of the mix: music at `volume` under the video's own sound (when it has one), faded out over the last 1.5 s, cut at the video's end. */
  static args(video:string,music:string,out:string,o:{volume:number;durationS:number;videoHasAudio:boolean}){
    const fade=Math.max(0,o.durationS-1.5).toFixed(2),m="[1:a]volume="+o.volume.toFixed(2)+",afade=t=out:st="+fade+":d=1.5[m]";
    const filter=o.videoHasAudio?m+";[0:a][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]":m.replace(/\[m\]$/,"[a]");
    return ["-y","-hide_banner","-loglevel","error","-i",video,"-stream_loop","-1","-i",music,"-filter_complex",filter,"-map","0:v:0","-map","[a]","-c:v","copy","-c:a","aac","-b:a","192k","-shortest","-t",(o.durationS+0.5).toFixed(2),"-movflags","+faststart",out];
  }
  /** A smaller JPEG copy of an image, to send as a reference. */
  async toJpeg(src:string,dest:string){
    const r=await this.exec(this.cmd,["-y","-hide_banner","-loglevel","error","-i",src,"-vf","scale='min(1280,iw)':-2","-q:v","3",dest]);
    if(r.code!==0)throw new Error("ffmpeg: "+(r.out.trim().split("\n").pop()||"failed").slice(0,300));
  }
  /** The last frame of a clip as a JPEG. */
  async lastFrame(src:string,dest:string){
    const r=await this.exec(this.cmd,["-y","-hide_banner","-loglevel","error","-sseof","-0.5","-i",src,"-update","1","-q:v","2",dest]);
    if(r.code!==0)throw new Error("ffmpeg: "+(r.out.trim().split("\n").pop()||"failed").slice(0,300));
  }
  /** The arguments that join clips end to end. Picture and sound are written again so clips from separate generations line up. */
  static concatArgs(list:string,out:string){
    return ["-y","-hide_banner","-loglevel","error","-f","concat","-safe","0","-i",list,"-c:v","libx264","-crf","16","-preset","medium","-pix_fmt","yuv420p","-c:a","aac","-b:a","192k","-movflags","+faststart",out];
  }
  async concat(files:string[],out:string){
    const list=out+".txt";
    writeFileSync(list,files.map(f=>"file '"+f.replace(/\\/g,"/").replace(/'/g,"'\\''")+"'").join("\n"));
    try{
      const r=await this.exec(this.cmd,Ffmpeg.concatArgs(list,out));
      if(r.code!==0)throw new Error("ffmpeg: "+(r.out.trim().split("\n").pop()||"failed").slice(0,300));
    }finally{rmSync(list,{force:true})}
  }
  async mix(video:string,music:string,out:string,o:{volume:number;durationS:number}){
    const r=await this.exec(this.cmd,Ffmpeg.args(video,music,out,{...o,videoHasAudio:await this.hasAudio(video)}));
    if(r.code!==0)throw new Error("ffmpeg: "+(r.out.trim().split("\n").pop()||"failed").slice(0,300));
  }
}
