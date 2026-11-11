// A fetch for calls that answer only when the work is done (Google's Interactions API holds the request
// open while the video renders). Node's built-in fetch gives up waiting for headers after 5 minutes.
import https from "node:https";
import http from "node:http";
import type {FetchLike} from "./types";

export const longFetch:FetchLike=(url,init)=>new Promise((resolve,reject)=>{
  const u=new URL(url),lib=u.protocol==="http:"?http:https;
  const rq=lib.request(u,{method:init?.method||"GET",headers:init?.headers},res=>{
    const chunks:Buffer[]=[];
    res.on("data",c=>chunks.push(c));
    res.on("error",reject);
    res.on("end",()=>{
      const text=Buffer.concat(chunks).toString("utf8"),status=res.statusCode||0;
      resolve({status,ok:status>=200&&status<300,headers:{get:n=>{const v=res.headers[n.toLowerCase()];return Array.isArray(v)?v[0]:v??null}},text:async()=>text});
    });
  });
  rq.on("error",reject);
  rq.setTimeout(20*60*1000,()=>rq.destroy(new Error("no answer after 20 minutes")));
  if(init?.body)rq.write(init.body);
  rq.end();
});
