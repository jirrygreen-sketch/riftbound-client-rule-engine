import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/hall-of-legends.js";
import { cardProgramsById, cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { assertTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";

const CANONICAL = "card.hash-e4adbb3b6a16047a000e20a54481f947239754cc236a48b06ad0cebcbfd7ed57";
const BASE = { type: "base", player: "A" };
const constant = (value) => ({ kind: "constant", value });
const OPTIONAL_KEY = "hall-of-legends.opt-in/optional";
const LEGEND_KEY = "hall-of-legends.opt-in/hall-of-legends.ready/hall-of-legends.legend";

const [ability] = program.abilities;
const [choice] = ability.body;
const [pay, readyLegend] = choice.args.body.value;
const legendSelection = readyLegend.args.objects.value;

/**
 * The merged matcher reads player selectors (layers/filter.ts), so the golden
 * binds `self` to the ability controller exactly as the production chain does;
 * the card keeps the symbolic spelling.
 */
const productionContext = (kernel) => new Proxy(kernel, {
  get(target, key) {
    if (key === "query") {
      return (filter) => target.query({}).filter((object) => matchesObjectFilter(
        Object.fromEntries(Object.entries(filter).map(([field, value]) => [
          field,
          field === "controller" && value === "self" ? target.controller : value
        ])),
        object
      ));
    }
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  }
});

function hallWorld({ exhausted = true, energy = 10 } = {}) {
  return world()
    .player("A", { energy })
    .player("B", { energy: 10 })
    .unit("legend-1", { owner: "A", types: ["legend"], exhausted, zone: "board", location: BASE })
    .unit("enemy-legend", { owner: "B", types: ["legend"], exhausted: true, zone: "board", location: { type: "base", player: "B" } })
    .unit("unit-1", { owner: "A", exhausted: true })
    .build();
}

function runBody(kernel, { accepted = true } = {}) {
  const bound = kernel.clone({
    source: kernel.getObject("legend-1"),
    sourceSnapshot: kernel.getObject("legend-1")
  });
  bound.setAnswers({
    [OPTIONAL_KEY]: accepted,
    [LEGEND_KEY]: [bound.ref("legend-1")]
  });
  return { bound, outcome: resolveChainBody(ability.body, productionContext(bound)) };
}

test("sfd-210-221 Hall of Legends: validates, is registered and keeps identity/source text", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, "When you conquer here, you may pay :rb_energy_1: to ready your legend.");
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("sfd-210-221 Hall of Legends: judgeReason names only the battlefield here anchor as the gap", () => {
  assert.match(program.judgeReason, /here/);
  assert.match(program.judgeReason, /Unsupported filter field here/);
  assert.match(program.judgeReason, /details\.battlefieldId/);
  assert.match(program.judgeReason, /383\.4\.c/);
  // The merged payment and the legend choose are no longer recorded as gaps.
  assert.doesNotMatch(program.judgeReason, /没有 cost\.pay 原语|没有合并的 cost\.pay|RIFT-261/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("sfd-210-221 Hall of Legends: conquer trigger and optional pay -> ready-your-legend structure", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "conquer");
  assert.deepEqual(ability.trigger.filter, { event: "conquer", here: true, player: "self" });
  assert.equal(ability.optional, true);
  assert.equal(choice.op, "choice.optional");
  assert.deepEqual(choice.args.body.value.map((instruction) => instruction.id), [
    "hall-of-legends.pay",
    "hall-of-legends.ready"
  ]);

  // 204.3 / 204.3.a: the printed 1 Energy payment uses the merged cost.pay
  // `payments` record (the shape the primitive actually accepts).
  assert.equal(pay.op, "cost.pay");
  assert.deepEqual(pay.args, { payments: constant({ energy: 1 }) });

  // 355.10.g: "your legend" does not target, so it is a resolution-time
  // non-target choose selection, not a TargetSpec.
  assert.equal(readyLegend.op, "effect.ready");
  assert.equal(readyLegend.linkedTo, "hall-of-legends.pay");
  assert.equal(readyLegend.targets, undefined);
  assert.deepEqual(legendSelection, {
    kind: "choose",
    id: "hall-of-legends.legend",
    filter: { type: "legend", controller: "self" },
    min: 1,
    max: 1
  });
});

test("sfd-210-221 Hall of Legends: the conquer filter carries the documented here placeholder", () => {
  // The printed "here" (053.3) is authored as the here placeholder; wiring it
  // to this battlefield's runtime identity is the named dependency below.
  assert.equal(ability.trigger.filter.here, true);
  assert.equal(ability.trigger.filter.player, "self");
});

test("sfd-210-221 Hall of Legends golden: paying 1 energy readies the exhausted legend through the production adapter", () => {
  const kernel = hallWorld();
  const { bound, outcome } = runBody(kernel, { accepted: true });

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["hall-of-legends.pay", "executed"],
    ["hall-of-legends.ready", "executed"],
    ["hall-of-legends.opt-in", "executed"]
  ]);
  // 204.3.a/205: the printed 1 Energy was really charged.
  assert.equal(bound.player("A").energy, 9);
  assert.deepEqual(
    outcome.linkedValues["hall-of-legends.opt-in/hall-of-legends.pay.payment"].total,
    { energy: 1, power: [], xp: 0, actions: [] }
  );
  // 416.1: the legend really became ready, and the real ready action committed.
  assert.equal(bound.getObject("legend-1").exhausted, false);
  assert.deepEqual(outcome.events.map((event) => event.action), ["pay", "ready"]);
});

test("sfd-210-221 Hall of Legends golden: declining pays nothing and leaves the legend exhausted", () => {
  const kernel = hallWorld();
  const { bound, outcome } = runBody(kernel, { accepted: false });

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason]), [
    ["hall-of-legends.opt-in", "negated", "skipped"]
  ]);
  assert.equal(bound.player("A").energy, 10);
  assert.equal(bound.getObject("legend-1").exhausted, true);
  assert.deepEqual(outcome.events, []);
});

test("sfd-210-221 Hall of Legends golden: an already-ready legend is not readied again (416.1.c)", () => {
  const kernel = hallWorld({ exhausted: false });
  const { bound, outcome } = runBody(kernel, { accepted: true });

  // 416.1.c: readying an already-ready object is a no-op, but the printed
  // payment still happened (it is a separate mandatory part of the chosen body).
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.events.map((event) => event.action), ["pay"]);
  assert.equal(bound.getObject("legend-1").exhausted, false);
  assert.equal(bound.player("A").energy, 9);
  assert.deepEqual(
    outcome.linkedValues["hall-of-legends.opt-in/hall-of-legends.ready.readied"],
    { count: 0, objects: [] }
  );
});

test("sfd-210-221 Hall of Legends golden: an unpayable 1 energy fails closed instead of readying for free", () => {
  const kernel = hallWorld({ energy: 0 });
  const bound = kernel.clone({
    source: kernel.getObject("legend-1"),
    sourceSnapshot: kernel.getObject("legend-1")
  });
  bound.setAnswers({ [OPTIONAL_KEY]: true, [LEGEND_KEY]: [bound.ref("legend-1")] });

  // 203.3 / 356.6: the failed payment must abort loudly; no partial ready may commit.
  assert.throws(
    () => resolveChainBody(ability.body, productionContext(bound)),
    (error) => error.name === "CostPlanError" && error.reason === "cannot-pay-cost"
  );
  assert.equal(bound.player("A").energy, 0);
  assert.equal(bound.getObject("legend-1").exhausted, true);
  assert.equal(bound.events.filter((event) => event.action === "ready").length, 0);
});

test("sfd-210-221 Hall of Legends golden: the choose filter only offers the controller's legends", () => {
  const kernel = hallWorld();
  const bound = kernel.clone({
    source: kernel.getObject("legend-1"),
    sourceSnapshot: kernel.getObject("legend-1")
  });
  const options = productionContext(bound).query(legendSelection.filter).map((object) => object.ref.id);
  assert.deepEqual(options, ["legend-1"]);
});

test("sfd-210-221 Hall of Legends: the conquer here anchor validates and translates", () => {
  // 383.4.c / 473.2.a: the trigger retains its source-Battlefield scope.
  assert.doesNotThrow(() => assertTriggerSpec(ability.trigger));
  assert.deepEqual(translateTriggerFilter(ability.trigger.filter, CANONICAL, "conquer"), {
    event: "conquer", here: true, player: "self"
  });
  // Dropping the field would translate but would also widen the trigger to
  // every conquer; the program must not do that silently.
  assertTriggerSpec({ at: "conquer", filter: translateTriggerFilter({ event: "conquered", player: "self" }, CANONICAL, "conquer") });
});

test.todo(
  "sfd-210-221 Hall of Legends: register and fire the conquer trigger at this Battlefield once the conquer " +
    "event carries a battlefield-relative anchor (turn/flow.ts already publishes details.battlefieldId; " +
    "events/trigger-spec.ts and programs/filters.ts must accept and translate it)"
);

