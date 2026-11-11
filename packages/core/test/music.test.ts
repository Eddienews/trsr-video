import {describe,it,expect} from "vitest";
import {example,blank,GENRES,MUSIC,musicPrompt,musicText} from "../src";

describe("music follows the tone of the film",()=>{
  it("every tone has its own music",()=>{
    expect(Object.keys(MUSIC).sort()).toEqual(Object.keys(GENRES).sort());
    expect(new Set(Object.values(MUSIC).map(m=>m.text)).size).toBe(Object.keys(MUSIC).length);
  });
  it("the prompt carries the description, the tempo and the length of the film",()=>{
    const S=example();S.genre="heartfelt";S.dur=15;
    const p=musicPrompt(S);
    expect(p.seconds).toBe(15);expect(p.bpm).toBe(72);
    expect(p.text).toBe(musicText(S).replace(/\.$/,"")+". BPM: 72. Length: 15 seconds");
    expect(p.text).toContain("no vocals");
    S.genre="action";expect(musicPrompt(S).text).toContain("BPM: 140");
  });
  it("a description written by the person replaces the one of the tone, not the tempo or the length",()=>{
    const S=example();S.dur=20;
    expect(musicPrompt(S,"  Solo accordion waltz.\n Dusty and slow.. ").text).toBe("Solo accordion waltz. Dusty and slow. BPM: 120. Length: 20 seconds");
    expect(musicPrompt(S,"   ").text).toBe(musicPrompt(S).text);
  });
  it("the length stays inside what the model makes",()=>{
    const S=blank();S.dur=900;expect(musicPrompt(S).seconds).toBe(380);
    S.dur=1;expect(musicPrompt(S).seconds).toBe(5);
    S.genre="unknown";expect(musicPrompt(S).bpm).toBe(72);
  });
});
