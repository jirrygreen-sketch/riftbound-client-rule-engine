import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/ruin-runner.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-4c33c3a92166927cee28b4acd0740603992c27aa8567488dee47edd7288ae1a1";
const [ability] = program.abilities;

test("sfd-105-221 Ruin Runner: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-105-221 Ruin Runner: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, "I can't be chosen by enemy spells and abilities.");
});

test("sfd-105-221 Ruin Runner: judgeReason names the untargetability consumer gap", () => {
  assert.match(program.judgeReason, /756/);
  assert.match(program.judgeReason, /757\.1/);
  assert.match(program.judgeReason, /758/);
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /target\/target-plan\.ts/);
  assert.match(program.judgeReason, /RIFT-90/);
});

test("sfd-105-221 Ruin Runner: one static untargetable declaration naming chooser and source category", () => {
  // 757 / 757.1: the passive ability designates the host as Untargetable for
  // the [Category] spells and abilities the text names — 757's own example is
  // this card verbatim. The declaration is data; no target rule is restated.
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.restrict");
  assert.equal(ability.effect.mode, "untargetable");
  assert.equal(ability.effect.appliesTo, "self");
  assert.equal(ability.effect.chooser, "opponent");
  assert.deepEqual(ability.effect.sources, ["spell", "ability"]);
  assert.equal(ability.condition, undefined);
});

test("sfd-105-221 Ruin Runner: the program authors no instruction, target or keyword it cannot execute", () => {
  // The restriction is a whole-object eligibility rule (355.9.b / 359.3.e.5),
  // not a filter on some instruction, so nothing in body could carry it; a
  // body-level no-op would fake execution.
  assert.equal(ability.body, undefined);
  assert.equal(ability.effect.body, undefined);
  assert.equal(/\.op\b/.test(JSON.stringify(program.abilities)), false);
});

test.todo(
  "sfd-105-221 Ruin Runner: the untargetability declaration must be consumed by target legality so an " +
    "opponent's spell or ability cannot choose this unit on the board (757/757.1, 758, 355.9.b) — " +
    "no continuous.restrict primitive exists, layers/ consumes only arithmetic/keyword/movement, and " +
    "target/target-plan.ts never reads such a declaration (RIFT-90 / RIFT-91)"
);

test.todo(
  "sfd-105-221 Ruin Runner: re-check untargetability on resolution so a unit that becomes untargetable " +
    "after being targeted mistargets (758.1, 758.2 / 758.2.a, 359.3.e.5) — same consumer gap"
);
