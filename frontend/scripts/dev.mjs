import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const project = path.join(root, "..");
const config = path.join(project, ".env.development.local");
if (existsSync(config)) process.loadEnvFile(config);
const localPython = path.join(
  project,
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const python =
  process.env.FGL_PYTHON || (existsSync(localPython) ? localPython : "python");
const backend = spawn(
  python,
  ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
  { cwd: path.join(root, "../backend"), stdio: "inherit", env: process.env },
);
const vite = spawn(
  process.execPath,
  [
    path.join(root, "node_modules/vite/bin/vite.js"),
    "--host",
    "0.0.0.0",
    ...process.argv.slice(2),
  ],
  { cwd: root, stdio: "inherit", env: process.env },
);
let stopped = false;
function stop(code = 0) {
  if (stopped) return;
  stopped = true;
  backend.kill("SIGTERM");
  vite.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300).unref();
}
for (const child of [backend, vite]) {
  child.on("error", (e) => {
    console.error(e.message);
    stop(1);
  });
  child.on("exit", (code) => stop(code || 0));
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
