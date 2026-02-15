import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { FrogConfig } from "../core/types.js";

const PROJECT_CONFIG = ".frogo.json";
const LEGACY_PROJECT_CONFIG = ".frog.json";
const GLOBAL_DIR = path.join(os.homedir(), ".frogo");
const LEGACY_GLOBAL_DIR = path.join(os.homedir(), ".frog");
const GLOBAL_CONFIG = path.join(GLOBAL_DIR, "config.json");
const LEGACY_GLOBAL_CONFIG = path.join(LEGACY_GLOBAL_DIR, "config.json");

async function readJson(filePath: string): Promise<FrogConfig | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed: FrogConfig = JSON.parse(raw);
    return parsed;
  } catch (error) {
    return null;
  }
}

export async function loadConfig(): Promise<FrogConfig> {
  const localPaths = [path.join(process.cwd(), PROJECT_CONFIG), path.join(process.cwd(), LEGACY_PROJECT_CONFIG)];

  for (const localPath of localPaths) {
    const local = await readJson(localPath);
    if (local) {
      return local;
    }
  }

  const globalPaths = [GLOBAL_CONFIG, LEGACY_GLOBAL_CONFIG];
  for (const globalPath of globalPaths) {
    const global = await readJson(globalPath);
    if (global) {
      return global;
    }
  }

  return {};
}
