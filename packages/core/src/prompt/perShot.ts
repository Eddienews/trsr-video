import type {State,Shot,Character} from "../state";
import {GENRES,DIALOGUE,STYLES,LIGHTS} from "../presets";
import {clean,num,fmt,spans,stop,named,whoOf,cName,cDesc,styleLock,lightLock} from "../util";

export type Block=[string,string[]];

/* One short prompt per shot (only who is in it) plus start/end keyframe prompts,
   reference sheets and an empty location plate: the local first+last-frame workflow. */
// The lens text means little to an image model: say how the frame is filled.
export function framing(lens:string):string|null{
  const l=lens.toLowerCase(),f=[];
  if(/macro|detail/.test(l))f.push("Extreme close-up on one detail, it fills the frame");
  else if(/85mm|100mm|tight/.test(l))f.push("Tight close-up: the face fills most of the frame");
  else if(/close/.test(l))f.push("Close-up: head and shoulders fill most of the frame, the background soft and blurred");
  else if(/two-shot/.test(l))f.push("Two-shot: both characters side by side fill the frame from the waist up");
  else if(/medium/.test(l))f.push("Medium shot: the character from the waist up");
  else if(/wide|establishing/.test(l))f.push("Wide shot: the whole place visible, characters small to medium in the frame");
  if(/low-angle|low angle/.test(l))f.push("camera close to the floor looking slightly up");
  if(/overhead/.test(l))f.push("camera high above looking down");
  return f.length?stop(f.join(", ")):null;
}
// Words too common to tell a character from the place.
const PLAIN=new Set("with that this from into over under above below until when then they them their there have holds hold held takes take only every each same just like very much more most some none than also small tiny little large huge round short long tall wide soft dark light bright white black brown green blue grey gray gold golden cream pink yellow orange purple silver clothes shell body face eyes head arms hands paws legs feet size".split(" "));
const STILL=(s:string)=>clean(s).filter(x=>!/haze|mist|fog|bloom|dust motes|glow and bloom/i.test(x));
export function perShot(S:State):Block[]{
  const sp=spans(S),out:Block[]=[],loc=clean(S.location);
  const add=(h:string,lines:(string|null|undefined)[])=>out.push([h,lines.filter((x):x is string=>x!==null&&x!==undefined&&x!=="")]);
  const ch=named(S),pl=(S.plates||[]).filter(p=>(p.name+p.desc).trim());
  const plateOf=(sh:Shot)=>{const i=+(sh.plate as number);return pl.length&&i>=0&&i<pl.length?i:-1};
  const plateName=(i:number)=>i<0?"LOCATION":(pl[i].name.trim()||("SET "+(i+1))).toUpperCase();
  const must=[...clean(S.continuity),...clean(S.scale)];
  // A rule that names a character who is not in the shot would pull that character in: keep it out.
  const keys=(c:Character)=>{const n=c.name.trim().toLowerCase(),w=n.split(/\s+/);return [n,w[w.length-1],...clean(c.nick).map(x=>x.toLowerCase())].filter(x=>x.length>1)};
  const mentions=(line:string,c:Character)=>keys(c).some(k=>new RegExp("\\b"+k.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\b","i").test(line));
  const STOPW=new Set("there their these those which while about after before every other never always stays only whole single film shot frame same with from into that this have like than then they them were your".split(" "));
  const words=(s:string)=>new Set((s.toLowerCase().match(/[a-z]{4,}/g)||[]).filter(x=>!STOPW.has(x)).map(x=>x.replace(/s$/,"")));
  // A rule enters a frame only when it is about something in that frame: a character in it, or a word its own text uses.
  // It also stays out when it describes the look of a character who is NOT in the frame (their outfit would jump onto someone else).
  const looks=(cs:Character[])=>new Set(cs.flatMap(c=>[...words([c.look,c.ward,c.prop].join(" "))]));
  const mustFor=(w:Character[],txt:string)=>{const out=named(S).map(([c])=>c).filter(c=>!w.includes(c)),tw=words(txt),inL=looks(w),outL=[...looks(out)].filter(x=>!inL.has(x));
    const m=must.filter(l=>!out.some(c=>mentions(l,c))&&![...words(l)].some(x=>outL.includes(x))&&(w.some(c=>mentions(l,c))||[...words(l)].some(x=>tw.has(x))));
    return m.length?"Must hold: "+m.map(stop).join(" "):null};
  const lightKf=STILL(S.lighting).join(" ");
  const look=[styleLock(S),lightLock(S)].filter(Boolean).join(" ");
  add("HOW TO USE",[
    "1. Make one reference image per character with the REFERENCE prompts (text-to-image).",
    "2. Make each empty "+(pl.length?"SET":"LOCATION")+" PLATE (text-to-image).",
    "3. For each shot, make the START and END keyframes with an image-edit model: image 1 = the plate named in the prompt, then the references in the order the prompt lists them. Most local editors take only 3 images, so with 3 or more characters the prompt asks for ONE reference sheet with the others side by side (paste their reference images next to each other).",
    "4. Generate each shot with the TAKE prompt in first + last frame mode (start = first image, end = last image).",
    "5. Join the shots in order with hard cuts."]);
  ch.forEach(([c])=>add("REFERENCE — "+cName(c),[
    "Character design reference, full body, three-quarter view, on a plain warm light-grey background.",
    cDesc(c)+".",c.pers.trim()?"Expression that shows: "+c.pers.trim()+".":null,
    ...clean(S.style).slice(0,2),"Soft even studio light. No text."]));
  // Without the style, the model picks its own look (and its own habits, like a lone figure in an empty corridor).
  // A plate is an empty set: a line about living things (animals, eyes, fur) makes the image model draw one.
  const ALIVE=/animal|creature|\beyes?\b|\bfur\b|anatomy/i,noLife=(l:string[])=>l.filter(x=>!ALIVE.test(x));
  const envStyle=noLife(clean(S.style).filter(x=>!/character|face|silhouette|puppet/i.test(x)));
  // An empty set shows the place before anything happens. A line that talks about a character (by name, or by what the
  // character is, wears or holds: "ONE hedgehog, ONE leaf umbrella") or about a later moment ("at the very end") makes the
  // image model draw it; so does, outdoors, a light source the place does not have ("lamps" in a storm on an open hill).
  const wordsOf=(s:string)=>(s.toLowerCase().match(/[a-z]{4,}/g)||[]).filter(w=>!PLAIN.has(w));
  const placeText=[...loc,...pl.map(p=>p.desc)].join(" ").toLowerCase();
  const charWords=new Set(named(S).flatMap(([c])=>wordsOf([c.name,c.nick,c.look,c.ward,c.prop].join(" "))).filter(w=>!placeText.includes(w)));
  const aboutChar=(x:string)=>wordsOf(x).some(w=>charWords.has(w));
  // One line can hold a rule for a character and one for the place ("Raincoat stays YELLOW. Lighthouse stripes stay RED."): judged sentence by sentence.
  const sentences=(x:string)=>x.split(/(?<=[.!?])\s+/);
  const LATER=/\b(at the (very )?end|in the end|last shot|finally|later on)\b/i;
  const SOURCE=/\b(lamps?|lanterns?|flames?|candles?|fires?|torch(es)?|neon|signs?|windows?|street ?lights?)\b/gi;
  const outdoors=/\b(hill|field|meadow|countryside|forest|woods|desert|beach|mountain|valley|prairie|garden|park|open sky)\b/i.test(placeText);
  const foreignLight=(x:string)=>{const m=x.match(SOURCE)||[];return outdoors&&m.length>0&&m.every(s=>!placeText.includes(s.toLowerCase().replace(/(es|s)$/,"")))};
  const plateLight=noLife(STILL(S.lighting)).filter(x=>!LATER.test(x)&&!foreignLight(x)&&!aboutChar(x));
  const plateLines=(desc:(string|null)[])=>["Background painting of an empty set for an animated film. 16:9 film frame.",...desc,...envStyle,...plateLight,...noLife(clean(S.surface)).slice(0,1),
    ...clean(S.continuity).filter(x=>!/never change|wardrobe|design/i.test(x)&&!named(S).some(([c])=>mentions(x,c))).map(x=>sentences(x).filter(s=>!aboutChar(s)).join(" ")).filter(Boolean),
    "An empty set: only architecture, objects and light.",
    S.textLock.trim()?stop(S.textLock.trim())+" No other readable text.":"No readable text, no logos."];
  if(pl.length)pl.forEach((p,i)=>add("SET PLATE — "+plateName(i),plateLines([...clean(p.desc),loc.length?"It is part of this place: "+loc.join(" "):null])));
  else add("LOCATION PLATE",plateLines(loc));
  S.shots.forEach((sh,i)=>{
    const w=whoOf(S,sh),acts=clean(sh.act).map(stop),frame=sh.lens.trim()||"35mm",pi=plateOf(sh);
    const inFrame=w.length?"In frame: ONLY "+w.map(cDesc).join("; ")+". Nobody else appears.":"No characters in frame.";
    // Local image editors take 3 pictures: the plate plus two references. A third character shares a sheet.
    const refImgs=w.length<=2?w.map(c=>[c]):[[w[0]],w.slice(1)];
    const refsLine="Image 1 is the "+(pi<0?"LOCATION PLATE":"SET PLATE «"+plateName(pi)+"»")+": keep that place, its layout and its light."+(w.length?" "+refImgs.map((g,j)=>"Image "+(j+2)+(g.length>1?" is a reference sheet with "+g.map((c,k)=>cName(c)+" ("+(k===0?"left":k===g.length-1?"right":"middle")+")").join(" and "):" is the reference of "+cName(g[0]))+": same design, outfit, colors and proportions.").join(" "):"");
    const startTxt=(sh.start||"").trim()||("The first moment of the shot: "+(acts[0]||"the scene before anything moves"));
    const endTxt=(sh.end||"").trim()||("The last moment of the shot: "+(acts[acts.length-1]||"the scene after the action"));
    const kf=(t:string)=>["Film frame of the animated short, "+frame+".",framing(frame),stop(t),inFrame,mustFor(w,t),refsLine,styleLock(S),lightKf,"Clear, crisp image with full contrast. 16:9, no readable text."];
    add("SHOT "+(i+1)+" — "+fmt(sp[i][0])+"–"+fmt(sp[i][1])+" ("+num(sh.len)+" s) · plate: "+(pi<0?"LOCATION PLATE":"SET PLATE — "+plateName(pi)),[]);
    add("SHOT "+(i+1)+" · KEYFRAME START",kf(startTxt));
    add("SHOT "+(i+1)+" · KEYFRAME END",kf(endTxt));
    add("SHOT "+(i+1)+" · TAKE PROMPT",[
      "Animated film shot, "+frame+", camera: "+stop(sh.move.trim()||"LOCKED"),framing(frame),...acts,inFrame,mustFor(w,acts.join(" ")),look,
      "Same place and same characters from the first to the last frame; nothing new enters the frame.",
      DIALOGUE[S.dialogue].line]);
  });
  return out;
}
