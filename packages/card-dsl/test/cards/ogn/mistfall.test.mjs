import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/mistfall.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { assertTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import costPay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";

test("ogn-152-298 Mistfall: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-152-298 Mistfall: identity, version and verbatim source text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-83ac5caa691e1d4ec728f3caba4e472ea1ca03749ff89db2ca5f1af82cf49020"
  );
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "When you buff a friendly unit, you may pay :rb_rune_body: and exhaust this to ready it."
  );
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /trigger-spec\.ts/);
  assert.match(program.judgeReason, /buff-added/);
  assert.match(program.judgeReason, /cost\.pay requires a valid, payable finalized cost plan|cost\.pay/);
  assert.match(program.judgeReason, /assertFinalizationSurface|Nested/);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-152-298 Mistfall: the buff-added trigger validates with its unit and controller filters", () => {
  const [ability] = program.abilities;
  const translated = translateTriggerFilter(ability.trigger.filter, "mistfall", ability.trigger.at);
  assert.deepEqual(translated, { event: "buff-added", object: { type: "unit" }, player: "self" });
  assert.doesNotThrow(() => assertTriggerSpec({ at: ability.trigger.at, filter: translated }));
});

test("ogn-152-298 Mistfall: cost.pay still cannot construct the trigger's pay-and-exhaust cost", () => {
  // 430/415: paying Body Power and exhausting the source is a resolution-time
  // cost of the trigger. The merged cost.pay only consumes a finalized plan;
  // the symbolic self-exhaust declaration is not one.
  const kernel = world()
    .player("A", { power: ["Body"] })
    .unit("mistfall", { owner: "A", types: ["gear"], zone: "board", exhausted: false })
    .build();
  const coaster = kernel.clone({ controller: "A", sourceSnapshot: kernel.getObject("mistfall") });
  const [choice] = program.abilities[0].body;
  const [payInstruction] = choice.args.body.value;
  assert.throws(
    () => runInstruction(costPay, payInstruction.args, { world: coaster }),
    /cost\.pay requires a valid, payable finalized cost plan/
  );
  assert.equal(coaster.getObject("mistfall").exhausted, false);
});

test("ogn-152-298 Mistfall: production Finalize asks for the nested optional-body target", () => {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .unit("mistfall", { owner: "A", types: ["gear"], zone: "board" })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => { throw new Error(`Unexpected choice: ${request.id}`); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  const source = kernel.getObject("mistfall");
  const trigger = program.abilities[0];
  engine.enqueue({
    id: "mistfall.probe",
    controller: "A",
    source,
    kind: "triggered",
    speed: "normal",
    body: trigger.body,
    object: source.ref
  });
  const error = (() => {
    try {
      engine.advance();
      return null;
    } catch (thrown) {
      return thrown;
    }
  })();
  assert.equal(error.name, "AwaitChoice");
  assert.equal(error.request.id, "mistfall.may-pay/optional");
  assert.equal(error.request.type, "optional");
});

test("ogn-152-298 Mistfall: buff-added trigger with optional pay+exhaust body", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "buff-added");
  assert.equal(ability.trigger.filter.event, "buff-added");
  assert.deepEqual(ability.trigger.filter.object, { type: "unit" });
  assert.equal(ability.trigger.filter.player, "self");
  assert.equal(ability.optional, false);

  assert.equal(ability.body.length, 1);
  const [choice] = ability.body;
  assert.equal(choice.op, "choice.optional");
  assert.equal(choice.args.body.kind, "constant");
  assert.deepEqual(choice.args.body.value.map(instruction => instruction.id), [
    "mistfall.pay-cost",
    "mistfall.ready-buffed-unit"
  ]);

  const [pay, readyInstruction] = choice.args.body.value;
  assert.equal(pay.op, "cost.pay");
  assert.equal(pay.linkedTo, undefined);
  assert.deepEqual(pay.args.power, { kind: "constant", value: ["Body"] });
  assert.deepEqual(pay.args.payments.value, [{ kind: "exhaust", object: "self" }]);

  assert.equal(readyInstruction.op, "effect.ready");
  assert.equal(readyInstruction.linkedTo, "mistfall.pay-cost");
  assert.deepEqual(readyInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "mistfall.buffed-unit" }
  });
  assert.equal(readyInstruction.targets.length, 1);
  assert.equal(readyInstruction.targets[0].id, "mistfall.buffed-unit");
  assert.deepEqual(readyInstruction.targets[0].filter, { type: "unit", controller: "self" });
});

test("ogn-152-298 Mistfall: the ready half executes through effect.ready once the target is locked", () => {
  const kernel = world()
    .unit("buffed-unit", { exhausted: true, might: 2, buffs: 1 })
    .build();
  const target = kernel.ref("buffed-unit");
  const run = runInstruction(
    ready,
    { objects: { kind: "constant", value: { kind: "target", id: "mistfall.buffed-unit" } } },
    { world: kernel, targets: { "mistfall.buffed-unit": [target] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.readied.count, 1);
  assert.equal(kernel.getObject("buffed-unit").exhausted, false);
  assert.deepEqual(run.events.map(event => event.action), ["ready"]);
});

test.todo(
  "Mistfall: pay 1 Body Power and exhaust the source as trigger finalize costs " +
    "(TriggeredAbility has no cost field; cost.pay cannot yet construct this trigger payment)"
);
test.todo(
  "Mistfall: bind 'ready it' to the buff-added event's unit (event-payload ObjectSelector)"
);
