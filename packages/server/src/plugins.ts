// Plugins: optional folders that add features to TRSR Video. The app works the same without any.
// A plugin is a folder inside PLUGINS_DIR (or <root>/plugins) with:
//   plugin.json  {"id":"my-plugin","name":"My plugin","version":"1.0.0","server":"server.mjs","web":"web.js"}
//   server.mjs   default export {imageModels:[...], imageTasks(state){...}}
//   web.js       export function mount(ctx){...}   (draws its own section in the Media tab)
// What a plugin can do today: offer extra image tasks (a reference sheet, for instance) made by image models it names.
// A plugin never gets an API key and never calls a provider: it says WHAT to make, and the app makes it,
// with the same rule as everything else here: nothing that costs money is sent without the person's OK.
import {existsSync,readdirSync,readFileSync} from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
import type {imageTasks} from "@trsr-video/core";

type State=Parameters<typeof imageTasks>[0];
/** An image model the plugin wants to use, at a provider the app already has a key for. */
/** `settings` go to the provider as they are (a quality level, for instance), for models that take them. */
export interface PluginModel{id:string;label:string;provider:string;apiModelId:string;width:number;height:number;estimateUSD:number;maxRefs:number;settings?:Record<string,unknown>}
/** One image the plugin can make for a film. `needs` are ids of other images of the film (the app's own, like "char-0", or the plugin's) sent as references.
    kind "reference" and "plate" are offered to the film as reference images; "panel" is a piece the plugin uses to build something else.
    `width`/`height` ask for another size than the model's usual one. `upload:true` is an image the plugin's page part draws itself
    (a page put together from panels): it costs nothing and is handed to the app, never sent to a provider. */
export interface PluginTask{id:string;kind:"reference"|"plate"|"panel";label:string;group?:string;prompt:string;needs:string[];width?:number;height?:number;upload?:boolean}
/** What a plugin adds to ONE part of a film: extra reference images (images of the film it made, by task id) and lines for the prompt.
    In a line, {task-id} stands for the name the image gets in that prompt ("IMAGE 6"); a line whose image is not sent is left out. */
export interface FilmPart{index:number;count:number;from:number;to:number}
export interface FilmExtras{refs:{task:string;label:string}[];lines:string[]}
/** What a plugin gets to write the prompt of one generation: which part of the film it is, how the images sent with it are named, the lines other plugins added. */
export interface PromptContext{part:FilmPart;durationS:number;totalS:number;audio:boolean;refs:{name:string;label:string;kind:"reference"|"plate"}[];lines:string[]}
export interface Plugin{id:string;name:string;version:string;dir:string;web:string|null;imageModels:PluginModel[];imageTasks:(S:State)=>PluginTask[];filmExtras:(S:State,part:FilmPart)=>FilmExtras;
  /** Other ways of writing the prompt of a film (promptMode "plugin:<plugin id>:<prompt id>"). */
  prompts:{id:string;label:string}[];buildPrompt:(id:string,S:State,ctx:PromptContext)=>string|null}

const str=(v:unknown):v is string=>typeof v==="string"&&v.trim().length>0;
const num=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v)&&v>0;
const okModel=(m:any):m is PluginModel=>!!m&&str(m.id)&&str(m.label)&&str(m.provider)&&str(m.apiModelId)&&num(m.width)&&num(m.height)&&num(m.estimateUSD)&&Number.isInteger(m.maxRefs)&&m.maxRefs>=0;
const okTask=(t:any):t is PluginTask=>!!t&&str(t.id)&&(t.kind==="reference"||t.kind==="plate"||t.kind==="panel")&&str(t.label)&&typeof t.prompt==="string"&&Array.isArray(t.needs)&&t.needs.every(str);

/** Loads every plugin folder. A plugin that is broken is skipped with a line in the log; it never stops the app. */
export async function loadPlugins(dir:string,log:(m:string)=>void=console.error,load:(fileUrl:string)=>Promise<any>=u=>import(u)):Promise<Plugin[]>{
  const out:Plugin[]=[];
  if(!existsSync(dir))return out;
  for(const e of readdirSync(dir,{withFileTypes:true})){
    if(!e.isDirectory())continue;
    const pdir=path.join(dir,e.name),mf=path.join(pdir,"plugin.json");
    if(!existsSync(mf))continue;
    try{
      const m=JSON.parse(readFileSync(mf,"utf8"));
      if(!str(m.id)||!/^[a-z0-9-]+$/.test(m.id)||!str(m.name)||!str(m.version))throw new Error("plugin.json needs id (a-z, 0-9, -), name and version");
      if(out.some(p=>p.id===m.id))throw new Error("another plugin already uses the id "+m.id);
      const safe=(f:unknown)=>str(f)&&/^[\w.-]+$/.test(f)&&existsSync(path.join(pdir,f))?f:null;
      const server=safe(m.server),mod=server?(await load(pathToFileURL(path.join(pdir,server)).href)).default:{};
      const models=Array.isArray(mod?.imageModels)?mod.imageModels.filter(okModel):[];
      const make=typeof mod?.imageTasks==="function"?mod.imageTasks as (S:State)=>unknown:null;
      // Task ids carry the plugin id, so they never clash with the app's own images or with another plugin's.
      const tasks=(S:State)=>{if(!make)return [];let r:unknown;try{r=make(S)}catch{return []}return Array.isArray(r)?r.filter(okTask).filter(t=>t.id.startsWith(m.id+":")):[]};
      const fx=typeof mod?.filmExtras==="function"?mod.filmExtras as (S:State,p:FilmPart)=>any:null;
      const extras=(S:State,part:FilmPart):FilmExtras=>{if(!fx)return {refs:[],lines:[]};let r:any;try{r=fx(S,part)}catch{return {refs:[],lines:[]}}
        return {refs:Array.isArray(r?.refs)?r.refs.filter((x:any)=>x&&str(x.task)&&x.task.startsWith(m.id+":")&&str(x.label)).map((x:any)=>({task:x.task,label:x.label})):[],lines:Array.isArray(r?.lines)?r.lines.filter(str):[]}};
      const pr=(Array.isArray(mod?.prompts)?mod.prompts:[]).filter((p:any)=>p&&str(p.id)&&/^[a-z0-9-]+$/.test(p.id)&&str(p.label)&&typeof p.build==="function");
      const build=(id:string,S:State,ctx:PromptContext)=>{const p=pr.find((x:any)=>x.id===id);if(!p)return null;try{const t=p.build(S,ctx);return str(t)?t:null}catch{return null}};
      out.push({id:m.id,name:m.name.trim(),version:m.version.trim(),dir:pdir,web:safe(m.web),imageModels:models,imageTasks:tasks,filmExtras:extras,prompts:pr.map((p:any)=>({id:p.id,label:p.label})),buildPrompt:build});
    }catch(err){log("Plugin "+e.name+" was not loaded: "+String((err as Error).message||err))}
  }
  return out;
}
