import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { FrogConfig } from "../core/types.js";

const PROJECT_CONFIG = ".frogo.json";
const GLOBAL_DIR = path.join(os.homedir(), ".frogo");
const GLOBAL_CONFIG = path.join(GLOBAL_DIR, "config.json");

export async function saveConfig(
  config: FrogConfig,
  options?: { local?: boolean; global?: boolean }
): Promise<void> {
  const local = options?.local ?? true;
  const global = options?.global ?? true;
  const serialized = JSON.stringify(config, null, 2);

  if (local) {
    const localPath = path.join(process.cwd(), PROJECT_CONFIG);
    await fs.writeFile(localPath, serialized, "utf-8");
  }

  if (global) {
    await fs.mkdir(GLOBAL_DIR, { recursive: true });
    await fs.writeFile(GLOBAL_CONFIG, serialized, "utf-8");
  }
}
