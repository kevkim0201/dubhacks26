import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const extensionDirectory = resolve(scriptDirectory, "..");
const distDirectory = resolve(extensionDirectory, "dist");
const viteEntry = resolve(extensionDirectory, "node_modules/vite/bin/vite.js");

rmSync(distDirectory, { recursive: true, force: true });

const commands = [
  ["build", "--watch", "--mode", "development"],
  ["build", "-c", "vite.content.config.js", "--watch", "--mode", "development"],
];
const children = commands.map((args) =>
  spawn(process.execPath, [viteEntry, ...args], {
    cwd: extensionDirectory,
    stdio: "inherit",
  })
);

let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) {
    if (child.exitCode === null) child.kill();
  }
}

for (const child of children) {
  child.on("error", (error) => {
    console.error(error);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) stop(code ?? 1);
  });
}

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
