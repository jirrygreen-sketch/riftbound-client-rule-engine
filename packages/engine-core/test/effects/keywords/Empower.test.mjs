import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "@riftbound/card-dsl";
import empower from "../../../dist/effects/keywords/Empower.js";
import { keywordDefinitionsById } from "../../../dist/effects/keywords/registry.generated.js";
import { runAbilityBody } from "../../../dist/effects/interpreter.js";
import { createProgramBinding, expandProgram } from "../../../dist/programs/index.js";
import { world } from "../../../dist/effects/testing/index.js";
import { TurnFlow } from "../../../dist/turn/flow.js";
import { bindResolveContext, createActionPipelineHost } from "../../../dist/events/action-adapter.js";
import { settle } from "../../turn/helpers.mjs";

const host = { canonicalCardId: "test:empower" };
const c = value => ({ kind: "constant", value });
const cost = { kind: "activated", energy: c(2) };
const expand = (params = {}) => empower.expand({ host, params: { cost, ...params } });
const program = abilities => ({
  canonicalCardId: host.canonicalCardId,
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText: "Empower keyword contract fixture",
  abilities
});

// Use the real program binder, Finalize/payment, Chain and interpreter. The
// synthetic program carries the expansion because KeywordAbility cannot yet
// carry params. No card status, body, world state or primitive is patched.
function setup(params = {}, { energy = 20, types = ["unit"], abilities } = {}) {
  const binding = createProgramBinding({ cardPrograms: [program(abilities ?? expand(params))] });
  const initial = world().player("A").player("B")
    .object("empower-source", {
      cardId: host.canonicalCardId, types, zone: "board", location: { type: "base", player: "A" },
      energy: null, power: null, might: 3
    })
    .unit("source")
    .unit("enemy", { owner: "B" })
    .deck(["A:deck:1", "A:deck:2"], { owner: "A" })
    .deck(["B:deck:1", "B:deck:2"], { owner: "B" })
    .rune(["A:rune:1", "A:rune:2"], { owner: "A" })
    .rune(["B:rune:1", "B:rune:2"], { owner: "B" })
    .build();
  const kernel = initial.clone({ sourceSnapshot: initial.getObject("empower-source") });
  const port = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => kernel.choose(request),
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const flow = new TurnFlow({
    host: port, player: id => kernel.player(id), turnOrder: ["A", "B"],
    battlefields: [{ id: "bf1", controller: null }, { id: "bf2", controller: null }]
  });
  flow.start();
  assert.equal(flow.phase, "main");
  const engine = flow.chain;
  assert.equal(engine.commit({ type: "gain-energy", player: "A", amount: energy }).status, "done");
  flow.advance();
  const source = () => kernel.getObject("empower-source");
  const draft = (index = 0) => binding.describeActivate(source(), "A", index);
  const activate = (index = 0) => {
    const item = flow.execute(draft(index));
    settle(flow);
    return item;
  };
  return { flow, engine, kernel, binding, source, draft, activate };
}

test("Empower registers a non-valued keyword with independent activated instances (CR 827.3)", () => {
  assert.equal(keywordDefinitionsById.get("Empower"), empower);
  assert.equal(empower.keyword, "Empower");
  assert.equal(empower.valued, false);
  assert.equal(empower.stacking, "separate");
  for (const ref of ["442.1.c.1", "827.1.b.1", "827.1.c.1", "827.1.c.5", "827.3"]) {
    assert.ok(empower.ruleRefs.includes(ref), ref);
  }
});

test("Empower expands to action-speed Empower of its source with a Finalize restriction", () => {
  const [ability] = expand();
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.cost, cost);
  assert.deepEqual(ability.restriction.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "eq",
    right: c(0)
  });
  assert.equal(ability.body.length, 1);
  assert.equal(ability.body[0].op, "effect.empower");
  assert.deepEqual(ability.body[0].args, { amount: c(1) });
  assert.deepEqual(ability.body[0].targets ?? [], []);
  assert.deepEqual(ability.body[0].picks ?? [], []);
});

test("the printed CostSpec preserves resource, non-resource and modified cost expressions", () => {
  const printed = {
    kind: "activated",
    energy: { kind: "arithmetic", operator: "max", operands: [c(0), {
      kind: "arithmetic", operator: "sub", operands: [c(12), {
        kind: "count", subject: "runes", filter: { type: "rune", controller: "self", zone: "rune-zone" }
      }]
    }] },
    payments: [{ kind: "exhaust", object: "self" }]
  };
  const [ability] = expand({ cost: printed });
  assert.deepEqual(ability.cost, printed);
  const result = validateCardProgram(program([ability]));
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("a numeric keyword value never replaces the printed Empower cost", () => {
  assert.deepEqual(
    empower.expand({ host, value: 12, params: { cost } }),
    empower.expand({ host, value: 0, params: { cost } })
  );
  assert.deepEqual(empower.expand({ host, value: 12 })[0].cost, { kind: "empower" });
});

test("an explicit timing override is preserved (CR 827.1.c.4)", () => {
  assert.equal(expand({ timing: "reaction" })[0].timing, "reaction");
});

test("expanded normal, stacking, zero-cap and reaction abilities validate as CardPrograms", () => {
  for (const params of [{}, { multiple: true }, { multiple: true, limit: 3 },
    { multiple: true, limit: 0 }, { timing: "reaction" }]) {
    const result = validateCardProgram(program(expand(params)));
    assert.equal(result.ok, true, JSON.stringify(result.issues));
  }
});

test("multiple-Empower permission removes the restriction and applies the cap only to the effect", () => {
  const [ability] = expand({ multiple: true, limit: 3 });
  assert.deepEqual(ability.restriction.condition, { kind: "always" });
  assert.deepEqual(ability.body[0].condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "lt",
    right: c(3)
  });
  assert.deepEqual(ability.body[0].args, { amount: c(1), multiple: c(true), limit: c(3) });
});

test("invalid permissions, caps and timing are rejected without coercion", () => {
  for (const params of [{ multiple: 1 }, { multiple: "true" }, { multiple: null }, { limit: 3 },
    { multiple: true, limit: -1 }, { multiple: true, limit: 1.5 },
    { multiple: true, limit: Number.POSITIVE_INFINITY },
    { multiple: true, limit: Number.MAX_SAFE_INTEGER + 1 }, { timing: "instant" }, { timing: null }]) {
    assert.throws(() => expand(params), TypeError);
  }
});

test("the program expander keeps every Empower instance separately instead of summing or deduplicating", () => {
  const f = setup();
  const expanded = expandProgram(program([
    { kind: "keyword", keyword: "empower", value: 2 },
    { kind: "keyword", keyword: "empower", value: 4 }
  ]), f.source());
  assert.equal(expanded.expanded.length, 2);
  assert.deepEqual(expanded.expanded.map(ability => ability.kind), ["activated", "activated"]);
  assert.deepEqual(expanded.expanded.map(ability => ability.body[0].args.amount), [c(1), c(1)]);
});

for (const type of ["unit", "gear", "legend"]) {
  test(`Empower pays its ability cost and empowers its own ${type} through the Chain and effect.empower`, () => {
    const f = setup({}, { types: [type] });
    const before = f.kernel.events.length;
    f.activate();
    assert.equal(f.source().empowered, 1);
    assert.equal(f.source().energy, null);
    assert.equal(f.source().power, null);
    assert.equal(f.kernel.getObject("source").empowered, 0);
    assert.equal(f.kernel.getObject("enemy").empowered, 0);
    assert.equal(f.kernel.player("A").energy, 18);
    assert.deepEqual(f.kernel.events.slice(before).map(event => event.action), ["pay", "empower"]);
    assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "became-target"), false);
  });
}

test("a normal Empower cannot be activated again while Empowered and does not pay a second cost", () => {
  const f = setup();
  f.activate();
  assert.throws(() => f.engine.execute(f.draft()), /Finalize legality failed/);
  assert.equal(f.kernel.player("A").energy, 18);
  assert.equal(f.source().empowered, 1);
});

test("an unpaid Empower ability cannot resolve or change status", () => {
  const f = setup({}, { energy: 1 });
  assert.throws(() => f.engine.execute(f.draft()), /pay|Energy|energy/);
  assert.equal(f.kernel.player("A").energy, 1);
  assert.equal(f.source().empowered, 0);
});

test("Empower pays resource and non-resource costs through Finalize (CR 827.1.c.2)", () => {
  const f = setup({ cost: { kind: "activated", energy: c(1), payments: [{ kind: "exhaust", object: "self" }] } });
  const before = f.kernel.events.length;
  f.activate();
  assert.equal(f.kernel.player("A").energy, 19);
  assert.equal(f.source().exhausted, true);
  assert.equal(f.source().empowered, 1);
  const actions = f.kernel.events.slice(before).map(event => event.action);
  assert.deepEqual([...actions].sort(), ["empower", "exhaust", "pay"]);
  assert.equal(actions.at(-1), "empower");
});

test("a second ability empowering the source before resolution leaves the first Empower with no effect", () => {
  const f = setup({ timing: "reaction" });
  f.engine.execute(f.draft());
  while (f.engine.priority !== "A") f.engine.pass(f.engine.priority);
  f.engine.execute(f.draft());
  settle(f.flow);
  assert.equal(f.kernel.player("A").energy, 16);
  assert.equal(f.source().empowered, 1);
  assert.equal(f.kernel.events.filter(event => event.action === "empower").length, 1);
});

test("multiple-Empower reaches three, then activation at cap still pays and has no effect (contract 3.4)", () => {
  const f = setup({ multiple: true, limit: 3 });
  for (let count = 1; count <= 3; count++) {
    f.activate();
    assert.equal(f.source().empowered, count);
    assert.equal(f.kernel.player("A").energy, 20 - 2 * count);
  }
  const before = f.kernel.events.length;
  f.activate();
  assert.equal(f.source().empowered, 3);
  assert.equal(f.kernel.player("A").energy, 12);
  assert.deepEqual(f.kernel.events.slice(before).map(event => event.action), ["pay"]);
  assert.equal(f.kernel.events.filter(event => event.action === "empower").length, 3);
});

test("multiple-Empower permission with cap one still permits activation while Empowered", () => {
  const f = setup({ multiple: true, limit: 1 });
  f.activate();
  f.activate();
  assert.equal(f.source().empowered, 1);
  assert.equal(f.kernel.player("A").energy, 16);
});

test("multiple-Empower rechecks its cap after a newer reaction resolves", () => {
  const f = setup({ multiple: true, limit: 1, timing: "reaction" });
  f.flow.execute(f.draft());
  while (f.engine.priority !== "A") f.flow.pass(f.engine.priority);
  f.flow.execute(f.draft());
  settle(f.flow);
  assert.equal(f.source().empowered, 1);
  assert.equal(f.kernel.player("A").energy, 16);
  assert.equal(f.kernel.events.filter(event => event.action === "empower").length, 1);
});

test("a zero cap is preserved: activation is legal, pays, and never becomes Empowered", () => {
  const f = setup({ multiple: true, limit: 0 });
  f.activate();
  assert.equal(f.source().empowered, 0);
  assert.equal(f.kernel.player("A").energy, 18);
  assert.equal(f.kernel.events.filter(event => event.action === "empower").length, 0);
});

test("multiple-Empower without a cap remains stackable", () => {
  const f = setup({ multiple: true });
  for (let count = 1; count <= 4; count++) {
    f.activate();
    assert.equal(f.source().empowered, count);
  }
  assert.equal(f.kernel.player("A").energy, 12);
});

test("independent Empower instances use their respective costs but share the source's status restriction", () => {
  for (const [index, paid] of [[0, 2], [1, 5]]) {
    const f = setup({}, { abilities: [...expand(), ...expand({ cost: { kind: "activated", energy: c(5) } })] });
    assert.equal(f.binding.activationAbilities(f.source()).length, 2);
    f.activate(index);
    assert.equal(f.kernel.player("A").energy, 20 - paid);
    assert.equal(f.source().empowered, 1);
    assert.throws(() => f.engine.execute(f.draft(1 - index)), /Finalize legality failed/);
  }
});

test("the normal resolution gate uses the current source count rather than its activation snapshot", () => {
  const f = setup();
  f.activate();
  const context = f.kernel.clone({ sourceSnapshot: f.source() });
  const result = runAbilityBody(expand()[0].body, context);
  assert.equal(result.results[0].result.status, "negated");
  assert.equal(result.results[0].result.reason, "skipped");
  assert.deepEqual(result.events, []);
  assert.equal(f.source().empowered, 1);
});
