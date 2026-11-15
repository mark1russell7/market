import { defineConfig } from "tsdown";

// The build for npm: ES modules in build/, with their declarations. The workspace runs the source (main is src/index.ts).
export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "build",
  format: "esm",
  platform: "node",
  fixedExtension: false,
  sourcemap: true,
  dts: true,
  publint: true,
});
