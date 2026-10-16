import assert from "node:assert/strict";
import test from "node:test";
import resources from "../../../src/effects/instructions/effect.resources.ts";
import { AwaitChoice, runInstruction, world } from "../../../src/effects/testing/index.ts";

const literal = value => ({ kind: "constant", value });
const linked = instructionId => ({ kind: "linked", instructionId });
const combined = { energy: literal(2), power: literal(["Calm", "Chaos", "Chaos"]) };

test("effect.resources adds Energy then Power and links actual additions, preserving the existing pool", () => {
  const kernel = world().player("A", { energy: 3, power: ["Fury", "Chaos"] }).build();
  const run = runInstruction(resources, combined, { world: kernel });
  assert.equal(resources.op, "effect.resources");
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").energy, 5);
  assert.deepEqual(kernel.player("A").power, ["Fury", "Chaos", "Calm", "Chaos", "Chaos"]);
  assert.deepEqual(run.events.map(event => event.action), ["gain-energy", "gain-power"]);
  assert.deepEqual(run.result.events, run.events);
  assert.deepEqual(run.linked.resources, { player: "A", energy: 2, power: ["Calm", "Chaos", "Chaos"] });
  assert.deepEqual(run.result.linkedValues, run.linked);
  assert.equal(kernel.player("B").energy, 0);
});

test("effect.resources supports all six domains and repeated Power without deduplication", () => {
  const power = ["Fury", "Calm", "Mind", "Body", "Chaos", "Order", "Fury"];
  const kernel = world().build();
  const run = runInstruction(resources, { player: literal("B"), power: literal(power) }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.player("B").power, power);
  assert.deepEqual(run.linked.resources, { player: "B", energy: 0, power });
  assert.deepEqual(run.events.map(event => event.action), ["gain-power"]);
  assert.deepEqual(kernel.player("A").power, []);
});

for (const action of ["gain-energy", "gain-power"]) {
  for (const status of ["replaced", "prevented", "impossible"]) {
    test("effect.resources negates " + status + " " + action + " and preserves the other actual addition", () => {
      const kernel = world().build();
      kernel.addReplacement(candidate => candidate.type === action ? status : null);
      const run = runInstruction(resources, combined, { world: kernel });
      const energy = action === "gain-energy" ? 0 : 2;
      const power = action === "gain-power" ? [] : ["Calm", "Chaos", "Chaos"];
      assert.equal(run.result.status, "negated");
      assert.equal(run.result.reason, status === "prevented" ? "skipped" : status);
      assert.equal(kernel.player("A").energy, energy);
      assert.deepEqual(kernel.player("A").power, power);
      assert.deepEqual(run.linked.resources, { player: "A", energy, power });
      assert.deepEqual(run.events.map(event => event.action), ["gain-energy", "gain-power"]);
      assert.deepEqual(run.result.events, run.events);
      assert.equal(run.events.find(event => event.action === action).outcome, status);
    });
  }
}

test("effect.resources records a fully prevented addition as zero, not the requested quantity", () => {
  const kernel = world().player("A", { energy: 7 }).build();
  kernel.addReplacement(action => action.type === "gain-energy" ? "prevented" : null);
  const run = runInstruction(resources, { energy: literal(9) }, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(kernel.player("A").energy, 7);
  assert.deepEqual(run.linked.resources, { player: "A", energy: 0, power: [] });
});

test("effect.resources ignores an empty target set before evaluating unavailable linked resource values", () => {
  const kernel = world().build();
  const before = kernel.stateForTest();
  const run = runInstruction(resources, { target: literal("unit"), energy: linked("missing") }, { world: kernel });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(kernel.stateForTest(), before);
  assert.deepEqual(run.linked, {});
  assert.deepEqual(run.events, []);
});

test("effect.resources ignores targets that leave and return with a new zoneEntryId", () => {
  const kernel = world().unit("unit").build();
  const stale = kernel.ref("unit");
  assert.equal(kernel.perform({ type: "return-to-hand", object: stale }).status, "done");
  assert.equal(kernel.perform({ type: "move-zone", object: kernel.ref("unit"), to: "base" }).status, "done");
  assert.notDeepEqual(kernel.ref("unit"), stale);
  const before = kernel.stateForTest();
  const run = runInstruction(resources, { target: literal("recipient"), ...combined }, {
    world: kernel, targets: { recipient: [stale] }
  });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(kernel.stateForTest(), before);
  assert.deepEqual(run.linked, {});
});

test("effect.resources uses current controllers of legal targets and deduplicates recipient candidates", () => {
  const kernel = world().unit("live", { owner: "A", controller: "B" }).unit("lost").build();
  const stale = kernel.ref("lost");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  const run = runInstruction(resources, { target: literal("units"), energy: literal(3) }, {
    world: kernel, targets: { units: [stale, kernel.ref("live"), kernel.ref("live")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("B").energy, 3);
  assert.equal(kernel.player("A").energy, 0);
  assert.deepEqual(run.linked.resources, { player: "B", energy: 3, power: [] });
  assert.equal(run.events.length, 1);
});

test("effect.resources reads non-target player and object picks without creating a target", () => {
  const kernel = world().unit("unit", { controller: "B" }).build();
  const run = runInstruction(resources, { pick: literal("recipient"), energy: literal(1) }, {
    world: kernel, picks: { recipient: [kernel.ref("unit"), "B", "B"] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("B").energy, 1);
  assert.deepEqual(run.events.map(event => event.action), ["gain-energy"]);
  assert.deepEqual(kernel.targets("recipient"), []);
});

test("effect.resources stale non-target picks are impossible rather than ignored", () => {
  const kernel = world().unit("unit").build();
  const stale = kernel.ref("unit");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  const before = kernel.stateForTest();
  const run = runInstruction(resources, { pick: literal("recipient"), energy: literal(1) }, {
    world: kernel, picks: { recipient: [stale] }
  });
  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.deepEqual(kernel.stateForTest(), before);
  assert.deepEqual(run.linked, {});
});

test("effect.resources zero quantities succeed without any gain action or replacement", () => {
  const kernel = world().build();
  kernel.addReplacement(action => ["gain-energy", "gain-power"].includes(action.type) ? "replaced" : null);
  const run = runInstruction(resources, { energy: literal(0), power: literal([]) }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events, []);
  assert.deepEqual(run.linked.resources, { player: "A", energy: 0, power: [] });
});

for (const amount of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, "2", false]) {
  test("effect.resources rejects invalid Energy " + JSON.stringify(amount) + " before either resource action", () => {
    const kernel = world().build();
    const run = runInstruction(resources, { ...combined, energy: literal(amount) }, { world: kernel });
    assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
    assert.equal(kernel.player("A").energy, 0);
    assert.deepEqual(kernel.player("A").power, []);
    assert.deepEqual(run.linked, {});
  });
}

for (const power of [null, "Chaos", ["Unknown"], ["Universal"], ["Chaos", null]]) {
  test("effect.resources rejects unsupported Power " + JSON.stringify(power) + " without an Energy side effect", () => {
    const kernel = world().build();
    const run = runInstruction(resources, { ...combined, power: literal(power) }, { world: kernel });
    assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
    assert.equal(kernel.player("A").energy, 0);
    assert.deepEqual(kernel.player("A").power, []);
  });
}

test("effect.resources accepts the largest safe Energy amount and rejects pool overflow", () => {
  const kernel = world().build();
  const run = runInstruction(resources, { energy: literal(Number.MAX_SAFE_INTEGER) }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.resources.energy, Number.MAX_SAFE_INTEGER);
  const overflow = runInstruction(resources, { energy: literal(1), power: literal(["Order"]) }, { world: kernel });
  assert.equal(overflow.result.status, "negated");
  assert.equal(kernel.player("A").energy, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(kernel.player("A").power, []);
  assert.deepEqual(overflow.events, []);
});

test("effect.resources evaluates count, arithmetic and linked values at resolution with a custom link key", () => {
  const kernel = world().unit("first").unit("second").build();
  const run = runInstruction(resources, {
    energy: { kind: "arithmetic", operator: "add", operands: [
      { kind: "count", subject: "objects", filter: { type: "unit" } }, linked("bonus")
    ] },
    power: linked("chosen-power"), linkKey: literal("added")
  }, { world: kernel, linked: { bonus: 3, "chosen-power": ["Mind", "Mind"] } });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.added, { player: "A", energy: 5, power: ["Mind", "Mind"] });
  assert.deepEqual(run.result.linkedValues, { added: run.linked.added });
  assert.equal(run.linked.resources, undefined);
});

test("effect.resources accepts object expressions bound by the interpreter and evaluates both resource values", () => {
  const kernel = world().unit("unit", { energy: 3, power: ["Mind", "Order"] }).build();
  const object = kernel.ref("unit");
  const run = runInstruction(resources, {
    energy: { kind: "object-property", object, property: "energy" },
    power: { kind: "object-attribute", object, attribute: "power" }
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.resources, { player: "A", energy: 3, power: ["Mind", "Order"] });
  assert.equal(kernel.player("A").energy, 3);
  assert.deepEqual(kernel.player("A").power, ["Mind", "Order"]);
});

test("effect.resources never treats an evaluated null printed Energy or Power as zero", () => {
  for (const field of ["energy", "power"]) {
    const kernel = world().unit("unit", { energy: null, power: null }).build();
    const run = runInstruction(resources, {
      ...combined, [field]: { kind: "object-property", object: kernel.ref("unit"), property: field }
    }, { world: kernel });
    assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
    assert.equal(kernel.player("A").energy, 0);
    assert.deepEqual(kernel.player("A").power, []);
    assert.equal(kernel.getObject("unit").energy, null);
    assert.equal(kernel.getObject("unit").power, null);
  }
});

test("effect.resources suspends its own recipient choice and deterministically replays the whole instruction", () => {
  const kernel = world().build();
  const args = { pick: literal("players"), choiceId: literal("resource-recipient"), ...combined };
  const options = { world: kernel, picks: { players: ["B", "A", "B"] } };
  const before = kernel.stateForTest();
  const asked = runInstruction(resources, args, options);
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.equal(asked.result, null);
  assert.deepEqual(asked.asked.request, {
    id: "resource-recipient", type: "mode", chooser: "A", visibility: "public", options: ["B", "A"]
  });
  assert.deepEqual(kernel.stateForTest(), before);
  assert.deepEqual(kernel.linkedSnapshot(), {});
  const replay = world().build();
  const answer = { "resource-recipient": "B" };
  const resolved = runInstruction(resources, args, { ...options, answers: answer });
  const repeated = runInstruction(resources, args, { ...options, world: replay, answers: answer });
  assert.equal(resolved.result.status, "executed");
  assert.deepEqual(resolved.result, repeated.result);
  assert.deepEqual(resolved.linked, repeated.linked);
  assert.deepEqual(kernel.stateForTest(), replay.stateForTest());
  assert.equal(kernel.player("B").energy, 2);
  assert.deepEqual(kernel.player("B").power, ["Calm", "Chaos", "Chaos"]);
  assert.equal(kernel.player("A").energy, 0);
});

test("effect.resources rejects invalid choice answers without any partial action", () => {
  const kernel = world().build();
  const run = runInstruction(resources, {
    player: literal(["A", "B"]), choiceId: literal("recipient"), ...combined
  }, { world: kernel, answers: { recipient: "C" } });
  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(kernel.player("A").energy, 0);
  assert.deepEqual(kernel.player("A").power, []);
});

test("effect.resources does not guess an ambiguous or unknown recipient", () => {
  for (const player of [["A", "B"], "C", null]) {
    const kernel = world().build();
    const run = runInstruction(resources, { player: literal(player), ...combined }, { world: kernel });
    assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
    assert.equal(kernel.player("A").energy, 0);
    assert.deepEqual(run.linked, {});
  }
});

test("ogn-204-298 Seal of Discord: its Add effect adds one Chaos Power, with no implicit cost or priority work", () => {
  // Catalog text: exhaust: Reaction — Add Chaos. Costs and timing are caller-owned.
  const kernel = world().object("seal", {
    cardId: "ogn-204-298", types: ["gear"], zone: "board", owner: "B", controller: "A",
    location: { type: "base", player: "A" }, energy: 0, power: ["Chaos"]
  }).build();
  const before = kernel.getObject("seal");
  const run = runInstruction(resources, { power: literal(["Chaos"]) }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.player("A").power, ["Chaos"]);
  assert.deepEqual(kernel.player("B").power, []);
  assert.deepEqual(kernel.getObject("seal"), before);
  assert.deepEqual(run.events.map(event => event.action), ["gain-power"]);
  assert.equal(run.events[0].timingPoint, kernel.timingPoint);
});

test("ogn-166-298 Chaos Rune: inherent Add 1 Energy effect follows CR 164.2.a and preserves null printed costs", () => {
  // The catalog omits Basic Rune ability text; CR 164.2 supplies its abilities.
  const kernel = world().object("rune", {
    cardId: "ogn-166-298", types: ["rune"], zone: "rune-zone", energy: null, power: null, might: null
  }).build();
  const before = kernel.getObject("rune");
  const run = runInstruction(resources, { energy: literal(1) }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.resources, { player: "A", energy: 1, power: [] });
  assert.equal(kernel.player("A").energy, 1);
  assert.deepEqual(kernel.getObject("rune"), before);
  assert.equal(kernel.getObject("rune").energy, null);
  assert.equal(kernel.getObject("rune").power, null);
});

test("ogn-166-298 Chaos Rune: inherent Add Chaos Power effect follows CR 164.2.b.1", () => {
  const kernel = world().rune("rune", { cardId: "ogn-166-298", energy: null, power: null }).build();
  const run = runInstruction(resources, { power: literal(["Chaos"]) }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.resources, { player: "A", energy: 0, power: ["Chaos"] });
  assert.deepEqual(kernel.player("A").power, ["Chaos"]);
  assert.deepEqual(run.events.map(event => event.action), ["gain-power"]);
});

test("effect.resources schema rejects missing / unknown args, raw values and malformed Exprs", () => {
  for (const args of [
    null, [], {}, { energy: 1 }, { power: ["Chaos"] }, { energy: { kind: "unknown" } },
    { energy: { kind: "constant" } }, { energy: literal(NaN) }, { energy: literal(Infinity) },
    { energy: { kind: "arithmetic", operator: "neg", operands: [] } },
    { energy: literal(1), extra: literal(2) },
    { energy: literal(1), player: literal("A"), pick: literal("players") },
    { energy: literal(1), target: literal("units"), pick: literal("players") }
  ]) assert.throws(() => resources.argsSchema.parse(args), TypeError);
});
