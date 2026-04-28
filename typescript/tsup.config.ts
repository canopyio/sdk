import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    langchain: "src/adapters/subpath-langchain.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node18",
  external: ["@langchain/core"],
});
