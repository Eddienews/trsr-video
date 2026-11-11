// The compact prompt: the same film in far fewer characters, for models with a short prompt limit
// (LTX takes 5000) or that make one clip without cuts (Runway Gen-4.5, Pika, Veo, Grok Imagine).
// It keeps what the tests showed matters most: style and light, who is who, the place, one action per shot,
// who is in frame, and the few locks that must not fail. It drops surfaces, physics, grade and performance notes.
import type {State} from "../state";
import type {ModelEntry} from "../models";
import {GENRES,DIALOGUE} from "../presets";
import {clean,fmt,spans,stop,whoOf,cName,styleLock,lightLock,named} from "../util";
import {framing} from "./perShot";
import {plain} from "../index";

const all=(s:string)=>clean(s).map(stop).join(" ");
const firstN=(s:string,n:number)=>clean(s).slice(0,n).map(stop).join(" ");
const CLOSE="NO subtitles, NO watermark, NO logos.";

// level 0 = everything the compact form has; each level up drops the least important part still there.
function build(S:State,multiShot:boolean,level:number):string{
  const sp=spans(S),out:string[]=[];
  out.push(("A "+S.dur+"-second "+(GENRES[S.genre]?.word||"animated")+" animated short. "+(DIALOGUE[S.dialogue]?.line||"")).trim());
  const story=level<2?all(S.logline):level<3?firstN(S.logline,2):"";
  if(story)out.push("STORY: "+story);
  const look=[styleLock(S),lightLock(S)].filter(Boolean).join(" ");
  if(look)out.push("STYLE: "+look);
  const chars=named(S).map(([c])=>{
    const parts=level<2?[c.look,c.ward,c.prop].map(x=>clean(x).join(", ")):[clean(c.look)[0]||"",clean(c.ward)[0]||""];
    return cName(c)+" ("+parts.filter(Boolean).join("; ")+")";
  });
  if(chars.length)out.push("CHARACTERS: "+chars.join(". ")+". Designs stay IDENTICAL from first frame to last.");
  const place=[level<2?all(S.location):firstN(S.location,2),level<1?all(S.blocking):firstN(S.blocking,2),S.textLock.trim()?stop(S.textLock.trim()):""].filter(Boolean).join(" ");
  if(place)out.push("PLACE: "+place);
  if(multiShot&&S.shots.length>1){
    out.push(S.shots.length+" SHOTS with HARD CUTS at "+sp.slice(0,-1).map(x=>fmt(x[1])).join(" / ")+":");
    S.shots.forEach((sh,i)=>{
      const w=whoOf(S,sh);
      out.push(fmt(sp[i][0])+"–"+fmt(sp[i][1])+" "+(sh.lens.trim()||"35mm")+", camera "+stop(sh.move.trim()||"LOCKED")
        +(w.length?" In frame: ONLY "+w.map(cName).join(", ")+".":"")+" "+all(sh.act));
    });
  }else{
    // One clip, no cuts: the shots become one action told in order, framed like the first shot.
    const s0=S.shots[0];
    out.push(("ONE continuous shot, no cuts. "+(framing(s0?.lens||"")||"")+" Camera: "+stop((s0?.move||"").trim()||"LOCKED")).replace(/\s+/g," "));
    const acts=S.shots.map(sh=>all(sh.act)).filter(Boolean);
    if(acts.length)out.push("ACTION in order: "+acts.join(" Then: "));
  }
  const rules=[level<1?all(S.scale):"",level<1?all(S.continuity):"",all(S.finalLocks)].filter(Boolean).join(" ");
  out.push("RULES: "+(rules?rules+" ":"")+(S.textLock.trim()?"NO readable text except the one stated in PLACE. ":"NO readable text. ")+CLOSE);
  return out.join("\n");
}

export interface CompactResult{text:string;/** 0 = nothing dropped … 4 = cut to fit */level:number}
export function compactPrompt(S:State,o:{multiShot:boolean;maxChars?:number|null}):CompactResult{
  const max=o.maxChars??Infinity;
  let text="";
  for(let level=0;level<=3;level++){text=build(S,o.multiShot,level);if(text.length<=max)return {text,level}}
  // Still too long: keep whole sentences from the start and always end with the closing rules.
  const tail="\n"+CLOSE,room=Math.max(0,max-tail.length);
  let body=text.slice(0,room);
  const cut=Math.max(body.lastIndexOf(". "),body.lastIndexOf(".\n"));
  if(cut>room*0.5)body=body.slice(0,cut+1);
  return {text:(body.trimEnd()+tail).slice(0,max),level:4};
}

export type PromptMode="auto"|"full"|"compact";
export interface ChosenPrompt{text:string;kind:"full"|"compact";level:number}
/**
 * The prompt that goes to a model. "auto" sends the full prompt when the model cuts between shots and
 * has room for it, and the compact one otherwise.
 */
export function promptFor(S:State,m:ModelEntry,mode:PromptMode="auto"):ChosenPrompt{
  const full=plain({...S,mode:"full"});
  const useCompact=mode==="compact"||(mode==="auto"&&(!m.multiShot||(m.maxPromptChars!==null&&full.length>m.maxPromptChars)));
  if(!useCompact)return {text:full,kind:"full",level:0};
  return {...compactPrompt(S,{multiShot:m.multiShot,maxChars:m.maxPromptChars}),kind:"compact"};
}
