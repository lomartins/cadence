import * as esbuild from "esbuild";

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

// presets.json is inlined into each bundle via the JSON import, so no copy needed.
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

console.log("cadence build complete -> dist/");
