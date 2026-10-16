import test from "node:test";
import assert from "node:assert/strict";
import { runAbilityBody } from "../../dist/effects/interpreter.js";
import { runInstruction, world } from "../../dist/effects/testing/index.js";

const constant = value => ({ kind: "constant", value });
const historyInstruction = query => ({
  id: "history", op: "condition.history", args: { query: constant(query) }
});
const play = (kernel, id, player = "A") => {
  const outcome = kernel.perform({ type: "play", object: kernel.ref(id), player });
  assert.equal(outcome.status, "done");
};
function cards() {
  const kernel = world()
    .hand("self", { cardId: "same-printing", types: ["unit"], tags: ["Legion"], energy: null, power: null })
    .hand("other", { cardId: "same-printing", types: ["unit"], tags: ["Legion"], energy: null, power: null })
    .hand("gear", { types: ["gear"], tags: ["Equipment"] })
    .hand("opponent", { owner: "B" })
    .build();
  return kernel.clone({ sourceSnapshot: kernel.getObject("self") });
}

test("builder exposes attacker, defender and default null combat roles", () => {
  const kernel = world().unit("attacker", { combatRole: "attacker" })
    .unit("defender", { combatRole: "defender" }).unit("idle")
    .card("unprinted", { combatRole: null, energy: null, power: null }).build();
  for (const [id, role] of [["attacker", "attacker"], ["defender", "defender"], ["idle", null], ["unprinted", null]]) {
    assert.equal(kernel.object(kernel.ref(id)).combatRole, role);
    assert.equal(kernel.evaluate({ kind: "object-property", object: kernel.ref(id), property: "combatRole" }), role);
  }
  assert.equal(kernel.getObject("unprinted").energy, null);
  assert.equal(kernel.getObject("unprinted").power, null);
  const outcome = runAbilityBody([{
    id: "role", op: "condition.value", args: {
      value: { kind: "object-property", object: kernel.ref("attacker"), property: "combatRole" }
    }
  }], kernel, new Map());
  assert.equal(outcome.linkedValues["role.value"], "attacker");
});

test("combat roles survive snapshots and last-known reads but clear on a new zone entry", () => {
  const kernel = world().unit("unit", { combatRole: "defender" }).build();
  const before = kernel.ref("unit");
  const copy = kernel.clone({ sourceSnapshot: kernel.getObject("unit") });
  assert.equal(copy.source.combatRole, "defender");
  assert.equal(copy.perform({ type: "return-to-hand", object: before }).status, "done");
  assert.equal(copy.lastKnown(before).combatRole, "defender");
  assert.equal(copy.object(copy.ref("unit")).combatRole, null);
  assert.equal(kernel.object(before).combatRole, "defender");
  play(copy, "unit");
  assert.equal(copy.getObject("unit").combatRole, null);
});

test("history excludes self across zone entries while retaining a separate copy of the same printing", () => {
  const kernel = cards();
  const firstEntry = kernel.ref("self");
  play(kernel, "self");
  play(kernel, "other");
  play(kernel, "opponent", "B");
  assert.equal(kernel.perform({ type: "return-to-hand", object: kernel.ref("self") }).status, "done");
  play(kernel, "self");
  const query = { scope: "turn", action: "play", player: "A" };
  assert.equal(kernel.history(query), 3);
  assert.equal(kernel.history({ ...query, exclude: "self" }), 1);
  assert.equal(kernel.history({ ...query, exclude: "source" }), 1);
  assert.equal(kernel.history({ ...query, object: firstEntry }), 1);
  assert.equal(kernel.history({ ...query, object: kernel.ref("self") }), 0);
  assert.equal(kernel.history({ ...query, object: firstEntry, exclude: "self" }), 0);
});

test("history combines exclusion, object filters, player and timing point", () => {
  const kernel = cards();
  for (const id of ["self", "other", "gear"]) play(kernel, id);
  play(kernel, "opponent", "B");
  const query = { scope: "turn", action: "play", player: "A", exclude: "self", timingPoint: "card-played" };
  assert.equal(kernel.history({ ...query, objectFilter: { type: "unit", tags: ["Legion"], zone: "hand", owner: "A" } }), 1);
  assert.equal(kernel.history({ ...query, objectFilter: { type: "gear", tag: "Equipment" } }), 1);
  assert.equal(kernel.history({ ...query, objectFilter: { type: "unit", controller: "B" } }), 0);
  assert.equal(kernel.history({ ...query, objectFilter: { types: ["unit", "gear"] } }), 0);
  assert.equal(kernel.history({ ...query, timingPoint: "main-start", objectFilter: {} }), 0);
});

test("object filters read historical characteristics instead of a later zone entry or controller", () => {
  const kernel = cards();
  play(kernel, "other");
  assert.equal(kernel.perform({ type: "take-control", object: kernel.ref("other"), player: "B" }).status, "done");
  assert.equal(kernel.perform({ type: "banish", object: kernel.ref("other") }).status, "done");
  const query = { action: "play", objectFilter: { controller: "A", zone: "hand", cardId: "same-printing", energy: null, power: null } };
  assert.equal(kernel.history(query), 1);
  assert.equal(kernel.history({ action: "play", objectFilter: { controller: "B" } }), 0);
  assert.equal(kernel.history({ action: "play", objectFilter: { energy: 0 } }), 0);
  assert.equal(kernel.clone().history(query), 1);
});

test("object filters can distinguish historical combat designations", () => {
  const kernel = world().unit("attacker", { combatRole: "attacker" })
    .unit("defender", { combatRole: "defender" }).unit("idle").build();
  for (const id of ["attacker", "defender", "idle"]) {
    assert.equal(kernel.perform({ type: "kill", object: kernel.ref(id) }).status, "done");
  }
  for (const role of ["attacker", "defender", null]) {
    assert.equal(kernel.history({ action: "kill", objectFilter: { combatRole: role } }), 1);
  }
  assert.equal(kernel.history({ action: "kill", objectFilter: { unknown: true } }), 0);
});

for (const selector of [{ target: "excluded" }, { pick: "excluded" }, { linked: "excluded" }]) {
  test(`history resolves exclusion binding ${JSON.stringify(selector)}`, () => {
    const kernel = cards();
    const refs = [kernel.ref("self"), kernel.ref("other")];
    kernel.setTargets("excluded", refs);
    kernel.setPicks("excluded", ["A", ...refs]);
    kernel.link("excluded", refs);
    for (const id of ["self", "other", "gear"]) play(kernel, id);
    assert.equal(kernel.history({ action: "play", exclude: selector }), 1);
    const outcome = runAbilityBody([historyInstruction({ action: "play", exclude: selector })], kernel, new Map());
    assert.equal(outcome.linkedValues["history.count"], 1);
  });
}

test("linked exclusions also accept one object and absent bindings exclude nothing", () => {
  const kernel = cards();
  kernel.link("one", kernel.ref("self"));
  play(kernel, "self");
  play(kernel, "other");
  assert.equal(kernel.history({ action: "play", exclude: { linked: "one" } }), 1);
  for (const selector of [{ target: "missing" }, { pick: "missing" }, { linked: "missing" }]) {
    assert.equal(kernel.history({ action: "play", exclude: selector }), 2);
  }
});

test("objectless actions remain countable but do not match object filters", () => {
  const kernel = cards();
  assert.equal(kernel.perform({ type: "gain-energy", player: "A", amount: 1 }).status, "done");
  assert.equal(kernel.history({ action: "gain-energy", exclude: "self" }), 1);
  assert.equal(kernel.history({ action: "gain-energy", objectFilter: {} }), 0);
  assert.equal(kernel.history({ action: "gain-energy", object: kernel.ref("self") }), 0);
});

test("history captures action data independently of the caller's later changes", () => {
  const kernel = cards();
  const action = { type: "play", object: kernel.ref("other"), player: "A" };
  assert.equal(kernel.perform(action).status, "done");
  action.object.id = "self";
  action.player = "B";
  assert.equal(kernel.history({ action: "play", player: "A", exclude: "self" }), 1);
  assert.equal(kernel.history({ action: "play", player: "B" }), 0);
});

test("prevented actions and suspended transactions do not enter filtered history", () => {
  const kernel = cards();
  kernel.addReplacement(action => action.type === "play" && action.object.id === "gear" ? "prevented" : null);
  assert.equal(kernel.perform({ type: "play", object: kernel.ref("gear"), player: "A" }).status, "prevented");
  const definition = {
    op: "test.history-transaction", argsSchema: { parse: value => value },
    execute(ctx) {
      const outcome = ctx.perform({ type: "play", object: kernel.ref("other"), player: "A" });
      assert.equal(outcome.status, "done");
      ctx.choose({ id: "confirm", type: "optional", chooser: "A", visibility: "public" });
      return { status: "executed", events: [...outcome.events] };
    }
  };
  const query = { action: "play", exclude: "self", objectFilter: { type: "unit" } };
  assert.ok(runInstruction(definition, {}, { world: kernel }).asked);
  assert.equal(kernel.history(query), 0);
  assert.equal(runInstruction(definition, {}, { world: kernel, answers: { confirm: true } }).result.status, "executed");
  assert.equal(kernel.history(query), 1);
});

test("interpreter context forwards the v1.1 history fields unchanged", () => {
  const kernel = cards();
  play(kernel, "self");
  play(kernel, "other");
  play(kernel, "gear");
  const query = { action: "play", exclude: "self", objectFilter: { type: "unit" } };
  const forwarded = [];
  const context = new Proxy(kernel, { get(target, key) {
    if (key === "history") return value => { forwarded.push(value); return target.history(value); };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const outcome = runAbilityBody([historyInstruction(query)], context, new Map());
  assert.equal(outcome.linkedValues["history.count"], 1);
  assert.deepEqual(forwarded, [{ scope: "turn", ...query }]);
});

for (const query of [
  { exclude: "other" }, { exclude: { id: "runtime-ref", zoneEntryId: 1 } },
  { exclude: { target: "" } }, { exclude: { target: "x", pick: "y" } },
  { objectFilter: null }, { objectFilter: [] }, { objectFilter: { energy: undefined } }
]) {
  test(`invalid v1.1 history field fails closed: ${JSON.stringify(query)}`, () => {
    assert.throws(() => runAbilityBody([historyInstruction(query)], cards(), new Map()));
  });
}
