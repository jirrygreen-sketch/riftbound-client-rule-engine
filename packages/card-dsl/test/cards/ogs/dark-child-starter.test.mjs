// Golden test for Dark Child, Starter (ogs-017-024).
//
// The card is judge-required: the turn-end timing point is emitted by the
// turn flow and card-program trigger registration is available, but the
// EventPattern vocabulary and Legend source zone still block the full card.
// What IS merged is the effect body:
// "ready 2 runes" runs through the real effect.ready primitive on the
// reference kernel, so the golden executes the card's own body via the
// chain interpreter adapter (the same path card bodies take in the chain).
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogs/dark-child-starter.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";

const CANONICAL_ID =
  "card.hash-bada5b917cb4b9f966ee3a8e2d81ca8bcacdc8093220a3f2d94d8234495aae12";
const SOURCE_TEXT = "At the end of your turn, ready 2 runes.";
const [ability] = program.abilities;
const [readyInstruction] = ability.body;

/** A board with this player's rune zone populated (CR 107.1.c / 417.1.b). */
const runeWorld = ({ own = ["rune-a", "rune-b"], ready = [], enemy = ["enemy-rune"] } = {}) => {
  const builder = world();
  for (const id of [...own, ...ready]) {
    builder.card(id, { types: ["rune"], zone: "rune-zone", exhausted: !ready.includes(id) });
  }
  for (const id of enemy) {
    builder.card(id, {
      types: ["rune"],
      zone: "rune-zone",
      exhausted: true,
      owner: "B",
      controller: "B"
    });
  }
  return builder.build();
};

/**
 * The static IR spells the implicit "you" as the controller placeholder that
 * the selection pipeline binds at Finalize/Resolve (190.6.d). The reference
 * kernel compares filter values literally, so the golden body substitutes the
 * concrete player, exactly like the Ekko, Recurrent / Assembly Rig goldens.
 */
const boundBody = (controller = "A") => [
  {
    ...readyInstruction,
    args: {
      ...readyInstruction.args,
      objects: {
        ...readyInstruction.args.objects,
        value: {
          ...readyInstruction.args.objects.value,
          filter: { ...readyInstruction.args.objects.value.filter, controller }
        }
      }
    }
  }
];

test("ogs-017-024 Dark Child, Starter: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogs-017-024 Dark Child, Starter: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // README section 2: the reason must name the missing semantics and the
  // dependent tasks, not just "needs support".
  assert.match(program.judgeReason, /validateTriggerSpec/);
  assert.match(program.judgeReason, /turn-end/);
  assert.match(program.judgeReason, /Legend Zone/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("ogs-017-024 Dark Child, Starter: turn-end trigger with a 2-rune ready body", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // "At the end of your turn" is the closed turn-end timing point (317.1.a).
  assert.equal(ability.trigger.at, "turn-end");
  assert.deepEqual(ability.trigger.filter, { event: "turn-end", player: "self" });
  // The runtime matcher compares the event name against the emitted timing
  // point (event.kind ?? timingPoint), so a turn-end event for this player
  // matches and other timings/players do not.
  assert.equal(matchesTriggerEvent(ability.trigger.filter, { timingPoint: "turn-end", player: "A" }, "A"), true);
  assert.equal(matchesTriggerEvent(ability.trigger.filter, { timingPoint: "turn-end", player: "B" }, "A"), false);
  assert.equal(matchesTriggerEvent(ability.trigger.filter, { timingPoint: "cleanup-start", player: "A" }, "A"), false);
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.optional, false);

  assert.equal(ability.body.length, 1);
  assert.equal(readyInstruction.id, "dark-child.ready-2-runes");
  assert.equal(readyInstruction.op, "effect.ready");
  // "ready 2 runes" is not "up to 2" (355.13 does not apply): the choice is
  // a resolution-time choose of your own runes (355.5.b / 355.10.f), never a
  // TargetSpec (355.7).
  assert.equal(readyInstruction.targets, undefined);
  assert.equal(readyInstruction.picks, undefined);
  assert.deepEqual(readyInstruction.args.objects, {
    kind: "constant",
    value: {
      kind: "choose",
      id: "dark-child.runes",
      filter: { zone: "rune-zone", type: "rune", controller: "self" },
      min: 2,
      max: 2,
      prompt: "Ready 2 runes."
    }
  });
});

test("ogs-017-024 Dark Child, Starter: the body asks for exactly 2 runes and readies them", () => {
  const kernel = runeWorld();
  const body = boundBody();

  // Without an answer the instruction suspends on a replayable choice request
  // scoped to the instruction path (contract 3.9 / interpreter README).
  let asked = null;
  try {
    resolveChainBody(body, kernel);
  } catch (error) {
    asked = error;
  }
  assert.ok(asked instanceof AwaitChoice, "expected a select-objects request");
  assert.deepEqual(asked.request, {
    id: "dark-child.ready-2-runes/dark-child.runes",
    type: "select-objects",
    chooser: "A",
    visibility: "public",
    options: [kernel.ref("rune-a"), kernel.ref("rune-b")],
    min: 2,
    max: 2,
    prompt: "Ready 2 runes."
  });

  const answered = runeWorld();
  answered.setAnswers({
    "dark-child.ready-2-runes/dark-child.runes": [answered.ref("rune-a"), answered.ref("rune-b")]
  });
  const outcome = resolveChainBody(boundBody(), answered);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results.length, 1);
  assert.equal(outcome.results[0].op, "effect.ready");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(answered.getObject("rune-a").exhausted, false);
  assert.equal(answered.getObject("rune-b").exhausted, false);
  // Only your own runes (190.6.d implied "you"); the opponent's rune is untouched.
  assert.equal(answered.getObject("enemy-rune").exhausted, true);
  assert.deepEqual(outcome.results[0].result.linkedValues.readied.count, 2);
});

test("ogs-017-024 Dark Child, Starter: a single available rune readies what it can (359.3.e.11)", () => {
  const kernel = runeWorld({ own: ["only-rune"], enemy: [] });
  kernel.setAnswers({
    "dark-child.ready-2-runes/dark-child.runes": [kernel.ref("only-rune")]
  });
  const outcome = resolveChainBody(boundBody(), kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("only-rune").exhausted, false);
  assert.equal(outcome.results[0].result.linkedValues.readied.count, 1);
});

test("ogs-017-024 Dark Child, Starter: no exhausted rune still resolves with an empty result", () => {
  const kernel = runeWorld({ own: ["rune-a"], ready: ["rune-a"], enemy: [] });
  kernel.setAnswers({
    "dark-child.ready-2-runes/dark-child.runes": [kernel.ref("rune-a")]
  });
  const outcome = resolveChainBody(boundBody(), kernel);
  // CR 416.1.b/416.1.c: an already-Ready rune is not Readied again.
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.results[0].result.linkedValues.readied, { count: 0, objects: [] });
});

test.todo(
  "Dark Child, Starter: the turn-end trigger enters the chain on its controller's turn " +
    "(CR 317.1.a) — the timing point is emitted by the turn flow and the card-program trigger " +
    "registration path exists, but the frozen EventPattern vocabulary still rejects the turn-end spelling"
);

test.todo(
  "Dark Child, Starter: the Legend source resolves from the Legend Zone (CR 107.4.c / 174.2.b) — " +
    "the frozen ZoneId (effects/contract.ts) and the reference kernel have no legend zone, and a " +
    "registration's default activeZones is ['board']"
);
