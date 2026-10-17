import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/piltover-enforcer.js";
import exhaust from "../../../../engine-core/dist/effects/instructions/effect.exhaust.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { EventPipeline } from "../../../../engine-core/dist/events/pipeline.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";

const CANONICAL_ID =
  "card.hash-8e09f40d2b739aa2e5e38a58cb0c9b9a2682ab534807bcc62c90206e763d6856";
const SOURCE_TEXT =
  "When you conquer, if you assigned 3 or more excess damage, you may exhaust me to ready a unit.";

const [ability] = program.abilities;
const [exhaustSelf, readyUnit] = ability.body;
const targetSpec = readyUnit.targets[0];

test("unl-187-219 Piltover Enforcer: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-187-219 Piltover Enforcer: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /excess damage/);
  assert.match(program.judgeReason, /467\.2\.c/);
  assert.match(program.judgeReason, /404\.1\.b\.1/);
  // The conquer timing point is really emitted now (turn/flow.ts Score wave),
  // and the exhaust/ready primitives plus the program binding are merged; the
  // reason must reflect the two remaining gaps instead of a blanket RIFT-89.
  assert.match(program.judgeReason, /turn\/flow\.ts/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.doesNotMatch(program.judgeReason, /依赖 RIFT-89（费用接线）/);
});

test("unl-187-219 Piltover Enforcer: 'When you conquer' trigger with the excess-damage clause as trigger condition", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.c / 383.4.c.1: a Conquer Effect; "self" is the conqueror.
  assert.equal(ability.trigger.at, "conquer");
  assert.deepEqual(ability.trigger.filter, { event: "conquer", player: "self" });
  // 383.2.a.1: the "if you assigned 3 or more excess damage" clause follows the
  // trigger condition directly and belongs to it; the count shape is the
  // documented readability gap, not an estimated damage ledger.
  assert.equal(ability.trigger.condition.kind, "compare");
  assert.equal(ability.trigger.condition.operator, "gte");
  assert.deepEqual(ability.trigger.condition.right, { kind: "constant", value: 3 });
  assert.equal(ability.trigger.condition.left.kind, "count");
  // 383.3.a: the leading "you may" is the Finalize decision for the trigger.
  assert.equal(ability.optional, true);
});

test("unl-187-219 Piltover Enforcer: exhaust-me then ready a unit, with the target declared once", () => {
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "piltover-enforcer.exhaust-self",
    "piltover-enforcer.ready-unit"
  ]);
  // 355.10.c.1 / 415.5: "exhaust me" is anchored to the source through a
  // non-target choose filter, so nothing becomes a target (355.7).
  assert.equal(exhaustSelf.op, "effect.exhaust");
  assert.deepEqual(exhaustSelf.args, {
    choose: {
      kind: "constant",
      value: { id: "piltover-enforcer.exhaust-self", filter: { object: "self" } }
    }
  });
  assert.equal(exhaustSelf.targets, undefined);
  assert.equal(exhaustSelf.picks, undefined);
  // "to ready a unit": 416.1–416.3 through effect.ready, linked so the ready
  // only follows the exhaust (359.3.e.14).
  assert.equal(readyUnit.op, "effect.ready");
  assert.deepEqual(readyUnit.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "piltover-enforcer.unit" }
  });
  assert.equal(readyUnit.linkedTo, "piltover-enforcer.exhaust-self");
  assert.deepEqual(targetSpec, {
    id: "piltover-enforcer.unit",
    filter: { zone: "board", type: "unit" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("unl-187-219 Piltover Enforcer: the exhaust/ready body executes through the interpreter", () => {
  const kernel = world()
    .unit("vi", { zone: "board", types: ["legend"], controller: "A" })
    .unit("ally", { zone: "board", exhausted: true })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("vi")) });
  ctx.setTargets(targetSpec.id, [ctx.ref("ally")]);
  const outcome = runAbilityBody(ability.body, ctx);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["piltover-enforcer.exhaust-self", "executed"],
    ["piltover-enforcer.ready-unit", "executed"]
  ]);
  assert.deepEqual(ctx.events.map(event => event.action), ["exhaust", "ready"]);
  assert.equal(ctx.object(ctx.ref("vi")).exhausted, true);
  assert.equal(ctx.object(ctx.ref("ally")).exhausted, false);
});

test("unl-187-219 Piltover Enforcer: an already-exhausted legend cannot be exhausted again (CR 415.1.b/c)", () => {
  // The primitive runner receives the *evaluated* args of the printed
  // "exhaust me" choose (the interpreter evaluates Exprs before dispatch); the
  // clone binds the source snapshot so the `{object: "self"}` anchor is the
  // legend, not the kernel's synthetic default source.
  const bound = world()
    .unit("vi", { zone: "board", types: ["legend"], controller: "A", exhausted: true })
    .build();
  const ctx = bound.clone({ sourceSnapshot: bound.object(bound.ref("vi")) });
  const run = runInstruction(
    exhaust,
    { choose: { id: "piltover-enforcer.exhaust-self", filter: { object: "self" } } },
    { world: ctx }
  );
  // 415.1.c: exhausting an already-exhausted object performs no additional
  // action; the printed instruction still resolves, with nothing newly exhausted.
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.exhausted.count, 0);
  assert.equal(run.linked.exhausted.alreadyExhausted, 1);
  assert.deepEqual(run.events, []);

  // A ready legend IS exhausted by the same printed args, linking the action.
  const readyLegend = world()
    .unit("vi", { zone: "board", types: ["legend"], controller: "A", exhausted: false })
    .build();
  const readyCtx = readyLegend.clone({ sourceSnapshot: readyLegend.object(readyLegend.ref("vi")) });
  const exhausted = runInstruction(
    exhaust,
    { choose: { id: "piltover-enforcer.exhaust-self", filter: { object: "self" } } },
    { world: readyCtx }
  );
  assert.equal(exhausted.result.status, "executed");
  assert.equal(exhausted.linked.exhausted.count, 1);
  assert.equal(readyCtx.getObject("vi").exhausted, true);
  assert.deepEqual(exhausted.events.map(event => event.action), ["exhaust"]);
});

test("unl-187-219 Piltover Enforcer: ready executes on the locked unit and a stale target is ignored", () => {
  const kernel = world().unit("ally", { zone: "board", exhausted: true }).build();
  const run = runInstruction(
    ready,
    { objects: { kind: "target", id: targetSpec.id } },
    { world: kernel, targets: { [targetSpec.id]: [kernel.ref("ally")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.readied.count, 1);
  assert.equal(kernel.getObject("ally").exhausted, false);

  const staleKernel = world().unit("ally", { zone: "board", exhausted: true }).build();
  const stale = staleKernel.ref("ally");
  staleKernel.perform({ type: "kill", object: stale });
  const staleRun = runInstruction(
    ready,
    { objects: { kind: "target", id: targetSpec.id } },
    { world: staleKernel, targets: { [targetSpec.id]: [stale] } }
  );
  assert.deepEqual(staleRun.result, { status: "ignored", reason: "mistargeted" });
});

test.todo(
  "unl-187-219 Piltover Enforcer: expose the conquer payload's assigned excess damage (CR 467.2.c.1–c.4: assigning vs dealing) " +
    "— the scoring payload has no such field and ResolveContext has no damage-assignment ledger (engine batch 4)"
);
test.todo(
  "unl-187-219 Piltover Enforcer: pay the leading 'exhaust me' as the trigger's base cost at Finalize (CR 383.3.b / 404.1.b.1 / 415.4–415.5) " +
    "— TriggeredAbility has no cost field (RIFT-261 series)"
);

test("unl-187-219 Piltover Enforcer golden: the merged pipeline really emits conquer as a triggerable timing", () => {
  // turn/flow.ts publishes the conquer timing inside the committed Score action
  // (one simultaneous group). Drive that emission through the real EventPipeline
  // with the card's own player-scoped filter: the subscription is reachable,
  // which is the merged half of this card.
  const kernel = world().player("A").player("B").unit("vi", { types: ["legend"], controller: "A" }).build();
  const hits = [];
  const pipeline = new EventPipeline(createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => { throw new Error("no choice"); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  }), ["A", "B"], "A");
  pipeline.onTrigger = snapshot => hits.push(snapshot.registration.id);
  pipeline.registerTrigger({
    id: "piltover-conquer",
    source: kernel.getObject("vi"),
    controller: "A",
    spec: { at: "conquer", filter: { event: "conquered", player: "self" } },
    body: []
  });
  pipeline.emit({ timingPoint: "conquer", player: "A", details: { battlefieldId: "bf-1" } });
  assert.deepEqual(hits, ["piltover-conquer"]);

  // The printed clause stays a comparison over the missing damage-assignment
  // ledger, so the card keeps judge-required instead of treating the count as a
  // damage sum (467.2.c.1: assigning and dealing are distinct).
  assert.equal(ability.trigger.condition.left.subject, "excess-damage-assigned-this-combat");
  assert.deepEqual(ability.trigger.condition.right, { kind: "constant", value: 3 });
});
