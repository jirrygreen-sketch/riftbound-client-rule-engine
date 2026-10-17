import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/heartening-soul.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import grantKeyword from "../../../../engine-core/dist/effects/instructions/continuous.grant-keyword.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL = "card.hash-b955ee21fd32d4a00aae0761a6d7f8f66eb03094edf676a34c3e87639045aae1";
const SOURCE_TEXT =
  "When you play me, ready a friendly legend.\n" +
  "Friendly legends have \":rb_exhaust:: Give a unit +3 :rb_might: this turn.\"";

const [readyTrigger, grantStatic] = program.abilities;
const [readyInstruction] = readyTrigger.body;
const grantedBody = grantStatic.effect.ability.body;
const [grantedInstruction] = grantedBody;

/** Strip instruction-level TargetSpecs: Finalize locks those in production. */
const executableBody = readyTrigger.body.map(({ targets, ...rest }) => rest);

test("rad-040-167 Heartening Soul: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-040-167 Heartening Soul: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.grant-ability/);
  assert.match(program.judgeReason, /Legend Zone|ZoneId/);
  // Second-sweep refresh: the reason names the currently unregistered op and the
  // layer-mapping failure, not a merely unbound shape.
  assert.match(program.judgeReason, /instructionDefinitionsById/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-040-167 Heartening Soul gap: no merged op can carry a whole activated ability (801.3.a / 135.4.b)", () => {
  // continuous.grant-ability is not a registered instruction op...
  assert.equal(instructionDefinitionsById.has("continuous.grant-ability"), false);
  // ...and the production static binder rejects the kind it would need a layer for.
  const f = fixture({ cards: [{ id: "src", cardId: CANONICAL, types: ["unit"], might: 7, zone: "board" }] });
  const binder = createEngineStaticBinder(f.engine);
  assert.throws(
    () => binder.bindStatic(grantStatic, f.kernel.getObject("src")),
    /continuous\.grant-ability has no layer mapping/
  );
  assert.deepEqual(f.engine.layers.registry.list(), []);
});

test("rad-040-167 Heartening Soul gap: keyword grants cannot carry the granted activated ability", () => {
  // The merged keyword-grant primitive is a real op, but its argument surface is
  // keyword/value only: an `ability` argument is rejected by its argsSchema, so
  // it cannot install the printed "[E]: give a unit +3 Might this turn" body.
  assert.equal(instructionDefinitionsById.has("continuous.grant-keyword"), true);
  assert.throws(
    () => grantKeyword.argsSchema.parse({
      objects: { kind: "constant", value: "self" },
      ability: grantStatic.effect.ability
    }),
    /Invalid continuous\.grant-keyword argument: ability/
  );
});

test("rad-040-167 Heartening Soul gap: a Legend Zone target cannot be selected (355.9.a.4)", () => {
  // The engine's closed ZoneId has no legend member, and the layer filter matches
  // no object for `zone: "legend"`, so the card's required target has no legal
  // candidate. The zone literal below is data asserted by this test, not an IR
  // change; the card keeps the target shape until the contract carries the zone.
  const kernel = world().unit("legend", { types: ["legend"], controller: "A", zone: "board" }).build();
  assert.equal(matchesObjectFilter({ zone: "legend" }, kernel.getObject("legend")), false);
  assert.deepEqual(kernel.query({ type: "legend", zone: "legend" }), []);
  assert.equal(kernel.objects.some((object) => object.zone === "legend"), false);
});

test("rad-040-167 Heartening Soul: play trigger readies one friendly legend (CR 355.9.a.4 / 416.1)", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(readyTrigger.kind, "triggered");
  assert.equal(readyTrigger.trigger.at, "card-played");
  assert.deepEqual(readyTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self", player: "controller" }
  });
  assert.equal(readyTrigger.optional, false);
  assert.equal(readyTrigger.body.length, 1);
  assert.equal(readyInstruction.id, "heartening-soul.ready-legend");
  assert.equal(readyInstruction.op, "effect.ready");
  assert.deepEqual(readyInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "heartening-soul.friendly-legend" }
  });
  assert.deepEqual(readyInstruction.targets, [
    {
      id: "heartening-soul.friendly-legend",
      filter: { type: "legend", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(readyInstruction.linkedTo, undefined);
});

test("rad-040-167 Heartening Soul: the granted legend ability is an exhaust-cost +3 Might this turn", () => {
  assert.equal(grantStatic.kind, "static");
  assert.equal(grantStatic.effect.kind, "continuous.grant-ability");
  assert.deepEqual(grantStatic.effect.filter, { type: "legend", controller: "controller" });

  const granted = grantStatic.effect.ability;
  assert.equal(granted.kind, "activated");
  assert.equal(granted.timing, "action");
  assert.deepEqual(granted.cost, { payments: [{ kind: "exhaust" }] });
  assert.equal(grantedBody.length, 1);
  // The granted body now uses the merged layers arithmetic op with the printed
  // "this turn" duration (143.2.a / 317.2.c), never a Buff counter (702).
  assert.equal(grantedInstruction.op, "continuous.might");
  assert.deepEqual(grantedInstruction.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(grantedInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(grantedInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "heartening-soul.granted.unit" }
  });
  assert.deepEqual(grantedInstruction.targets, [
    {
      id: "heartening-soul.granted.unit",
      filter: { type: "unit", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("rad-040-167 Heartening Soul golden: the ready instruction readies an exhausted friendly legend", () => {
  const kernel = world()
    .unit("legend", { types: ["legend"], exhausted: true, zone: "board", location: { type: "base", player: "A" } })
    .build();
  kernel.setTargets("heartening-soul.friendly-legend", [kernel.ref("legend")]);

  const outcome = runAbilityBody(executableBody, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [["heartening-soul.ready-legend", "executed"]]
  );
  assert.equal(kernel.getObject("legend").exhausted, false);
  assert.deepEqual(outcome.events.map((event) => event.action), ["ready"]);
});

test("rad-040-167 Heartening Soul golden: a stale legend target is ignored (CR 359.3.e.7)", () => {
  const kernel = world()
    .unit("legend", { types: ["legend"], exhausted: true, zone: "board", location: { type: "base", player: "A" } })
    .build();
  const stale = kernel.ref("legend");
  assert.equal(kernel.perform({ type: "move-zone", object: stale, to: "trash" }).status, "done");
  kernel.setTargets("heartening-soul.friendly-legend", [stale]);

  const outcome = runAbilityBody(executableBody, kernel);

  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.deepEqual(outcome.events, []);
});

test("rad-040-167 Heartening Soul golden: the granted +3 Might this turn really applies through the layers engine", () => {
  // The granted body is the shape every friendly legend receives once
  // continuous.grant-ability can carry it; bind the target exactly as Finalize
  // would and run the body through the chain interpreter adapter.
  const base = world()
    .unit("legend", { owner: "A", types: ["legend"] })
    .unit("unit", { owner: "A", controller: "A", might: 2 })
    .build();
  const kernel = base.clone({
    sourceSnapshot: base.getObject("legend"),
    targets: new Map([["heartening-soul.granted.unit", [base.ref("unit")]]])
  });

  const outcome = resolveChainBody(grantedBody, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [["heartening-soul.granted.give-might", "executed"]]
  );
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 3);
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  // 143.2.a Effective Might: 2 + 3 = 5 while the granted ability's effect lasts;
  // 317.2.c: the end-of-turn cleanup restores 2.
  const layers = createLayerEngine(kernel.objects, [{ ...registration, timestamp: 1 }]);
  assert.equal(layers.evaluate(kernel.ref("unit")).might, 5);
  layers.advance({ id: "turn-end" });
  assert.equal(layers.evaluate(kernel.ref("unit")).might, 2);
});

test.todo(
  "rad-040-167 Heartening Soul: attach the whole activated ability (its [E] cost and duration) to " +
    "every friendly legend — CR 801.3.a / 135.4.b needs a registered continuous.grant-ability " +
    "instruction plus a programs/statics layer mapping that carries a complete activated Ability, " +
    "including its [E] cost and duration"
);
test.todo(
  "rad-040-167 Heartening Soul: target legality for a legend in the Legend Zone (CR 355.9.a.4) needs " +
    "a current ZoneId/target contract that includes the Legend Zone; the engine's closed ZoneId has no " +
    "legend member and { zone: \"legend\" } matches no object today"
);
test.todo(
  "rad-040-167 Heartening Soul: once complete Ability grants and Legend Zone targets are bound, use the " +
    "CardProgram lifecycle to register the static grant and card-played trigger, then activate the granted exhaust-cost ability"
);
