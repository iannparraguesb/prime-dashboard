/** Levanta el backend y Vite juntos, y baja los dos con un solo Ctrl-C. */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

const hijos = [
  spawn(process.execPath, ["server.mjs"], { cwd: RAIZ, stdio: "inherit" }),
  spawn(npx, ["vite"], { cwd: RAIZ, stdio: "inherit" }),
];

const bajar = () => {
  for (const h of hijos) h.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", bajar);
process.on("SIGTERM", bajar);
for (const h of hijos) h.on("exit", bajar);
