// The prompt builder must produce exactly what the v2.2 page produced.
// Goldens come from the original page itself (npm run golden).
import {describe,it,expect} from "vitest";
import {readdirSync,readFileSync,existsSync} from "node:fs";
import path from "node:path";
import {blank,example,plain,metaPrompt,checks,total,spans,lightOk,type State} from "../src";

const dir=(d:string)=>path.join(__dirname,d);
const read=(p:string)=>JSON.parse(readFileSync(p,"utf8"));
const names=readdirSync(dir("golden")).filter(f=>f.endsWith(".json")).map(f=>f.replace(".json",""));

// Same merge the page does when it loads a saved state.
const load=(name:string):State=>{
  const f=path.join(dir("fixtures"),name+".json");
  return existsSync(f)?Object.assign(blank(),read(f)):example();
};

describe.each(names)("v2.2 parity: %s",name=>{
  const g=read(path.join(dir("golden"),name+".json"));
  const S=load(name);
  it("single prompt",()=>expect(plain({...S,mode:"full"})).toBe(g.full));
  it("per shot + keyframes",()=>expect(plain({...S,mode:"shots"})).toBe(g.shots));
  it("prompt of the saved mode",()=>expect(plain(S)).toBe(g.current));
  it("AI request",()=>expect(metaPrompt(S)).toBe(g.meta));
  it("12 locks",()=>expect(checks(S)).toEqual(g.checks));
  it("timeline",()=>{expect(total(S)).toBe(g.total);expect(spans(S)).toEqual(g.spans);expect(lightOk(S)).toBe(g.lightOk)});
});
