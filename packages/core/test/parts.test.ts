import {describe,it,expect} from "vitest";
import {example,plain,splitParts,partState,total} from "../src";

const film=(lens:number[])=>{const S=example();S.shots=lens.map((len,i)=>({...S.shots[i%S.shots.length],len}));S.dur=lens.reduce((a,b)=>a+b,0);return S};
describe("a film in parts",()=>{
  it("breaks only between shots and never goes over the model's longest clip",()=>{
    const S=film([4,3,3,3,2, 5,3,3,4, 4,3,4,4, 3,3,4,3,2]);
    const p=splitParts(S,15,4)!;
    expect(p.map(x=>[x.from,x.to,x.durationS,x.startS])).toEqual([[0,4,15,0],[5,8,15,15],[9,12,15,30],[13,17,15,45]]);
    expect(p.reduce((a,x)=>a+x.durationS,0)).toBe(total(S));
  });
  it("a short last part takes a shot from the one before",()=>{
    const p=splitParts(film([5,5,5,5,5,5,2]),15,4)!;
    expect(p.map(x=>x.durationS)).toEqual([15,10,7]);
    expect(p[2].from).toBe(5);expect(p[2].startS).toBe(25);
  });
  it("says no when one shot alone does not fit, or a part cannot reach the shortest clip",()=>{
    expect(splitParts(film([16,3]),15,4)).toBeNull();
    expect(splitParts(film([15,2]),15,4)).toBeNull();
    expect(splitParts(film([8,7]),15,4)!.length).toBe(1);
  });
  it("each part is a film of its own: its shots, its length, which part it is",()=>{
    const S=film([4,3,3,3,2, 5,3,3,4]),p=splitParts(S,15,4)!,B=partState(S,p,1,[{kind:"reference",label:"The Keeper"},{kind:"plate",label:"Island"}]);
    expect(B.shots).toHaveLength(4);expect(B.dur).toBe(15);expect(total(B)).toBe(15);
    const t=plain(B);
    expect(t).toContain("PART 2 OF 2 of a 30-second film (this part: 0:15–0:30).");
    expect(t).toContain("IMAGE 1 = the reference of THE KEEPER");
    expect(t).toContain("IMAGE 2 = the place «ISLAND»");
    expect(t).toContain("Do NOT start the video on any of them.");
    expect(t).not.toContain("NONE. Text-only generation.");
    expect(t).toContain("SHOT 4");expect(t).not.toContain("SHOT 5");
    // the original film is untouched
    expect(S.shots).toHaveLength(9);expect(S.refs).toBe("");
  });
  it("names the images the way the provider asks",()=>{
    const S=film([8,7,8,7]),p=splitParts(S,15,4)!;
    const t=plain(partState(S,p,0,[{kind:"reference",label:"The Keeper"},{kind:"plate",label:"Island"}],"<<<image_{n}>>>"));
    expect(t).toContain("<<<image_1>>> = the reference of THE KEEPER");
    expect(t).toContain("<<<image_2>>> = the place «ISLAND»");
    expect(t).not.toContain("IMAGE 1 =");
  });
  it("a film that fits in one generation is left as it is",()=>{
    const S=example(),p=splitParts(S,30,4)!;
    expect(p).toHaveLength(1);
    expect(plain(partState(S,p,0))).toBe(plain(S));
  });
});
