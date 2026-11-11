// Keys and settings live in the .env file at the project root (or in the system environment).
// They are read here, on the server, and never sent to the browser or written to logs.
import {readFileSync,writeFileSync,existsSync,renameSync} from "node:fs";

export class EnvFile{
  private vals=new Map<string,string>();
  constructor(private file:string){this.load()}
  load(){
    this.vals.clear();
    if(!existsSync(this.file))return;
    for(const line of readFileSync(this.file,"utf8").split(/\r?\n/)){
      const m=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if(m)this.vals.set(m[1],m[2].replace(/^(['"])(.*)\1$/,"$2"));
    }
  }
  /** .env wins over the system environment, so a key saved in the app is the one used. */
  get(name:string):string{return (this.vals.get(name)??process.env[name]??"").trim()}
  has(name:string):boolean{return this.get(name).length>0}
  /** What the interface may show: whether a key exists and its last 4 characters. */
  mask(name:string){const v=this.get(name);return {configured:v.length>0,last4:v.length>=8?v.slice(-4):""}}
  set(name:string,value:string){
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))throw new Error("invalid variable name");
    if(/[\r\n]/.test(value))throw new Error("invalid value");
    const lines=existsSync(this.file)?readFileSync(this.file,"utf8").split(/\r?\n/):[];
    const i=lines.findIndex(l=>new RegExp("^\\s*"+name+"\\s*=").test(l));
    const row=value===""?null:name+"="+value;
    if(i>=0){if(row===null)lines.splice(i,1);else lines[i]=row}else if(row!==null){if(lines.length&&lines[lines.length-1]==="")lines.pop();lines.push(row)}
    const tmp=this.file+".tmp";
    writeFileSync(tmp,lines.join("\n").replace(/\n*$/,"\n"),{mode:0o600});
    renameSync(tmp,this.file);
    this.load();
  }
  number(name:string):number|null{const v=parseFloat(this.get(name));return Number.isFinite(v)&&v>0?v:null}
}
