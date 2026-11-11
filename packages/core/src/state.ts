import {GENRES,STYLES,LIGHTS} from "./presets";

export interface Character{name:string;nick:string;look:string;ward:string;prop:string;pers:string}
export interface Plate{name:string;desc:string}
export interface Shot{len:number|string;lens:string;move:string;act:string;who?:number[];plate?:number|string;start?:string;end?:string}
export interface State{
  lang:"pt"|"en";title:string;dur:number;aspect:string;genre:string;dialogue:string;logline:string;refs:string;
  chars:Character[];location:string;blocking:string;scale:string;continuity:string;firstFrame:string;textLock:string;
  plates:Plate[];shots:Shot[];stylePreset:string;lightPreset:string;mode:"full"|"shots";
  style:string;surface:string;physics:string;lighting:string;grade:string;performance:string;finalLocks:string;
}

export function blank():State{
  return {lang:"pt",title:"",dur:20,aspect:"16:9 horizontal",genre:"comedy",dialogue:"none",logline:"",refs:"",
    chars:[{name:"",nick:"",look:"",ward:"",prop:"",pers:""}],
    location:"",blocking:"",scale:"",continuity:"",firstFrame:"",textLock:"",plates:[],
    shots:[{len:4,lens:"35mm wide establishing",move:"Slow push-in.",act:""},{len:4,lens:"50mm close-up",move:"LOCKED.",act:""},{len:4,lens:"50mm close-up",move:"LOCKED.",act:""},{len:4,lens:"24mm low-angle wide",move:"FAST tracking alongside the action.",act:""},{len:4,lens:"35mm two-shot",move:"LOCKED. Hold for the reaction.",act:""}],
    stylePreset:"painterly",lightPreset:"golden",mode:"full",
    style:STYLES.painterly.style,surface:STYLES.painterly.surface,physics:STYLES.painterly.physics,
    lighting:LIGHTS.golden.lighting,grade:LIGHTS.golden.grade,performance:GENRES.comedy.perf,finalLocks:""};
}
export function example():State{
  const s=blank();
  Object.assign(s,{title:"The Last Match",dur:20,genre:"comedy",dialogue:"sfx",
    logline:"A stormy dusk on a tiny rocky island with ONE old lighthouse.\nThe lamp is OUT and a small fishing boat is heading for the rocks.\nThe keeper has ONE match left.\nEvery time he strikes it, a cheeky seagull blows it out.\nWhen he gives up, the gull lights the lamp itself with a stolen lighter.",
    chars:[
      {name:"THE KEEPER",nick:"OLD BRINE",look:"Short, barrel-shaped old man, huge white beard, tiny eyes under bushy brows",ward:"Bright YELLOW raincoat, navy knit cap, black rubber boots",prop:"Carries a small red matchbox",pers:"stubborn, grumpy, easily flustered"},
      {name:"THE GULL",nick:"PIP",look:"Plump white seagull with grey wings, oversized orange beak, one feather sticking up like a raised eyebrow",ward:"",prop:"Keeps a nest full of shiny stolen junk",pers:"cheeky, smug, secretly helpful"}],
    location:"A tiny rocky island with ONE red-and-white striped lighthouse.\nA round lamp room at the top with glass windows all around.\nA big brass lamp stands in the center of the room.\nThe gull's nest sits on the railing outside, full of shiny junk.\nDark sea all around.",
    blocking:"The keeper stands at the lamp, frame center.\nThe gull perches on the open window, FRAME RIGHT.\nThe boat light is always visible through the windows at FRAME LEFT.",
    scale:"The keeper is short. The lamp is as tall as he is.\nThe gull is the size of his head.\nThe boat is TINY in the distance.",
    continuity:"The lamp stays DARK until the final shot.\nRaincoat stays YELLOW. Lighthouse stripes stay RED and WHITE.",
    firstFrame:"Wide view of the island at stormy dusk.\nThe lighthouse is dark.\nA small boat light bobs far out at sea, frame left.\nA white gull sits on the top railing.",
    shots:[
      {len:3,lens:"35mm wide establishing",move:"Slow push-in toward the lamp room.",act:"Stormy dusk. Waves hit the rocks.\nThe lighthouse is dark.\nA boat light bobs toward the island.",who:[1],plate:0,start:"Wide view of the dark lighthouse on the rocky island at stormy dusk, a tiny boat light far out at sea on the left, the gull small on the top railing",end:"Same view, closer to the lamp room, the boat light a little nearer"},
      {len:3,lens:"50mm close-up",move:"LOCKED.",act:"Inside the lamp room. The keeper opens his matchbox.\nONE match left. He gulps.",who:[0],plate:1,start:"Close-up of the keeper in the dark lamp room holding a small red matchbox",end:"Same close-up: the matchbox is open with ONE match inside, the keeper gulps, worried"},
      {len:4,lens:"50mm medium",move:"LOCKED.",act:"He strikes the match. A tiny flame.\nThe gull leans in from the window and blows it out with one puff.\nThe keeper turns slowly, furious.",who:[0,1],plate:1},
      {len:4,lens:"24mm low-angle wide",move:"FAST tracking around the lamp.",act:"The keeper chases the gull around the lamp, waving his cap.\nThe gull hops just out of reach every time.\nThe boat light grows bigger in the window.",who:[0,1],plate:1},
      {len:3,lens:"85mm close-up",move:"SNAP ZOOM into the gull.",act:"The keeper slumps against the lamp, defeated.\nThe gull tilts its head.\nIt drops a shiny lighter from its beak and flicks it with one foot.",who:[0,1],plate:1},
      {len:3,lens:"28mm wide",move:"LOCKED. Hold for the ending.",act:"The lamp bursts into warm light. The beam sweeps over the sea.\nThe boat turns away safely.\nThe keeper and the gull stand side by side. The gull winks.",who:[0,1],plate:1}],
    plates:[{name:"ISLAND",desc:"Wide view of the tiny rocky island at stormy dusk, the red-and-white striped lighthouse with its dark lamp room on top, rough sea all around"},
      {name:"LAMP ROOM",desc:"Inside the round lamp room: the big brass lamp in the center, glass windows all around showing the dark sea, an open window on the right with the gull's nest outside"}],
    lightPreset:"storm",lighting:LIGHTS.storm.lighting,grade:LIGHTS.storm.grade,
    finalLocks:"ONE match. ONE lamp. The gull lights it."});
  return s;
}
