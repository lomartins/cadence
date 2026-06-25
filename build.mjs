import * as esbuild from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";

const common = {
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node18",
  // keytar is an optional native module — never bundle it; load it lazily at runtime.
  external: ["keytar"],
  logLevel: "info",
  // shim so bundled ESM can use require() for any transitive CJS deps
  banner: {
    js: "import { createRequire as __cadenceRequire } from 'node:module'; const require = __cadenceRequire(import.meta.url);",
  },
};

await mkdir("dist/data", { recursive: true });

await esbuild.build({
  ...common,
  entryPoints: ["src/server/index.ts"],
  outfile: "dist/server/index.mjs",
});

await esbuild.build({
  ...common,
  entryPoints: ["src/hooks/dispatch.ts"],
  outfile: "dist/hooks/dispatch.mjs",
});

// presets.json is inlined into the bundle, but also ship a copy for tooling.
await copyFile("src/data/presets.json", "dist/data/presets.json");

console.log("cadence build complete -> dist/");
