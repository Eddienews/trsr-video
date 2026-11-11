import {readFileSync,readdirSync} from "node:fs";
import path from "node:path";
import type {ModelEntry} from "@trsr-video/core";

export interface ProviderEntry{label:string;envKey:string;keyHint?:string;endpoint:string;docsUrl:string;capabilities:{cancel:boolean;reportsCost:boolean}}
export interface Registry{providers:Record<string,ProviderEntry>;models:ModelEntry[]}

/** Reads registry/providers.json and every registry/models/*.json. A new model is one more entry there. */
export function loadRegistry(dir:string):Registry{
  const providers:Record<string,ProviderEntry>=JSON.parse(readFileSync(path.join(dir,"providers.json"),"utf8"));
  const models:ModelEntry[]=[];
  for(const f of readdirSync(path.join(dir,"models")).filter(f=>f.endsWith(".json")).sort())
    models.push(...JSON.parse(readFileSync(path.join(dir,"models",f),"utf8")));
  const seen=new Set<string>();
  for(const m of models){
    if(!providers[m.provider])throw new Error("registry: model "+m.id+" names unknown provider "+m.provider);
    if(seen.has(m.id))throw new Error("registry: duplicate model id "+m.id);
    seen.add(m.id);
  }
  return {providers,models};
}
