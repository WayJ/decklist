import { readFileSync, writeFileSync } from "node:fs";

const ENTRY_KEYS = new Set(["source", "skill", "pin"]);
const TOP_KEYS = new Set(["skills", "$schema"]);

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

function checkEntry(skills, name, value, file) {
  if (typeof name !== "string" || name.length === 0) fail(file, null, "name must be a non-empty string");
  if (typeof value === "string") {
    if (value.length === 0) fail(file, name, "source must be a non-empty string");
    return;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(file, name, "entry must be a source string or an object");
  }
  if (typeof value.source !== "string" || value.source.length === 0) {
    fail(file, name, "source must be a non-empty string");
  }
  for (const k of Object.keys(value)) {
    if (!ENTRY_KEYS.has(k)) fail(file, name, `unknown entry key: ${k}`);
    if ((k === "skill" || k === "pin") && typeof value[k] !== "string") {
      fail(file, name, `${k} must be a string`);
    }
  }
}

export function parseManifest(text, file = "decklist.json") {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new ManifestError(file, null, `invalid JSON: ${e.message}`);
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    fail(file, null, "top level must be an object");
  }
  for (const k of Object.keys(doc)) {
    if (!TOP_KEYS.has(k)) fail(file, null, `unknown top-level key: ${k}`);
  }
  if (typeof doc.skills !== "object" || doc.skills === null || Array.isArray(doc.skills)) {
    fail(file, null, "skills must be an object mapping names to entries");
  }
  const skills = {};
  for (const [name, value] of Object.entries(doc.skills)) {
    checkEntry(skills, name, value, file);
    skills[name] = typeof value === "string" ? { source: value } : { ...value };
  }
  return { skills };
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
