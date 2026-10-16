import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/siren-of-the-shallows.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import ganking from "../../../../engine-core/dist/effects/keywords/Ganking.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL = "card.hash-62965a5787d4b9aff0b49316615355a97d59939503fd28b217e578ee755f0d63";
const SOURCE_TEXT =
  "[Disarm] (When I attack, give an enemy unit here -1 :rb_might: this turn.)\n" +
  "[Ganking] (I can move from battlefield to battlefield.)";

test("Siren of the Shallows program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Siren of the Shallows identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The judgeReason must name the missing keyword expansions and their tasks.
  assert.match(program.judgeReason, /Disarm/);
  assert.match(program.judgeReason, /RIFT-83/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /continuous\.movement/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Siren of the Shallows structure: [Disarm] and [Ganking] declared, no invented instructions", () => {
  assert.deepEqual(program.abilities, [
    { kind: "keyword", keyword: "disarm" },
    { kind: "keyword", keyword: "ganking" }
  ]);
  // 831.1.c.3: the printed [Disarm] omits X, so the value is presumed 1 by the
  // keyword expansion (README 5: omit value when the keyword carries none here).
  assert.equal(program.abilities[0].value, undefined);
  assert.equal(program.abilities[1].value, undefined);
  // reminder brackets are rule explanations, never separate instructions.
  assert.equal(program.judgeReason.includes("Ganking"), true);
});

test("Siren of the Shallows dependency check: Ganking is registered, Disarm is not", () => {
  // Ganking has a merged KeywordDef, but its continuous.movement expansion has no
  // end-to-end consumer, which is exactly why the card cannot be executable yet.
  assert.equal(keywordDefinitionsById.get("Ganking"), ganking);
  assert.equal(keywordDefinitionsById.get("Disarm"), undefined);
  const expansion = ganking.expand({ host: { canonicalCardId: CANONICAL } });
  assert.deepEqual(expansion.map((ability) => ability.effect.kind), ["continuous.movement"]);
});

test.todo(
  "Siren of the Shallows: [Disarm] expansion — attack trigger, temporary -1 Might on an enemy unit 'here' " +
    "(CR 831.1.d, 831.1.c.3 default X = 1) — needs kw-disarm plus continuous.might / continuous.duration (RIFT-83/84, RIFT-91)"
);

test.todo(
  "Siren of the Shallows: [Ganking] end-to-end wiring — card program → keyword registry → layer/movement " +
    "permission consumption (contract 3.5) — RIFT-83 expansion exists, consumer pending RIFT-120 follow-up"
);
