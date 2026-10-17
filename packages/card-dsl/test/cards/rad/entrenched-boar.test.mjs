import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/entrenched-boar.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { EventPipeline } from "../../../../engine-core/dist/events/pipeline.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { restrictions } from "../../../../engine-core/dist/layers/rules/query.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import restrict from "../../../../engine-core/dist/effects/instructions/continuous.restrict.js";
import { duelWorld, mainTiming, readinessFor, moveDuelUnitsStandard } from "../../../../engine-core/test/rules/movement/support.mjs";

const CANONICAL =
  "card.hash-83b3503583d3b1c2a4c954330e33aa17c188c4a97ab757da916900476485a9f4";
const SOURCE_TEXT = "You may have me enter ready. If you do, I can't move this turn.";

const [replacement] = program.abilities;
const [optional] = replacement.with;
const [enterReady, cannotMove] = optional.args.body.value;

/**
 * The card's own declared replacement.enter form, expressed with the entry
 * rewrite spelled out (the raw card body wraps it in choice.optional, which the
 * planner deliberately rejects: see the TODO test at the end).
 */
const entryRewrite = (state) => ({
  replaces: replacement.replaces,
  with: [
    {
      id: "entrenched-boar.enter-ready",
      op: "replacement.enter",
      args: { state: { kind: "constant", value: state } }
    }
  ]
});

/** Reference kernel + the merged event pipeline; every execution is real. */
function scene() {
  const kernel = world()
    .player("A")
    .player("B")
    .hand("boar", { types: ["unit"], might: 2 })
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

/**
 * The permanent play sequence the production ChainEngine performs when a Unit
 * resolves (src/chain/engine.ts: resolve -> entry state action -> entry move).
 * The test drives exactly those pipeline commits; it never edits zones by hand.
 */
function enterBoard(kernel, pipeline, id, location) {
  kernel.perform({ type: "move-zone", object: kernel.ref(id), to: "chain" });
  kernel.perform({ type: "exhaust", object: kernel.ref(id) });
  return pipeline.commit({ type: "move-zone", object: kernel.ref(id), to: location.type, location });
}

test("rad-026-167 Entrenched Boar: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-026-167 Entrenched Boar: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // README §2: the reason names each remaining semantic and its owner task.
  assert.match(program.judgeReason, /optional/);
  assert.match(program.judgeReason, /replacement\.event/);
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /RIFT-359/);
  // The merged entry replacement must no longer be reported as unmerged.
  assert.doesNotMatch(program.judgeReason, /replacement\.enter 家族/);
  assert.doesNotMatch(program.judgeReason, /RIFT-91/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-026-167 Entrenched Boar: one self-entry replacement wrapping the optional ready entry", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(replacement.kind, "replacement");
  // CR 369.3 / 359.2.c: the replaced event is this unit entering (exhausted by
  // default, 143.4).
  assert.deepEqual(replacement.replaces, {
    event: "object-enters-board",
    filter: { source: "self" }
  });
  // Contract 3.9: "may" is a choice.optional wrapping the chosen instructions.
  assert.equal(replacement.with.length, 1);
  assert.equal(optional.op, "choice.optional");
  assert.equal(optional.args.body.kind, "constant");
  // The entry rewrite is the RIFT-260 replacement.enter declaration form, not a
  // post-entry effect.ready (which would fire a "becomes ready" event).
  assert.equal(enterReady.op, "replacement.enter");
  assert.deepEqual(enterReady.args.state, { kind: "constant", value: "ready" });
  assert.deepEqual(enterReady.args.zone, { kind: "constant", value: "board" });
});

test("rad-026-167 Entrenched Boar: 'I can't move this turn' is linked to the accepted entry rewrite", () => {
  // CR 054 (Can't beats Can) + 144.1/144.2 (Standard Move) + 317.2.c (expiry).
  assert.equal(cannotMove.op, "continuous.restrict");
  assert.deepEqual(cannotMove.args.restriction, {
    kind: "constant",
    value: "cannot-move"
  });
  // "this turn" is the alias the merged op resolves to the end-of-turn duration.
  assert.deepEqual(cannotMove.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(cannotMove.args.appliesTo, {
    kind: "object-property",
    object: "self",
    property: "ref"
  });
  // The restriction is conditioned on the accepted choice: it is inside the
  // optional body and linked to the entry rewrite it depends on.
  assert.equal(cannotMove.linkedTo, "entrenched-boar.enter-ready");
});

test("rad-026-167 Entrenched Boar: the declared entry rewrite really lands a ready permanent (CR 369.3 / 805.6)", () => {
  const { kernel, host, pipeline } = scene();
  bindReplacement(entryRewrite("ready"), kernel.ref("boar"), { host, pipeline });

  const outcome = enterBoard(kernel, pipeline, "boar", { type: "base", player: "A" });

  // The rewrite is carried into the entry move, so the permanent lands ready
  // and the pipeline reports the substitution.
  assert.equal(outcome.status, "replaced");
  assert.equal(kernel.getObject("boar").zone, "board");
  assert.equal(kernel.getObject("boar").exhausted, false);
  // 805.6.a: the orientation was rewritten at entry, so no separate
  // "becomes ready" timing was produced.
  assert.equal(
    pipeline.events.some(event => event.timingPoint === "object-readied"),
    false
  );
});

test("rad-026-167 Entrenched Boar: the declared exhausted form would keep the default entry", () => {
  // Same declared opcode with state "exhausted": proves the category really is
  // the entry rewrite (and that the golden above is not passing by accident).
  const { kernel, host, pipeline } = scene();
  bindReplacement(entryRewrite("exhausted"), kernel.ref("boar"), { host, pipeline });

  const outcome = enterBoard(kernel, pipeline, "boar", { type: "base", player: "A" });

  assert.equal(outcome.status, "replaced");
  assert.equal(kernel.getObject("boar").zone, "board");
  assert.equal(kernel.getObject("boar").exhausted, true);
});

test("rad-026-167 Entrenched Boar: the rewrite is self-scoped and leaves other permanents alone", () => {
  const { kernel, host, pipeline } = scene();
  bindReplacement(entryRewrite("ready"), kernel.ref("boar"), { host, pipeline });
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

  // CR 370.1.b: the replaced event is this unit's entry only, so the other
  // permanent enters exhausted (143.4).
  assert.equal(outcome.status, "done");
  assert.equal(kernel.getObject(bystander.ref.id).exhausted, true);
  assert.equal(kernel.getObject("boar").zone, "hand");
});

test("rad-026-167 Entrenched Boar: the movement prohibition registers a real ability-layer restriction", () => {
  const kernel = world().unit("boar", { might: 2 }).build();
  const scoped = kernel.clone({
    source: kernel.ref("boar"),
    sourceSnapshot: kernel.getObject("boar")
  });

  const run = runInstruction(restrict, cannotMove.args, { world: scoped });

  assert.equal(run.result.status, "executed");
  const [registered] = scoped.snapshot().continuous;
  assert.equal(registered.effect.layer, "ability");
  assert.equal(registered.effect.effect.kind, "restriction");
  assert.equal(registered.effect.effect.restriction, "cannot-move");
  assert.deepEqual(registered.effect.filter, scoped.ref("boar"));
  // CR 317.2.c: "this turn" becomes the end-of-turn duration the layers cleanup
  // expires in one batch.
  assert.deepEqual(registered.duration, { type: "end-of-turn" });

  // The merged rule query really reads the prohibition back (layers/rules).
  const registry = new ContinuousEffectRegistry();
  for (const entry of scoped.snapshot().continuous) registry.register(entry.effect, entry.duration);
  const readable = restrictions(registry, "move", kernel.ref("boar"), kernel.getObject("boar"), "A");
  assert.equal(readable.length, 1);
  assert.equal(readable[0].name, "cannot-move");
  assert.deepEqual(readable[0].filter, scoped.ref("boar"));
});

test.todo('Entrenched Boar: atomic optional entry replacement plus new-incarnation movement restriction registration (CR 368.1/369.3/317.2.c; RIFT-359)');

test("Entrenched Boar: its declared prohibition blocks only this unit's Standard Move and expires at turn end", () => {
  const scene = duelWorld();
  const board = scene.place(scene.place(scene.board, "boar", "A", scene.baseA), "ally", "A", scene.baseA);
  const kernel = world().base("boar", { might: 2 }).base("ally", { might: 2 }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("boar") });
  const run = runInstruction(restrict, cannotMove.args, { world: scoped });
  assert.equal(run.result.status, "executed");
  const registry = new ContinuousEffectRegistry();
  for (const entry of scoped.continuousEffects) registry.register(entry.effect, entry.duration);
  const rules = {
    registry,
    refForUnit: unit => scoped.ref(unit.objectId),
    objectForUnit: unit => scoped.getObject(unit.objectId),
  };
  const readiness = readinessFor(board);
  const request = id => ({ actor: "A", unitUIDs: [id], destinationLocationId: scene.bf1, timing: mainTiming("A") });
  assert.throws(() => moveDuelUnitsStandard(board, readiness, request("boar"), rules), /prohibited from moving/);
  const allyMove = moveDuelUnitsStandard(board, readiness, request("ally"), rules);
  assert.equal(allyMove.board.units.find(unit => unit.objectId === "ally").locationId, scene.bf1);
  registry.expireAt({ id: "turn-end", player: "A" }, ref => scoped.object(ref));
  const boarMove = moveDuelUnitsStandard(board, readiness, request("boar"), rules);
  assert.equal(boarMove.board.units.find(unit => unit.objectId === "boar").locationId, scene.bf1);
});
