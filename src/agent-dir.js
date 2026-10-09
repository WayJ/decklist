import { join } from "node:path";

export const AGENTS_DIR = "agents";

export const agentDir = (cwd, name) => join(cwd, AGENTS_DIR, name);
