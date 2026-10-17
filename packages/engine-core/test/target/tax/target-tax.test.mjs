import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "@riftbound/card-dsl";
import { createTargetTaxAdapter, collectTargetTaxes } from "../../../dist/target/tax/index.js";
import { finalizeTargetPlan, resolveTargetPlan } from "../../../dist/target/target-plan.js";
import { prepareCostPayment } from "../../../dist/cost/payment.js";
import { DUEL_DOMAINS } from "../../../dist/cost/resources.js";
import { world, AwaitChoice } from "../../../dist/effects/testing/index.js";
import Deflect from "../../../dist/effects/keywords/Deflect.js";

const c = value => ({ kind: "constant", value });
const costInput = extra => ({ id: "play", cost: { kind: "printed" }, domains: ["Fury"], ...extra });
const requirement = extra => ({ id: "unit", filter: { type: "unit", zone: "board" }, ...extra });
const effectProgram = effect => ({ canonicalCardId: "test.target-tax", rulesetVersion: "core-1.5", status: "executable", sourceText: "test tax", abilities: [{ kind: "static", effect }] });
function fixture({ power = ["Calm"], energy = 2, keywords = [{ id: "deflect" }], source = {} } = {}) {
  const kernel = world().player("A", { energy, power })
    .hand("source", { types: ["spell"], energy: 2, power: [], ...source })
    .unit("enemy", { owner: "B", might: 2, keywords })
    .unit("other", { owner: "B", keywords: [{ id: "Deflect", value: 2 }] })
    .unit("friendly", { keywords: [{ id: "deflect", value: 4 }] }).build();
  return kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("source")) });
}
const adapterFor = (ctx, input = {}, options = {}) => createTargetTaxAdapter(ctx, costInput(input), { kind: "spell", ...options });
const powerTotal = plan => plan.total.power.reduce((sum, power) => sum + power.amount, 0);

test("single Deflect appends any-domain Power before a real payment allocation", () => {
  const ctx = fixture();
  const before = ctx.snapshot();
  const adapter = adapterFor(ctx);
  const plan = adapter.finalizeTargetPlan(requirement(), { selected: [ctx.ref("enemy")] });
  assert.deepEqual(plan.selected, [ctx.ref("enemy")]);
  assert.equal(adapter.costPlan.total.energy, 2);
  assert.deepEqual(adapter.costPlan.total.power, [{ allowedDomains: DUEL_DOMAINS, amount: 1 }]);
  assert.equal(adapter.costPlan.components[1].stage, "mandatory-additional");
  const payment = prepareCostPayment(ctx, adapter.costPlan);
  assert.deepEqual(payment.actions[0].action.plan, { finalized: true, energy: 2, power: ["Calm"] });
  assert.deepEqual(ctx.snapshot(), before);
});

test("multiple selected targets add all their taxes to one cost plan", () => {
  const ctx = fixture({ power: ["Calm", "Mind", "Order"] });
  const adapter = adapterFor(ctx);
  const plan = adapter.finalizeTargetPlan(requirement({ selection: "any" }), { selected: [ctx.ref("enemy"), ctx.ref("other")] });
  assert.equal(plan.selected.length, 2);
  assert.equal(powerTotal(adapter.costPlan), 3);
  assert.equal(prepareCostPayment(ctx, adapter.costPlan).actions[0].action.plan.power.length, 3);
});

test("stacked Deflect sums defaults and explicit values (CR 809.2)", () => {
  const ctx = fixture({ power: ["Calm", "Mind", "Order"], keywords: [{ id: "Deflect" }, { id: "deflect", value: 2 }, { id: "Deflect", value: 0 }] });
  const adapter = adapterFor(ctx);
  adapter.finalizeTargetPlan(requirement(), { selected: [ctx.ref("enemy")] });
  assert.equal(powerTotal(adapter.costPlan), 3);
  assert.equal(adapter.costPlan.components.length, 2);
});

test("own units pay no Deflect and current controller takes precedence over owner", () => {
  const ctx = fixture({ power: [] });
  const adapter = adapterFor(ctx);
  adapter.finalizeTargetPlan(requirement(), { selected: [ctx.ref("friendly")] });
  assert.equal(powerTotal(adapter.costPlan), 0);
  const owned = world().player("A", { energy: 0, power: ["Body"] }).unit("enemy", { owner: "A", controller: "B", keywords: [{ id: "Deflect" }] }).build();
  const tax = collectTargetTaxes(owned, owned.object(owned.ref("enemy")), { kind: "ability" });
  assert.equal(tax[0].cost.payments[0].amount.value, 1);
});

test("unpayable target is excluded from both query and the actual choice prompt", () => {
  const ctx = fixture({ power: [] });
  const adapter = adapterFor(ctx);
  assert.deepEqual(adapter.queryTargetCandidates(requirement()), [ctx.ref("friendly")]);
  assert.throws(() => adapter.finalizeTargetPlan(requirement()), error => error instanceof AwaitChoice &&
    assert.deepEqual(error.request.options, [ctx.ref("friendly")]) === undefined);
  const before = ctx.snapshot();
  assert.throws(() => adapter.finalizeTargetPlan(requirement(), { selected: [ctx.ref("enemy")] }), error => error.code === "invalid-target-choice");
  assert.deepEqual(ctx.snapshot(), before);
});

test("base and tax compete for the same Power instead of independently passing", () => {
  const ctx = fixture({ power: ["Fury"], source: { power: ["Fury"] } });
  const adapter = adapterFor(ctx);
  assert.deepEqual(adapter.queryTargetCandidates(requirement()), [ctx.ref("friendly")]);
  assert.throws(() => adapter.finalizeTargetPlan(requirement(), { selected: [ctx.ref("enemy")] }), error => error.code === "invalid-target-choice");
});

test("combined unaffordable selection is rejected atomically and a new affordable selection works", () => {
  const ctx = fixture({ power: ["Calm", "Mind"] });
  const adapter = adapterFor(ctx);
  const base = adapter.costPlan;
  const events = [];
  assert.throws(() => adapter.finalizeTargetPlan(requirement({ selection: "any" }), {
    selected: [ctx.ref("enemy"), ctx.ref("other")],
    onTargetsFinalized: event => events.push(event), onTargeted: event => events.push(event)
  }), error => error.code === "target-tax-unpayable");
  assert.equal(events.length, 0);
  assert.equal(adapter.costPlan, base);
  adapter.finalizeTargetPlan(requirement(), { selected: [ctx.ref("other")] });
  assert.equal(powerTotal(adapter.costPlan), 2);
});

test("RIFT-90 appendTargetTax rejects cumulative costs and rolls back the whole selection", () => {
  const ctx = fixture({ power: ["Body"] });
  const adapter = adapterFor(ctx);
  const before = adapter.costPlan;
  assert.throws(() => finalizeTargetPlan(ctx, requirement({ selection: "any" }), {
    selected: [ctx.ref("enemy"), ctx.ref("other")], tax: { kind: "deflect", amount: 1 }, taxAdapter: adapter
  }), error => error.code === "target-tax-unpayable");
  assert.equal(adapter.costPlan, before);
});

test("RIFT-90 explicit adapter appends Power and checks payer identity", () => {
  const ctx = fixture();
  const adapter = adapterFor(ctx);
  finalizeTargetPlan(ctx, requirement(), { selected: [ctx.ref("enemy")], tax: { kind: "deflect", amount: 1 }, taxAdapter: adapter });
  assert.equal(powerTotal(adapter.costPlan), 1);
  assert.equal(adapter.costPlan.total.energy, 2);
  assert.throws(() => finalizeTargetPlan(ctx, requirement(), {
    selected: [ctx.ref("enemy")], tax: { kind: "deflect", amount: 1, payer: "B" }, taxAdapter: adapter
  }), error => error.reason === "invalid-cost-plan");
  assert.equal(powerTotal(adapter.costPlan), 1);
});

test("repeated targeting pays each choice and Resolve never adds tax again", () => {
  const ctx = fixture({ power: ["Calm", "Mind"] });
  const adapter = adapterFor(ctx);
  adapter.finalizeTargetPlan(requirement(), { selected: [ctx.ref("enemy")], repeatIndex: 0 });
  const second = adapter.finalizeTargetPlan(requirement(), { selected: [ctx.ref("enemy")], repeatIndex: 1, reselected: true });
  assert.equal(powerTotal(adapter.costPlan), 2);
  resolveTargetPlan(ctx, second);
  assert.equal(powerTotal(adapter.costPlan), 2);
});

test("zero targets and zero Deflect leave no tax component", () => {
  const ctx = fixture({ power: [], keywords: [{ id: "deflect", value: 0 }] });
  const adapter = adapterFor(ctx);
  adapter.finalizeTargetPlan(requirement({ selection: "up-to", max: 2 }), { selected: [] });
  adapter.finalizeTargetPlan(requirement(), { selected: [ctx.ref("enemy")] });
  assert.equal(adapter.costPlan.components.length, 1);
});

test("total discounts apply after Deflect; ignored base costs still pay the tax", () => {
  const ctx = fixture({ power: [] });
  const discounted = adapterFor(ctx, { discounts: [{ id: "discount", resource: "power", amount: c(1) }] });
  discounted.finalizeTargetPlan(requirement(), { selected: [ctx.ref("enemy")] });
  assert.equal(powerTotal(discounted.costPlan), 0);
  const ignored = adapterFor(ctx, { baseModifications: [{ kind: "ignore-base", ignore: "resources" }] });
  assert.throws(() => ignored.finalizeTargetPlan(requirement(), { selected: [ctx.ref("enemy")] }), error => error.code === "invalid-target-choice");
});

test("separate target requirements share the accumulated cost and do not lose earlier taxes", () => {
  const ctx = fixture({ power: ["Calm", "Mind"] });
  const adapter = adapterFor(ctx);
  adapter.finalizeTargetPlan(requirement({ id: "first" }), { selected: [ctx.ref("enemy")] });
  const prior = adapter.costPlan;
  assert.throws(() => adapter.finalizeTargetPlan(requirement({ id: "second" }), { selected: [ctx.ref("other")] }), error => error.code === "invalid-target-choice");
  assert.equal(adapter.costPlan, prior);
});

test("Deflect expansion is consumed unchanged and is not counted again from keywords", () => {
  const ctx = fixture();
  const [ability] = Deflect.expand({ host: { canonicalCardId: "test.host" } });
  assert.equal(validateCardProgram(effectProgram(ability.effect)).ok, true);
  const adapter = adapterFor(ctx, {}, { effects: [{ id: "expanded-deflect", target: ctx.ref("enemy"), effect: ability.effect }] });
  adapter.finalizeTargetPlan(requirement(), { selected: [ctx.ref("enemy")] });
  assert.equal(powerTotal(adapter.costPlan), 1);
});

test("multiple bound Deflect expansions sum into one mandatory additional cost", () => {
  const ctx = fixture({ power: ["Calm", "Body", "Order"] });
  const effects = [1, 2].map((value, index) => ({
    id: `deflect:${index}`, target: ctx.ref("enemy"),
    effect: Deflect.expand({ value, host: { canonicalCardId: "test.host" } })[0].effect
  }));
  const adapter = adapterFor(ctx, {}, { effects });
  adapter.finalizeTargetPlan(requirement(), { selected: [ctx.ref("enemy")] });
  assert.equal(adapter.costPlan.components.length, 2);
  assert.deepEqual(adapter.costPlan.components[1].original.power, [{ allowedDomains: DUEL_DOMAINS, amount: 3 }]);
});

test("explicit spell-only tax adds Energy as an increase and does not tax abilities", () => {
  const ctx = fixture({ energy: 4, power: [] });
  const effect = { kind: "target.tax", cost: { energy: c(2) }, appliesTo: "spells", stage: "increase" };
  assert.equal(validateCardProgram(effectProgram(effect)).ok, true);
  const effects = [{ id: "spell-tax", target: ctx.ref("enemy"), effect }];
  const spell = adapterFor(ctx, {}, { effects });
  spell.finalizeTargetPlan(requirement(), { selected: [ctx.ref("enemy")] });
  assert.equal(spell.costPlan.total.energy, 4);
  assert.equal(spell.costPlan.components[1].stage, "increase");
  const ability = adapterFor(ctx, {}, { kind: "ability", effects });
  ability.finalizeTargetPlan(requirement(), { selected: [ctx.ref("enemy")] });
  assert.equal(ability.costPlan.total.energy, 2);
});

test("a card-text tax on spells choosing this unit also applies to friendly spells", () => {
  const ctx = fixture({ energy: 3, power: [] });
  const adapter = adapterFor(ctx, {}, { effects: [{ id: "spell-tax", target: ctx.ref("friendly"), effect: {
    kind: "target.tax", cost: { energy: c(1) }, appliesTo: "spells", stage: "increase"
  } }] });
  adapter.finalizeTargetPlan(requirement(), { selected: [ctx.ref("friendly")] });
  assert.equal(adapter.costPlan.total.energy, 3);
});

test("explicit costs and Deflect expansions sum without colliding with existing component IDs", () => {
  const ctx = fixture({ energy: 4 });
  const effects = [
    { id: "deflect", target: ctx.ref("enemy"), effect: Deflect.expand({ host: { canonicalCardId: "test.host" } })[0].effect },
    { id: "energy", target: ctx.ref("enemy"), effect: { kind: "target.tax", cost: { energy: c(1) }, appliesTo: "spells" } }
  ];
  const adapter = adapterFor(ctx, { mandatoryAdditional: [{ id: "target-tax:0", cost: { energy: c(1) } }] }, { effects });
  adapter.finalizeTargetPlan(requirement(), { selected: [ctx.ref("enemy")] });
  assert.equal(adapter.costPlan.total.energy, 4);
  assert.equal(powerTotal(adapter.costPlan), 1);
  assert.equal(new Set(adapter.costPlan.components.map(component => component.id)).size, 4);
});

test("stale bound effects never rebind to the same card ID's new zone entry", () => {
  const ctx = fixture({ power: [] });
  const previous = ctx.ref("enemy");
  const adapter = adapterFor(ctx, {}, { effects: [{ id: "old-tax", target: previous, effect: { kind: "target.tax", value: c(9) } }] });
  assert.equal(ctx.perform({ type: "return-to-hand", object: previous }).status, "done");
  assert.equal(ctx.perform({ type: "move-zone", object: ctx.ref("enemy"), to: "battlefield", location: { type: "battlefield", id: "battlefield-1" } }).status, "done");
  assert.notEqual(ctx.ref("enemy").zoneEntryId, previous.zoneEntryId);
  adapter.finalizeTargetPlan(requirement(), { selected: [ctx.ref("enemy")] });
  assert.equal(powerTotal(adapter.costPlan), 0);
});

test("tax expression reads its host's characteristics rather than the spell's", () => {
  const ctx = fixture({ power: ["Mind", "Body"] });
  const adapter = adapterFor(ctx, {}, { effects: [{ id: "host-tax", target: ctx.ref("enemy"), effect: { kind: "target.tax", value: { kind: "object-property", object: "self", property: "might" } } }] });
  adapter.finalizeTargetPlan(requirement(), { selected: [ctx.ref("enemy")] });
  assert.equal(powerTotal(adapter.costPlan), ctx.object(ctx.ref("enemy")).might);
});

test("explicit cost expressions bind self to the taxed unit", () => {
  const ctx = fixture({ energy: 4, power: [] });
  const adapter = adapterFor(ctx, {}, { effects: [{ id: "host-energy", target: ctx.ref("enemy"), effect: {
    kind: "target.tax", cost: { energy: { kind: "object-property", object: "self", property: "might" } }, appliesTo: "spells"
  } }] });
  adapter.finalizeTargetPlan(requirement(), { selected: [ctx.ref("enemy")] });
  assert.equal(adapter.costPlan.total.energy, 4);
});

test("ability sources are taxed even when the source is a unit", () => {
  const ctx = fixture({ source: { types: ["unit"], energy: 0 } });
  const adapter = adapterFor(ctx, { cost: { kind: "activated", energy: c(1) } }, { kind: "ability" });
  adapter.finalizeTargetPlan(requirement(), { selected: [ctx.ref("enemy")] });
  assert.equal(adapter.costPlan.total.energy, 1);
  assert.equal(powerTotal(adapter.costPlan), 1);
});

test("base and optional cost choices stay locked while targets are previewed", () => {
  const ctx = fixture({ energy: 4 });
  ctx.setAnswers({ "play:base": "energy", "play:optional:extra": true });
  const adapter = adapterFor(ctx, {
    baseChoices: [{ id: "energy", cost: { energy: c(2) } }, { id: "free", cost: { energy: c(0) } }],
    optionalAdditional: [{ id: "extra", kind: "additional", cost: { energy: c(1) } }]
  });
  ctx.setAnswers({});
  adapter.finalizeTargetPlan(requirement(), { selected: [ctx.ref("enemy")] });
  assert.equal(adapter.costPlan.total.energy, 3);
  assert.equal(powerTotal(adapter.costPlan), 1);
  assert.deepEqual(adapter.costPlan.selectedAdditional, [{ id: "extra", kind: "additional" }]);
});

test("later declarations cannot rewrite a previously finalized tax component", () => {
  const ctx = fixture({ power: ["Calm", "Body"] });
  const allowedDomains = ["Calm"];
  const effects = [{ id: "fixed", target: ctx.ref("enemy"), effect: { kind: "target.tax", cost: {
    payments: [{ kind: "power", amount: c(1), allowedDomains }]
  } } }];
  const adapter = adapterFor(ctx, {}, { effects });
  adapter.finalizeTargetPlan(requirement({ id: "first" }), { selected: [ctx.ref("enemy")] });
  allowedDomains[0] = "Fury";
  adapter.finalizeTargetPlan(requirement({ id: "second" }), { selected: [ctx.ref("friendly")] });
  assert.deepEqual(adapter.costPlan.total.power, [{ allowedDomains: ["Calm"], amount: 1 }]);
});

test("invalid Deflect amounts cannot become payable zero costs", () => {
  for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const ctx = fixture({ keywords: [{ id: "deflect", value }] });
    assert.throws(() => adapterFor(ctx).queryTargetCandidates(requirement()), error => error.reason === "invalid-cost-plan");
  }
});

test("null printed costs stay null and require an explicit alternate cost", () => {
  const ctx = fixture({ source: { energy: null, power: null } });
  assert.throws(() => adapterFor(ctx), error => error.reason === "missing-printed-cost");
  const adapter = adapterFor(ctx, { baseModifications: [{ kind: "alternate", id: "alternate", cost: { energy: c(0) } }] });
  adapter.finalizeTargetPlan(requirement(), { selected: [ctx.ref("enemy")] });
  assert.deepEqual(adapter.costPlan.printed, { energy: null, power: null });
  assert.equal(powerTotal(adapter.costPlan), 1);
});

test("malformed tax extensions are rejected with paths while the legacy shape remains valid", () => {
  for (const [effect, path] of [
    [{ kind: "target.tax", cost: { energy: 2 } }, ".cost.energy"],
    [{ kind: "target.tax", cost: { energy: c(2) }, value: c(1) }, ".cost"],
    [{ kind: "target.tax", value: c(1), appliesTo: "units" }, ".appliesTo"],
    [{ kind: "target.tax", value: c(1), appliesTo: ["spells"] }, ".appliesTo"],
    [{ kind: "target.tax", value: c(1), stage: "discount" }, ".stage"]
  ]) {
    const result = validateCardProgram(effectProgram(effect));
    assert.equal(result.ok, false);
    assert.ok(result.issues.some(issue => issue.path.endsWith(path)));
  }
  assert.equal(validateCardProgram(effectProgram({ kind: "target.tax", value: c(1) })).ok, true);
});
