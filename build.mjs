import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

try {
  await build({
    entryPoints: [join(root, "src/content/index.ts")],
    bundle: true,
    format: "iife",
    target: "chrome110",
    outfile: join(dist, "content.js"),
    logLevel: "info",
  });
} catch {
  process.exit(1);
}

cpSync(join(root, "manifest.json"), join(dist, "manifest.json"));
cpSync(join(root, "icons"), join(dist, "icons"), { recursive: true });

console.log("dist/ を生成しました");
