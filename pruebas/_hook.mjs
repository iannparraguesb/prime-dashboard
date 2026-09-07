import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transformSync } from "esbuild";

export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const base = new URL(specifier, context.parentURL);
    if (!existsSync(fileURLToPath(base))) {
      for (const ext of [".tsx", ".ts"]) {
        const cand = fileURLToPath(base) + ext;
        if (existsSync(cand)) return { url: pathToFileURL(cand).href, format: "module", shortCircuit: true };
      }
    }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.endsWith(".tsx") || url.endsWith(".ts")) {
    const src = await readFile(fileURLToPath(url), "utf8");
    const { code } = transformSync(src, {
      loader: url.endsWith(".tsx") ? "tsx" : "ts",
      format: "esm",
      jsx: "automatic",
      target: "node20",
    });
    return { format: "module", source: code, shortCircuit: true };
  }
  return next(url, context);
}
