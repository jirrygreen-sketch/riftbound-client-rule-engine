// Whole-card execution evidence for this program (the RIFT-687 template row and
// its supported-part tests) lives in
// test/cards/templates/triggered-object-moved-continuous-might-687.test.mjs;
// every assertion below is retained.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/ribbon-dancer.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { translateObjectFilter, translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";

const CARD_ID = "card.hash-1d9968343e4ab4ff83ad67e03bc124632358c3526c2bbddcc0667b4849c03538";
const TARGET_ID = "ribbon-dancer.other-friendly-unit";

const [ability] = program.abilities;
const [mightInstruction] = ability.body;
const [targetSpec] = mightInstruction.targets;

test("sfd-038-221 Ribbon Dancer: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-038-221 Ribbon Dancer: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "When I move to a battlefield, give another friendly unit +1 :rb_might: this turn."
  );
});

test("sfd-038-221 Ribbon Dancer: judgeReason names the temporary-Might and move-payload gaps", () => {
  // continuous.might is merged, so the reason must not claim the
  // Might-modification primitive is missing; the remaining gaps are the
  // move-event destination payload and the relative object anchors.
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /Finalize\/Resolve/);
  assert.match(program.judgeReason, /object-moved/);
  assert.match(program.judgeReason, /449\.1/);
  assert.match(program.judgeReason, /exclude/);
  assert.match(program.judgeReason, /translateObjectFilter/);
  assert.doesNotMatch(program.judgeReason, /没有注册 continuous\.might 的原语/);
});

test("sfd-038-221 Ribbon Dancer: 'When I move to a battlefield' subscribes to object-moved", () => {
  // 421.1 / 449.1 / 449.2: a Move is a permanent changing locations on the
  // Board; 458 / 458.1: a Recall is not a Move and does not trigger Move
  // abilities. The battlefield destination is expressed with the toZone
  // payload match, matching merged sfd/corinna-veraza.
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "object-moved");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-moved",
    toZone: "battlefield",
    filter: { source: "self" }
  });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.optional, false);
});

test("sfd-038-221 Ribbon Dancer: the effect is a one-turn Might grant targeted at another friendly unit", () => {
  // CR 703 / effect.buff.ts header: a temporary Might modification belongs to
  // the continuous.might layer, never to the Buff counter primitive.
  assert.equal(ability.body.length, 1);
  assert.equal(mightInstruction.id, "ribbon-dancer.give-plus-1");
  assert.equal(mightInstruction.op, "continuous.might");
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });
  // "give another friendly unit +1 Might" modifies the chosen unit, so the
  // instruction reads its object from the declared target (the merged
  // continuous.might selection shape), never from the ability source.
  assert.deepEqual(mightInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: TARGET_ID }
  });
  assert.equal(mightInstruction.linkedTo, undefined);

  // 355.7 / 355.9.b: "another friendly unit" is chosen, so it is a target;
  // "another" excludes the source through the symbolic exclude selector.
  assert.equal(mightInstruction.targets.length, 1);
  assert.equal(targetSpec.id, TARGET_ID);
  assert.deepEqual(targetSpec.filter, {
    type: "unit",
    controller: "controller",
    zone: "board",
    exclude: "source"
  });
  assert.equal(targetSpec.min, 1);
  assert.equal(targetSpec.max, 1);
  assert.equal(targetSpec.selection, "one");
  assert.equal(mightInstruction.picks, undefined);
});

test("sfd-038-221 Ribbon Dancer golden: the merged continuous.might primitive registers the end-of-turn arithmetic effect", () => {
  // The card's Might clause runs for
  // real through the merged interpreter path: the +1 lands in the arithmetic
  // layer with the end-of-turn duration (478.1.a, 317.1.a / 468.7.c).
  const kernel = world()
    .unit("ribbon-dancer", { owner: "A", controller: "A", might: 3 })
    .unit("ally", { owner: "A", controller: "A", might: 2 })
    .build();
  const allyRef = kernel.ref("ally");
  // The card's static filter spelling reaches the chain already normalized by
  // the merged programs layer ('controller' -> the ability controller), and
  // the interpreter's own queryObjects handles the object anchors; only the
  // scalar part goes through the reference kernel's literal filter match.
  const context = new Proxy(kernel, {
    get(target, key) {
      if (key === "targets") return (id) => (id === TARGET_ID ? [allyRef] : target.targets(id));
      if (key === "query") {
        return (filter) => target.query({
          ...filter,
          ...(filter.controller === "controller" || filter.controller === "self" ? { controller: "A" } : {})
        });
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const outcome = resolveChainBody(ability.body, context);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [["ribbon-dancer.give-plus-1", "executed"]]
  );
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 1);
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  const engine = createLayerEngine(
    kernel.objects,
    kernel.continuousEffects.map((entry) => ({ effect: entry.effect, duration: entry.duration, timestamp: 1 }))
  );
  // 143.2.a: only the chosen ally rises by 1; the source itself is untouched.
  assert.equal(engine.evaluate(kernel.ref("ally")).might, 3);
  assert.equal(engine.evaluate(kernel.ref("ribbon-dancer")).might, 3);
  assert.equal(engine.expireAt("turn-end").length, 1);
  assert.equal(engine.evaluate(kernel.ref("ally")).might, 2);
});

test("sfd-038-221 Ribbon Dancer: the move trigger filter is translated with the printed destination match", () => {
  // Structure evidence for the remaining trigger gap: the production filter
  // translator emits the destination match the card authors, while the
  // emitted object-moved event still carries no destination payload for it.
  assert.deepEqual(
    translateTriggerFilter(
      { event: "object-moved", toZone: "battlefield", filter: { source: "self" } },
      "ribbon-dancer",
      "object-moved"
    ),
    { event: "object-moved", object: { objectId: "ribbon-dancer" }, toZone: "battlefield" }
  );
});

test.todo(
  "sfd-038-221 Ribbon Dancer: the object-moved event must carry the destination kind/id so that " +
    "toZone: \"battlefield\" matches only genuine Moves onto a battlefield (449.1/449.2, with " +
    "458/458.1 excluding Recalls), and the card trigger must reach the pipeline"
);

test.todo(
  "sfd-038-221 Ribbon Dancer: programs/filters.ts must translate the relative object anchors " +
    "(exclude: \"source\" for 'another', sameLocationAs), after which Finalize must legalize and " +
    "re-check 'another friendly unit' at resolution (355.8, 355.9, 359.3.e)"
);
