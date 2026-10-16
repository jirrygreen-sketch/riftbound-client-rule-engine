// Golden test for Herald of the Emperor (rad-118-167).
// The play trigger and the target selection are fixed; the base-Might set has no
// merged primitive and the trigger has no registration path (see judgeReason).
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/herald-of-the-emperor.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-f31c457784f7a2bda7271b96edb7702e948e7047187f0226e77144f06ba40ce1";
const SOURCE_TEXT = "When you play me, choose a friendly unit. Its base Might becomes 5 this turn.";

const [playTrigger] = program.abilities;
const [setBaseMight] = playTrigger.body;
const [friendlyUnit] = setBaseMight.targets;

test("rad-118-167 Herald of the Emperor: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-118-167 Herald of the Emperor: judgeReason names the base-Might primitive and the trigger registration", () => {
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /continuous\.duration/);
  assert.match(program.judgeReason, /143\.2\.a\.1/);
  assert.match(program.judgeReason, /registerTrigger/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /RIFT-120/);
});

test("rad-118-167 Herald of the Emperor: 'When you play me' is the self-scoped card-played trigger (383.4.a.1)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, { self: true });
  assert.equal(playTrigger.trigger.condition, undefined);
  assert.equal(playTrigger.trigger.once, undefined);
  assert.equal(playTrigger.optional, false);
});

test("rad-118-167 Herald of the Emperor: the body sets the chosen friendly unit's base Might to 5 this turn (143.2.a.1)", () => {
  assert.equal(playTrigger.body.length, 1);
  assert.equal(setBaseMight.id, "herald.set-base-might");
  assert.equal(setBaseMight.op, "continuous.base-might");
  assert.deepEqual(setBaseMight.args.amount, { kind: "constant", value: 5 });
  assert.deepEqual(setBaseMight.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(setBaseMight.args.target, {
    kind: "constant",
    value: "herald.friendly-unit"
  });
  assert.equal(setBaseMight.picks, undefined);
  assert.equal(setBaseMight.linkedTo, undefined);
});

test("rad-118-167 Herald of the Emperor: 'choose a friendly unit' is a single friendly-unit target (355.5/355.9.b)", () => {
  assert.equal(setBaseMight.targets.length, 1);
  assert.deepEqual(friendlyUnit, {
    id: "herald.friendly-unit",
    filter: { type: "unit", controller: "controller", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("rad-118-167 Herald of the Emperor: the base-Might instruction has no merged opcode yet", () => {
  const base = world()
    .unit("herald", { might: 3 })
    .unit("ally", { might: 2 })
    .build();
  const scoped = base.clone({ sourceSnapshot: base.getObject("herald") });
  scoped.setTargets("herald.friendly-unit", [base.ref("ally")]);
  // Two honest facts: the opcode has no registered primitive, and the reference
  // kernel matches the symbolic filter keys by exact value, so its own target
  // preparation finds no candidate and the instruction is ignored — nothing
  // pretends the base-Might set happened.
  assert.equal(instructionDefinitionsById.has("continuous.base-might"), false);
  assert.equal(instructionDefinitionsById.has("continuous.might"), false);
  const outcome = runAbilityBody(playTrigger.body, scoped);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]), [
    ["herald.set-base-might", "ignored", "mistargeted"]
  ]);
  assert.deepEqual(outcome.events, []);
  assert.throws(
    () =>
      runAbilityBody(
        [
          {
            id: "herald.opcode-probe",
            op: "continuous.base-might",
            args: { amount: { kind: "constant", value: 5 } }
          }
        ],
        scoped
      ),
    /Unregistered instruction opcode: continuous\.base-might/
  );
  assert.equal(scoped.getObject("ally").might, 2);
});

test.todo(
  "rad-118-167 Herald of the Emperor: 'its base Might becomes 5 this turn' applied in the Trait-Altering layer " +
    "and expiring at end of turn (CR 143.2.a.1/475/479.2) — the continuous.might (base-Might) and " +
    "continuous.duration primitives are not merged (RIFT-91)"
);
test.todo(
  "rad-118-167 Herald of the Emperor: the card-played trigger registered as a TriggerRegistration so the play " +
    "effect goes on the chain (CR 383.4.a.2; contract §7.2 batch 4/5) — RIFT-120"
);

