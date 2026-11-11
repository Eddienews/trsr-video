import type {State} from "../state";
import {num} from "../util";

/* The music of a film follows its tone. One short description per tone, always instrumental:
   a voice would fight the sounds and lines of the video. The text is English, like every prompt. */
export interface MusicTone{text:string;bpm:number}
export const MUSIC:Record<string,MusicTone>={
  comedy:{bpm:120,text:"Playful, bouncy orchestral comedy score. Pizzicato strings, clarinet, bassoon and light percussion. Mischievous and warm, with small pauses for the jokes"},
  heartfelt:{bpm:72,text:"Gentle, warm and tender piece. Soft felt piano and nylon-string guitar, with light strings entering halfway. Hopeful and intimate"},
  suspense:{bpm:90,text:"Tense, minimal underscore. Low pulsing synth, sparse piano notes and slowly rising strings. Quiet, uneasy, building to the end"},
  action:{bpm:140,text:"Driving, energetic orchestral action cue. Fast percussion, staccato strings and short brass hits. Bold and relentless"},
  wonder:{bpm:96,text:"Magical, wide-eyed orchestral piece. Celesta, harp, soft choir pads and flowing strings. Curious and full of awe"}
};
export const MUSIC_MAX_S=380;
const END="Instrumental only, no vocals. Film score for a short animated film, clean ending";

/** The description offered for the film's tone; the person can rewrite it. */
export const musicText=(S:State):string=>(MUSIC[S.genre]||MUSIC.heartfelt).text+". "+END+".";
export const musicBpm=(S:State):number=>(MUSIC[S.genre]||MUSIC.heartfelt).bpm;

/** What is sent to the music model: the description, the tempo and the length of the film. */
export function musicPrompt(S:State,custom?:string):{text:string;seconds:number;bpm:number}{
  const seconds=Math.max(5,Math.min(MUSIC_MAX_S,Math.round(num(S.dur)||20)));
  const body=(custom??"").trim().replace(/\s+/g," ").replace(/\.+$/,"")||musicText(S).replace(/\.+$/,"");
  const bpm=musicBpm(S);
  return {text:body+". BPM: "+bpm+". Length: "+seconds+" seconds",seconds,bpm};
}
