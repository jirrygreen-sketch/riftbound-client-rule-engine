import assert from "node:assert/strict";
import test from "node:test";
import {
  TargetSelectionError,
  finalizePick,
  finalizeRepeatedTargetPlans,
  finalizeTargetPlan,
  queryTargetCandidates,
  reselectTargetPlan,
  resolveTargetPlan,
  targetBounds
} from "../../src/target/target-plan.ts";

const ref = (id, zoneEntryId = 1) => ({ id, zoneEntryId });
const object = (id, values = {}) => ({
  ref: ref(id, values.zoneEntryId ?? 1),
  cardId: id,
  name: id,
  types: values.types ?? ["unit"],
  tags: values.tags ?? [],
  keywords: values.keywords ?? [],
  owner: values.owner ?? "A",
  controller: values.controller ?? "A",
  zone: values.zone ?? "board",
  location: values.location ?? { type: "battlefield", id: "bf1" },
  might: values.might ?? 2,
  energy: values.energy ?? null,
  power: values.power ?? null,
  exhausted: values.exhausted ?? false,
  damage: values.damage ?? 0,
  stunned: values.stunned ?? false,
  buffs: values.buffs ?? 0,
  attachedTo: values.attachedTo ?? null,
  faceDown: values.faceDown ?? false,
  isToken: values.isToken ?? false
});

function world(objects, answers = []) {
  const queue = [...answers];
  const linked = [];
  return {
    source: objects[0] ?? object("source"),
    controller: "A",
    timingPoint: "chain.item-finalized",
    object: candidate => objects.find(item => item.ref.id === candidate.id && item.ref.zoneEntryId === candidate.zoneEntryId) ?? null,
    lastKnown: candidate => objects.find(item => item.ref.id === candidate.id) ?? object(candidate.id),
    query: filter => objects.filter(item => Object.entries(filter).every(([key, value]) => {
      if (key === "type") return item.types.includes(value);
      if (key === "types") return item.types.includes(value);
      return item[key] === value;
    })),
    zoneSlice: () => [],
    targets: () => [],
    picks: () => [],
    player: id => ({ id, energy: 0, power: [], runePool: [], runes: [], xp: 0, score: 0, handSize: 0, handCount: 0, deckSize: 0, deckCount: 0, runeDeckSize: 0, runeDeckCount: 0 }),
    evaluate: expression => expression.value,
    test: () => true,
    linked: () => undefined,
    history: () => 0,
    choose: request => {
      linked.push(request);
      return queue.length > 0 ? queue.shift() : request.options.slice(request.min, request.min);
    },
    perform: () => ({ status: "done", events: [] }),
    link: () => {},
    addContinuous: () => {},
    registerDelayedTrigger: () => {},
    choiceRequests: linked
  };
}

const requirement = (overrides = {}) => ({ id: "unit", filter: { type: "unit", zone: "board" }, ...overrides });

test("target bounds default to one mandatory target", () => {
  assert.deepEqual(targetBounds(requirement(), 3), { min: 1, max: 1 });
});

test("targeting-up-to-zero-targets-legal: up-to permits zero targets", () => {
  assert.deepEqual(targetBounds(requirement({ selection: "up-to", max: 2 }), 3), { min: 0, max: 2 });
});

test("targeting-up-to-partial-count: any permits zero through all available targets", () => {
  assert.deepEqual(targetBounds(requirement({ selection: "any" }), 3), { min: 0, max: 3 });
});

test("all selects the available set", () => {
  assert.deepEqual(targetBounds(requirement({ selection: "all" }), 3), { min: 0, max: 3 });
});

test("invalid target bounds are rejected", () => {
  assert.throws(() => targetBounds(requirement({ min: 2, max: 1 }), 3), error => error instanceof TargetSelectionError && error.code === "invalid-bounds");
});

test("targeting-choose-locks-at-finalize: query returns only the current filtered objects", () => {
  const ctx = world([object("a"), object("b", { types: ["gear"] })]);
  assert.deepEqual(queryTargetCandidates(ctx, requirement()), [ref("a")]);
});

test("query deduplicates repeated provider references", () => {
  const first = object("a");
  const ctx = world([first, first]);
  assert.deepEqual(queryTargetCandidates(ctx, requirement()), [ref("a")]);
});

test("targeting-restriction-not-itself-target: location is a restriction on the chosen object", () => {
  const ctx = world([object("a", { location: { type: "battlefield", id: "bf1" } }), object("b", { location: { type: "battlefield", id: "bf2" } })]);
  assert.deepEqual(queryTargetCandidates(ctx, requirement({ location: { type: "battlefield", id: "bf2" } })), [ref("b")]);
});

test("base location compares by owning player", () => {
  const ctx = world([object("a", { location: { type: "base", player: "A" } }), object("b", { location: { type: "base", player: "B" } })]);
  assert.deepEqual(queryTargetCandidates(ctx, requirement({ location: { type: "base", player: "B" } })), [ref("b")]);
});

test("targeting-pending-item-not-targetable: pending chain objects are excluded by default", () => {
  const ctx = world([object("a", { zone: "chain" }), object("b")]);
  assert.deepEqual(queryTargetCandidates(ctx, requirement({ filter: { type: "unit" } })), [ref("b")]);
});

test("host may distinguish finalized chain objects from pending objects", () => {
  const ctx = world([object("a", { types: ["spell"], zone: "chain" }), object("b")]);
  assert.deepEqual(queryTargetCandidates(ctx, requirement({ filter: { type: "spell", zone: "chain" } }), { isPending: candidate => candidate.id === "b" }), [ref("a")]);
});

test("mandatory target asks the context for one answer", () => {
  const ctx = world([object("a"), object("b")], [[ref("b")]]);
  const plan = finalizeTargetPlan(ctx, requirement());
  assert.deepEqual(plan.selected, [ref("b")]);
  assert.equal(ctx.choiceRequests[0].id, "target:unit");
});

test("explicit target answers are validated without asking", () => {
  const ctx = world([object("a"), object("b")]);
  const plan = finalizeTargetPlan(ctx, requirement(), { selected: [ref("a")] });
  assert.deepEqual(plan.selected, [ref("a")]);
  assert.equal(ctx.choiceRequests.length, 0);
});

test("illegal explicit targets are rejected", () => {
  const ctx = world([object("a")]);
  assert.throws(() => finalizeTargetPlan(ctx, requirement(), { selected: [ref("missing")] }), error => error.code === "invalid-target-choice");
});

test("duplicate explicit targets are rejected", () => {
  const ctx = world([object("a")]);
  assert.throws(() => finalizeTargetPlan(ctx, requirement(), { selected: [ref("a"), ref("a")] }), error => error.code === "invalid-target-choice");
});

test("targeting-required-target-missing-illegal: required target with no legal object is rejected", () => {
  const ctx = world([]);
  assert.throws(() => finalizeTargetPlan(ctx, requirement()), error => error.code === "no-legal-targets");
});

test("up-to zero finalizes without asking", () => {
  const ctx = world([object("a")]);
  const plan = finalizeTargetPlan(ctx, requirement({ selection: "up-to", max: 2 }), { selected: [] });
  assert.deepEqual(plan.selected, []);
  assert.equal(ctx.choiceRequests.length, 0);
});

test("all finalizes every legal object", () => {
  const ctx = world([object("a"), object("b")]);
  const plan = finalizeTargetPlan(ctx, requirement({ selection: "all" }));
  assert.deepEqual(plan.selected, [ref("a"), ref("b")]);
});

test("targeting-group-requirement-at-finalize: group target retains its group kind in the locked requirement", () => {
  const ctx = world([object("bf1", { types: ["battlefield"] })]);
  const plan = finalizeTargetPlan(ctx, requirement({ id: "group", kind: "group", group: true, filter: { type: "battlefield" } }), { selected: [ref("bf1")] });
  assert.equal(plan.requirement.kind, "group");
  assert.equal(plan.requirement.group, true);
});

test("finalize locks copies of object references", () => {
  const ctx = world([object("a")]);
  const selected = ref("a");
  const plan = finalizeTargetPlan(ctx, requirement(), { selected: [selected] });
  assert.notStrictEqual(plan.selected[0], selected);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.selected), true);
});

test("finalize emits one group event and one target event per member", () => {
  const ctx = world([object("a"), object("b")]);
  const events = [];
  const plan = finalizeTargetPlan(ctx, requirement({ selection: "all" }), {
    onTargetsFinalized: event => events.push(event),
    onTargeted: event => events.push(event)
  });
  assert.equal(plan.selected.length, 2);
  assert.deepEqual(events.map(event => event.kind), ["targets-finalized", "became-target", "became-target"]);
});

test("pick finalization does not emit target callbacks", () => {
  const ctx = world([object("a")]);
  const plan = finalizePick(ctx, { id: "pick", options: ["a", "b"], selection: "one" }, ["a"]);
  assert.deepEqual(plan.selected, ["a"]);
  assert.equal(ctx.choiceRequests.length, 0);
});

test("pick rejects duplicate values", () => {
  const ctx = world([]);
  assert.throws(() => finalizePick(ctx, { id: "pick", options: ["a", "b"], selection: "any" }, ["a", "a"]), error => error.code === "invalid-target-choice");
});

test("pick can select a non-object player value", () => {
  const ctx = world([]);
  const plan = finalizePick(ctx, { id: "player", options: ["A", "B"], selection: "one" }, ["B"]);
  assert.deepEqual(plan.selected, ["B"]);
});

test("resolve keeps a target whose zone entry identity is unchanged", () => {
  const ctx = world([object("a")]);
  const plan = finalizeTargetPlan(ctx, requirement(), { selected: [ref("a")] });
  assert.deepEqual(resolveTargetPlan(ctx, plan).selected, [ref("a")]);
  assert.equal(resolveTargetPlan(ctx, plan).status, "resolved");
});

test("resolve drops a target whose zone entry identity changed", () => {
  const ctx = world([object("a", { zoneEntryId: 2 })]);
  const plan = { requirement: requirement(), selected: [ref("a", 1)], lockedAt: "finalize", retestAtResolve: true };
  const result = resolveTargetPlan(ctx, plan);
  assert.equal(result.status, "ignored");
  assert.deepEqual(result.invalid, [ref("a", 1)]);
  assert.equal(result.reason, "mistargeted");
});

test("targeting-untargetable-category-change: resolve drops a target that left the legal filter", () => {
  const ctx = world([object("a", { types: ["gear"] })]);
  const plan = { requirement: requirement(), selected: [ref("a")], lockedAt: "finalize", retestAtResolve: true };
  assert.equal(resolveTargetPlan(ctx, plan).status, "ignored");
});

test("resolve drops a target that became pending", () => {
  const ctx = world([object("a")]);
  const plan = { requirement: requirement(), selected: [ref("a")], lockedAt: "finalize", retestAtResolve: true };
  assert.equal(resolveTargetPlan(ctx, plan, { isPending: () => true }).status, "ignored");
});

test("targeting-group-subset-after-move: resolve preserves the legal portion of a group", () => {
  const ctx = world([object("a"), object("b", { types: ["gear"] })]);
  const plan = { requirement: requirement({ selection: "any" }), selected: [ref("a"), ref("b")], lockedAt: "finalize", retestAtResolve: true };
  const result = resolveTargetPlan(ctx, plan);
  assert.equal(result.status, "partial");
  assert.deepEqual(result.selected, [ref("a")]);
});

test("resolve with an empty up-to plan is resolved", () => {
  const ctx = world([object("a")]);
  const plan = { requirement: requirement({ selection: "up-to", max: 2 }), selected: [], lockedAt: "finalize", retestAtResolve: true };
  assert.equal(resolveTargetPlan(ctx, plan).status, "resolved");
});

test("resolve reports its result to the host", () => {
  const ctx = world([object("a")]);
  const plan = { requirement: requirement(), selected: [ref("a")], lockedAt: "finalize", retestAtResolve: true };
  let reported;
  resolveTargetPlan(ctx, plan, { onTargetsResolved: event => { reported = event; } });
  assert.equal(reported.kind, "targets-resolved");
  assert.equal(reported.status, "resolved");
});

test("targeting-new-choices-remake-all: reselection starts from the current legal set", () => {
  const objects = [object("a"), object("b")];
  const ctx = world(objects, [[ref("b")]]);
  const original = { requirement: requirement(), selected: [ref("a")], lockedAt: "finalize", retestAtResolve: true };
  const replacement = reselectTargetPlan(ctx, original);
  assert.deepEqual(replacement.selected, [ref("b")]);
  assert.equal(ctx.choiceRequests[0].id, "target:unit");
});

test("targeting-new-choices-retrigger-targeting: reselection emits a second became-target event", () => {
  const ctx = world([object("a"), object("b")], [[ref("b")]]);
  const events = [];
  const original = { requirement: requirement(), selected: [ref("a")], lockedAt: "finalize", retestAtResolve: true };
  reselectTargetPlan(ctx, original, { onTargeted: event => events.push(event) });
  assert.equal(events[0].reselected, true);
});

test("repeat plans use independent request ids and answers", () => {
  const ctx = world([object("a"), object("b")], [[ref("a")], [ref("b")]]);
  const plans = finalizeRepeatedTargetPlans(ctx, requirement(), 2);
  assert.deepEqual(plans.map(plan => plan.selected), [[ref("a")], [ref("b")]]);
  assert.deepEqual(ctx.choiceRequests.map(request => request.id), ["target:unit:repeat:0", "target:unit:repeat:1"]);
});

test("repeat plans support explicit independent answers", () => {
  const ctx = world([object("a"), object("b")]);
  const plans = finalizeRepeatedTargetPlans(ctx, requirement(), 2, { selections: [[ref("a")], [ref("b")]] });
  assert.deepEqual(plans.map(plan => plan.repeatIndex), [0, 1]);
});

test("repeat count zero makes no target choice", () => {
  const ctx = world([object("a")]);
  assert.deepEqual(finalizeRepeatedTargetPlans(ctx, requirement(), 0), []);
  assert.equal(ctx.choiceRequests.length, 0);
});

test("negative repeat count is rejected", () => {
  const ctx = world([object("a")]);
  assert.throws(() => finalizeRepeatedTargetPlans(ctx, requirement(), -1), error => error.code === "invalid-bounds");
});

test("m1-target-tax-deflect: Deflect tax calls the cost adapter once per selected target", () => {
  const ctx = world([object("a"), object("b")]);
  const requests = [];
  finalizeTargetPlan(ctx, requirement({ selection: "all" }), {
    selected: [ref("a"), ref("b")],
    tax: { kind: "deflect", amount: 1, payer: "B" },
    taxAdapter: { appendTargetTax: request => { requests.push(request); return { status: "appended" }; } }
  });
  assert.deepEqual(requests.map(request => [request.target.id, request.payer, request.amount]), [["a", "B", 1], ["b", "B", 1]]);
});

test("Deflect tax can be calculated per target", () => {
  const ctx = world([object("a"), object("b")]);
  const amounts = [];
  finalizeTargetPlan(ctx, requirement({ selection: "all" }), {
    tax: target => ({ kind: "deflect", amount: target.ref.id === "a" ? 1 : 2 }),
    taxAdapter: { appendTargetTax: request => { amounts.push(request.amount); return { status: "appended" }; } }
  });
  assert.deepEqual(amounts, [1, 2]);
});

test("Deflect tax requires an explicit cost adapter", () => {
  const ctx = world([object("a")]);
  assert.throws(() => finalizeTargetPlan(ctx, requirement(), { selected: [ref("a")], tax: { kind: "deflect", amount: 1 } }), error => error.code === "tax-adapter-required");
});

test("unpayable Deflect tax aborts finalization before notifications", () => {
  const ctx = world([object("a")]);
  let notified = false;
  assert.throws(() => finalizeTargetPlan(ctx, requirement(), {
    selected: [ref("a")],
    tax: { kind: "deflect", amount: 1 },
    taxAdapter: { appendTargetTax: () => ({ status: "unpayable", reason: "no rune" }) },
    onTargetsFinalized: () => { notified = true; }
  }), error => error.code === "target-tax-unpayable");
  assert.equal(notified, false);
});

test("zero Deflect tax does not require a payment action", () => {
  const ctx = world([object("a")]);
  const plan = finalizeTargetPlan(ctx, requirement(), { selected: [ref("a")], tax: { kind: "deflect", amount: 0 } });
  assert.deepEqual(plan.selected, [ref("a")]);
});

test("target tax request carries the complete locked plan", () => {
  const ctx = world([object("a")]);
  let received;
  const plan = finalizeTargetPlan(ctx, requirement(), {
    selected: [ref("a")],
    tax: { kind: "deflect", amount: 1 },
    taxAdapter: { appendTargetTax: request => { received = request; return { status: "appended" }; } }
  });
  assert.strictEqual(received.targetPlan, plan);
  assert.equal(received.targetPlan.lockedAt, "finalize");
});
