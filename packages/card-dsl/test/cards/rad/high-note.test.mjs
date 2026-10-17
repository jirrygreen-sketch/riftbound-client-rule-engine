import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/rad/high-note.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL = "card.hash-94a6c9fbd1c07987c118b3c37993744abe6442237b9355dfa3faf6771ca2da54";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Give a unit –:rb_might: this turn equal to the number of exhausted units you control.";

const [reaction, play] = program.abilities;
const [countInstruction, mightInstruction] = play.body;
const [targetSpec] = mightInstruction.targets;

/**
 * The chain Finalize wrapper resolves the contract's "self"/"opponent"
 * controller placeholders and asks layers/filter.ts (chain/engine.ts). Bind the
 * same production query here so the card's own "you control" filter really
 * matches instead of failing on a literal placeholder comparison.
 */
function productionQuery(kernel, controller = kernel.controller) {
  return (filter) => {
    const normalized = { ...filter };
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "self") normalized[key] = controller;
    }
    return kernel.objects.filter((object) => {
      for (const key of ["controller", "owner"]) {
        if (normalized[key] === "opponent" && object[key] === controller) return false;
      }
      const resolved = { ...normalized };
      if (resolved.controller === "opponent") resolved.controller = "any";
      return matchesObjectFilter(resolved, object);
    });
  };
}

/** A board with the chosen unit plus the given number of exhausted friendly units. */
function fixture(exhaustedFriendly) {
  const builder = world()
    .unit("target", { owner: "A", controller: "A", might: 4 })
    .unit("ready-1", { owner: "A", controller: "A", exhausted: false });
  for (let index = 0; index < exhaustedFriendly; index += 1) {
    builder.unit("exhausted-" + index, { owner: "A", controller: "A", exhausted: true });
  }
  // 415.2: "you control" never counts the opponent's exhausted units.
  builder.unit("enemy-exhausted", { owner: "B", controller: "B", exhausted: true });
  return builder.build();
}

function runCardBody(kernel) {
  const scoped = kernel.clone({
    sourceSnapshot: kernel.getObject("target"),
    targets: new Map([["unit", [kernel.ref("target")]]])
  });
  const context = bindResolveContext(scoped, { query: productionQuery(scoped, "A") });
  const outcome = resolveChainBody(play.body, context);
  const layers = createLayerEngine(
    scoped.objects,
    scoped.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 }))
  );
  return { scoped, outcome, layers };
}

test("rad-048-167 High Note: program passes validateCardProgram with the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-048-167 High Note: [Reaction], printed energy 3 and no printed power", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.equal(reaction.value, undefined);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 }
  });
  // power: null in the catalog means no printed power; the field is absent.
  assert.equal(Object.hasOwn(play.cost, "power"), false);
});

test("rad-048-167 High Note: the amount is read at resolution and consumed as a linked value", () => {
  assert.equal(play.body.length, 2);

  // 415.2 / 190.6.d: "the number of exhausted units you control" — a count over
  // the controller's exhausted units, negated so the Might instruction receives
  // an evaluated integer (contract 3.6: values are read when the effect resolves).
  assert.equal(countInstruction.id, "high-note.count-exhausted");
  assert.equal(countInstruction.op, "condition.value");
  assert.deepEqual(countInstruction.args.operator, { kind: "constant", value: "neg" });
  assert.deepEqual(countInstruction.args.key, { kind: "constant", value: "value" });
  const [operand] = countInstruction.args.operands.value;
  assert.equal(operand.kind, "count");
  assert.equal(operand.subject, "exhausted-units-you-control");
  assert.deepEqual(operand.filter, { type: "unit", controller: "self", states: "exhausted" });
  assert.equal(countInstruction.linkedTo, undefined);

  // "Give a unit –Might this turn": a layers arithmetic modification, never a
  // Buff counter (702), expiring at the end-of-turn cleanup (317.2.c).
  assert.equal(mightInstruction.id, "high-note.give-minus-might");
  assert.equal(mightInstruction.op, "continuous.might");
  assert.deepEqual(mightInstruction.args.amount, {
    kind: "linked-value",
    instructionId: "high-note.count-exhausted",
    key: "value"
  });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(mightInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "unit" }
  });
  assert.equal(mightInstruction.linkedTo, undefined);

  // "a unit" is a target (355.9.b), not a pick.
  assert.equal(mightInstruction.picks, undefined);
  assert.equal(mightInstruction.targets.length, 1);
  assert.deepEqual(targetSpec, {
    id: "unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("rad-048-167 High Note golden: two exhausted units give the chosen unit -2 Might until end of turn", () => {
  const { scoped, outcome, layers } = runCardBody(fixture(2));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [
      ["high-note.count-exhausted", "executed"],
      ["high-note.give-minus-might", "executed"]
    ]
  );
  assert.equal(outcome.linkedValues["high-note.count-exhausted.value"], -2);

  // One arithmetic-layer registration for the chosen unit, lasting to end of turn.
  assert.equal(scoped.continuousEffects.length, 1);
  const [registration] = scoped.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  // The registration carries the per-object guard function next to the shape,
  // so read the declared fields instead of comparing the whole record.
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, -2);
  assert.equal(typeof registration.effect.effect.condition, "function");
  assert.deepEqual(registration.effect.filter, {
    objectId: "target",
    zone: "board",
    zoneEntryId: 1
  });
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  // The layers engine applies it: 4 - 2 = 2 (143.2.a), and the expiry restores 4.
  assert.equal(layers.evaluate(scoped.ref("target")).might, 2);
  layers.advance({ id: "turn-end" });
  assert.equal(layers.evaluate(scoped.ref("target")).might, 4);
});

test("rad-048-167 High Note golden: zero exhausted units are a legal no-op (355.13)", () => {
  const { scoped, outcome, layers } = runCardBody(fixture(0));

  // The count resolves to 0; the merged continuous.might treats an add of 0 as
  // "nothing happened" (negated/skipped) instead of registering a +0 layer.
  // The arithmetic node negates the count, so the linked value is -0; it is
  // still an add of zero and must not register a layer effect.
  const counted = outcome.linkedValues["high-note.count-exhausted.value"];
  assert.equal(counted === 0, true);
  assert.equal(outcome.results[1].result.status, "negated");
  assert.equal(outcome.results[1].result.reason, "skipped");
  assert.deepEqual(scoped.continuousEffects, []);
  assert.equal(layers.evaluate(scoped.ref("target")).might, 4);
});

test("rad-048-167 High Note golden: a lost target ignores the Might instruction (359.3.e.2/e.6)", () => {
  const kernel = fixture(2);
  const stale = kernel.ref("target");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  const scoped = kernel.clone({
    sourceSnapshot: kernel.getObject("exhausted-0"),
    targets: new Map([["unit", [stale]]])
  });
  const context = bindResolveContext(scoped, { query: productionQuery(scoped, "A") });
  const outcome = resolveChainBody(play.body, context);

  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[1].result.status, "ignored");
  assert.equal(outcome.results[1].result.reason, "mistargeted");
  assert.deepEqual(scoped.continuousEffects, []);
});
