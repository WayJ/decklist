// tests/docs.test.js — v2 schema and README
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = JSON.parse(readFileSync(new URL("../schema/decklist.schema.json", import.meta.url)));

test("schema models the v2 agent document", () => {
  assert.equal(schema.type, "object");
  assert.deepEqual(schema.required, ["agents"]);
  assert.equal(schema.additionalProperties, false);
  for (const k of ["name", "version", "description", "private", "license", "author", "agents"]) {
    assert.ok(schema.properties[k], `missing property: ${k}`);
  }
  const agent = schema.properties.agents.additionalProperties;
  assert.equal(agent.additionalProperties, false);
  assert.deepEqual(agent.required, ["harness", "skills"]);
  assert.equal(agent.properties.harness.minLength, 1);
  assert.equal(agent.properties.persona.maxLength, 2000);
  assert.equal(
    schema.properties.agents.propertyNames.pattern,
    "^[A-Za-z0-9][A-Za-z0-9._-]*$",
    "agent names must be schema-constrained (spec DoD 3, review F2)",
  );
  const entry = agent.properties.skills.additionalProperties.oneOf;
  assert.equal(entry[0].minLength, 1);
  assert.equal(entry[1].additionalProperties, false);
  assert.deepEqual(entry[1].required, ["source"]);
});

test("README quickstart works as written; package metadata matches v2", () => {
  const t = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  for (const s of ["decklist install", "decklist add", "--agent", "decklist list",
                   "harness", "persona", "agents", "decklist.lock", "decklist.json",
                   ".gitignore", "node --test"])
    assert.ok(t.includes(s), `README missing: ${s}`);
  assert.ok(!t.includes("node --test tests/"), "README test command is the dir form that fails on modern Node");
  assert.ok(t.includes("cat > decklist.json"), "quickstart must create the manifest before add (review F4)");
  assert.ok(t.includes('"harness": "claude-code", "skills": {}'), "quickstart minimal manifest missing");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
  assert.match(pkg.description, /multi-agent/, "package description still v0 positioning (review F5)");
});
