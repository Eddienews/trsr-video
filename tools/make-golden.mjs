// Regenerates packages/core/test/golden from the ORIGINAL v2.2 page (legacy/index-v2.2.html).
// The goldens are the contract: packages/core must produce exactly this text.
// Run only when the legacy page itself is replaced by a newer reference version.
import {createRequire} from "node:module";
import {readdirSync,readFileSync,writeFileSync} from "node:fs";
import {fileURLToPath,pathToFileURL} from "node:url";
import path from "node:path";
const {chromium}=createRequire(import.meta.url)("playwright");
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const fx=path.join(root,"packages/core/test/fixtures"),gold=path.join(root,"packages/core/test/golden");
const page=await (await chromium.launch()).newPage();
await page.route("**/fonts.g*",r=>r.abort());
const url=pathToFileURL(path.join(root,"legacy/index-v2.2.html")).href;
await page.goto(url);
const grab=()=>page.evaluate(()=>{const m=S.mode;S.mode="full";const full=plain();S.mode="shots";const shots=plain();S.mode=m;
  return {mode:m,current:plain(),full,shots,meta:metaPrompt(),checks:checks(),total:total(),spans:spans(),lightOk:lightOk()}});
const out={};
for(const f of readdirSync(fx).filter(x=>x.endsWith(".json")).sort()){
  await page.evaluate(s=>localStorage.setItem("nwl-animation-prompt-v1",s),readFileSync(path.join(fx,f),"utf8"));
  await page.reload();
  out[f.replace(".json","")]=await grab();
}
// the built-in example, reached the way a user reaches it
await page.evaluate(()=>localStorage.clear());await page.reload();await page.click("#example");
out["builtin-example"]=await grab();
for(const [k,v] of Object.entries(out))writeFileSync(path.join(gold,k+".json"),JSON.stringify(v,null,1)+"\n");
console.log("goldens:",Object.keys(out).join(", "));
await page.context().browser().close();
