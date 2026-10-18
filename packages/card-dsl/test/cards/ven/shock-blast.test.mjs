import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/shock-blast.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { collectCostModifications } from "../../../../engine-core/dist/cost/discounts/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import damageDefinition from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-c9945e7665b7b73c7fc723b3de1260db01ea2a28b12779b874641e989df11f0b";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "This costs :rb_energy_2: less if you control something that's [Empowered].\n" +
  "Deal 4 to a unit at a battlefield.";

const [action, discount, play] = program.abilities;
const [deal] = play.body;
const BATTLEFIELD_UNIT = "shock-blast.battlefield-unit";

test("ven-059-166 Shock Blast: program passes validateCardProgram with the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("ven-059-166 Shock Blast: judgeReason names the cost-modification wiring and the Empowered predicate", () => {
  assert.match(program.judgeReason, /356\.4\.b/);
  assert.match(program.judgeReason, /continuous\.cost-modification/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /Empowered/);
  assert.match(program.judgeReason, /conditionMatches/);
  assert.match(program.judgeReason, /collectCostModifications/);
  assert.match(program.judgeReason, /442\.1\.a/);
  assert.doesNotMatch(program.judgeReason, /RIFT-89|RIFT-91/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-059-166 Shock Blast: printed 3 Energy + 1 Mind Power and the [Action] keyword", () => {
  assert.deepEqual(action, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 },
    power: { kind: "constant", value: 1 }
  });
});

test("ven-059-166 Shock Blast: the -2 Energy discount is a self static with a descriptive Empowered gate", () => {
  assert.equal(discount.kind, "static");
  assert.deepEqual(discount.effect, {
    kind: "continuous.cost-modification",
    resource: "energy",
    amount: { kind: "constant", value: -2 },
    minimum: { kind: "constant", value: 0 },
    appliesTo: "self"
  });
  // The gate is descriptive: no merged Condition evaluates "you control
  // something that's Empowered", and layers/engine.ts treats unknown conditions
  // as true, so it must not be spelled as a near-miss predicate.
  assert.deepEqual(discount.condition, {
    kind: "expression",
    value: { kind: "constant", value: "you-control-something-empowered" }
  });
  assert.equal(discount.condition.kind, "expression");
  // Not approximated as "you control a unit" or any always-true condition.
  assert.notEqual(discount.condition.kind, "always");
});

test("ven-059-166 Shock Blast: structure — Deal 4 to one unit at a battlefield", () => {
  assert.equal(play.body.length, 1);
  assert.equal(deal.id, "shock-blast.deal-4");
  assert.equal(deal.op, "effect.damage");
  assert.deepEqual(deal.args.amount, { kind: "constant", value: 4 });
  assert.deepEqual(deal.args.target, { kind: "constant", value: BATTLEFIELD_UNIT });
  assert.equal(deal.linkedTo, undefined);
  assert.equal(deal.picks, undefined);
  // 355.9.b: "at a battlefield" is the target restriction; the filter carries it.
  assert.deepEqual(deal.targets, [
    {
      id: BATTLEFIELD_UNIT,
      filter: { type: "unit", location: "battlefield" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("ven-059-166 Shock Blast: the declared location filter accepts battlefield units and rejects base units", () => {
  const kernel = world()
    .unit("at-battlefield", { might: 5, controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .base("at-base", { might: 5, controller: "B" })
    .build();
  const [target] = deal.targets;
  assert.equal(matchesObjectFilter(target.filter, kernel.getObject("at-battlefield")), true);
  assert.equal(matchesObjectFilter(target.filter, kernel.getObject("at-base")), false);
});

test("ven-059-166 Shock Blast golden: the body really deals 4 to the locked battlefield unit", () => {
  const kernel = world()
    .unit("victim", { might: 6, controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  // effect.damage's argsSchema requires target to be a TargetSpec id string,
  // while the static IR holds it as a constant expression (the chain adapter's
  // LITERAL_FIELDS decodes it the same way). Only that one evaluated value is
  // substituted here; the amount stays the program's own.
  const run = runInstruction(
    damageDefinition,
    { ...deal.args, target: deal.args.target.value },
    { world: kernel, targets: { [BATTLEFIELD_UNIT]: [kernel.ref("victim")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("victim").damage, 4);
  assert.equal(run.linked.dealt, 4);
  assert.equal(run.linked.dealtCount, 1);
});

test("ven-059-166 Shock Blast golden: the body deals 4 through the chain adapter with the kernel's location spelling", () => {
  // The reference kernel's matchesFilter (effects/testing/test-kernel.ts)
  // compares a filter's `location` by exact JSON equality, so the production
  // spelling `location: "battlefield"` (understood by layers/filter.ts) matches
  // nothing there. Golden execution substitutes that one key with the kernel's
  // location object, exactly as the merged rad-013-167 Lost to the Sands and
  // sfd-106-221 Show of Strength goldens document; instruction order, amount and
  // target spec stay the program's own.
  const kernel = world()
    .unit("victim", { might: 6, controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const kernelBody = JSON.parse(
    JSON.stringify(play.body),
    (key, value) => (key === "location" && value === "battlefield" ? { type: "battlefield", id: "bf-1" } : value)
  );
  kernel.setTargets(BATTLEFIELD_UNIT, [kernel.ref("victim")]);

  const outcome = resolveChainBody(kernelBody, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["shock-blast.deal-4", "executed"]
  ]);
  assert.equal(kernel.getObject("victim").damage, 4);
  assert.deepEqual(outcome.events.map(event => event.action), ["damage"]);
});

test("ven-059-166 Shock Blast golden: a target that left the Board before resolution ignores the damage", () => {
  const kernel = world()
    .unit("victim", { might: 6, controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const stale = kernel.ref("victim");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  kernel.setTargets(BATTLEFIELD_UNIT, [stale]);

  const outcome = resolveChainBody(play.body, kernel);

  // 359.3.e.7: every locked reference is stale, so the instruction is ignored
  // rather than revived by object id.
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.deepEqual(outcome.events, []);
});

test("ven-059-166 Shock Blast gap: the merged static binder refuses continuous.cost-modification", () => {
  // Executed evidence for judgeReason point 1: the production binder has no
  // layer for the declared static, so no Finalize cost plan can read the -2.
  const kernel = world().unit("shock-blast", {}).build();
  const source = kernel.getObject("shock-blast");
  const binder = createEngineStaticBinder({ layers: createLayerEngine([source]) });
  assert.throws(
    () => binder.bindStatic(discount, source),
    /Static ability kind continuous\.cost-modification has no layer mapping/
  );
});

test("ven-059-166 Shock Blast gap: the Empowered gate is descriptive and unknown conditions fall back to true", () => {
  // layers/engine.ts conditionMatches treats an unknown condition kind as true,
  // so the near-miss predicate must stay a named description, not a real gate.
  const kernel = world().unit("shock-blast", {}).build();
  const snapshot = kernel.getObject("shock-blast");
  const engine = createLayerEngine([snapshot], [{
    effect: {
      id: "shock-blast.gate",
      layer: "arithmetic",
      source: snapshot.ref,
      filter: { objectId: "shock-blast" },
      effect: { kind: "continuous.might", amount: { kind: "constant", value: 2 }, condition: discount.condition }
    },
    duration: { type: "permanent" },
    timestamp: 1,
    sequence: 1
  }]);
  // The unknown kind is not rejected; it silently satisfies the gate.
  assert.equal(engine.evaluate(snapshot.ref).might, snapshot.might + 2);
  assert.deepEqual(discount.condition, {
    kind: "expression",
    value: { kind: "constant", value: "you-control-something-empowered" }
  });
});

test("ven-059-166 Shock Blast evidence: the merged cost collector rejects the named Empowered gate", () => {
  const kernel = world()
    .unit("shock-blast", { cardId: CANONICAL, owner: "A", controller: "A", energy: 3 })
    .build();
  const source = kernel.getObject("shock-blast");
  const context = bindResolveContext(kernel, { source, controller: "A" });
  assert.throws(
    () => collectCostModifications(
      context,
      { id: "shock-blast-play", cost: { kind: "explicit", energy: { kind: "constant", value: 3 } } },
      { statics: [{ id: "shock-blast", source: source.ref, ability: discount }] }
    ),
    /Descriptive cost predicates require an authoritative condition adapter/
  );
});
