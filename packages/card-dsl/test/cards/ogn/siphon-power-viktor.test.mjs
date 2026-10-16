import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import siphonPower from "../../../dist/cards/ogn/siphon-power-viktor.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";

const CANONICAL = "card.hash-d619150ac39f656ea38c332ad3a03989be755c3114becae61bb346ae3996951d";
const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };
const ELSEWHERE = { type: "battlefield", id: "battlefield-2" };

const [keyword, play] = siphonPower.abilities;
const [friendlyInstruction, enemyInstruction] = play.body;

/**
 * chain/engine.ts resolves the static controller/owner spellings before it
 * calls the production matcher: 'self' becomes the ability controller and
 * 'opponent' excludes that player's objects. The reference kernel's own query
 * compares filter values literally, so the goldens go through the same
 * normalization the production chain applies (the merged switcheroo /
 * facebreaker goldens use this exact helper).
 */
const chainQuery = (kernel, controller) => (value) => {
  const normalized = { ...value };
  for (const key of ["controller", "owner"]) {
    if (normalized[key] === "self") normalized[key] = controller;
  }
  return kernel.query({}).filter((object) => {
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "opponent" && object[key] === controller) return false;
    }
    return matchesObjectFilter({
      ...normalized,
      ...(normalized.controller === "opponent" ? { controller: "any" } : {}),
      ...(normalized.owner === "opponent" ? { owner: "any" } : {})
    }, object);
  });
};

const chainContext = (kernel, controller) => new Proxy(kernel, {
  get(target, key) {
    if (key === "query") return chainQuery(target, controller);
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  }
});

/** Board including the chosen battlefield plus units on it and elsewhere. */
function siphonWorld() {
  const kernel = world()
    .unit("chosen-bf", { types: ["battlefield"], owner: "A", location: BATTLEFIELD })
    .unit("friendly-here", { owner: "A", controller: "A", might: 3, location: BATTLEFIELD })
    .unit("friendly-elsewhere", { owner: "A", controller: "A", might: 3, location: ELSEWHERE })
    .unit("enemy-here", { owner: "B", controller: "B", might: 3, location: BATTLEFIELD })
    .unit("enemy-weak-here", { owner: "B", controller: "B", might: 1, location: BATTLEFIELD })
    .unit("enemy-elsewhere", { owner: "B", controller: "B", might: 3, location: ELSEWHERE })
    .build();
  kernel.setTargets("chosen-battlefield", [kernel.ref("chosen-bf")]);
  return kernel;
}

const registrations = (kernel) => kernel.continuousEffects.map(entry => ({
  effect: entry.effect,
  duration: entry.duration,
  timestamp: 1
}));

const effectiveMight = (kernel, id) =>
  createLayerEngine(kernel.objects, registrations(kernel)).evaluate(kernel.ref(id)).might;

test("Siphon Power program is structurally valid EffectIR v2 data and executable", () => {
  const result = validateCardProgram(siphonPower);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(siphonPower.status, "executable");
  assert.equal(siphonPower.judgeReason, undefined);
});

test("Siphon Power identity, ruleset and printed text are verbatim", () => {
  assert.equal(siphonPower.canonicalCardId, CANONICAL);
  assert.equal(siphonPower.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(
    siphonPower.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "Choose a battlefield. Give friendly units there +1 :rb_might: this turn and enemy units there " +
      "-1 :rb_might: this turn, to a minimum of 1 :rb_might:."
  );
  assert.equal(cardRegistryById.get(siphonPower.canonicalCardId), siphonPower);
});

test("Siphon Power declares the printed [Reaction] keyword (CR 813)", () => {
  assert.equal(siphonPower.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(keyword.value, undefined);
});

test("Siphon Power structure: the battlefield choice plus the two programmatic Might sets", () => {
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.equal(play.body.length, 2);

  // "Choose a battlefield" (355.5 / 355.7 / 355.9.a) — the battlefield is the
  // chosen object; the unit sets anchor on it with sameLocationAs.
  assert.equal(friendlyInstruction.targets.length, 1);
  assert.deepEqual(friendlyInstruction.targets[0], {
    id: "chosen-battlefield",
    filter: { type: "battlefield" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(enemyInstruction.targets, undefined);

  // "Give friendly units there +1 Might this turn" — a programmatic set
  // (355.10.d), not a target group, with the end-of-turn duration.
  assert.equal(friendlyInstruction.id, "grant-plus-1-to-friendly-units");
  assert.equal(friendlyInstruction.op, "continuous.might");
  assert.deepEqual(friendlyInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(friendlyInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(friendlyInstruction.args.minimum, undefined);
  assert.deepEqual(friendlyInstruction.args.objects, {
    kind: "constant",
    value: {
      kind: "query",
      filter: {
        type: "unit",
        zone: "board",
        controller: "self",
        sameLocationAs: { target: "chosen-battlefield" }
      }
    }
  });
  assert.equal(friendlyInstruction.linkedTo, undefined);

  // "... and enemy units there -1 Might this turn, to a minimum of 1 Might."
  // The printed limit is carried explicitly (479.4.b snapshots it).
  assert.equal(enemyInstruction.id, "grant-minus-1-to-enemy-units");
  assert.equal(enemyInstruction.op, "continuous.might");
  assert.deepEqual(enemyInstruction.args.amount, { kind: "constant", value: -1 });
  assert.deepEqual(enemyInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(enemyInstruction.args.minimum, { kind: "constant", value: 1 });
  assert.deepEqual(enemyInstruction.args.objects, {
    kind: "constant",
    value: {
      kind: "query",
      filter: {
        type: "unit",
        zone: "board",
        controller: "opponent",
        sameLocationAs: { target: "chosen-battlefield" }
      }
    }
  });
  assert.equal(enemyInstruction.linkedTo, undefined);
});

test("Siphon Power golden: both Might instructions execute through the production chain adapter", () => {
  const kernel = siphonWorld();
  const outcome = resolveChainBody(play.body, chainContext(kernel, "A"));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(result => [result.id, result.result.status]),
    [
      ["grant-plus-1-to-friendly-units", "executed"],
      ["grant-minus-1-to-enemy-units", "executed"]
    ]
  );

  // One arithmetic-layer registration per affected unit: the friendly unit at
  // the battlefield and both enemy units there; the units at the other
  // battlefield are never grouped in (sameLocationAs anchor).
  assert.deepEqual(
    kernel.continuousEffects.map(entry => entry.effect.filter.objectId).sort(),
    ["enemy-here", "enemy-weak-here", "friendly-here"]
  );
  assert.deepEqual(
    kernel.continuousEffects.map(entry => [entry.effect.filter.objectId, entry.effect.effect.amount]),
    [["friendly-here", 1], ["enemy-here", -1], ["enemy-weak-here", 0]]
  );
  // 479.4.b: the -1 to a minimum of 1 snapshots at application time — the
  // 3-Might enemy really receives -1, and the 1-Might enemy receives 0 rather
  // than being pushed below its printed minimum.
  assert.equal(kernel.continuousEffects.find(entry => entry.effect.filter.objectId === "enemy-here").effect.effect.minimum, 1);
  // 317.1.a / 468.7.c: "this turn" is an end-of-turn duration on every entry.
  for (const entry of kernel.continuousEffects) assert.deepEqual(entry.duration, { type: "end-of-turn" });
});

test("Siphon Power golden: friendly +1 and enemy -1 apply only at the chosen battlefield", () => {
  const kernel = siphonWorld();
  resolveChainBody(play.body, chainContext(kernel, "A"));

  assert.equal(effectiveMight(kernel, "friendly-here"), 4);
  assert.equal(effectiveMight(kernel, "friendly-elsewhere"), 3);
  assert.equal(effectiveMight(kernel, "enemy-here"), 2);
  // The printed minimum of 1 holds: the (1, -1) pair snapshots to a 0-Might
  // modification instead of taking the unit below 1 (479.4.b).
  assert.equal(effectiveMight(kernel, "enemy-weak-here"), 1);
  assert.equal(effectiveMight(kernel, "enemy-elsewhere"), 3);
});

test("Siphon Power golden: the modification expires at end of turn (317.1.a / 468.7.c)", () => {
  const kernel = siphonWorld();
  resolveChainBody(play.body, chainContext(kernel, "A"));
  const engine = createLayerEngine(kernel.objects, registrations(kernel));
  assert.equal(engine.evaluate(kernel.ref("friendly-here")).might, 4);
  assert.equal(engine.evaluate(kernel.ref("enemy-here")).might, 2);

  const expired = engine.expireAt("turn-end");
  assert.equal(expired.length, 3);
  assert.equal(engine.evaluate(kernel.ref("friendly-here")).might, 3);
  assert.equal(engine.evaluate(kernel.ref("enemy-here")).might, 3);
});

test("Siphon Power golden: a chosen battlefield that left the Board is ignored and the sets resolve empty", () => {
  const kernel = siphonWorld();
  const stale = kernel.ref("chosen-bf");
  kernel.perform({ type: "move-zone", object: stale, to: "trash" });
  kernel.setTargets("chosen-battlefield", [stale]);

  const outcome = resolveChainBody(play.body, chainContext(kernel, "A"));
  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map(result => [result.id, result.result.status, result.result.reason]),
    [
      ["grant-plus-1-to-friendly-units", "ignored", "mistargeted"],
      ["grant-minus-1-to-enemy-units", "negated", "skipped"]
    ]
  );
  assert.equal(kernel.continuousEffects.length, 0);
});
