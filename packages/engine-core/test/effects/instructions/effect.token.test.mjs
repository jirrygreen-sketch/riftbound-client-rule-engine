import assert from "node:assert/strict";
import test from "node:test";
import token from "../../../src/effects/instructions/effect.token.ts";
import { AwaitChoice, runInstruction, world } from "../../../src/effects/testing/index.ts";

const literal = value => ({ kind: "constant", value });
const base = { type: "base", player: "A" };
const battlefield = { type: "battlefield", id: "battlefield-1" };
const args = overrides => ({ token: literal("mech"), location: literal(base), ...overrides });
const tokens = kernel => kernel.query({ zone: "board", type: "unit" }).filter(object => object.isToken);

test("effect.token creates a Mech with its printed definition and actual linked reference", () => {
  const kernel = world().build();
  const run = runInstruction(token, args(), { world: kernel });
  assert.equal(token.op, "effect.token");
  assert.equal(run.result.status, "executed");
  assert.equal(run.asked, null);
  const [created] = tokens(kernel);
  assert.equal(created.name, "Mech");
  assert.equal(created.cardId, null);
  assert.equal(created.might, 3);
  assert.equal(created.energy, null);
  assert.equal(created.power, null);
  assert.deepEqual(created.tags, ["Mech"]);
  assert.deepEqual(created.types, ["unit"]);
  assert.deepEqual(created.keywords, []);
  assert.equal(created.owner, "A");
  assert.equal(created.controller, "A");
  assert.deepEqual(created.location, base);
  assert.deepEqual(run.linked.token, { amount: 1, objects: [created.ref], objectsComplete: true });
  assert.equal(kernel.evaluate({ kind: "linked", instructionId: "earlier", key: "token.amount" }), 1);
  assert.deepEqual(run.linked["token.objects"], [created.ref]);
  assert.deepEqual(run.result.linkedValues, run.linked);
  assert.deepEqual(run.events.map(event => event.action), ["create-token"]);
  assert.deepEqual(run.result.events, run.events);
});

for (const [definition, name, might, tags] of [
  ["recruit", "Recruit", 1, ["Recruit"]],
  ["sand-soldier", "Sand Soldier", 2, ["Shurima"]],
  ["reflection", "Reflection", 0, []],
  ["tentacle", "Tentacle", 1, ["Bilgewater"]]
]) {
  test(`effect.token creates the CR v1.5 ${definition} definition without inventing abilities`, () => {
    const kernel = world().build();
    const run = runInstruction(token, args({ token: literal(definition) }), { world: kernel });
    assert.equal(run.result.status, "executed");
    const [created] = tokens(kernel);
    assert.equal(created.name, name);
    assert.equal(created.might, might);
    assert.deepEqual(created.tags, tags);
    assert.equal(created.energy, null);
    assert.equal(created.power, null);
  });
}

for (const status of ["replaced", "prevented", "impossible"]) {
  test(`effect.token returns negated when the creation hook reports ${status}`, () => {
    const kernel = world().build();
    kernel.addReplacement(action => action.type === "create-token" ? status : null);
    const run = runInstruction(token, args({ amount: literal(3) }), { world: kernel });
    assert.equal(run.result.status, "negated");
    assert.equal(run.result.reason, status === "replaced" ? "replaced" : "impossible");
    assert.equal(tokens(kernel).length, 0);
    assert.deepEqual(run.linked.token, { amount: 0, objects: [], objectsComplete: true });
    assert.equal(run.events.length, 1);
    assert.equal(run.events[0].outcome, status);
    assert.deepEqual(run.result.events, run.events);
  });
}

test("effect.token retains actual creations and ordered events when a later action is prevented", () => {
  const kernel = world().build();
  kernel.addReplacement((action, context) => action.type === "create-token" && tokens(context).length === 1 ? "prevented" : null);
  const run = runInstruction(token, args({ amount: literal(3) }), { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(tokens(kernel).length, 1);
  assert.equal(run.linked.token.amount, 1);
  assert.equal(run.linked["token.amount"], 1);
  assert.deepEqual(run.linked.token.objects, [tokens(kernel)[0].ref]);
  assert.equal(run.events.length, 2);
  assert.equal(run.events[1].outcome, "prevented");
  assert.deepEqual(run.result.events, run.events);
});

test("effect.token ignores a target whose old zoneEntryId was invalidated by leaving the Board", () => {
  const kernel = world().unit("anchor").build();
  const stale = kernel.ref("anchor");
  assert.equal(kernel.perform({ type: "return-to-hand", object: stale }).status, "done");
  assert.equal(kernel.object(stale), null);
  const before = kernel.stateForTest();
  const run = runInstruction(token, { token: literal("mech"), target: literal("here") }, {
    world: kernel, targets: { here: [stale] }
  });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.deepEqual(run.linked, {});
  assert.deepEqual(kernel.stateForTest(), before);
});

test("effect.token ignores an empty target set even when the count is zero", () => {
  const kernel = world().build();
  const run = runInstruction(token, { token: literal("mech"), amount: literal(0), target: literal("here") }, { world: kernel });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
});

test("effect.token uses the surviving target location when another target became stale", () => {
  const kernel = world().unit("stale").unit("anchor").build();
  const stale = kernel.ref("stale");
  kernel.perform({ type: "return-to-hand", object: stale });
  const run = runInstruction(token, { token: literal("sand-soldier"), target: literal("here") }, {
    world: kernel, targets: { here: [stale, kernel.ref("anchor")] }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(tokens(kernel)[0].location, battlefield);
});

test("effect.token resolves a non-target pick without consulting the target set", () => {
  const kernel = world().unit("anchor").build();
  const run = runInstruction(token, { token: literal("mech"), pick: literal("here") }, {
    world: kernel, targets: { here: [] }, picks: { here: [kernel.ref("anchor")] }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(tokens(kernel)[0].location, battlefield);
});

test("effect.token treats a stale non-target pick as impossible rather than mistargeted", () => {
  const kernel = world().unit("anchor").build();
  const stale = kernel.ref("anchor");
  kernel.perform({ type: "return-to-hand", object: stale });
  const run = runInstruction(token, { token: literal("mech"), pick: literal("here") }, {
    world: kernel, picks: { here: [stale] }
  });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(tokens(kernel).length, 0);
});

test("effect.token creates zero tokens without an action or an unnecessary location choice", () => {
  const kernel = world().build();
  const run = runInstruction(token, {
    token: literal("mech"), amount: literal(0), locations: literal([base, battlefield]), choiceId: literal("where")
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.asked, null);
  assert.equal(run.events.length, 0);
  assert.deepEqual(run.linked.token, { amount: 0, objects: [], objectsComplete: true });
});

test("effect.token creates more tokens than the available cards or printed tokens (CR 181)", () => {
  const kernel = world().build();
  assert.equal(kernel.player("A").deckSize, 0);
  assert.equal(tokens(kernel).length, 0);
  const run = runInstruction(token, args({ amount: literal(12) }), { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(tokens(kernel).length, 12);
  assert.equal(run.linked.token.amount, 12);
  assert.equal(new Set(run.linked.token.objects.map(ref => ref.id)).size, 12);
  assert.equal(run.events.length, 12);
  assert.equal(kernel.player("A").deckSize, 0);
});

for (const amount of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "2", null]) {
  test(`effect.token rejects the invalid evaluated count ${String(amount)}`, () => {
    const kernel = world().build();
    const run = runInstruction(token, args({ amount: literal(amount) }), { world: kernel });
    assert.equal(run.result.status, "negated");
    assert.equal(tokens(kernel).length, 0);
    assert.equal(run.events.length, 0);
    assert.equal(run.linked.token.amount, 0);
  });
}

test("effect.token suspends for a location choice and replays deterministically with the answer", () => {
  const kernel = world().build();
  const input = { token: literal("mech"), amount: literal(2), locations: literal([base, battlefield]), choiceId: literal("token-location") };
  const before = kernel.stateForTest();
  const asked = runInstruction(token, input, { world: kernel });
  assert.equal(asked.result, null);
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.deepEqual(asked.asked.request, {
    id: "token-location", type: "mode", chooser: "A", visibility: "public", options: [base, battlefield]
  });
  assert.deepEqual(kernel.stateForTest(), before);
  assert.deepEqual(asked.linked, {});
  const answered = runInstruction(token, input, { world: kernel, answers: { "token-location": battlefield } });
  assert.equal(answered.result.status, "executed");
  assert.equal(answered.asked, null);
  assert.equal(tokens(kernel).length, 2);
  assert.deepEqual(tokens(kernel).map(object => object.location), [battlefield, battlefield]);
  const replay = runInstruction(token, input, { world: world().build(), answers: { "token-location": battlefield } });
  assert.deepEqual(answered.result, replay.result);
  assert.deepEqual(answered.linked, replay.linked);
  assert.deepEqual(answered.events, replay.events);
});

test("effect.token rejects an answer outside the offered location choices", () => {
  const kernel = world().build();
  const run = runInstruction(token, {
    token: literal("mech"), locations: literal([base, battlefield]), choiceId: literal("where")
  }, { world: kernel, answers: { where: { type: "battlefield", id: "not-offered" } } });
  assert.equal(run.result.status, "negated");
  assert.equal(tokens(kernel).length, 0);
  assert.equal(run.events.length, 0);
});

test("effect.token uses a single location option without suspending", () => {
  const kernel = world().build();
  const run = runInstruction(token, {
    token: literal("mech"), locations: literal([base]), choiceId: literal("where")
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.asked, null);
});

test("effect.token evaluates linked values and records the actual count under the authored link key", () => {
  const kernel = world().build();
  const run = runInstruction(token, args({
    token: { kind: "linked", instructionId: "earlier", key: "definition" },
    amount: { kind: "linked-value", instructionId: "earlier", key: "count" },
    linkKey: literal("created-mechs")
  }), { world: kernel, linked: { definition: "mech", count: 2 } });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked["created-mechs"].amount, 2);
  assert.equal(run.linked["created-mechs"].objects.length, 2);
  assert.deepEqual(run.result.linkedValues["created-mechs"], run.linked["created-mechs"]);
});

test("effect.token evaluates a count once before creating any additional units", () => {
  const kernel = world().unit("first").unit("second").build();
  const run = runInstruction(token, args({ amount: { kind: "count", subject: "units", filter: { type: "unit", zone: "board" } } }), { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(tokens(kernel).length, 2);
});

for (const definition of ["gold", "sprite", "bird", "shadow-clone", "bomb", "unknown", "__proto__"]) {
  test(`effect.token keeps the unsupported ${definition} definition or ability dependencies judge-required`, () => {
    const kernel = world().build();
    const run = runInstruction(token, args({ token: literal(definition) }), { world: kernel });
    assert.equal(run.result.status, "negated");
    assert.equal(run.linked.token.blockedReason, "token-definition-or-abilities-judge-required");
    assert.equal(tokens(kernel).length, 0);
    assert.equal(run.events.length, 0);
  });
}

for (const [card, ability, definition, amount, location] of [
  ["sfd-021-221 Ferrous Forerunner (M1 Rumble)", "Play two 3 Might Mech unit tokens to your base", "mech", 2, base],
  ["sfd-157-221 Royal Guard (M1 Fiora)", "When you play me, play a 2 Might Sand Soldier unit token here", "sand-soldier", 1, battlefield],
  ["sfd-207-221 Emperor's Dais", "If you do, play a 2 Might Sand Soldier unit token here", "sand-soldier", 1, battlefield],
  ["sfd-203-221 Battle Mistress", "play a Gold gear token exhausted", "gold", 1, base]
]) {
  test(`${card}: ${ability} stays blocked pending Chain token creation (CR 440.2.c)`, () => {
    const kernel = world().build();
    const run = runInstruction(token, args({ mode: literal("play"), token: literal(definition), amount: literal(amount), location: literal(location) }), { world: kernel });
    assert.equal(run.result.status, "negated");
    assert.equal(run.result.reason, "impossible");
    assert.equal(run.linked.token.blockedReason, "token-play-requires-chain-creation");
    assert.equal(kernel.objects.length, 0);
    assert.equal(run.events.length, 0);
  });
}

test("effect.token schema accepts all seven card-dsl expression forms", () => {
  for (const expression of [
    literal(1), { kind: "literal", value: 1 },
    { kind: "object-property", object: { id: "unit", zoneEntryId: 1 }, property: "might" },
    { kind: "object-attribute", object: { id: "unit", zoneEntryId: 1 }, attribute: "might" },
    { kind: "linked", instructionId: "earlier" },
    { kind: "linked-value", instructionId: "earlier", key: "count" },
    { kind: "count", subject: "units", filter: { type: "unit" } }
  ]) assert.deepEqual(token.argsSchema.parse(args({ amount: expression })).amount, expression);
});

test("effect.token schema rejects raw values, malformed expressions, and ambiguous destinations", () => {
  const cyclic = {};
  cyclic.self = cyclic;
  for (const input of [
    null, [], {}, { token: literal("mech") }, args({ token: "mech" }), args({ amount: 2 }),
    args({ amount: { kind: "unknown" } }), args({ amount: { kind: "constant" } }),
    args({ amount: literal(NaN) }), args({ amount: literal(Infinity) }), args({ amount: literal(cyclic) }),
    args({ amount: { kind: "object-property", object: "unit", property: "might" } }),
    args({ amount: { kind: "linked", key: "amount" } }),
    args({ amount: { kind: "count", subject: "units", filter: [] } }),
    args({ target: literal("here") }), args({ pick: literal("here") }),
    { token: literal("mech"), locations: literal([base]) }, args({ choiceId: literal("where") }),
    args({ exhausted: literal(true) })
  ]) assert.throws(() => token.argsSchema.parse(input), TypeError);
});

test("effect.token rejects malformed or unavailable location requests without creating a token", () => {
  for (const input of [
    args({ location: literal(null) }), args({ location: literal({ type: "battlefield", id: "" }) }),
    args({ location: literal({ type: "base", player: "B" }) }),
    { token: literal("mech"), locations: literal([]), choiceId: literal("where") },
    { token: literal("mech"), locations: literal([base]), choiceId: literal(7) },
    args({ mode: literal("copy") }), args({ linkKey: literal(null) })
  ]) {
    const kernel = world().build();
    const run = runInstruction(token, input, { world: kernel });
    assert.equal(run.result.status, "negated");
    assert.equal(kernel.objects.length, 0);
    assert.equal(run.events.length, 0);
  }
});
