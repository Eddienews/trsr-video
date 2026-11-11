import type {State,Shot,Character} from "../state";
import {GENRES,DIALOGUE,STYLES,LIGHTS} from "../presets";
import {clean,num,fmt,spans,stop,named,whoOf,cName,cDesc,styleLock,lightLock} from "../util";

export type Block=[string,string[]];

export function sections(S:State):Block[]{
  const sp=spans(S),n=S.shots.length,out:Block[]=[];
  const add=(h:string,lines:(string|null|undefined)[])=>out.push([h,lines.filter((x):x is string=>x!==null&&x!==undefined)]);
  const names=S.chars.map(c=>c.name.trim()).filter(Boolean);

  add("SCENE CONTEXT",["A "+S.dur+"-second "+GENRES[S.genre].word+" short. One single continuous story.",...clean(S.logline),DIALOGUE[S.dialogue].line]);

  const refs=clean(S.refs);
  add("ACTIVE REFERENCES",refs.length
    ?[...refs,"Use the references ONLY for what is stated above.","Everything else is defined in the sections below.","KEEP every design IDENTICAL from first frame to last."]
    :["NONE. Text-only generation.","The ART STYLE is fully described in STYLE below.","ALL characters, props and the location are defined below.","KEEP every design IDENTICAL from first frame to last."]);

  const ch:string[]=[];
  S.chars.forEach((c,i)=>{
    if(!(c.name+c.look+c.ward+c.prop+c.pers).trim())return;
    if(ch.length)ch.push("");
    ch.push((c.name.trim()||"CHARACTER "+(i+1)).toUpperCase()+(c.nick.trim()?' — "'+c.nick.trim().toUpperCase()+'"':""));
    ch.push(...clean(c.look),...clean(c.ward),...clean(c.prop));
    if(c.pers.trim())ch.push("Personality: "+c.pers.trim());
  });
  add("CHARACTERS",ch);
  add("LOCATION MAP",[...clean(S.location),...clean(S.blocking),S.textLock.trim()?stop(S.textLock.trim()):null]);
  add("SCALE LOCK",clean(S.scale));
  add("CONTINUITY",["Same location, same time of day, same light direction in every shot.","Character designs NEVER change.","Wardrobe and colors NEVER change.",...clean(S.continuity)]);
  add("FIRST FRAME / BLOCKING",clean(S.firstFrame));
  add("FORMAT MODE",[S.aspect+".",n>1?"HARD CUTS at: "+sp.slice(0,-1).map(x=>fmt(x[1])).join(" / "):"ONE continuous shot. No cuts."]);
  add("OPTICS",S.shots.map((sh,i)=>"SHOT "+(i+1)+" ("+fmt(sp[i][0])+"–"+fmt(sp[i][1])+"): "+(sh.lens.trim()||"35mm")));
  add("CAMERA",S.shots.map((sh,i)=>"SHOT "+(i+1)+": "+stop(sh.move.trim()||"LOCKED")));
  const act:(string|null)[]=[];
  S.shots.forEach((sh,i)=>{
    if(i)act.push("");
    const w=whoOf(S,sh);
    act.push("SHOT "+(i+1)+" ("+fmt(sp[i][0])+"–"+fmt(sp[i][1])+")",w.length?"In frame: ONLY "+w.map(cName).join(", ")+".":null,...clean(sh.act),i<n-1?"HARD CUT.":"Hold.");
  });
  add("ACTION",act);
  add("PERFORMANCE",clean(S.performance));
  add("SURFACE DETAIL",clean(S.surface));
  add("PHYSICS",clean(S.physics));
  add("LIGHTING",clean(S.lighting));
  add("COLOR GRADE",clean(S.grade));
  add("STYLE",[...clean(S.style),S.textLock.trim()?"NO readable text except what is stated in LOCATION MAP.":"NO readable text anywhere in frame.","NO text overlays.","NO subtitles.","NO watermark.","NO logos."]);
  add("OUTPUT SETTINGS",[S.aspect.split(" ")[0]+".",S.dur+" seconds.",n>1?n+" shots with HARD CUTS at the listed timestamps.":"One continuous shot.","Clean, smooth animation. No flicker."]);
  add("FINAL POSITIVE LOCKS",[(STYLES[S.stylePreset]||{}).lock,(LIGHTS[S.lightPreset]||{}).lock,names.length?names.map(x=>x.toUpperCase()).join(", ")+(names.length>1?" stay":" stays")+" IDENTICAL from first frame to last.":null,S.textLock.trim()?stop(S.textLock.trim()):null,...clean(S.finalLocks)]);
  return out;
}
