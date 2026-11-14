import type {ModelEntry,Size} from "@trsr-video/core";

export interface SubmitRequest{model:ModelEntry;prompt:string;size:Size;resolution:string;aspect:string;durationS:number;audio:boolean;seed?:number;
  /** Reference images as data URIs, in the order the prompt names them (IMAGE 1, IMAGE 2...). Only sent to models whose registry entry accepts them. */
  referenceImages?:string[]}
export type PollResult=
  |{status:"processing";progress?:number}
  |{status:"success";videoUrl:string;costUSD?:number;seed?:number}
  |{status:"error";error:ProviderError};

/**
 * Why a provider call failed, in terms the queue can act on.
 * auth: stop and tell the user, never retry. balance: stop, needs credit.
 * concurrency: another request holds the credit, wait for it and try again.
 * invalid: the request itself is wrong (allowedValues lists what the API accepts).
 * busy: rate limit or provider overload, retry later. provider/network: the run failed.
 */
export type ErrorKind="auth"|"balance"|"concurrency"|"invalid"|"busy"|"provider"|"network";
export class ProviderError extends Error{
  constructor(public kind:ErrorKind,message:string,public code?:string,public extra:{allowedValues?:unknown;retryAfterS?:number;parameter?:string}={}){super(message)}
  get retryable(){return this.kind==="concurrency"||this.kind==="busy"}
}

/** Every provider is one of these. A new provider = one file implementing it + one entry in registry/providers.json. */
export interface ProviderAdapter{
  id:string;
  /** Sends the generation and returns the provider's task id. */
  submit(req:SubmitRequest,apiKey:string):Promise<{taskId:string}>;
  poll(taskId:string,apiKey:string):Promise<PollResult>;
  /** How long a run may take before the queue gives up; the queue's own default (30 minutes) otherwise. */
  timeoutMs?:number;
  /** Present only when the provider can cancel a running task. */
  cancel?(taskId:string,apiKey:string):Promise<void>;
}
export type FetchLike=(url:string,init?:{method?:string;headers?:Record<string,string>;body?:string})=>Promise<{status:number;ok:boolean;headers:{get(n:string):string|null};text():Promise<string>}>;
