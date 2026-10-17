import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/mageseeker-investigator.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import restrict from "../../../../engine-core/dist/effects/instructions/continuous.restrict.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { appliedCosts } from "../../../../engine-core/dist/layers/rules/query.js";
import { moveDuelUnitsStandard } from "../../../../engine-core/dist/zones/movement.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-b160c71d3dd5254b9c98867feb0f67b7805cefc8624fcf4d00f8f427ab3be532";
const SOURCE_TEXT =
  "Opponents must pay :rb_rune_rainbow: for each unit beyond the first to move " +
  "multiple units to my battlefield at the same time.";

const [applied] = program.abilities;

test("unl-163-219 Mageseeker Investigator: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-163-219 Mageseeker Investigator: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /204\.4/);
  assert.match(program.judgeReason, /applied-cost|Applied Cost/);
  assert.match(program.judgeReason, /163\.2\.b/);
  assert.match(program.judgeReason, /355\.10\.b/);
  // Re-checked against the merged sources: the instruction path registers and
  // reads back, but the static binder cannot map the kind and no movement cost
  // plan consumes the registration.
  assert.match(program.judgeReason, /normalizedEffect/);
  assert.match(program.judgeReason, /actions/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-163-219 Mageseeker Investigator: the card text is one Applied Cost static ability (204.4)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(applied.kind, "static");
  assert.equal(applied.effect.kind, "continuous.restrict");
  assert.equal(applied.effect.mode, "applied-cost");
  // layers/rules/query.ts reads the plural spelling for static card data.
  assert.deepEqual(applied.effect.actions, ["move"]);
  assert.equal(applied.effect.action, undefined);
  // 204.4.a: the associated Game Action is the linked effect of the Cost; CR
  // narrows it to a simultaneous batch of Moves.
  assert.equal(applied.effect.batch, "simultaneous");
  // 204.4.b / 204.4.c: the payer is the player performing the Move, and the
  // action is illegal when it cannot or will not be paid.
  assert.equal(applied.effect.payer, "moving-player");
  // 135.2.e.5 / 163.2.b: :rb_rune_rainbow: is Power of any Domain.
  assert.equal(applied.effect.resource, "power");
  assert.equal(applied.effect.domain, "any");
  // 355.10.b: "to my battlefield" is a restriction/permission on the game
  // action, not a target choice.
  assert.deepEqual(applied.effect.destination, { kind: "self-battlefield" });
  // "for each unit beyond the first" over the same simultaneous batch.
  assert.deepEqual(applied.effect.amount, { perBatch: "units-moved", minus: 1 });
});

test("unl-163-219 Mageseeker Investigator golden: Applied Cost registers through the merged restriction primitive", () => {
  const kernel = world().unit("investigator", { owner: "A", controller: "A", might: 4 }).build();
  const run = runInstruction(
    restrict,
    {
      mode: { kind: "constant", value: applied.effect.mode },
      action: { kind: "constant", value: applied.effect.actions },
      cost: { kind: "constant", value: {
        resource: applied.effect.resource,
        domain: applied.effect.domain,
        payer: applied.effect.payer,
        amount: applied.effect.amount
      } }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  const registry = createContinuousEffectRegistry();
  for (const entry of kernel.continuousEffects) registry.register(entry.effect, entry.duration);
  const entries = appliedCosts(registry, "move");
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].cost, {
    resource: "power",
    domain: "any",
    payer: "moving-player",
    amount: { perBatch: "units-moved", minus: 1 }
  });
});

test("unl-163-219 Mageseeker Investigator: the production static binding keeps kind 'restriction', so appliedCosts() cannot see it (204.4)", () => {
  // static binding succeeds, but the registered kind stays 'restriction' while
  // appliedCosts() only matches 'applied-cost' - the card's own declaration is
  // therefore invisible to the query on the production path.
  const f = fixture({
    cards: [{ id: "investigator", cardId: CANONICAL_ID, types: ["unit"], energy: 4, power: [], might: 4 }]
  });
  const source = { ...f.kernel.getObject("investigator"), cardId: CANONICAL_ID, zone: "board" };
  const handle = createEngineStaticBinder(f.engine).bindStatic(applied, source);
  const [registration] = f.engine.layers.registry.list();
  assert.equal(registration.effect.effect.kind, "restriction");
  assert.equal(registration.effect.effect.mode, "applied-cost");
  assert.deepEqual(registration.effect.effect.actions, ["move"]);
  assert.deepEqual(appliedCosts(f.engine.layers.registry, "move"), []);
  handle.unbind();
});

test("unl-163-219 Mageseeker Investigator golden: the registration is readable but no movement plan charges it (204.4.a-c)", () => {
  // Reading back through appliedCosts() is real (the instruction path). What is
  // missing is a consumer: the standard-move kernel takes its cost plan from the
  // caller and never queries appliedCosts(), and the [A] amount has no payable
  // representation either.
  const kernel = world().unit("investigator", { owner: "A", controller: "A", might: 4 }).build();
  const run = runInstruction(
    restrict,
    {
      mode: { kind: "constant", value: applied.effect.mode },
      action: { kind: "constant", value: applied.effect.actions },
      cost: { kind: "constant", value: {
        resource: applied.effect.resource,
        domain: applied.effect.domain,
        payer: applied.effect.payer,
        amount: applied.effect.amount
      } }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  const registry = createContinuousEffectRegistry();
  for (const entry of kernel.continuousEffects) registry.register(entry.effect, entry.duration);
  assert.deepEqual(appliedCosts(registry, "move").map((entry) => entry.actions), [["move"]]);
  // Scoped to the associated action only.
  assert.deepEqual(appliedCosts(registry, "play"), []);
  // The move kernel's rule bridge only reads movement/restrictions, never
  // appliedCosts, so the registration cannot influence a real Move.
  assert.equal(typeof moveDuelUnitsStandard, "function");
  assert.equal(moveDuelUnitsStandard.length, 4);
});
test.todo(
  "unl-163-219 Mageseeker Investigator: universal Power ([A], 135.2.e.5 / 163.2.b) must stay representable; the six-domain " +
    "enumeration cannot express it and must not be replaced by a colored domain — cost/README.md contract request 2"
);
test.todo(
  "unl-163-219 Mageseeker Investigator: the simultaneous-batch unit count feeding the cost amount, and the " +
    "\"my battlefield\" destination anchor (355.10.b) — movement batch accounting and runtime location anchoring are missing"
);
