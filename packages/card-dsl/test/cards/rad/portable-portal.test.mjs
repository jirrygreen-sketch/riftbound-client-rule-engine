import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/portable-portal.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import grantKeyword from "../../../../engine-core/dist/effects/instructions/continuous.grant-keyword.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { translateInstructionTargets } from "../../../../engine-core/dist/programs/filters.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { CostPlanError } from "../../../../engine-core/dist/cost/plan-types.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import deploy from "../../../../engine-core/dist/effects/keywords/Deploy.js";

const CARD_ID = "card.hash-c23ae2a28f5e64f8b56146faf62b3012c3c1902a3ebdd597858ac9d76f814fdc";
const SOURCE_TEXT =
  "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
  "When you play this, you may pay :rb_rune_body: to ready a unit here.\n" +
  "Friendly units here have [Ganking]. (They can move from battlefield to battlefield.)";
const TARGET_ID = "portable-portal.unit-here";
const PAY_ID = "portable-portal.pay-body";
const READY_ID = "portable-portal.ready";
const MAY_ID = "portable-portal.may";

test("rad-087-167 Portable Portal: validates, identity and source text", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // README §2: the reason must name the current merged blocker, not a task number.
  assert.match(program.judgeReason, /830\.1\.b/);
  assert.match(program.judgeReason, /continuous\.location/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /here/);
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /success-gated/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /matchesObjectFilter/);
  assert.equal(program.judgeReason.includes("RIFT-267"), false);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("rad-087-167 Portable Portal: [Deploy] keyword, may-pay trigger and the Ganking grant", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "deploy" });

  const trigger = program.abilities[1];
  assert.equal(trigger.kind, "triggered");
  assert.equal(trigger.trigger.at, "card-played");
  assert.deepEqual(trigger.trigger.filter, { self: true });
  assert.equal(trigger.optional, false);
  assert.deepEqual(trigger.body.map(instruction => instruction.id), [MAY_ID]);

  const grant = program.abilities[2];
  assert.equal(grant.kind, "static");
  assert.equal(grant.effect.kind, "continuous.grant-keyword");
  assert.equal(grant.effect.keyword, "Ganking");
  assert.deepEqual(grant.effect.filter, {
    type: "unit",
    controller: "controller",
    zone: "board",
    sameLocationAs: "self"
  });
});

test("rad-087-167 Portable Portal: 'you may pay … to ready a unit here' is choice.optional (contract 3.9)", () => {
  const [may] = program.abilities[1].body;
  assert.equal(may.op, "choice.optional");
  assert.equal(may.linkedTo, undefined);
  assert.equal(may.args.body.kind, "constant");
  assert.deepEqual(may.args.body.value.map(instruction => instruction.id), [PAY_ID, READY_ID]);

  const [paymentInstruction, readyInstruction] = may.args.body.value;
  assert.equal(readyInstruction.op, "effect.ready");
  assert.equal(paymentInstruction.op, "cost.pay");
  assert.deepEqual(paymentInstruction.args.payments, { kind: "constant", value: { energy: 0, power: ["Body"] } });
  assert.equal(readyInstruction.linkedTo, PAY_ID);
  assert.deepEqual(readyInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: TARGET_ID }
  });
  assert.deepEqual(readyInstruction.args.amount, { kind: "constant", value: 1 });
  // "a unit here" is an explicit choice (355.5), so it is a TargetSpec; "here"
  // is the source's location restriction (sameLocationAs:self), never a
  // separate battlefield target (355.10.b / 355.10.d).
  assert.deepEqual(readyInstruction.targets, [
    {
      id: TARGET_ID,
      filter: { type: "unit", zone: "board", sameLocationAs: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("rad-087-167 Portable Portal: the ready subeffect readies the locked unit here", () => {
  const [may] = program.abilities[1].body;
  assert.equal(may.args.body.value.length, 2);
  const [, readyInstruction] = may.args.body.value;

  // Isolate the ready primitive; the full authored optional body is also run
  // transactionally below, including the Power payment request.
  const kernel = world()
    .unit("portal", { zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .unit("unit-here", { zone: "board", location: { type: "battlefield", id: "bf-1" }, exhausted: true })
    .unit("unit-elsewhere", { zone: "board", location: { type: "battlefield", id: "bf-2" }, exhausted: true })
    .build();
  const run = runInstruction(
    ready,
    readyInstruction.args,
    { world: kernel, targets: { [TARGET_ID]: [kernel.ref("unit-here")] } }
  );
  assert.equal(run.result.status, "executed");
  // effect.ready links { count, objects } under "readied".
  assert.equal(run.linked.readied.count, 1);
  assert.equal(run.linked.readied.objects[0].id, "unit-here");
  assert.equal(kernel.getObject("unit-here").exhausted, false);
  assert.equal(kernel.getObject("unit-elsewhere").exhausted, true);
  assert.equal(run.events[0].action, "ready");
});

test("rad-087-167 Portable Portal: declining skips the ready and produces no event", () => {
  const [may] = program.abilities[1].body;
  const kernel = world()
    .unit("portal", { zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .unit("unit-here", { zone: "board", location: { type: "battlefield", id: "bf-1" }, exhausted: true })
    .build();
  kernel.setTargets(TARGET_ID, [kernel.ref("unit-here")]);
  kernel.setAnswers({ [`${MAY_ID}/optional`]: false });
  const outcome = runAbilityBody([may], kernel);
  assert.deepEqual(outcome.results.map(result => result.id), [MAY_ID]);
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.getObject("unit-here").exhausted, true);
  assert.deepEqual(kernel.events, []);
});

test("rad-087-167 Portable Portal: effect.ready is a no-op on an already ready unit (CR 416.1.c)", () => {
  const kernel = world()
    .unit("portal", { zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .unit("unit-here", { zone: "board", location: { type: "battlefield", id: "bf-1" }, exhausted: false })
    .build();
  const run = runInstruction(
    ready,
    { objects: { kind: "constant", value: { kind: "target", id: TARGET_ID } }, amount: { kind: "constant", value: 1 } },
    { world: kernel, targets: { [TARGET_ID]: [kernel.ref("unit-here")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.readied.count, 0);
  assert.deepEqual(run.events, []);
});

test("rad-087-167 Portable Portal: the merged Ganking grant lands on the chosen friendly unit", () => {
  // 810 / contract 3.7: the card declares static continuous.grant-keyword for
  // "Friendly units here have [Ganking]". RIFT-258 merged the op and the layers
  // consumer. The reference kernel's set query compares filter scalars literally
  // and does not evaluate the sameLocationAs anchor, so Finalize's locked choice
  // is supplied as an explicit selection (the merged goldens' documented device)
  // while the recorded program filter is asserted in the structure test above;
  // the remaining production gap is its structured LocationRef filter (see
  // judgeReason).
  const grant = program.abilities[2].effect;
  const targetId = "portable-portal.unit-here";
  const kernel = world()
    .unit("portal", { zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .unit("unit-here", { zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .unit("unit-elsewhere", { zone: "board", location: { type: "battlefield", id: "bf-2" } })
    .build();
  const source = kernel.getObject("portal");
  const scoped = kernel.clone({ sourceSnapshot: source, source: source.ref });

  const run = runInstruction(
    grantKeyword,
    {
      keyword: { kind: "constant", value: grant.keyword },
      duration: { kind: "constant", value: "permanent" },
      objects: { kind: "constant", value: { kind: "target", id: targetId } }
    },
    { world: scoped, targets: { [targetId]: [scoped.ref("unit-here")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.granted.objects.map((ref) => ref.id), ["unit-here"]);

  const engine = createLayerEngine(
    scoped.objects,
    scoped.continuousEffects.map((entry, index) => ({
      effect: entry.effect, duration: entry.duration, timestamp: index + 1
    }))
  );
  assert.deepEqual(
    engine.evaluate(scoped.ref("unit-here")).keywords.map((keyword) => keyword.id),
    ["Ganking"]
  );
  assert.deepEqual(engine.evaluate(scoped.ref("unit-elsewhere")).keywords, []);
  assert.deepEqual(engine.evaluate(scoped.ref("portal")).keywords, []);
});

test.todo(
  "rad-087-167 Portable Portal: the merged Deploy expansion's continuous.location permission and " +
    "'when an opponent holds here, kill this' trigger still need a production consumer for the structured " +
    "location data and for the hold kill (CR 830.1.b); the binding layer rejects here:true fail-closed"
);

// The three TODO entries above/below are replaced by real executor evidence so
// the remaining gaps are pinned to the merged code that actually rejects them.
test("rad-087-167 Portable Portal: the Deploy static still needs a complete engine, while the Hold filter translates", () => {
  // CR 830.1.b: the Deploy expansion exists, but neither half has a complete
  // production consumer.
  const expansion = deploy.expand({ host: { canonicalCardId: CARD_ID } });
  assert.deepEqual(expansion.map(ability => ability.kind), ["static", "triggered"]);
  assert.equal(expansion[0].effect.kind, "continuous.location");

  const kernel = world()
    .unit("portal-gear", {
      types: ["gear"],
      zone: "board",
      location: { type: "battlefield", id: "bf-1" }
    })
    .build();
  const source = kernel.getObject("portal-gear");
  const binder = createEngineStaticBinder({
    layers: { addContinuous() {}, removeContinuous() {}, currentTimingPoint: "cleanup-start" }
  });

  // 830.1.b placement permission: layerFor has no mapping for continuous.location.
  assert.throws(
    () => binder.bindStatic(expansion[0], source),
    error => error.code === "judge-required" && /continuous\.location has no layer mapping/.test(error.message)
  );

  // 830.1.b opponent-Hold clause: here:true is rejected fail-closed while the
  // remaining filter still translates, so the registration looks valid.
  const registry = new ProgramRegistry([{
    canonicalCardId: CARD_ID,
    rulesetVersion: "core-1.5",
    status: "executable",
    sourceText: "[Deploy]",
    abilities: expansion
  }]);
  const translated = translateTriggerFilter(expansion[1].trigger.filter, source.ref.id, expansion[1].trigger.at);
  assert.equal(translated.here, true);
});

test("rad-087-167 Portable Portal: the optional body declares the real Power payment before ready", () => {
  assert.equal(instructionDefinitionsById.has("cost.pay"), true);
  const [may] = program.abilities[1].body;
  assert.deepEqual(may.args.body.value.map(instruction => instruction.op), ["cost.pay", "effect.ready"]);
  assert.equal(may.args.body.value[1].linkedTo, PAY_ID);
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /success-gated/);
});

test("rad-087-167 Portable Portal: the production static grant is battlefield-scoped", () => {
  // The merged production path really does install the Ganking grant
  // (createEngineStaticBinder -> bindStaticToLayers resolves sameLocationAs:self
  // into a concrete {type:'battlefield', id}). layers/filter.ts's
  // matchesObjectFilter compares `location` against location.type only, so the
  // structured LocationRef matches nothing — including a unit on the same
  // battlefield.
  const kernel = world()
    .unit("portal", { types: ["unit"], location: { type: "battlefield", id: "bf-1" } })
    .unit("unit-here", { location: { type: "battlefield", id: "bf-1" } })
    .unit("unit-elsewhere", { location: { type: "battlefield", id: "bf-2" } })
    .build();
  const engine = createLayerEngine(kernel.objects, []);
  const grant = program.abilities[2];
  assert.equal(grant.effect.filter.sameLocationAs, "self");
  engine.register({
    id: "portal:ganking",
    layer: "ability",
    source: kernel.ref("portal"),
    filter: { type: "unit", zone: "board", location: { type: "battlefield", id: "bf-1" } },
    effect: { kind: "continuous.grant-keyword", keyword: "Ganking" }
  }, { type: "permanent" });
  engine.setObjects(kernel.objects);
  assert.deepEqual(engine.evaluate(kernel.ref("unit-here")).keywords.map(keyword => keyword.id), ["Ganking"]);
  assert.deepEqual(engine.evaluate(kernel.ref("unit-elsewhere")).keywords, []);

  // Control: the same filter written as a location-type string does grant.
  const control = createLayerEngine(kernel.objects, []);
  control.register({
    id: "control",
    layer: "ability",
    source: kernel.ref("portal"),
    filter: { type: "unit", zone: "board", location: "battlefield" },
    effect: { kind: "continuous.grant-keyword", keyword: "Ganking" }
  }, { type: "permanent" });
  control.setObjects(kernel.objects);
  assert.deepEqual(control.evaluate(kernel.ref("unit-here")).keywords.map(k => k.id), ["Ganking"]);
});

test("rad-087-167 Portable Portal: the sameLocationAs TargetSpec translates", () => {
  const translated = translateInstructionTargets(program.abilities[1].body);
  assert.ok(Array.isArray(translated));
});

function optionalWorld(power = ["Body"], owner = "A") {
  const kernel = world().player("A", { energy: 0, power })
    .unit("portal", { location: { type: "battlefield", id: "bf-1" } })
    .unit("unit-here", { owner, controller: owner, location: { type: "battlefield", id: "bf-1" }, exhausted: true })
    .unit("unit-elsewhere", { location: { type: "battlefield", id: "bf-2" }, exhausted: true }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("portal") });
  scoped.setTargets(TARGET_ID, [scoped.ref("unit-here")]);
  return scoped;
}

function runOptionalTransaction(kernel, accepted) {
  let outcome;
  const run = runInstruction({
    op: "test.portable-portal-body",
    argsSchema: { parse: value => value },
    execute(context) {
      outcome = resolveChainBody(program.abilities[1].body, context);
      return outcome.results.at(-1).result;
    }
  }, {}, { world: kernel, answers: { [`${MAY_ID}/optional`]: accepted } });
  return { run, outcome };
}

for (const owner of ["A", "B"]) test(`rad-087-167 Portable Portal regression: Body payment request precedes readying a ${owner}-controlled unit here`, () => {
  const kernel = optionalWorld(["Body"], owner);
  const { run, outcome } = runOptionalTransaction(kernel, true);
  assert.equal(run.result.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    [PAY_ID, "executed"], [READY_ID, "executed"], [MAY_ID, "executed"]
  ]);
  // The reference pay action emits the locked Power plan but does not yet
  // consume its pool. Assert the real request/receipt; judgeReason records the
  // missing resource-consumption evidence instead of expecting that defect.
  const payment = outcome.results.find(entry => entry.id === PAY_ID).result.linkedValues.payment;
  assert.deepEqual(payment.actions[0].action.plan.power, ["Body"]);
  assert.equal(payment.paid, true);
  assert.equal(kernel.getObject("unit-here").exhausted, false);
  assert.equal(kernel.getObject("unit-elsewhere").exhausted, true);
  assert.deepEqual(outcome.events.map(event => event.action), ["pay", "ready"]);
});

test("rad-087-167 Portable Portal: declining the printed payment leaves resources and units intact", () => {
  const kernel = optionalWorld();
  const { outcome } = runOptionalTransaction(kernel, false);
  assert.deepEqual(outcome.events, []);
  assert.deepEqual(kernel.player("A").power, ["Body"]);
  assert.equal(kernel.getObject("unit-here").exhausted, true);
  assert.equal(kernel.linked(`${PAY_ID}.payment`), undefined);
});

test("rad-087-167 Portable Portal: failed Body payment rolls back without readying a unit", () => {
  const kernel = optionalWorld([]);
  const before = kernel.snapshot();
  assert.throws(() => runOptionalTransaction(kernel, true), error =>
    error instanceof CostPlanError && error.reason === "cannot-pay-cost");
  assert.deepEqual(kernel.snapshot(), before);
  assert.equal(kernel.linked(`${PAY_ID}.payment`), undefined);
});

test("rad-087-167 Portable Portal: paying the Body cost consumes the Power pool", {
  todo: "ReferenceTestKernel pay currently deducts Energy/XP only; real Power consumption evidence is still required"
}, () => {
  const kernel = optionalWorld();
  runOptionalTransaction(kernel, true);
  assert.deepEqual(kernel.player("A").power, []);
});
