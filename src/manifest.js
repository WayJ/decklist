import { readFileSync, writeFileSync } from "node:fs";

export const PERSONA_MAX = 2000;

const ENTRY_KEYS = new Set(["source", "skill", "pin"]);
const TOP_KEYS = new Set(["$schema", "name", "version", "description", "private", "license", "author", "agents"]);
const AGENT_KEYS = new Set(["harness", "persona", "skills"]);
const BASIC_STRINGS = ["description", "license", "author"];
const BASICS = ["name", "version", ...BASIC_STRINGS, "private"];
const AGENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const NAME_PATTERN = /^[a-z0-9-~][a-z0-9-._~]*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export class ManifestError extends Error {
  constructor(file, key, reason) {
    super(`${file}: ${key ? key + ": " : ""}${reason}`);
    this.name = "ManifestError";
    this.file = file;
    this.key = key;
    this.reason = reason;
  }
}

function fail(file, key, reason) {
  throw new ManifestError(file, key, reason);
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function checkEntry(value, key, file) {
  if (typeof value === "string") {
    if (value.length === 0) fail(file, key, "source must be a non-empty string");
    return;
  }
  if (!isPlainObject(value)) fail(file, key, "entry must be a source string or an object");
  if (typeof value.source !== "string" || value.source.length === 0) {
    fail(file, key, "source must be a non-empty string");
  }
  for (const k of Object.keys(value)) {
    if (!ENTRY_KEYS.has(k)) fail(file, key, `unknown entry key: ${k}`);
    if ((k === "skill" || k === "pin") && typeof value[k] !== "string") {
      fail(file, key, `${k} must be a string`);
    }
  }
}

function checkBasics(doc, file) {
  if ("name" in doc && (typeof doc.name !== "string" || !NAME_PATTERN.test(doc.name))) {
    fail(file, "name", "must match ^[a-z0-9-~][a-z0-9-._~]*$");
  }
  if ("version" in doc && (typeof doc.version !== "string" || !VERSION_PATTERN.test(doc.version))) {
    fail(file, "version", "must be x.y.z");
  }
  for (const k of BASIC_STRINGS) {
    if (k in doc && (typeof doc[k] !== "string" || doc[k].length === 0)) {
      fail(file, k, "must be a non-empty string");
    }
  }
  if ("private" in doc && typeof doc.private !== "boolean") {
    fail(file, "private", "must be a boolean");
  }
}

export function parseManifest(text, file = "decklist.json") {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new ManifestError(file, null, `invalid JSON: ${e.message}`);
  }
  if (!isPlainObject(doc)) fail(file, null, "top level must be an object");
  if ("skills" in doc) fail(file, "skills", "skills must be declared under an agent (agents.<name>.skills)");
  for (const k of Object.keys(doc)) {
    if (!TOP_KEYS.has(k)) fail(file, null, `unknown top-level key: ${k}`);
  }
  checkBasics(doc, file);

  if (!("agents" in doc)) fail(file, "agents", "required (may be empty)");
  if (!isPlainObject(doc.agents)) fail(file, "agents", "must be an object mapping agent names to definitions");

  const agents = {};
  for (const [name, def] of Object.entries(doc.agents)) {
    if (!AGENT_NAME.test(name)) fail(file, "agents", `invalid agent name: ${name}`);
    const at = `agents.${name}`;
    if (!isPlainObject(def)) fail(file, at, "must be an object");
    for (const k of Object.keys(def)) {
      if (!AGENT_KEYS.has(k)) fail(file, at, `unknown agent key: ${k}`);
    }
    if (typeof def.harness !== "string" || def.harness.length === 0) {
      fail(file, `${at}.harness`, "required non-empty string");
    }
    if ("persona" in def && typeof def.persona !== "string") {
      fail(file, `${at}.persona`, "must be a string");
    }
    if (def.persona !== undefined && def.persona.length > PERSONA_MAX) {
      fail(file, `${at}.persona`, `exceeds ${PERSONA_MAX} characters`);
    }
    if (!("skills" in def)) fail(file, `${at}.skills`, "required (may be empty)");
    if (!isPlainObject(def.skills)) fail(file, `${at}.skills`, "must be an object");

    const skills = {};
    for (const [key, value] of Object.entries(def.skills)) {
      if (key.length === 0) fail(file, null, "name must be a non-empty string");
      checkEntry(value, `${at}.skills.${key}`, file);
      skills[key] = typeof value === "string" ? { source: value } : { ...value };
    }
    agents[name] = { harness: def.harness, ...(def.persona !== undefined && { persona: def.persona }), skills };
  }

  const out = { agents };
  for (const k of BASICS) if (k in doc) out[k] = doc[k];
  return out;
}

export function readManifest(dir) {
  const file = dir + "/decklist.json";
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  return parseManifest(text, file);
}

export function writeManifest(dir, skills) {
  writeFileSync(dir + "/decklist.json", JSON.stringify({ skills }, null, 2) + "\n");
}
