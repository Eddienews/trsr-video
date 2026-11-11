import type {State} from "../state";
import {GENRES,DIALOGUE} from "../presets";
import {clean} from "../util";
import {sections} from "./single";

export function metaPrompt(S:State):string{
  const heads=sections(S).map(x=>x[0]);
  return ["You are a director writing a prompt for a text-to-video AI model that makes short animated films.",
  "Turn the IDEA below into one complete prompt. The idea may be written in Portuguese; write the prompt in English.",
  "",
  "Use EXACTLY these sections, in this order, each one headed as ==== NAME ====:",
  heads.join(" / "),
  "",
  "Rules:",
  "- Short declarative lines, one fact per line. No paragraphs.",
  "- Put the few things that must not fail in CAPITALS (colors, counts, sizes, NO/NEVER rules).",
  "- CHARACTERS: for each one give body and face, outfit with exact colors, vehicle or prop, and personality.",
  "- LOCATION MAP: describe the place like a map, then say from which side of the frame each character enters.",
  "- SCALE LOCK and CONTINUITY: state relative sizes and everything that never changes between shots.",
  "- Split the "+S.dur+" seconds into 5 to 8 shots. Give every shot a time range, one lens (OPTICS), one camera move (CAMERA) and one clear action (ACTION). End each shot with HARD CUT. and the last one with Hold.",
  "- The story needs a setup, an escalation and a final turn that lands in the last two shots.",
  "- STYLE ends with: NO text overlays. NO subtitles. NO watermark. NO logos.",
  "- FINAL POSITIVE LOCKS repeats, in five or six lines, the style, the light, the key colors and the ending.",
  "- Output only the prompt.",
  "",
  "Fixed settings:",
  "Format: "+S.aspect+". Duration: "+S.dur+" seconds. Tone: "+GENRES[S.genre].word+". "+DIALOGUE[S.dialogue].line,
  "",
  "STYLE to use:",...clean(S.style),
  "",
  "LIGHTING to use:",...clean(S.lighting),
  "",
  "IDEA:",
  clean(S.logline).join("\n")||"[write your idea here]"].join("\n");
}
