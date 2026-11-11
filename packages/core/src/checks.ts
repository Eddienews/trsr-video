import type {State} from "./state";
import {clean,num,total,named,whoOf,lightOk} from "./util";

/** [passed, key] — the key (k1…k12) names the lock; labels live in the interface. */
export type Check=[boolean,string];

export function checks(S:State):Check[]{
  const filled=S.chars.filter(c=>(c.name+c.look+c.ward+c.pers).trim());
  return [
    [clean(S.logline).length>=3,"k1"],
    [filled.length>0&&filled.every(c=>c.look.trim()&&(c.ward.trim()||c.prop.trim())&&c.pers.trim()),"k2"],
    [clean(S.location).length>=2,"k3"],
    [clean(S.blocking).length>=1,"k4"],
    [clean(S.scale).length>=1,"k5"],
    [clean(S.firstFrame).length>=2,"k6"],
    [total(S)===+S.dur,"k7"],
    [S.shots.every(s=>s.lens.trim()&&s.move.trim()&&s.act.trim()),"k8"],
    [S.shots.every(s=>num(s.len)<=8),"k9"],
    [clean(S.style).length>=2&&clean(S.lighting).length>=2,"k10"],
    [named(S).length===0||S.shots.every(s=>whoOf(S,s).length>0),"k11"],
    [lightOk(S),"k12"]];
}
