import {AVATARS,COATS} from "../public/campus/world.js";
import {SCENES} from "../public/campus/scenes.js";
import { icons } from "./pixel-icons.js";
import { build } from "esbuild";
import { STUDY_STYLES,styleLayout } from "../public/campus/wardrobe.js";
import { mkdir, copyFile,readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL(".", import.meta.url)),
  out = path.join(root, "dist");
await mkdir(out, { recursive: true });
const outfitRows={};
for(const style of STUDY_STYLES){
  const source=path.join(root,"../design/character-v3",style.id);
  const layout=styleLayout(JSON.parse(await readFile(path.join(source,"runtime-manifest.json"),"utf8")));
  if(!layout)throw Error("Invalid outfit "+style.id);
  outfitRows[style.id]=layout.rows;
  await copyFile(path.join(source,"sprite-sheet-alpha.png"),path.join(out,style.id+".png"));
}
await build({
  entryPoints: [path.join(root, "main.js")],
  outfile: path.join(out, "main.js"),
  bundle: true,
  minify: true,
  format: "esm",
  define:{WEB_OUTFIT_ROWS:JSON.stringify(outfitRows)},
  target: "es2020",
});
const files = {
  "app.webmanifest":"app.webmanifest",
  "app-icon-180.png":"app-icon-180.png",
  "app-icon-192.png":"app-icon-192.png",
  "app-icon-512.png":"app-icon-512.png",
  "sw.js":"sw.js",
  "../design/stage1/assets/campus-warp.png":"campus-warp.png",
  "../design/stage1/assets/campus-wayfinding.png": "wayfinding.png",
  "../design/stage1/assets/campus-bench.png":"campus-bench.png",
  "index.html": "index.html",
  "../design/stage1/assets/icons/library-desk.png": "desk.png",
  "style.css": "style.css",
  "../design/stage1/assets/interface.css":"interface.css",
  "../design/stage1/assets/Galmuri11-Bold.woff2":"pixel-bold.woff2",
  "../design/stage1/assets/Galmuri11.woff2": "pixel.woff2",
  "../design/stage1/assets/LICENSE.txt": "font-license.txt",
};
for(const folder of ["icons","lounge","skins","panels","previews"]) await mkdir(path.join(out,folder),{recursive:true});
// Keep each destination card and backdrop on the same campus art revision as LAN.
for(const scene of Object.values(SCENES)){
  files["../design/stage1/assets/previews/"+scene.id+".png"]="previews/"+scene.id+".png";
  const filename=scene.image.split("/").at(-1);
  files["../design/stage1/assets/"+filename]=(scene.id==="lounge"?"library":scene.id)+".png";
}
for(const name of ["notebook","archive","jacket","tutor","fitting-room"])
  files["../design/stage1/assets/panels/"+name+".png"]="panels/"+name+".png";
for(const name of ["header-bar","dock-bar","sign-plate","close","frame-parchment","frame-mulberry","frame-sage","frame-stone","tick-off","tick-on","button-paper","button-wine","button-muted","control-paper","control-wine","control-inset","control-muted","name-own","name-friend","speech-paper","stick-base","stick-cap"])
  files["../design/stage1/assets/skins/"+name+".png"]="skins/"+name+".png";
for(const style of STUDY_STYLES)
  files["../design/stage1/assets/icons/outfit-"+style.id+".png"]="icons/outfit-"+style.id+".png";
for(const name of new Set(Object.values(icons)))
  await copyFile(path.join(root,"../design/stage1/assets/icons",name+".png"),path.join(out,"icons",name+".png"));
for(const name of ["desk","long-table","round-table","sofa","chair-back","chair-front"])
  files["../design/stage1/assets/lounge/"+name+".png"]="lounge/"+name+".png";
for (const avatar of AVATARS)
  for (const coat of COATS)
    files["../public/campus/sprites/" + avatar + "/" + coat + ".png"] =
      avatar + "-" + coat + ".png";
for (const [src, dest] of Object.entries(files))
  await copyFile(path.resolve(root, src), path.join(out, dest));
await mkdir(path.join(out, "api"), { recursive: true });
await build({
  entryPoints: [path.join(root, "api/rendezvous.mjs")],
  outfile: path.join(out, "api/rendezvous.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  footer: { js: "module.exports = module.exports.default;" },
});
await copyFile(path.join(root, "vercel.json"), path.join(out, "vercel.json"));
