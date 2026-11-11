import {defineConfig} from "vite";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

// The version shown next to the logo comes from the root package.json.
const version=JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json",import.meta.url)),"utf8")).version;

// In development the page runs on :5173 and the local server on :4477.
export default defineConfig({
  define:{__APP_VERSION__:JSON.stringify(version)},
  server:{proxy:{"/api":"http://127.0.0.1:4477","/videos":"http://127.0.0.1:4477"}}
});
