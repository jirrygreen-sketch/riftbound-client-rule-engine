import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import runePrison from "../../../dist/cards/ogn/rune-prison.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import stun from "../../../../engine-core/dist/effects/instructions/effect.stun.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-6347b24ab04866148459050aad3a3ee903e16b2873c869ef49ba20384d26ba18";

const [keyword, play] = runePrison.abilities;
const [stunInstruction] = play.body;
// The interpreter evaluates each arg expression before dispatch, so a direct
// primitive run (runInstruction) receives the already-evaluated target id.
const evaluatedArgs = { target: stunInstruction.args.target.value };

test("Rune Prison program is structurally valid EffectIR v2 data", () => {
  const result = validateCardProgram(runePrison);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Rune Prison identity, ruleset, status and printed text", () => {
  assert.equal(runePrison.canonicalCardId, CANONICAL);
  assert.equal(runePrison.rulesetVersion, "core-1.5");
  assert.equal(runePrison.status, "executable");
  assert.equal(runePrison.judgeReason, undefined);
  assert.equal(cardRegistryById.get(runePrison.canonicalCardId), runePrison);
  assert.equal(
    runePrison.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "Stun a unit. (It doesn't deal combat damage this turn.)"
  );
});

test("Rune Prison: [Action] keyword plus one targeted effect.stun instruction", () => {
  assert.equal(runePrison.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "action" });
  assert.equal(keyword.value, undefined);
  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 1);
  assert.equal(stunInstruction.id, "stun-a-unit");
  assert.equal(stunInstruction.op, "effect.stun");
  assert.deepEqual(stunInstruction.args, { target: { kind: "constant", value: "stunned-unit" } });
  assert.equal(stunInstruction.picks, undefined);
  assert.equal(stunInstruction.linkedTo, undefined);
  assert.equal(stunInstruction.condition, undefined);
  assert.deepEqual(stunInstruction.targets, [
    {
      id: "stunned-unit",
      filter: { type: "unit" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("Rune Prison: the merged registry really registers effect.stun", () => {
  assert.equal(instructionDefinitionsById.get("effect.stun"), stun);
  assert.equal(stun.op, "effect.stun");
});

test("Rune Prison golden: stuns the chosen unit and links the actual result (CR 424.1)", () => {
  const kernel = world().unit("target-unit", { owner: "B", might: 4 }).build();
  const target = kernel.ref("target-unit");
  const run = runInstruction(stun, evaluatedArgs, {
    world: kernel,
    targets: { "stunned-unit": [target] }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("target-unit").stunned, true);
  assert.deepEqual(run.events.map(event => event.action), ["stun"]);
  assert.equal(run.linked.stunned.count, 1);
  assert.deepEqual(run.linked["stunned.objects"], [{ id: "target-unit", zoneEntryId: 1 }]);
});

test("Rune Prison golden: an already Stunned unit cannot be Stunned again (CR 424.1.a.1)", () => {
  const kernel = world().unit("target-unit", { owner: "B", stunned: true }).build();
  const target = kernel.ref("target-unit");
  const run = runInstruction(stun, evaluatedArgs, {
    world: kernel,
    targets: { "stunned-unit": [target] }
  });

  // Choosing an already Stunned unit stays legal; nothing extra happens and no
  // unit-stunned timing point is emitted (424.1.a.1).
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.stunned.count, 0);
  assert.equal(run.linked.stunned.alreadyStunned, 1);
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("target-unit").stunned, true);
});

test("Rune Prison golden: a stale target is ignored at resolution (359.3.e)", () => {
  const kernel = world().unit("target-unit", { owner: "B" }).build();
  const stale = kernel.ref("target-unit");
  kernel.perform({ type: "kill", object: stale });
  const run = runInstruction(stun, evaluatedArgs, {
    world: kernel,
    targets: { "stunned-unit": [stale] }
  });

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
});

test("Rune Prison golden: the program's own body drives effect.stun through the interpreter", () => {
  const kernel = world().unit("target-unit", { owner: "B" }).build();
  kernel.setTargets("stunned-unit", [kernel.ref("target-unit")]);

  // "a unit" resolves to any Board unit; the filter is satisfied by the
  // kernel's own snapshots, so the program body executes for real.
  const outcome = runAbilityBody(play.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => result.id), ["stun-a-unit"]);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("target-unit").stunned, true);
  assert.deepEqual(outcome.events.map(event => event.action), ["stun"]);
});

test.todo(
  "Rune Prison consequence: a Stunned Unit does not contribute its Might to combat damage " +
    "(CR 424.1.b) while still needing its full Might in damage to be killed (424.1.c) - needs the " +
    "combat damage step (contract 7.2 batch 5 Turn/Combat)"
);

test.todo(
  "Rune Prison expiry: the Stunned status is lost at step 3d of the end of turn cleanup " +
    "(CR 424.1.a.2) - needs the cleanup/end-of-turn expiration path"
);
