import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/bilgewater-bully.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so the keyword/layer evidence below loads the built engine through
// its workspace layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { keywordRegistryById } = await import(new URL("effects/keywords/registry.generated.js", engineCore));
const { instructionDefinitionsById } = await import(new URL("effects/instructions/registry.generated.js", engineCore));

const CANONICAL = "card.hash-bfada85ea0485d763baf4f6d82594347175927b1b09ec1e1d976fce15710013e";
const [grantAbility] = program.abilities;

test("Bilgewater Bully program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("identity: canonicalCardId, ruleset, status, judgeReason, verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /continuous\.movement/);
  assert.equal(
    program.sourceText,
    "While I'm buffed, I have [Ganking]. (I can move from battlefield to battlefield.)"
  );
});

test("structure: static conditional Ganking grant on the buffed host", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(grantAbility.kind, "static");
  assert.equal(grantAbility.effect.kind, "continuous.grant-keyword");
  assert.equal(grantAbility.effect.keyword, "Ganking");
  assert.deepEqual(grantAbility.effect.filter, { object: "self" });
  // "While I'm buffed" — a conditional passive ability (CR 364.3), read as the
  // host's real buffs counter (CR 702 / 702.2.a).
  assert.deepEqual(grantAbility.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "buffs" },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
  assert.equal(grantAbility.body, undefined);
});

test("dependency evidence: no merged instruction implements a keyword grant", () => {
  // The grant must be a static layer effect (contract 3.7); no primitive
  // opcode consumes "continuous.grant-keyword".
  assert.equal(instructionDefinitionsById.has("continuous.grant-keyword"), false);
  assert.equal(instructionDefinitionsById.has("effect.grant-keyword"), false);
});

test("dependency evidence: Ganking expands only to an unconsumed continuous.movement effect", () => {
  const ganking = keywordRegistryById.get("Ganking");
  assert.ok(ganking, "effects/keywords/Ganking.ts must be registered");
  assert.equal(ganking.keyword, "Ganking");
  assert.equal(ganking.stacking, "single");
  assert.ok(ganking.ruleRefs.includes("810.1.c"), "810.1.c is the Standard Move permission rule Ganking expands");
  const expansion = ganking.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expansion.length, 1);
  assert.equal(expansion[0].kind, "static");
  assert.equal(expansion[0].effect.kind, "continuous.movement");
  // Nothing in the merged instruction set performs this movement permission.
  assert.equal(instructionDefinitionsById.has("continuous.movement"), false);
});

test.todo(
  "Bilgewater Bully: execute 'While I'm buffed, I have [Ganking]' once the ability layer consumes " +
    "continuous.grant-keyword (RIFT-91) and the movement system reads continuous.movement " +
    "(RIFT-83 Ganking expansion / movement workstream)"
);
