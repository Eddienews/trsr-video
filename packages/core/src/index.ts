import type {State} from "./state";
import {sections,type Block} from "./prompt/single";
import {perShot} from "./prompt/perShot";

export * from "./presets";
export * from "./state";
export * from "./util";
export * from "./checks";
export {sections,type Block} from "./prompt/single";
export {perShot,framing} from "./prompt/perShot";
export {metaPrompt} from "./prompt/meta";
export {MUSIC,MUSIC_MAX_S,musicText,musicBpm,musicPrompt,type MusicTone} from "./prompt/music";
export {imageTasks,imageSize,PLATE_ONLY,type ImageTask,type ImageKind} from "./prompt/images";
export {compactPrompt,promptFor,type PromptMode,type ChosenPrompt} from "./prompt/compact";

/** The blocks of the mode the state is in: "full" = single prompt, "shots" = per shot + keyframes. */
export const blocks=(S:State):Block[]=>S.mode==="shots"?perShot(S):sections(S);
/** The final prompt text, exactly as copied or sent to a video model. */
export const plain=(S:State):string=>blocks(S).map(([h,l])=>"==== "+h+" ===="+(l.length?"\n"+l.join("\n"):"")).join("\n\n");
export * from "./models";
export {splitParts,partState,type Part,type PartRef} from "./parts";
