import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/friendship.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-380c1a7758d95d28f1a1ab46065c44a878dd909f52f43900cdf66c7669153512";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Choose a unit. Give it +1 :rb_might: this turn for each of the following tags " +
  "among your units — Bird, Cat, Dog, and Poro.";

const [keyword, play] = program.abilities;
const [mightBird, ...restMight] = play.body;
const [chosenUnit] = mightBird.targets;

// The reference kernel compares filter values literally; the production chain
// (chain/engine.ts) resolves the controller/owner placeholders before querying.
// The goldens drive the card body through the production chain adapter while
// keeping the reference kernel as the resolver — the merged frigid-jewel
// convention.
const chainQuery = (kernel, controller) => (value) => {
  const normalized = { ...value };
  for (const key of ["controller", "owner"]) {
    if (normalized[key] === "self" || normalized[key] === "controller") normalized[key] = controller;
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
const registrations = (kernel) => kernel.continuousEffects.map(entry => ({
  effect: entry.effect,
  duration: entry.duration,
  timestamp: 1
}));
const effectiveMight = (kernel, id) => createLayerEngine(kernel.objects, registrations(kernel)).evaluate(kernel.ref(id)).might;

const buildWorld = () =>
  world()
    .unit("chosen", { owner: "A", controller: "A", might: 2, location: { type: "base", player: "A" } })
    .unit("bird", { owner: "A", controller: "A", might: 1, tags: ["Bird"], location: { type: "base", player: "A" } })
    .unit("bird-two", { owner: "A", controller: "A", might: 1, tags: ["Bird"], location: { type: "base", player: "A" } })
    .unit("cat", { owner: "A", controller: "A", might: 1, tags: ["Cat"], location: { type: "base", player: "A" } })
    .unit("enemy", { owner: "B", controller: "B", might: 3, tags: ["Dog"], location: { type: "base", player: "B" } })
    .build();

test("unl-046-219 Friendship: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
});

test("unl-046-219 Friendship: identity, ruleset, executable status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  // Every ability is executed by the goldens below, so the program carries no
  // judgeReason (README §2: executable programs drop the field entirely).
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("unl-046-219 Friendship: [Reaction], printed cost and one per-tag +1 instruction", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(keyword.value, undefined);
  assert.equal(play.kind, "play");
  // Catalog printing: 1 energy, no printed power.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 1 }
  });
  // One instruction per printed tag (Bird, Cat, Dog, Poro), each granting +1.
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["friendship.grant-might-bird", "continuous.might"],
      ["friendship.grant-might-cat", "continuous.might"],
      ["friendship.grant-might-dog", "continuous.might"],
      ["friendship.grant-might-poro", "continuous.might"]
    ]
  );
});

test("unl-046-219 Friendship: 'Choose a unit' is one targeted Board unit", () => {
  // 355.5 / 355.7: "Choose a unit" names one specific game object, so it is a
  // target (min = max = 1, selection "one") — not an each-set. The spec is
  // declared once and every per-tag instruction resolves the same choice.
  assert.equal(mightBird.op, "continuous.might");
  assert.deepEqual(mightBird.targets, [
    {
      id: "friendship.chosen-unit",
      filter: { type: "unit", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(chosenUnit.id, "friendship.chosen-unit");
  for (const instruction of restMight) {
    assert.deepEqual(instruction.targets, [], "only the first instruction declares the target spec");
    assert.deepEqual(instruction.args.objects, {
      kind: "constant",
      value: { kind: "target", id: "friendship.chosen-unit" }
    });
    assert.equal(mightBird.targets.length, 1);
  }
  assert.equal(mightBird.linkedTo, undefined);
  assert.equal(mightBird.picks, undefined);
});

test("unl-046-219 Friendship: each +1 is temporary (end of turn), never a Buff counter", () => {
  // 143.2.a / 317.2.c: "Might" is the layered effective value and "this turn"
  // expires in the end-of-turn cleanup; 702 Buffs are a different game object,
  // which is why the instructions are continuous.might and not effect.buff.
  for (const instruction of play.body) {
    assert.deepEqual(instruction.args.duration, { kind: "constant", value: "end-of-turn" });
    assert.equal(instruction.op, "continuous.might");
    assert.notEqual(instruction.op, "effect.buff");
  }
});

test("unl-046-219 Friendship: the amount is +1 per listed tag present, clamped by its instruction condition", () => {
  // "+1 for each of the following tags among your units": every instruction
  // grants the printed +1 and is gated by an instruction-level condition
  // (gte 1), so 2 Bird units still grant a single +1. The count is the
  // presence check for the tag, not the amount (355.13 skips the 0 case).
  const printedTags = ["Bird", "Cat", "Dog", "Poro"];
  for (const [index, instruction] of play.body.entries()) {
    assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
    assert.deepEqual(instruction.condition, {
      kind: "compare",
      left: {
        kind: "count",
        subject: "units-with-tag",
        filter: { type: "unit", zone: "board", controller: "self", tags: [printedTags[index]] }
      },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    });
  }
});

test("unl-046-219 Friendship golden: two distinct tags grant +2 and expire at end of turn", () => {
  // 355.13 / 317.2.c: one arithmetic-layer continuous.might registration per
  // present tag, each with an end-of-turn duration.
  const kernel = buildWorld();
  kernel.setTargets("friendship.chosen-unit", [kernel.ref("chosen")]);
  const outcome = resolveChainBody(play.body, chainContext(kernel, "A"));

  assert.equal(outcome.status, "partial");
  // Bird and Cat are present: those two instructions execute; Dog and Poro are
  // absent and skip with a 0 amount.
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["friendship.grant-might-bird", "executed"],
    ["friendship.grant-might-cat", "executed"],
    ["friendship.grant-might-dog", "negated"],
    ["friendship.grant-might-poro", "negated"]
  ]);
  assert.deepEqual(outcome.results.map(entry => entry.result.reason), [
    undefined,
    undefined,
    "skipped",
    "skipped"
  ]);
  assert.deepEqual(kernel.continuousEffects.map(entry => entry.effect.filter.objectId), ["chosen", "chosen"]);
  assert.deepEqual(kernel.continuousEffects.map(entry => entry.effect.effect.amount), [1, 1]);
  // 317.1.a / 468.7.c: "this turn" is an end-of-turn duration.
  for (const entry of kernel.continuousEffects) {
    assert.deepEqual(entry.duration, { type: "end-of-turn" });
  }
  assert.equal(effectiveMight(kernel, "chosen"), 4);
  assert.equal(effectiveMight(kernel, "bird"), 1);
  assert.equal(effectiveMight(kernel, "enemy"), 3);
  assert.equal(outcome.linkedValues["friendship.grant-might-bird.affected.count"], 1);

  // The temporary modification expires in the end-of-turn cleanup.
  const engine = createLayerEngine(kernel.objects, registrations(kernel));
  assert.equal(engine.expireAt("turn-end").length, 2);
  assert.equal(engine.evaluate(kernel.ref("chosen")).might, 2);
});

test("unl-046-219 Friendship golden: two Bird units still grant one +1 per printed tag", () => {
  // The multiplier counts distinct listed tags (at most 4), not units: 2 Bird
  // + 1 Cat = +2, and the clamped per-instruction amount never becomes +2.
  const kernel = buildWorld();
  kernel.setTargets("friendship.chosen-unit", [kernel.ref("chosen")]);
  const outcome = resolveChainBody(play.body, chainContext(kernel, "A"));

  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results.filter(entry => entry.result.status === "executed").length, 2);
  assert.deepEqual(kernel.continuousEffects.map(entry => entry.effect.effect.amount), [1, 1]);
  assert.equal(effectiveMight(kernel, "chosen"), 4);
});

test("unl-046-219 Friendship golden: none of the listed tags present grants nothing", () => {
  // 355.13: every 0-amount instruction is skipped, so no registration exists.
  const kernel = world()
    .unit("chosen", { owner: "A", controller: "A", might: 2, location: { type: "base", player: "A" } })
    .unit("no-tag", { owner: "A", controller: "A", might: 1, location: { type: "base", player: "A" } })
    .build();
  kernel.setTargets("friendship.chosen-unit", [kernel.ref("chosen")]);
  const outcome = resolveChainBody(play.body, chainContext(kernel, "A"));

  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]),
    [
      ["friendship.grant-might-bird", "negated", "skipped"],
      ["friendship.grant-might-cat", "negated", "skipped"],
      ["friendship.grant-might-dog", "negated", "skipped"],
      ["friendship.grant-might-poro", "negated", "skipped"]
    ]
  );
  assert.equal(kernel.continuousEffects.length, 0);
  assert.equal(effectiveMight(kernel, "chosen"), 2);
});

test("unl-046-219 Friendship golden: only your units are counted (enemy Dog does not pay)", () => {
  // "among your units" scopes the count to the ability controller's Board
  // units; the enemy Dog never triggers the Dog instruction.
  const kernel = buildWorld();
  kernel.setTargets("friendship.chosen-unit", [kernel.ref("chosen")]);
  const outcome = resolveChainBody(play.body, chainContext(kernel, "A"));

  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results.find(entry => entry.id === "friendship.grant-might-dog").result.status, "negated");
  assert.equal(effectiveMight(kernel, "chosen"), 4);
});

test("unl-046-219 Friendship golden: the modification lands only on the chosen unit", () => {
  const kernel = buildWorld();
  kernel.setTargets("friendship.chosen-unit", [kernel.ref("chosen")]);
  resolveChainBody(play.body, chainContext(kernel, "A"));

  assert.equal(effectiveMight(kernel, "chosen"), 4);
  assert.equal(effectiveMight(kernel, "bird"), 1);
  assert.equal(effectiveMight(kernel, "bird-two"), 1);
  assert.equal(effectiveMight(kernel, "cat"), 1);
  assert.equal(effectiveMight(kernel, "enemy"), 3);
});

test("unl-046-219 Friendship golden: all four printed tags grant +4", () => {
  const kernel = world()
    .unit("chosen", { owner: "A", controller: "A", might: 2, location: { type: "base", player: "A" } })
    .unit("bird", { owner: "A", controller: "A", might: 1, tags: ["Bird"], location: { type: "base", player: "A" } })
    .unit("cat", { owner: "A", controller: "A", might: 1, tags: ["Cat"], location: { type: "base", player: "A" } })
    .unit("dog", { owner: "A", controller: "A", might: 1, tags: ["Dog"], location: { type: "base", player: "A" } })
    .unit("poro", { owner: "A", controller: "A", might: 1, tags: ["Poro"], location: { type: "base", player: "A" } })
    .build();
  kernel.setTargets("friendship.chosen-unit", [kernel.ref("chosen")]);
  const outcome = resolveChainBody(play.body, chainContext(kernel, "A"));

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results.filter(entry => entry.result.status === "executed").length, 4);
  assert.equal(kernel.continuousEffects.length, 4);
  assert.equal(effectiveMight(kernel, "chosen"), 6);
});

test("unl-046-219 Friendship golden: a chosen unit that left the Board ignores the spell", () => {
  // 359.3.e.6: the only target is gone, so the two instructions whose tag
  // condition still passes resolve their dead reference as ignored rather than
  // re-aiming; the remaining instructions fail their condition first and are
  // skipped.
  const kernel = buildWorld();
  const stale = kernel.ref("chosen");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  kernel.setTargets("friendship.chosen-unit", [stale]);
  const outcome = resolveChainBody(play.body, chainContext(kernel, "A"));

  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]),
    [
      ["friendship.grant-might-bird", "ignored", "mistargeted"],
      ["friendship.grant-might-cat", "ignored", "mistargeted"],
      ["friendship.grant-might-dog", "negated", "skipped"],
      ["friendship.grant-might-poro", "negated", "skipped"]
    ]
  );
  assert.equal(kernel.continuousEffects.length, 0);
  assert.equal(kernel.getObject("chosen").zone, "hand");
});
