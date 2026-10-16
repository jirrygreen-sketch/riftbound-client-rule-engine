import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/momentary-companion.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CARD_ID = "card.hash-acd7471a82a9a0d5caee4793bb24dd67313afca36a5e9b63e8e43bb188c5e0d4";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "When you play me, if it's not your turn, give me [Temporary]. (Kill me at the start of my controller's Beginning Phase, before scoring.)";

test("rad-095-167 Momentary Companion: validates, identity and source text", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Temporary/);
  assert.match(program.judgeReason, /816\.1\.b/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("rad-095-167 Momentary Companion: [Hidden] keyword plus the card-played trigger", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "hidden" });

  const triggered = program.abilities[1];
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, { self: true });
  assert.equal(triggered.optional, false);
  assert.deepEqual(triggered.body.map(instruction => instruction.id), [
    "momentary-companion.grant-temporary"
  ]);
});

test("rad-095-167 Momentary Companion: \"if it's not your turn\" is a trigger condition, not a body instruction", () => {
  const triggered = program.abilities[1];
  assert.deepEqual(triggered.trigger.condition, {
    kind: "not",
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "current-turn-player-is-controller" }
    }
  });
  // The condition gates the whole trigger (the ability does not go on the chain
  // when it is your turn), so it must not be an instruction-level condition.
  assert.equal(triggered.body[0].condition, undefined);
});

test("rad-095-167 Momentary Companion: give me [Temporary] with a permanent grant", () => {
  const [grant] = program.abilities[1].body;
  assert.equal(grant.op, "continuous.grant-keyword");
  assert.deepEqual(grant.args.keyword, { kind: "constant", value: "Temporary" });
  assert.deepEqual(grant.args.duration, { kind: "constant", value: "permanent" });
  assert.deepEqual(grant.targets, [
    {
      id: "momentary-companion.self",
      filter: { type: "unit", object: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("rad-095-167 Momentary Companion: the two dependencies are not executable today", () => {
  // Evidence for the judgeReason: there is no continuous.grant-keyword
  // instruction, and no Temporary keyword definition exists, so the body cannot
  // execute at all today.
  assert.equal(instructionDefinitionsById.has("continuous.grant-keyword"), false);
  assert.equal(keywordDefinitionsById.has("Temporary"), false);
  // [Hidden] does have a KeywordDef, but its expansion is a bare data-only
  // cost.hidden static effect: nothing consumes it (no cost.hidden cost, no hide
  // action, no facedown provenance), so it cannot make this card executable.
  const hidden = keywordDefinitionsById.get("Hidden");
  assert.ok(hidden);
  assert.equal(hidden.valued, false);
  assert.deepEqual(hidden.expand({ host: { canonicalCardId: CARD_ID } }), [
    { kind: "static", effect: { kind: "cost.hidden" } }
  ]);
});

test.todo(
  "momentary-companion: [Temporary] keyword definition (CR v1.5 816.1.b 'at the start of this permanent's" +
    " controller's Beginning Phase, before scoring, kill this') plus the continuous.grant-keyword consumer" +
    " (RIFT-91); the granted keyword must be a permanent characteristic (816.3)"
);
test.todo(
  "momentary-companion: the 'if it's not your turn' condition needs a current-turn-player predicate compared with" +
    " the ability controller; Condition has no such predicate today"
);
test.todo(
  "momentary-companion: [Hidden] (CR 811) cost.hidden expansion and the hide/facedown play permissions (RIFT-84)"
);
