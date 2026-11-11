import {describe,it,expect} from "vitest";
import {fmt,num,clean,stop,framing,blank,sections,perShot,checks} from "../src";

describe("helpers",()=>{
  it("fmt writes cut times",()=>{expect(fmt(0)).toBe("0:00");expect(fmt(7.5)).toBe("0:07.5");expect(fmt(75)).toBe("1:15")});
  it("num rounds to half seconds and never goes negative",()=>{expect(num("2.3")).toBe(2.5);expect(num(-4)).toBe(0);expect(num("x")).toBe(0)});
  it("clean drops empty lines",()=>expect(clean(" a \n\n b ")).toEqual(["a","b"]));
  it("stop adds one final period",()=>{expect(stop("LOCKED")).toBe("LOCKED.");expect(stop("Hold!")).toBe("Hold!")});
});
describe("lens → framing",()=>{
  it.each([
    ["35mm wide establishing",/^Wide shot/],["50mm medium",/^Medium shot/],["50mm close-up",/^Close-up: head and shoulders/],
    ["85mm close-up",/^Tight close-up/],["100mm macro detail",/^Extreme close-up/],["35mm two-shot",/^Two-shot/],
  ])("%s",(lens,re)=>expect(framing(lens)).toMatch(re));
  it("adds camera height",()=>{expect(framing("24mm low-angle wide")).toMatch(/close to the floor/);expect(framing("18mm overhead wide")).toMatch(/high above/)});
  it("unknown lens gives no framing line",()=>expect(framing("anamorphic")).toBeNull());
});
describe("structure",()=>{
  const S=blank();
  it("single prompt has the 19 sections in order",()=>{
    const h=sections(S).map(b=>b[0]);
    expect(h).toHaveLength(19);expect(h[0]).toBe("SCENE CONTEXT");expect(h[18]).toBe("FINAL POSITIVE LOCKS");
  });
  it("per shot gives a header, two keyframes and a take for every shot",()=>{
    const h=perShot(S).map(b=>b[0]);
    expect(h.filter(x=>/KEYFRAME START$/.test(x))).toHaveLength(S.shots.length);
    expect(h.filter(x=>/TAKE PROMPT$/.test(x))).toHaveLength(S.shots.length);
  });
  it("there are 12 locks",()=>expect(checks(S)).toHaveLength(12));
});
