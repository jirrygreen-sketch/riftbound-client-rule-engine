
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/firebrand-raider.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { EventPipeline } from "../../../../engine-core/dist/events/pipeline.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { restrictions } from "../../../../engine-core/dist/layers/rules/query.js";

const CANONICAL =
  "card.hash-f4847d9fdb97d7ccf7a9d4a296e64e63e5d8c219daa10d1016d79ae12591dc77";
const SOURCE_TEXT =
  "I enter ready.\nWhen you play me, ready all enemy units.\nOther units enter ready.\n" +
  "Units don't ready during the Awaken Phase.";

const ENTER_READY = "firebrand-raider.enter-ready";
const READY_ENEMIES = "firebrand-raider.ready-enemy-units";
const OTHERS_ENTER_READY = "firebrand-raider.others-enter-ready";

const [selfReady, trigger, othersReady, restriction] = program.abilities;

function scene() {
  const kernel = world()
    .player("A")
    .player("B")
    .hand("firebrand-raider", { types: ["unit"], might: 6 })
    .build();
  const decide = () => {
    throw new Error("unexpected choice");
  };
  const pipelineHost = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => {
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose: decide }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const host = {
    object: ref => kernel.object(ref),
    objects: () => kernel.objects,
    context: (source, controller) =>
      bindResolveContext(kernel, {
        source,
        controller,
        timingPoint: "object-enters-board",
        choose: decide
      })
  };
  return { kernel, host, pipeline: new EventPipeline(pipelineHost, ["A", "B"], "A") };
}

test("rad-019-167 Firebrand Raider: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /turn\/flow\.ts/);
  assert.match(program.judgeReason, /during: awaken-phase/);
  // The merged entry replacement must not still be described as unmerged.
  assert.doesNotMatch(program.judgeReason, /replacement\.enter 管线未合入/);
});

test("rad-019-167: enter-ready replacements, ready-all-enemies trigger and Awaken restriction", () => {
  assert.equal(program.abilities.length, 4);

  assert.equal(selfReady.kind, "replacement");
  assert.deepEqual(selfReady.replaces, {
    event: "object-enters-board",
    filter: { source: "self", exhausted: true }
  });
  assert.equal(selfReady.with[0].id, ENTER_READY);
  assert.equal(selfReady.with[0].op, "effect.ready");
  // RIFT-260's entry-orientation form: a single self-targeted effect.ready.
  assert.deepEqual(selfReady.with[0].args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });

  assert.equal(trigger.kind, "triggered");
  assert.equal(trigger.trigger.at, "card-played");
  assert.deepEqual(trigger.trigger.filter, { self: true });
  assert.equal(trigger.optional, false);
  assert.equal(trigger.body.length, 1);
  const [readyInstruction] = trigger.body;
  assert.equal(readyInstruction.id, READY_ENEMIES);
  assert.equal(readyInstruction.op, "effect.ready");
  // "all enemy units" = 非目标集合（355.10.d），不是 TargetSpec。
  assert.equal(readyInstruction.targets, undefined);
  assert.deepEqual(readyInstruction.args.objects, {
    kind: "constant",
    value: {
      kind: "query",
      filter: { zone: "board", type: "unit", controller: "opponent" }
    }
  });

  assert.equal(othersReady.kind, "replacement");
  assert.deepEqual(othersReady.replaces, {
    event: "object-enters-board",
    filter: { type: "unit", other: true, exhausted: true }
  });
  assert.equal(othersReady.with[0].id, OTHERS_ENTER_READY);
  // "Other units enter ready" must name the replaced event's object, which only
  // the replacement.object link provides; the static replaces form cannot bind it.
  assert.deepEqual(othersReady.with[0].args, {
    objects: { kind: "constant", value: { kind: "linked", key: "replacement.object" } }
  });

  assert.equal(restriction.kind, "static");
  assert.equal(restriction.effect.kind, "continuous.restrict");
  assert.equal(restriction.effect.mode, "prevent");
  assert.equal(restriction.effect.event, "ready");
  assert.equal(restriction.effect.during, "awaken-phase");
  assert.deepEqual(restriction.effect.filter, { zone: "board", type: "unit" });
});

test("rad-019-167 golden: 'I enter ready' really rewrites the entry to ready (143.4 / 369.3)", () => {
  const { kernel, host, pipeline } = scene();
  // Binding the card's own declared replaces pattern and body; the test supplies
  // no semantics of its own.
  bindReplacement(
    { replaces: selfReady.replaces, with: selfReady.with },
    kernel.ref("firebrand-raider"),
    { host, pipeline }
  );

  kernel.perform({ type: "move-zone", object: kernel.ref("firebrand-raider"), to: "chain" });
  assert.equal(kernel.getObject("firebrand-raider").zone, "chain");
  // The chain lands the default exhausted entry orientation (359.2.c).
  kernel.perform({ type: "exhaust", object: kernel.ref("firebrand-raider") });
  assert.equal(kernel.getObject("firebrand-raider").exhausted, true);

  const outcome = pipeline.commit({
    type: "move-zone",
    object: kernel.ref("firebrand-raider"),
    to: "base",
    location: { type: "base", player: "A" }
  });

  assert.equal(outcome.status, "replaced");
  assert.equal(kernel.getObject("firebrand-raider").zone, "board");
  assert.equal(kernel.getObject("firebrand-raider").exhausted, false);
  // 805.6.a: the orientation was rewritten at entry, so no separate
  // "becomes ready" timing fired.
  assert.equal(
    pipeline.events.some(event => event.timingPoint === "object-readied"),
    false
  );
});

test("rad-019-167 golden: an unbound other unit keeps the default exhausted entry", () => {
  const { kernel, host, pipeline } = scene();
  bindReplacement(
    { replaces: selfReady.replaces, with: selfReady.with },
    kernel.ref("firebrand-raider"),
    { host, pipeline }
  );
  kernel.perform({
    type: "create-token",
    player: "B",
    to: "chain",
    token: { cardId: null, name: "Bystander", types: ["unit"], might: 3, energy: null, power: null, exhausted: true }
  });
  const bystander = kernel.objects.find(object => object.name === "Bystander");

  const outcome = pipeline.commit({
    type: "move-zone",
    object: bystander.ref,
    to: "base",
    location: { type: "base", player: "B" }
  });

  // The self-scoped declaration never applies to another unit's entry: the
  // "Other units enter ready" half has no merged binding (see judgeReason).
  assert.equal(outcome.status, "done");
  assert.equal(kernel.getObject(bystander.ref.id).exhausted, true);
});

test("rad-019-167: 'ready all enemy units' readies only opponents' units", () => {
  // 生产链上下文会把 controller: "opponent" 归一化（chain/engine.ts 的 query 覆盖）；
  // 这里用同一归一化规则的宿主验证指令语义，不手改 frame/zone/health。
  const kernel = world()
    .unit("enemy", { owner: "B", exhausted: true })
    .unit("mine", { exhausted: true })
    .player("B")
    .build();
  const raw = kernel.query.bind(kernel);
  kernel.query = filter => {
    const normalized = { ...filter };
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "opponent" || normalized[key] === "self") delete normalized[key];
    }
    const objects = raw(normalized);
    if (filter.controller === "opponent") return objects.filter(object => object.controller !== kernel.controller);
    if (filter.controller === "self") return objects.filter(object => object.controller === kernel.controller);
    return objects;
  };

  const outcome = resolveChainBody(trigger.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("enemy").exhausted, false);
  assert.equal(kernel.getObject("mine").exhausted, true);
  const link = outcome.linkedValues[READY_ENEMIES + ".readied"];
  assert.equal(link.count, 1);
  assert.deepEqual(link.objects, [{ id: "enemy", zoneEntryId: 1 }]);
});

test("rad-019-167: the Awaken prohibition is legal IR and readable by the rules query", () => {
  // Drive the declared shape through the merged rules query. The turn flow's
  // Awaken ready task still needs to consume this prohibition (todo below).
  const kernel = world().unit("unit", { exhausted: true }).build();
  const registry = new ContinuousEffectRegistry();
  registry.register(
    {
      id: "firebrand-raider.awaken",
      layer: "ability",
      source: kernel.ref("unit"),
      filter: restriction.effect.filter,
      effect: {
        kind: "restriction",
        actions: ["ready"],
        restriction: "awaken-phase"
      }
    },
    { type: "permanent" }
  );
  const listed = restrictions(registry, "ready", kernel.ref("unit"), kernel.getObject("unit"), "A");
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, "awaken-phase");
});

test.todo(
  "rad-019-167 Firebrand Raider: 'Other units enter ready' (365.1) needs a replacement body that can name the " +
    "replaced event's object; the binder only exposes replacement.object inside a replacement.event body, and " +
    "the IR cannot express that body's instead form (an instruction array)"
);
test.todo(
  "rad-019-167 Firebrand Raider: 'Units don't ready during the Awaken Phase' (315.1.b) must be consumed by the " +
    "Awaken ready flow through the registered continuous.restrict prohibition; the turn flow currently readies " +
    "every exhausted permanent without consulting the layers rules"
);

