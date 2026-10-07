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
    entryPoints: [
      { in: join(root, "src/content/index.ts"), out: "content" },
      { in: join(root, "src/options/options.ts"), out: "options/options" },
      { in: join(root, "src/background.ts"), out: "background" },
    ],
    bundle: true,
    format: "iife",
    target: "chrome110",
    outdir: dist,
    logLevel: "info",
  });
} catch {
  process.exit(1);
}

cpSync(join(root, "manifest.json"), join(dist, "manifest.json"));
cpSync(join(root, "icons"), join(dist, "icons"), { recursive: true });
cpSync(join(root, "_locales"), join(dist, "_locales"), { recursive: true });
cpSync(
  join(root, "src/options/options.html"),
  join(dist, "options/options.html"),
);
cpSync(
  join(root, "src/options/options.css"),
  join(dist, "options/options.css"),
);

console.log("dist/ を生成しました");
