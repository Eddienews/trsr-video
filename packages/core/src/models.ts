// Model registry types and the pure rules around them: size, validation, rescaling, cost.
import type {State,Shot} from "./state";
import {num,total} from "./util";
import {promptFor,type PromptMode} from "./prompt/compact";

export type Size=[number,number];
export interface ModelEntry{
  id:string;label:string;provider:string;apiModelId:string;
  duration:{minS:number;maxS:number;allowedS?:number[]};
  multiShot:boolean;audio:boolean;audioParam:string|null;
  inputs:{referenceImages:number|null;firstFrame:boolean|null;lastFrame:boolean|null};
  maxPromptChars:number|null;
  /** resolution → aspect → [width,height]; null = not checked against the provider docs, never offered. */
  sizes:Record<string,Record<string,Size|null>>;
  pricing:{currency:"USD";perSecond:Record<string,number|null>;perSecondByDuration?:Record<string,Record<string,number>>;minUSD?:number;source:"official"|"measured";asOf:string;
    measured?:{resolution:string;durationS:number;costUSD:number;date:string}[]};
  notes?:string;sizesNominal?:boolean;durationControl?:boolean;docsUrl:string|null;verifiedAt:string|null;
}

/** "16:9 horizontal" → "16:9" */
export const aspectKey=(aspect:string):string=>String(aspect||"").trim().split(/\s+/)[0];

export function pickSize(m:ModelEntry,resolution:string,aspect:string):Size|null{
  return m.sizes?.[resolution]?.[aspectKey(aspect)]??null;
}
/** Resolutions this model can produce in this aspect, with a known price. */
export function resolutionsFor(m:ModelEntry,aspect:string):string[]{
  return Object.keys(m.sizes).filter(r=>pickSize(m,r,aspect)&&typeof m.pricing.perSecond[r]==="number");
}

export interface Estimate{usd:number;perSecond:number;durationS:number;resolution:string;source:"official"|"measured";asOf:string}
export function estimateCost(m:ModelEntry,resolution:string,durationS:number):Estimate|null{
  const p=m.pricing.perSecondByDuration?.[resolution]?.[String(durationS)]??m.pricing.perSecond[resolution];
  if(typeof p!=="number"||!(durationS>0))return null;
  // Some providers charge a minimum per generation.
  const usd=Math.max(p*durationS,m.pricing.minUSD??0);
  return {usd:Math.round(usd*10000)/10000,perSecond:p,durationS,resolution,source:m.pricing.source,asOf:m.pricing.asOf};
}
/** Real minus estimated, in USD and as a share of the estimate. */
export function costDiff(estimatedUSD:number,realUSD:number){
  const usd=Math.round((realUSD-estimatedUSD)*10000)/10000;
  return {usd,pct:estimatedUSD>0?Math.round(usd/estimatedUSD*1000)/10:null};
}

export type IssueCode="durationNotControlled"|"durationNotAllowed"|"durationTooLong"|"durationTooShort"|"durationNotWhole"|"shotsDontAddUp"|"sizeUnavailable"|"priceUnknown"|"promptTooLong"|"noMultiShot";
export interface Issue{code:IssueCode;blocking:boolean;value?:number|string;limit?:number|string}

/** What stops (blocking) or should be reviewed before sending this state to this model. */
export function validateForModel(S:State,m:ModelEntry,resolution:string,mode:PromptMode="auto"):Issue[]{
  const out:Issue[]=[],d=+S.dur||0;
  const allowed=m.duration.allowedS;
  // A model that picks its own length takes any duration; the form's duration only feeds the prompt and the estimate.
  if(m.durationControl===false)out.push({code:"durationNotControlled",blocking:false,value:d});
  else if(allowed&&!allowed.includes(d))out.push({code:"durationNotAllowed",blocking:true,value:d,limit:allowed.join(", ")});
  else if(d>m.duration.maxS)out.push({code:"durationTooLong",blocking:true,value:d,limit:m.duration.maxS});
  else if(d<m.duration.minS)out.push({code:"durationTooShort",blocking:true,value:d,limit:m.duration.minS});
  if(!Number.isInteger(d))out.push({code:"durationNotWhole",blocking:true,value:d});
  if(total(S)!==d)out.push({code:"shotsDontAddUp",blocking:true,value:total(S),limit:d});
  if(!pickSize(m,resolution,S.aspect))out.push({code:"sizeUnavailable",blocking:true,value:resolution+" "+aspectKey(S.aspect)});
  else if(typeof m.pricing.perSecond[resolution]!=="number")out.push({code:"priceUnknown",blocking:true,value:resolution});
  const chars=promptFor(S,m,mode).text.length;
  if(m.maxPromptChars!==null&&chars>m.maxPromptChars)out.push({code:"promptTooLong",blocking:true,value:chars,limit:m.maxPromptChars});
  if(!m.multiShot&&S.shots.length>1)out.push({code:"noMultiShot",blocking:false,value:S.shots.length});
  return out;
}

/**
 * Fit the shots into a new total, keeping how many there are and their proportions.
 * Lengths stay on the half-second grid the form uses and add up exactly to the target.
 * 5 shots of 4 s into 15 s → 5 shots of 3 s.
 */
export function rescaleShots(shots:Shot[],targetS:number):Shot[]{
  const n=shots.length,cur=shots.reduce((a,s)=>a+num(s.len),0);
  if(!n||!(targetS>0))return shots;
  const units=Math.round(targetS*2);                       // half seconds to hand out
  if(units<n)throw new Error("rescaleShots: "+targetS+" s is too short for "+n+" shots");
  const ideal=shots.map(s=>cur>0?num(s.len)/cur*units:units/n);
  const got=ideal.map(x=>Math.max(1,Math.floor(x)));
  let left=units-got.reduce((a,b)=>a+b,0);
  const order=ideal.map((x,i)=>[x-Math.floor(x),i] as [number,number]).sort((a,b)=>b[0]-a[0]||a[1]-b[1]).map(x=>x[1]);
  for(let k=0;left>0;k++,left--)got[order[k%n]]++;
  for(let k=0;left<0;k++){const i=order[n-1-(k%n)];if(got[i]>1){got[i]--;left++}if(k>n*units)break}
  return shots.map((s,i)=>({...s,len:got[i]/2}));
}
/** The state fitted to a model's duration limits (shots rescaled, duration set). */
export function fitToModel(S:State,m:ModelEntry):State{
  const d=+S.dur||0,a=m.duration.allowedS;
  // Fixed lengths (5 or 10 s, say): the longest one that fits, or the shortest there is.
  const target=a&&a.length?(a.filter(x=>x<=d).sort((x,y)=>y-x)[0]??Math.min(...a)):Math.round(Math.min(m.duration.maxS,Math.max(m.duration.minS,d)));
  return {...S,dur:target,shots:rescaleShots(S.shots,target)};
}
