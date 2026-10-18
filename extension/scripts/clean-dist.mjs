import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)));
rmSync(resolve(scriptDirectory, "../dist"), { recursive: true, force: true });
