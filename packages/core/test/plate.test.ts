import {describe,it,expect} from "vitest";
import {example,blank,imageTasks,LIGHTS} from "../src";

// NorthWindLab test, 2026-11-13: "ONE hedgehog, ONE leaf umbrella" in the continuity and "lamps and flames" in the storm
// light made the image model put the hedgehog and lit houses into the empty hill.
const flower=()=>{
  const S=blank();
  Object.assign(S,{title:"The Last Flower",
    chars:[{name:"PIP",nick:"",look:"A tiny round hedgehog the size of an apple, soft brown spines",ward:"",prop:"Holds a big green leaf as an umbrella",pers:"brave"}],
    location:"The top of a small bare grassy hill at stormy dusk.\nONE small blue flower, still closed, grows alone at the very top of the hill.",
    continuity:"ONE hedgehog, ONE blue flower, ONE leaf umbrella.\nThe flower stays CLOSED until the last shot, when it opens wide.",
    lighting:LIGHTS.storm.lighting+"\nOne warm ray of sun breaks through at the very end.",plates:[]});
  return S;
};
const plate=(S:ReturnType<typeof blank>)=>imageTasks(S).find(t=>t.kind==="plate")!.prompt;

describe("the empty set",()=>{
  it("leaves out what belongs to a character, light sources the place does not have, and later moments",()=>{
    const p=plate(flower());
    expect(p).not.toMatch(/hedgehog|umbrella/i);
    expect(p).not.toMatch(/lamps|flames/i);
    expect(p).not.toMatch(/very end/i);
    expect(p).toContain("The flower stays CLOSED until the last shot");
    expect(p).toContain("Stormy dusk under heavy clouds.");
  });
  it("keeps a light source the place has",()=>{
    const S=example();S.plates=[];
    expect(plate(S)).toContain("glow");
    const L=flower();L.location+="\nAn old street lamp stands beside the flower.";
    expect(plate(L)).toMatch(/lamps and flames/);
  });
});
