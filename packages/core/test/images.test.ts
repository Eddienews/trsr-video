import {describe,it,expect} from "vitest";
import {example,blank,imageTasks,imageSize,perShot} from "../src";

describe("the still images of a film",()=>{
  const S=example(),T=imageTasks(S),by=(id:string)=>T.find(t=>t.id===id)!;
  it("lists one reference per character, one plate per set and two frames per shot",()=>{
    expect(T.filter(t=>t.kind==="reference").map(t=>t.id)).toEqual(["char-0","char-1"]);
    expect(T.filter(t=>t.kind==="plate").map(t=>[t.id,t.label])).toEqual([["plate-0","ISLAND"],["plate-1","LAMP ROOM"]]);
    expect(T.filter(t=>t.kind==="keyframe")).toHaveLength(S.shots.length*2);
  });
  it("uses exactly the text of the per-shot prompt",()=>{
    const blocks=new Map(perShot(S).map(([h,l])=>[h,l.join("\n")]));
    expect(by("char-0").prompt).toBe(blocks.get("REFERENCE — THE KEEPER"));
    expect(by("plate-1").prompt).toBe(blocks.get("SET PLATE — LAMP ROOM"));
    expect(by("shot-3-end").prompt).toBe(blocks.get("SHOT 3 · KEYFRAME END"));
    for(const t of T)expect(t.prompt.length).toBeGreaterThan(40);
  });
  it("a frame is drawn from its plate first, then the characters in it",()=>{
    expect(by("shot-1-start").needs).toEqual(["plate-0","char-1"]);
    expect(by("shot-3-start").needs).toEqual(["plate-1","char-0","char-1"]);
    expect(by("char-0").needs).toEqual([]);
  });
  it("without sets there is a single location plate",()=>{
    const B=example();B.plates=[];const t=imageTasks(B);
    expect(t.filter(x=>x.kind==="plate").map(x=>x.id)).toEqual(["plate-loc"]);
    expect(t.find(x=>x.id==="shot-2-start")!.needs[0]).toBe("plate-loc");
  });
  it("a frame with three characters is marked, not silently cut",()=>{
    const B=example();B.chars.push({name:"THE CAT",nick:"",look:"grey cat",ward:"",prop:"",pers:"lazy"});B.shots[2].who=[0,1,2];
    const t=imageTasks(B);
    expect(t.find(x=>x.id==="shot-3-start")!.unsupported).toBe("tooManyCharacters");
    expect(t.find(x=>x.id==="shot-2-start")!.unsupported).toBeUndefined();
  });
  it("an empty form still gives a plate and frames, and no unnamed character",()=>{
    const t=imageTasks(blank());
    expect(t.some(x=>x.kind==="reference")).toBe(false);
    expect(t.filter(x=>x.kind==="keyframe")).toHaveLength(10);
  });
  it("sizes are near one megapixel in multiples of 16",()=>{
    expect(imageSize("16:9 horizontal")).toEqual([1344,768]);
    expect(imageSize("9:16 vertical")).toEqual([768,1344]);
    expect(imageSize("1:1")).toEqual([1024,1024]);
    const [w,h]=imageSize("2:1");expect(w%16+h%16).toBe(0);expect(Math.abs(w/h-2)).toBeLessThan(0.05);
    expect(imageSize("")).toEqual(imageSize("16:9"));
  });
});
