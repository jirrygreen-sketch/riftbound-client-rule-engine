import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/heart-of-dark-ice.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";

const CANONICAL = "card.hash-fb2b68d85d71603dc36df01e06a5cedb3afd2385f4545e34f533a975f5db9ffa";
const SOURCE_TEXT = ":rb_exhaust:: Give a unit +3 :rb_might: this turn.";

const [activated] = program.abilities;
const [mightInstruction] = activated.body;
const targetSpec = mightInstruction.targets[0];

/**
 * Production drives a card's activated ability through the chain: the
 * program binding turns the CardProgram into a ChainDraft, then ChainEngine
 * finalizes (targets + costs) and resolves the body through the interpreter
 * adapter. The golden builds exactly that path on the reference kernel: the
 * host Port owns state, choices and the action pipeline, and
 * `createProgramBinding({ cardPrograms: [program] })` supplies describeActivate.
 */
function heartFixture({ units = ["chosen-unit", "enemy-unit"] } = {}) {
  const builder = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .base("heart-of-dark-ice", {
      owner: "A",
      cardId: CANONICAL,
      types: ["gear"],
      location: { type: "base", player: "A" },
      energy: 3,
      power: ["Calm"],
      might: null
    });
  if (units.includes("chosen-unit")) builder.unit("chosen-unit", { owner: "A", might: 2 });
  if (units.includes("enemy-unit")) builder.unit("enemy-unit", { owner: "B", might: 2 });
  const kernel = builder.build();
  const requests = [];
  const decide = (request) => {
    requests.push(request);
    // The Finalize target request offers both Board units (355.7); the golden
    // picks the first legal candidate to keep the scenario deterministic.
    if (request.type === "select-objects" && request.options.length >= request.min) {
      return [...request.options].slice(0, request.min);
    }
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: decide,
    context: (sourceSnapshot, controller, timingPoint) => bindResolveContext(kernel, {
      source: sourceSnapshot, controller, timingPoint, choose: decide
    }),
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  const binding = createProgramBinding({ cardPrograms: [program] });
  return { kernel, engine, binding, requests };
}

function activateHeart(fixture) {
  const draft = fixture.binding.describeActivate(fixture.kernel.getObject("heart-of-dark-ice"), "A");
  fixture.engine.execute(draft);
  let guard = 0;
  while (fixture.engine.items.length && guard++ < 20) fixture.engine.pass(fixture.engine.priority);
  return draft;
}

test("sfd-052-221 Heart of Dark Ice: program validates and is executable", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-052-221 Heart of Dark Ice structure: one action-speed activated ability, exhaust-self cost, one-unit +3 Might this turn", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(activated.kind, "activated");
  // Gear activated abilities default to Action timing (CR 151.2); no [Reaction] is printed.
  assert.equal(activated.timing, "action");
  assert.deepEqual(activated.cost, {
    kind: "activated",
    payments: [{ kind: "exhaust", object: "self" }]
  });
  assert.equal(activated.restriction, undefined);

  assert.equal(activated.body.length, 1);
  assert.equal(mightInstruction.id, "heart-of-dark-ice.give-plus-3-might");
  // "Give a unit +3 Might this turn" is a temporary Might modification on the
  // arithmetic layer (143.2.a/475-478), never an effect.buff counter (702/703).
  assert.equal(mightInstruction.op, "continuous.might");
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(mightInstruction.picks, undefined);
  assert.equal(mightInstruction.linkedTo, undefined);
  // Contract 3.6: the object position carries the symbolic target selector,
  // never a runtime ObjectRef.
  assert.deepEqual(mightInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "heart-of-dark-ice.unit" }
  });

  // "a unit" — exactly one Board unit chosen by the controller (355.7/355.10).
  assert.equal(mightInstruction.targets.length, 1);
  assert.deepEqual(targetSpec, {
    id: "heart-of-dark-ice.unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("sfd-052-221 Heart of Dark Ice golden: the real chain pays the exhaust cost and registers +3 Might", () => {
  const fixture = heartFixture();
  const draft = activateHeart(fixture);

  // The printed cost flows through the card program's own CostSpec: nothing is
  // hand-built and the chain's Finalize really exhausts the Gear (415.3.a/415.5).
  assert.deepEqual(draft.cost.cost.payments, [{ kind: "exhaust", object: "self" }]);
  assert.equal(fixture.kernel.getObject("heart-of-dark-ice").exhausted, true);
  // The Finalize TargetPlan chose the only candidate; 355.7's target lock is real.
  assert.deepEqual(
    fixture.requests.filter(request => request.id === `target:${targetSpec.id}`).length,
    1
  );

  // The continuous.might effect landed on the arithmetic layer through the
  // chain's ResolveContext.addContinuous, and only the chosen unit is affected.
  assert.equal(fixture.engine.layers.evaluate(fixture.kernel.ref("chosen-unit")).might, 5);
  assert.equal(fixture.engine.layers.evaluate(fixture.kernel.ref("enemy-unit")).might, 2);
  // No Buff counter was placed (702/703 semantics are different).
  assert.equal(fixture.engine.layers.evaluate(fixture.kernel.ref("chosen-unit")).buffs, 0);
  // The real action wave shows the paid exhaust and the resolved chain item.
  assert.ok(fixture.engine.pipeline.events.some(event => event.timingPoint === "object-exhausted"));
  assert.ok(fixture.engine.pipeline.events.some(event => event.timingPoint === "chain-item-resolve"));
  assert.ok(fixture.engine.pipeline.events.some(event => event.timingPoint === "became-target"));
});

test("sfd-052-221 Heart of Dark Ice golden: the +3 expires at end of turn (317.1.a/468.7.c)", () => {
  const fixture = heartFixture();
  activateHeart(fixture);
  assert.equal(fixture.engine.layers.evaluate(fixture.kernel.ref("chosen-unit")).might, 5);

  // TurnPhaseLayers expires "this turn" effects when the turn ends.
  const expired = fixture.engine.layers.expireAt("turn-end");
  assert.equal(expired.length, 1);
  assert.equal(fixture.engine.layers.evaluate(fixture.kernel.ref("chosen-unit")).might, 2);
});

test("sfd-052-221 Heart of Dark Ice golden: an activation with no legal unit fails Finalize without changing state", () => {
  const fixture = heartFixture({ units: [] });
  const draft = fixture.binding.describeActivate(fixture.kernel.getObject("heart-of-dark-ice"), "A");
  assert.throws(
    () => fixture.engine.execute(draft),
    (error) => {
      assert.equal(error.code, "no-legal-targets");
      return true;
    }
  );
  // The activation did not happen: the Gear stays ready and nothing was layered.
  assert.equal(fixture.kernel.getObject("heart-of-dark-ice").exhausted, false);
  assert.equal(fixture.engine.layers.registry.list().length, 0);
});
