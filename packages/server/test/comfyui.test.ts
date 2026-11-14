import {describe,it,expect} from "vitest";
import {comfyuiAdapter,h3Graph} from "../src/providers/comfyui";
import {loadRegistry,keyless} from "../src/registry";
import path from "node:path";

const LISTS:Record<string,[string,string[]]>={
  UNETLoader:["unet_name",["minimax_h3_fl2va_pruned_w4a8_mixed.safetensors","minimax_h3_ref2va_pruned_w4a8_mixed.safetensors","z_image_turbo.safetensors"]],
  CLIPLoader:["clip_name",["qwen3vl_4b_fp8_scaled.safetensors"]],
  VAELoader:["vae_name",["minimax_h3_video_vae_int8_convrot.safetensors","minimax_h3_audio_vae_fp32.safetensors"]],
  ClipProjApply:["projection",["mmh3-4b-ClipProj-v3.1-mlp.safetensors"]],
};
function fake(history:()=>any,lists=LISTS){
  const calls:{url:string;body?:any}[]=[];
  const res=(o:any,status=200)=>({ok:status<400,status,json:async()=>o,text:async()=>JSON.stringify(o)});
  const f=async(url:string,init?:any)=>{
    calls.push({url,body:init?.body});
    const p=url.replace("http://comfy","");
    if(p.startsWith("/object_info/")){const n=p.split("/").pop()!;const [inp,list]=lists[n]||["x",[]];return res({[n]:{input:{required:{[inp]:[list]}}}})}
    if(p==="/upload/image")return res({name:"ref-"+calls.length+".jpg",subfolder:"trsr-video"});
    if(p==="/prompt")return res({prompt_id:"P1",node_errors:{}});
    if(p.startsWith("/history/"))return res(history());
    return res({});
  };
  return {calls,f};
}
const req=(o:any={})=>({model:{} as any,prompt:"<Picture 1> is THE GUARD.",size:[960,544] as [number,number],resolution:"540p",aspect:"16:9",durationS:8,audio:true,seed:7,
  referenceImages:["data:image/jpeg;base64,"+Buffer.from("x").toString("base64")],...o});

describe("comfyui (video on this computer)",()=>{
  it("is a provider without a key in the registry, with a free model",()=>{
    const r=loadRegistry(path.resolve(__dirname,"../../../registry"));
    expect(keyless(r.providers.comfyui)).toBe(true);
    expect(keyless(r.providers.runware)).toBe(false);
    const m=r.models.find(x=>x.id==="minimax-h3-local")!;
    expect(m.provider).toBe("comfyui");expect(m.pricing.perSecond["540p"]).toBe(0);expect(m.inputs.refToken).toBe("<Picture {n}>");
  });
  it("uploads the references, sends the H3 graph and reads the video back",async()=>{
    let h:any={};const {calls,f}=fake(()=>h);
    const a=comfyuiAdapter(()=>"http://comfy",f as any);
    const {taskId}=await a.submit(req(),"");
    expect(taskId).toBe("P1:7");
    const sent=JSON.parse(calls.find(c=>c.url.endsWith("/prompt"))!.body).prompt;
    expect(sent["7"].inputs).toMatchObject({mode:"reference",resolution:"540P",aspect_ratio:"16:9",seconds:8,media_type_1:"image",media_1:["201",0]});
    expect(sent["201"].inputs.image).toMatch(/^trsr-video\//);
    expect(sent["1b"].inputs.unet_name).toMatch(/ref2va/);expect(sent["11"].inputs.noise_seed).toBe(7);
    expect(await a.poll(taskId,"")).toEqual({status:"processing"});
    h={P1:{status:{status_str:"success",completed:true},outputs:{"19":{images:[{filename:"trsr-video/1_00001_.mp4",subfolder:"trsr-video",type:"output"}]}}}};
    const r=await a.poll(taskId,"");
    expect(r).toMatchObject({status:"success",costUSD:0,seed:7});
    expect((r as any).videoUrl).toContain("http://comfy/view?filename=");
  });
  it("says what is missing instead of sending a graph that cannot run",async()=>{
    const {f}=fake(()=>({}),{...LISTS,UNETLoader:["unet_name",["z_image_turbo.safetensors"]]});
    await expect(comfyuiAdapter(()=>"http://comfy",f as any).submit(req(),"")).rejects.toMatchObject({kind:"invalid",code:"comfyMissing"});
  });
  it("reports a failed run with ComfyUI's message, and a resolution it cannot make",async()=>{
    const {f}=fake(()=>({P1:{status:{status_str:"error",messages:[["execution_error",{exception_message:"Allocation on device"}]]}}}));
    const a=comfyuiAdapter(()=>"http://comfy",f as any);
    const r=await a.poll("P1:1","");
    expect(r.status).toBe("error");expect((r as any).error.message).toContain("Allocation on device");
    await expect(a.submit(req({resolution:"1080p"}),"")).rejects.toMatchObject({kind:"invalid"});
  });
  it("leaves the audio out of the video when there is none",()=>{
    const g=h3Graph({fl2va:"a",ref2va:"b",text:"c",video:"d",audio:"e",proj:"f"},{prompt:"p",refs:[],resolution:"540p",aspect:"16:9",seconds:5,seed:1,audio:false,prefix:"x"});
    expect(g["18"].inputs.audio).toBeUndefined();expect(g["7"].inputs.media_1).toBeUndefined();
  });
});
