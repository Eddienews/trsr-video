import type {State,Shot,Character} from "./state";
import {STYLES,LIGHTS} from "./presets";

export const clean=(s:unknown):string[]=>String(s||"").split("\n").map(x=>x.trim()).filter(Boolean);
export const num=(v:unknown):number=>Math.max(0,Math.round((parseFloat(v as string)||0)*2)/2);
export function fmt(x:number):string{const m=Math.floor(x/60),s=x-m*60,w=Math.floor(s),f=Math.round((s-w)*10);return m+":"+String(w).padStart(2,"0")+(f?"."+f:"")}
export function spans(S:State):[number,number][]{let c=0;return S.shots.map(sh=>{const a=c;c+=num(sh.len);return [a,c] as [number,number]})}
export const total=(S:State):number=>S.shots.reduce((a,sh)=>a+num(sh.len),0);
export const stop=(s:string):string=>/[.!?"”]$/.test(s)?s:s+".";
export const named=(S:State):[Character,number][]=>S.chars.map((c,i)=>[c,i] as [Character,number]).filter(([c])=>c.name.trim());
export const whoOf=(S:State,sh:Shot):Character[]=>(sh.who||[]).map(i=>S.chars[i]).filter(c=>c&&c.name.trim());
export const cName=(c:Character):string=>c.name.trim().toUpperCase();
export const cDesc=(c:Character):string=>cName(c)+" ("+[c.look,c.ward,c.prop].map(x=>clean(x).join(", ")).filter(Boolean).join("; ")+")";
export const styleLock=(S:State):string=>(STYLES[S.stylePreset]||{}).lock||clean(S.style)[0]||"";
export const lightLock=(S:State):string=>(LIGHTS[S.lightPreset]||{}).lock||clean(S.lighting)[0]||"";
const INDOOR=/\b(inside|interior|indoors?|store|supermarket|shop|office|kitchen|corridor|aisle|bakery|restaurant|dentro|interior|loja|mercado|supermercado|sala|quarto|cozinha|escrit[oó]rio|corredor|padaria)\b/i;
const OUTDOOR_LIGHT=["golden","morning","overcast","storm"];
export const lightOk=(S:State):boolean=>!(INDOOR.test(S.location)&&OUTDOOR_LIGHT.includes(S.lightPreset));
