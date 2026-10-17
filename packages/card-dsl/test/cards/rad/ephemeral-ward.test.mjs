
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/ephemeral-ward.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-9ec6311582c4337e549c7a39070aeaf28ae3996142538fa2fb11c3b16cebcf5b";
const SOURCE_TEXT = "Your units have +2 :rb_might:.\nWhen you play a unit, kill this.";

const [staticAbility, triggered] = program.abilities;
const [killInstruction] = triggered.body;

/** A Board snapshot shaped like the merged layer input. */
function unit(id, values = {}) {
  return {
    ref: { id, zoneEntryId: 1 },
    cardId: "card:" + id,
    name: id,
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "base", player: "A" },
    might: 2,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false,
    ...values
  };
}

test("rad-039-167 Ephemeral Ward: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-039-167 Ephemeral Ward: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-039-167 Ephemeral Ward: the +2 Might aura is a controller-scoped arithmetic static effect", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(staticAbility.kind, "static");
  assert.deepEqual(staticAbility.effect, {
    kind: "continuous.might",
    mode: "add",
    layer: "arithmetic",
    amount: { kind: "constant", value: 2 },
    filter: { type: "unit", controller: "controller", zone: "board" }
  });
  assert.equal(staticAbility.condition, undefined);
});

test("rad-039-167 Ephemeral Ward: the merged layers engine applies the declared +2 Might (CR 143.2.a / 475)", () => {
  // The merged registration path resolves the affected set and registers one
  // arithmetic spec per object (bindTarget/mergeFilter in
  // layers/rules/registration.ts produce exactly this object-scoped filter).
  // Driving the card's declared effect through the real LayerEngine proves the
  // arithmetic half itself executes: Might 2 -> 4, still clamped at 0.
  const mine = unit("mine");
  const spec = {
    id: "ephemeral-ward-aura",
    layer: staticAbility.effect.layer,
    source: { id: "ephemeral-ward", zoneEntryId: 1 },
    filter: { objectId: mine.ref.id, zone: "board" },
    effect: staticAbility.effect
  };
  const engine = createLayerEngine([mine], [{ effect: spec, duration: { type: "permanent" } }]);
  assert.equal(engine.evaluate(mine.ref).might, 4);

  const weakened = unit("weakened", { might: 1 });
  const clamped = createLayerEngine(
    [weakened],
    [{
      effect: { ...spec, filter: { objectId: weakened.ref.id, zone: "board" } },
      duration: { type: "permanent" }
    }, {
      effect: { id: "shrink", layer: "arithmetic", filter: { objectId: weakened.ref.id }, effect: { kind: "decrease", amount: { kind: "constant", value: 4 } } },
      duration: { type: "permanent" }
    }]
  );
  assert.equal(clamped.evaluate(weakened.ref).might, 0);
});

test("rad-039-167 Ephemeral Ward: card-played unit trigger kills the source itself", () => {
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    filter: { type: "unit", player: "controller" }
  });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 1);
  assert.equal(killInstruction.id, "ephemeral-ward.kill-this");
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args.self, { kind: "constant", value: true });
  assert.deepEqual(killInstruction.args.reason, { kind: "constant", value: "card-played-unit" });
  assert.equal(killInstruction.linkedTo, undefined);
});

test("rad-039-167 Ephemeral Ward golden: the kill-self body really moves the source to the trash (CR 429.1)", () => {
  const kernel = world()
    .unit("ephemeral-ward", { zone: "board", location: { type: "base", player: "A" }, might: 0 })
    .unit("watcher", { zone: "board", might: 2 })
    .build();
  const scoped = kernel.clone({
    source: kernel.ref("ephemeral-ward"),
    sourceSnapshot: kernel.getObject("ephemeral-ward")
  });

  const outcome = resolveChainBody(triggered.body, scoped);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [["ephemeral-ward.kill-this", "executed"]]
  );
  assert.equal(scoped.getObject("ephemeral-ward").zone, "trash");
  assert.equal(scoped.getObject("ephemeral-ward").location, null);
  assert.deepEqual(outcome.events.map((event) => event.action), ["kill"]);
});

test("rad-039-167 Ephemeral Ward golden: a replacement on the kill negates the instruction and leaves the ward on the board", () => {
  const kernel = world()
    .unit("ephemeral-ward", { zone: "board", location: { type: "base", player: "A" } })
    .build();
  const scoped = kernel.clone({
    source: kernel.ref("ephemeral-ward"),
    sourceSnapshot: kernel.getObject("ephemeral-ward")
  });
  scoped.addReplacement((action) => (action.type === "kill" ? "replaced" : null));

  const outcome = resolveChainBody(triggered.body, scoped);

  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "replaced");
  assert.equal(scoped.getObject("ephemeral-ward").zone, "board");
});

test.todo(
  "rad-039-167 Ephemeral Ward: register the declared static aura as a ContinuousEffectSpec so production " +
    "applies +2 Might (no merged path reads CardProgram static abilities; registerContinuousEffect has no " +
    "caller) — RIFT-257 card-program binding"
);

test.todo(
  "rad-039-167 Ephemeral Ward: resolve the declared aura's controller scope (\"Your units\") for an " +
    "arithmetic-layer spec — the card's controller anchor has no merged consumer that turns it into the " +
    "ability controller's units, so the affected set must be resolved by the RIFT-257 registration adapter"
);

