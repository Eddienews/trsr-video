import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import path from "node:path";
import {blank,example,total,pickSize,resolutionsFor,estimateCost,costDiff,validateForModel,rescaleShots,fitToModel,aspectKey,type ModelEntry} from "../src";

const models:ModelEntry[]=JSON.parse(readFileSync(path.join(__dirname,"../../../registry/models/runware.json"),"utf8"));
const M=(id:string)=>models.find(m=>m.id===id)!;

describe("registry",()=>{
  it("every model has the fields the app relies on",()=>{
    for(const m of models){
      expect(m.id&&m.label&&m.provider&&m.apiModelId).toBeTruthy();
      expect(m.duration.minS).toBeLessThan(m.duration.maxS);
      expect(["official","measured"]).toContain(m.pricing.source);
      expect(m.pricing.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for(const r of Object.keys(m.sizes))for(const s of Object.values(m.sizes[r]))if(s){expect(s[0]%2).toBe(0);expect(s[1]%2).toBe(0)}
    }
    expect(new Set(models.map(m=>m.id)).size).toBe(models.length);
  });
});
describe("size from resolution + format",()=>{
  it("picks the size each model accepts",()=>{
    expect(pickSize(M("seedance-2.5"),"480p","16:9 horizontal")).toEqual([854,480]);
    expect(pickSize(M("seedance-2.0-mini"),"480p","16:9 horizontal")).toEqual([864,496]);
    expect(pickSize(M("kling-4.0-flash"),"720p","16:9 horizontal")).toEqual([1280,720]);
  });
  it("does not offer what was never checked",()=>{
    // a size the registry marks as not checked (null)
    expect(pickSize({...M("kling-4.0-flash"),sizes:{"720p":{"16:9":[1280,720] as [number,number],"9:16":null}}},"720p","9:16 vertical")).toBeNull();
    expect(pickSize(M("kling-4.0-flash"),"480p","16:9")).toBeNull();
    expect(resolutionsFor(M("kling-4.0-flash"),"16:9")).toEqual(["720p"]);
    expect(resolutionsFor(M("seedance-2.5"),"1:1 square")).toEqual(["480p","720p","1080p"]);
  });
  it("aspectKey",()=>expect(aspectKey("9:16 vertical")).toBe("9:16"));
});
describe("cost",()=>{
  it("duration × price per second",()=>{
    expect(estimateCost(M("seedance-2.0-mini"),"480p",15)!.usd).toBe(0.54);
    expect(estimateCost(M("seedance-2.5"),"480p",20)!.usd).toBe(2.04);
    expect(estimateCost(M("kling-4.0-flash"),"720p",20)!.usd).toBe(1.88);
  });
  it("estimates stay within 6% of the costs measured on real runs",()=>{
    for(const m of models)for(const r of m.pricing.measured||[]){
      const e=estimateCost(m,r.resolution,r.durationS)!;
      expect(Math.abs(costDiff(e.usd,r.costUSD).pct!)).toBeLessThan(6);
    }
  });
  it("unknown price gives no estimate",()=>expect(estimateCost(M("kling-4.0-flash"),"1080p",10)).toBeNull());
  it("costDiff",()=>expect(costDiff(0.54,0.57)).toEqual({usd:0.03,pct:5.6}));
});
describe("validation per model",()=>{
  it("the 20 s example fits Seedance 2.5 and Kling, not the Mini",()=>{
    const S=example();
    expect(validateForModel(S,M("seedance-2.5"),"480p")).toEqual([]);
    expect(validateForModel(S,M("kling-4.0-flash"),"720p")).toEqual([]);
    expect(validateForModel(S,M("seedance-2.0-mini"),"480p")).toEqual([{code:"durationTooLong",blocking:true,value:20,limit:15}]);
  });
  it("flags sizes, shot sums and short durations",()=>{
    const S={...example(),aspect:"9:16 vertical"};
    expect(validateForModel(S,{...M("kling-4.0-flash"),sizes:{"720p":{"16:9":[1280,720] as [number,number],"9:16":null}}},"720p").map(i=>i.code)).toContain("sizeUnavailable");
    const T={...blank(),dur:2};
    const codes=validateForModel(T,M("seedance-2.5"),"480p").map(i=>i.code);
    expect(codes).toContain("durationTooShort");expect(codes).toContain("shotsDontAddUp");
  });
});
describe("rescale",()=>{
  it("5 shots of 4 s become 5 of 3 s",()=>{
    expect(rescaleShots(blank().shots,15).map(s=>s.len)).toEqual([3,3,3,3,3]);
  });
  it("keeps count, proportions and the exact total",()=>{
    const S=example(),r=rescaleShots(S.shots,15);          // 3,3,4,4,3,3 → 15
    expect(r).toHaveLength(6);
    expect(r.reduce((a,s)=>a+(s.len as number),0)).toBe(15);
    expect(r[2].len as number).toBeGreaterThanOrEqual(r[0].len as number);
    expect(r[0].act).toBe(S.shots[0].act);
    for(const t of [4,7,9.5,13,30])expect(rescaleShots(S.shots,t).reduce((a,s)=>a+(s.len as number),0)).toBe(t);
  });
  it("never makes a shot shorter than half a second, and refuses the impossible",()=>{
    const shots=[{len:10,lens:"",move:"",act:""},{len:0.5,lens:"",move:"",act:""},{len:0.5,lens:"",move:"",act:""}];
    expect(rescaleShots(shots,4).every(s=>(s.len as number)>=0.5)).toBe(true);
    expect(()=>rescaleShots(shots,1)).toThrow();
  });
  it("fitToModel fixes the Mini case and passes validation after",()=>{
    const F=fitToModel(example(),M("seedance-2.0-mini"));
    expect(F.dur).toBe(15);expect(total(F)).toBe(15);
    expect(validateForModel(F,M("seedance-2.0-mini"),"480p")).toEqual([]);
  });
});
