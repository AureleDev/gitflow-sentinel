#!/usr/bin/env node
// managed-by: gitflow-sentinel (skill tooling)
// evals/evals.json holds behavioral eval cases for the SKILL.md description
// itself (does this prompt actually trigger the skill, does the agent's
// resulting behavior match the assertions) — they are not unit tests of this
// codebase and are meant to be run by a skill-eval harness (e.g. the
// bmad-eval-runner / skill-installer style tooling) against a live agent, not
// by this script. What this script CAN check without an agent is that the
// file itself stays well-formed as it is edited, so a typo is caught before it
// silently breaks whatever harness consumes it — that half was previously
// unverified by anything in this repository.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const FILE = path.join(ROOT, "evals", "evals.json");

const REQUIRED_EVAL_FIELDS = ["id", "name", "prompt", "expected_output", "assertions"];

function fail(msg) {
  console.error(`INVALID: ${msg}`);
  process.exitCode = 1;
}

let raw;
try {
  raw = readFileSync(FILE, "utf8");
} catch (error) {
  fail(`could not read ${FILE}: ${error.message}`);
  process.exit(1);
}

let doc;
try {
  doc = JSON.parse(raw);
} catch (error) {
  fail(`${FILE} is not valid JSON: ${error.message}`);
  process.exit(1);
}

if (typeof doc.skill_name !== "string" || !doc.skill_name) fail("skill_name must be a non-empty string");
if (!Array.isArray(doc.evals) || doc.evals.length === 0) fail("evals must be a non-empty array");

const seenIds = new Set();
for (const [i, e] of (doc.evals || []).entries()) {
  const where = `evals[${i}]`;
  for (const field of REQUIRED_EVAL_FIELDS) {
    if (!(field in e)) fail(`${where} is missing required field '${field}'`);
  }
  if (typeof e.id !== "number") fail(`${where}.id must be a number`);
  else if (seenIds.has(e.id)) fail(`${where}.id ${e.id} is duplicated`);
  else seenIds.add(e.id);
  if (typeof e.name !== "string" || !e.name) fail(`${where}.name must be a non-empty string`);
  if (typeof e.prompt !== "string" || e.prompt.length < 10) fail(`${where}.prompt looks too short to be a real eval prompt`);
  if (!Array.isArray(e.assertions) || e.assertions.length === 0) fail(`${where}.assertions must be a non-empty array`);
}

if (process.exitCode === 1) {
  console.error(`\n${FILE} failed validation.`);
} else {
  console.log(`OK: ${doc.evals.length} eval case(s) in ${path.relative(ROOT, FILE)} are well-formed.`);
  console.log("Note: this only checks structure. Running the cases against a live agent requires a skill-eval harness (e.g. bmad-eval-runner) — this script does not do that.");
}
