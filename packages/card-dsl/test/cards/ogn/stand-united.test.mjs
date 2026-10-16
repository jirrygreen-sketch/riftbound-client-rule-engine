import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import standUnited from "../../../dist/cards/ogn/stand-united.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import buff from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import might from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-40071acacac7084766aaea4ce4329db5541d659f9ec5225d9dc853542a456664";

const [hidden, action, play] = standUnited.abilities;
const [buffInstruction, extraMight] = play.body;
const evaluatedBuffArgs = { mode: "buff", target: buffInstruction.args.target.value };

test("Stand United program is structurally valid EffectIR v2 data", () => {
  const result = validateCardProgram(standUnited);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Stand United identity, ruleset, status and printed text", () => {
  assert.equal(standUnited.canonicalCardId, CANONICAL);
  assert.equal(standUnited.rulesetVersion, "core-1.5");
  assert.equal(standUnited.status, "judge-required");
  assert.match(standUnited.judgeReason, /continuous\.might/);
  assert.match(standUnited.judgeReason, /RIFT-258/);
  assert.match(standUnited.judgeReason, /RIFT-257/);
  assert.match(standUnited.judgeReason, /811\.2/);
  assert.equal(cardRegistryById.get(standUnited.canonicalCardId), standUnited);
  assert.equal(
    standUnited.sourceText,
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
      "[Action] (Play on your turn or in showdowns.)\n" +
      "Buff a friendly unit. Buffs give an additional +1 :rb_might: to friendly units this turn. " +
      "(To buff a unit, give it a +1 :rb_might: buff if it doesn't already have one.)"
  );
});

test("Stand United declares the printed [Hidden] and [Action] keywords (CR 811 / 806)", () => {
  assert.equal(standUnited.abilities.length, 3);
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
  assert.deepEqual(action, { kind: "keyword", keyword: "action" });
  assert.equal(hidden.value, undefined);
  assert.equal(action.value, undefined);
});

test("Stand United body: a merged Buff instruction plus the Buff Might modifier", () => {
  assert.equal(play.body.length, 2);
  assert.equal(buffInstruction.id, "buff-friendly-unit");
  assert.equal(buffInstruction.op, "effect.buff");
  assert.deepEqual(buffInstruction.args, {
    mode: { kind: "constant", value: "buff" },
    target: { kind: "constant", value: "friendly-unit" }
  });
  assert.deepEqual(buffInstruction.targets, [
    {
      id: "friendly-unit",
      filter: { type: "unit", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(buffInstruction.linkedTo, undefined);

  assert.equal(extraMight.id, "buffs-give-additional-might");
  assert.equal(extraMight.op, "continuous.might");
  assert.deepEqual(extraMight.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(extraMight.args.duration, { kind: "constant", value: "this-turn" });
  // 811.2's Stand United example: the second sentence covers every friendly
  // unit with a Buff, regardless of location, so it is an each-set with a
  // "has a buff" filter rather than the first sentence's target.
  assert.deepEqual(extraMight.args.objects, {
    kind: "constant",
    value: {
      kind: "query",
      filter: {
        zone: "board",
        type: "unit",
        controller: "controller",
        characteristics: { buffs: 1 }
      }
    }
  });
  assert.equal(extraMight.targets, undefined);
});

test("Stand United: the merged layers engine applies an arithmetic Might modifier with an expirable lifetime", () => {
  const kernel = world().unit("friendly-unit", { might: 2 }).build();
  const engine = createLayerEngine([kernel.getObject("friendly-unit")], [
    {
      effect: {
        id: "stand-united-test",
        layer: "arithmetic",
        filter: { type: "unit" },
        // The same ContinuousEffect shape Shield's merged expansion emits.
        effect: {
          kind: "continuous.might",
          mode: "add",
          appliesTo: "self",
          amount: { kind: "constant", value: 1 }
        }
      },
      duration: { type: "end-of-turn" }
    }
  ]);
  assert.equal(engine.evaluateAll()[0].might, 3);
  assert.deepEqual(engine.expireAt("turn-end"), ["stand-united-test"]);
  assert.equal(engine.evaluateAll()[0].might, 2);
});

test("Stand United golden: continuous.might registers the +1 for every friendly buffed unit (CR 703 rewritten)", () => {
  const base = world()
    .unit("spell-source", { types: ["spell"], zone: "chain", owner: "A", controller: "A" })
    .unit("buffed-ally", { might: 2, buffs: 1, owner: "A", controller: "A" })
    .unit("plain-ally", { might: 2, buffs: 0, owner: "A", controller: "A" })
    .unit("enemy-buffed", { might: 2, buffs: 1, owner: "B", controller: "B" })
    .build();
  // The card's filter uses the contract-level "controller" placeholder for the
  // ability controller (the chain's Finalize/query wrapper resolves the
  // equivalent "self" spelling to the item's controller). The test kernel
  // matches filter values literally, so supply that resolved controller value
  // while running the real production object matcher.
  const productionQuery = (filter) => base.objects.filter((object) => matchesObjectFilter(
    Object.fromEntries(Object.entries(filter).map(([key, value]) =>
      [key, (key === "controller" || key === "owner") && value === "controller" ? "A" : value])),
    object
  ));
  const kernel = bindResolveContext(base, {
    source: base.getObject("spell-source"),
    sourceSnapshot: base.getObject("spell-source"),
    query: productionQuery
  });

  const outcome = resolveChainBody([extraMight], kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["buffs-give-additional-might", "executed"]
  ]);
  assert.equal(outcome.linkedValues["buffs-give-additional-might.affected.count"], 1);
  assert.deepEqual(outcome.linkedValues["buffs-give-additional-might.affected.objects"], [
    base.ref("buffed-ally")
  ]);
  assert.equal(base.continuousEffects.length, 1);
  assert.equal(base.continuousEffects[0].effect.filter.objectId, "buffed-ally");
  assert.equal(base.continuousEffects[0].effect.effect.amount, 1);
  assert.deepEqual(base.continuousEffects[0].duration, { type: "end-of-turn" });

  const layers = createLayerEngine(base.objects, base.continuousEffects);
  assert.equal(layers.evaluate(base.ref("buffed-ally")).might, 3);
  assert.equal(layers.evaluate(base.ref("plain-ally")).might, 2);
  assert.equal(layers.evaluate(base.ref("enemy-buffed")).might, 2);
  // The end-of-turn lifetime is real: expiring it removes the +1.
  assert.equal(layers.expireAt("turn-end").length, 1);
  assert.equal(layers.evaluate(base.ref("buffed-ally")).might, 2);
});

test("Stand United golden: with no friendly buffed unit the Might instruction is a skipped negation", () => {
  const base = world()
    .unit("spell-source", { types: ["spell"], zone: "chain", owner: "A", controller: "A" })
    .unit("plain-ally", { might: 2, buffs: 0, owner: "A", controller: "A" })
    .build();
  // Resolve the declared "controller" placeholder the way the chain's
  // Finalize/query wrapper does, so the empty candidate set is caused by the
  // absent friendly Buff (characteristics: { buffs: 1 }), not by a literal
  // placeholder mismatch.
  const productionQuery = (filter) => base.objects.filter((object) => matchesObjectFilter(
    Object.fromEntries(Object.entries(filter).map(([key, value]) =>
      [key, (key === "controller" || key === "owner") && value === "controller" ? "A" : value])),
    object
  ));
  const kernel = bindResolveContext(base, {
    source: base.getObject("spell-source"),
    sourceSnapshot: base.getObject("spell-source"),
    query: productionQuery
  });
  const run = runInstruction(might, {
    amount: extraMight.args.amount,
    duration: extraMight.args.duration,
    objects: extraMight.args.objects
  }, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "skipped");
  assert.equal(base.continuousEffects.length, 0);
});

test("Stand United golden: the Buff half places one Buff counter on the chosen unit (CR 427.1.b)", () => {
  const kernel = world().unit("friendly-unit", { might: 2 }).build();
  const target = kernel.ref("friendly-unit");
  const run = runInstruction(buff, evaluatedBuffArgs, {
    world: kernel,
    targets: { "friendly-unit": [target] }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("friendly-unit").buffs, 1);
  assert.equal(run.linked.buffedCount, 1);
  assert.deepEqual(run.events.map(event => event.action), ["buff"]);
});

test("Stand United golden: a unit that already has a Buff is not buffed again (CR 427.1.b.1 / 702.3)", () => {
  const kernel = world().unit("friendly-unit", { might: 2, buffs: 1 }).build();
  const run = runInstruction(buff, evaluatedBuffArgs, {
    world: kernel,
    targets: { "friendly-unit": [kernel.ref("friendly-unit")] }
  });

  // Choosing a unit that already has a Buff stays legal; nothing extra is
  // placed and the "was buffed this way" result is false.
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "skipped");
  assert.equal(kernel.getObject("friendly-unit").buffs, 1);
});

test("Stand United interpreter: the Buff half resolves and the Might half registers through the real body", () => {
  const base = world().unit("friendly-unit", { might: 2, buffs: 0 }).build();
  // Finalize-time target locking is supplied to the kernel directly, exactly
  // as the production caller must (the reference kernel matches filters by
  // value and cannot resolve the pipeline's "controller" placeholder).
  const body = play.body.map(({ targets, ...rest }) => rest);
  base.setTargets("friendly-unit", [base.ref("friendly-unit")]);
  // Bind the production object matcher for the query the Might instruction
  // issues so the card's declared "controller" placeholder resolves the same
  // way the chain's Finalize/query wrapper resolves it.
  const productionQuery = (filter) => base.objects.filter((object) => matchesObjectFilter(
    Object.fromEntries(Object.entries(filter).map(([key, value]) =>
      [key, (key === "controller" || key === "owner") && value === "controller" ? "A" : value])),
    object
  ));
  const kernel = bindResolveContext(base, {
    source: base.getObject("friendly-unit"),
    sourceSnapshot: base.getObject("friendly-unit"),
    query: productionQuery
  });

  // The Buff instruction places the counter first, then the Might instruction
  // sees the newly buffed unit through the real "buffs: 1" characteristic
  // query and registers the end-of-turn +1 for it.
  const outcome = runAbilityBody(body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["buff-friendly-unit", "executed"],
    ["buffs-give-additional-might", "executed"]
  ]);
  assert.equal(base.getObject("friendly-unit").buffs, 1);
  assert.equal(base.continuousEffects.length, 1);
  assert.equal(base.continuousEffects[0].effect.effect.amount, 1);
  assert.deepEqual(base.continuousEffects[0].duration, { type: "end-of-turn" });
});

test.todo(
  "Stand United: the printed sentence is a rule-modifying effect over the class of buffs, so a unit " +
    "that gains its first Buff later in the turn must receive the +1 and a unit whose Buff is spent must " +
    "lose it (the merged continuous.might instruction resolves and registers its object set once) - " +
    "needs a class-level continuous-consumer model or a CardProgram static binding (RIFT-257)"
);

test.todo(
  "Stand United [Hidden]: hide for [A] and play from the facedown zone for [0] (CR 811.1.b / 811.1.c.2) - " +
    "needs the Hidden cost/zone workstream (RIFT-84)"
);
