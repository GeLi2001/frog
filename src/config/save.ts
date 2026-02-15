import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { FrogConfig } from "../core/types.js";

const PROJECT_CONFIG = ".frogo.json";
const GLOBAL_DIR = path.join(os.homedir(), ".frogo");
const GLOBAL_CONFIG = path.join(GLOBAL_DIR, "config.json");

function sanitizeConfig(config: FrogConfig): FrogConfig {
  const sanitized = JSON.parse(JSON.stringify(config)) as FrogConfig;
  if (sanitized.datadog) {
    delete sanitized.datadog.apiKey;
    delete sanitized.datadog.appKey;
  }
  if (sanitized.langsmith) {
    delete sanitized.langsmith.apiKey;
  }
  return sanitized;
}

export async function saveConfig(
  config: FrogConfig,
  options?: { local?: boolean; global?: boolean }
): Promise<void> {
  const local = options?.local ?? false;
  const global = options?.global ?? true;
  const serialized = JSON.stringify(sanitizeConfig(config), null, 2);

  if (local) {
    const localPath = path.join(process.cwd(), PROJECT_CONFIG);
    await fs.writeFile(localPath, serialized, { encoding: "utf-8", mode: 0o600 });
    await fs.chmod(localPath, 0o600).catch(() => {
      /* ignore chmod failures */
    });
  }

  if (global) {
    await fs.mkdir(GLOBAL_DIR, { recursive: true, mode: 0o700 });
    await fs.writeFile(GLOBAL_CONFIG, serialized, { encoding: "utf-8", mode: 0o600 });
    await fs.chmod(GLOBAL_CONFIG, 0o600).catch(() => {
      /* ignore chmod failures */
    });
  }
}
