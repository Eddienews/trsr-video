import type {State,Shot} from "../state";
import {named,whoOf,cName} from "../util";
import {perShot} from "./perShot";

/* The still images a film needs before its shots: one reference per character, one empty plate per set,
   and the first and last frame of each shot. The text of each one is the same text the "per shot + keyframes"
   prompt shows (perShot), so what is generated here and what is copied from there never drift apart. */
export type ImageKind="reference"|"plate"|"keyframe";
export interface ImageTask{
  id:string;kind:ImageKind;label:string;prompt:string;
  /** Ids of the images this one is drawn from, in the order the prompt names them (image 1 = the plate). */
  needs:string[];
  shot?:number;role?:"start"|"end";
  /** Why it cannot be made here: local editors take 3 pictures (the plate plus two references). */
  unsupported?:"tooManyCharacters";
}
export const PLATE_ONLY="plate-loc";

export function imageTasks(S:State):ImageTask[]{
  const blocks=new Map(perShot(S).map(([h,l])=>[h,l.join("\n")]));
  const out:ImageTask[]=[];
  const pl=(S.plates||[]).filter(p=>(p.name+p.desc).trim());
  const plateName=(i:number)=>(pl[i].name.trim()||("SET "+(i+1))).toUpperCase();
  const plateOf=(sh:Shot)=>{const i=+(sh.plate as number);return pl.length&&i>=0&&i<pl.length?i:-1};
  for(const [c,i] of named(S)){
    const h="REFERENCE — "+cName(c);
    out.push({id:"char-"+i,kind:"reference",label:cName(c),prompt:blocks.get(h)||"",needs:[]});
  }
  if(pl.length)pl.forEach((_p,i)=>out.push({id:"plate-"+i,kind:"plate",label:plateName(i),prompt:blocks.get("SET PLATE — "+plateName(i))||"",needs:[]}));
  else out.push({id:PLATE_ONLY,kind:"plate",label:"LOCATION",prompt:blocks.get("LOCATION PLATE")||"",needs:[]});
  S.shots.forEach((sh,n)=>{
    const pi=plateOf(sh),who=whoOf(S,sh).map(c=>"char-"+S.chars.indexOf(c));
    const needs=[pi<0?(pl.length?"plate-0":PLATE_ONLY):"plate-"+pi,...who];
    for(const role of ["start","end"] as const){
      const h="SHOT "+(n+1)+" · KEYFRAME "+role.toUpperCase();
      const t:ImageTask={id:"shot-"+(n+1)+"-"+role,kind:"keyframe",label:"SHOT "+(n+1)+" · "+role.toUpperCase(),prompt:blocks.get(h)||"",needs,shot:n+1,role};
      if(who.length>2)t.unsupported="tooManyCharacters";
      out.push(t);
    }
  });
  return out;
}

const SIZES:Record<string,[number,number]>={"16:9":[1344,768],"9:16":[768,1344],"1:1":[1024,1024],"4:3":[1152,864],"3:4":[864,1152],"21:9":[1536,656]};
/** Width and height near one megapixel for a film format, both multiples of 16 (16:9 → 1344 × 768). */
export function imageSize(aspect:string):[number,number]{
  const m=/(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)/.exec(aspect||"");
  if(!m||!(+m[1]>0)||!(+m[2]>0))return SIZES["16:9"];
  if(SIZES[m[1]+":"+m[2]])return SIZES[m[1]+":"+m[2]];
  const ar=+m[1]/+m[2];
  const r=(v:number)=>Math.max(256,Math.min(2048,Math.round(v/16)*16));
  const h=Math.sqrt(1344*768/ar);
  return [r(h*ar),r(h)];
}
