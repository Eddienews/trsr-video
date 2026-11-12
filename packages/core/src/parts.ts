import type {State} from "./state";
import {num,fmt,total,clean} from "./util";

/* A film longer than one generation of the model is made in parts. Parts always break between shots (a hard cut),
   never inside one, so the seam between two generations is a cut the film already has. What keeps the characters
   the same from part to part is the same reference images sent with every part. */
export interface Part{from:number;to:number;durationS:number;startS:number}
export interface PartRef{kind:"reference"|"plate";label:string}

/** Groups the shots into consecutive parts of at most maxS seconds. Null when one shot alone is longer than maxS. */
export function splitParts(S:State,maxS:number,minS=0):Part[]|null{
  const out:Part[]=[];let from=0,dur=0,start=0;
  S.shots.forEach((sh,i)=>{
    const len=num(sh.len);
    if(dur+len>maxS&&i>from){out.push({from,to:i-1,durationS:dur,startS:start});start+=dur;from=i;dur=0}
    dur+=len;
  });
  if(S.shots.length)out.push({from,to:S.shots.length-1,durationS:dur,startS:start});
  if(out.some(p=>p.durationS>maxS||p.durationS<=0))return null;
  // A last part shorter than the model's shortest clip takes shots from the one before it, while that one can spare them.
  for(let k=out.length-1;k>0;k--){
    const p=out[k],q=out[k-1];
    while(p.durationS<minS&&q.to>q.from){
      const len=num(S.shots[q.to].len);
      if(p.durationS+len>maxS||q.durationS-len<minS)break;
      q.to--;q.durationS-=len;p.from--;p.durationS+=len;p.startS-=len;
    }
  }
  return out.some(p=>p.durationS<minS)?null:out;
}

/** The film cut down to one part: its shots, its length, and a context that says which part it is and what the images are. */
export function partState(S:State,parts:Part[],k:number,refs:PartRef[]=[],token?:string):State{
  const p=parts[k],n=parts.length,P:State=JSON.parse(JSON.stringify(S));
  P.shots=P.shots.slice(p.from,p.to+1);P.dur=p.durationS;
  if(n>1){
    P.logline=["PART "+(k+1)+" OF "+n+" of a "+total(S)+"-second film (this part: "+fmt(p.startS)+"–"+fmt(p.startS+p.durationS)+").",
      "This part shows ONLY the shots listed in ACTION"+(k>0?"; what happens before them is already filmed":"")+(k<n-1?"; the story continues in the next part":"")+".",
      "The whole story, for context:",...clean(S.logline)].join("\n");
    if(k>0){
      const first=P.shots[0],acts=clean(first.act);
      P.firstFrame=(first.start||"").trim()||acts[0]||P.firstFrame;
    }
    P.continuity=[...clean(S.continuity),"Same characters, same place and same light as the other parts of the film."].join("\n");
  }
  if(refs.length){
    const name=(i:number)=>token?token.replace("{n}",String(i+1)):"IMAGE "+(i+1);
    P.refs=[...refs.map((r,i)=>name(i)+" = "+(r.kind==="plate"?"the place «"+r.label.toUpperCase()+"»: keep that place, its layout and its light.":"the reference of "+r.label.toUpperCase()+": same design, colors, markings and proportions in every shot.")),
      "Use the images for design only. Do NOT start the video on any of them."].join("\n");
  }
  return P;
}
