import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_CONFIG_FILE = path.join(PROJECT_DIR, "cc-hub-usage.conf");
