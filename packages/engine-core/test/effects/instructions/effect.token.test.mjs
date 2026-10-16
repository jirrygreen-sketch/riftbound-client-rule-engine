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
  const actions = [];
  kernel.addReplacement(action => { actions.push(action); return null; });
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
  assert.deepEqual(actions.map(action => [action.type, action.to]), [["create-token", "board"]]);
  assert.deepEqual(kernel.pendingItems, []);
});

test("effect.token play creates only on the Chain and hands each returned reference to play", () => {
  const kernel = world().build();
  const actions = [];
  const chainRefs = [];
  kernel.addReplacement((action, context) => {
    actions.push(action);
    if (action.type === "play") {
      const pending = context.pendingItems;
      assert.deepEqual(pending, [{ object: action.object, controller: "A", status: "pending" }]);
      assert.equal(context.object(action.object).zone, "chain");
      assert.equal(context.object(action.object).location, null);
      assert.equal(context.zone("A", "board").length, chainRefs.length);
      chainRefs.push(action.object);
    }
    return null;
  });
  const run = runInstruction(token, args({ mode: literal("play"), amount: literal(2) }), { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(actions.map(action => action.type), ["create-token", "play", "create-token", "play"]);
  assert.deepEqual(actions.filter(action => action.type === "create-token").map(action => action.to), ["chain", "chain"]);
  assert.deepEqual(actions.filter(action => action.type === "play").map(action => action.location), [base, base]);
  assert.deepEqual(run.events.map(event => event.timingPoint), ["chain-item-pending", "card-played", "chain-item-pending", "card-played"]);
  assert.deepEqual(run.linked.token, {
    amount: 2, objects: tokens(kernel).map(object => object.ref), objectsComplete: true,
    createdAmount: 2, createdObjects: chainRefs
  });
  assert.deepEqual(run.linked["token.createdObjects"], chainRefs);
  assert.equal(run.linked["token.createdAmount"], 2);
  assert.equal(kernel.history({ action: "play", player: "A" }), 2);
  for (const ref of chainRefs) {
    assert.equal(kernel.object(ref), null);
    assert.equal(kernel.lastKnown(ref).zone, "chain");
  }
  for (const object of tokens(kernel)) {
    assert.ok(kernel.object(object.ref));
    assert.equal(object.energy, null);
    assert.equal(object.power, null);
    assert.deepEqual(object.location, base);
  }
  assert.deepEqual(kernel.pendingItems, []);
  assert.deepEqual(kernel.zone("A", "chain"), []);
  assert.deepEqual(run.result.linkedValues, run.linked);
  assert.deepEqual(run.result.events, run.events);
});

test("effect.token play keeps the ability controller as token owner and playing player (CR 182-183)", () => {
  const kernel = world().build().clone({ controller: "B" });
  const location = { type: "base", player: "B" };
  const run = runInstruction(token, args({ mode: literal("play"), location: literal(location) }), { world: kernel });
  assert.equal(run.result.status, "executed");
  const [played] = tokens(kernel);
  assert.equal(played.owner, "B");
  assert.equal(played.controller, "B");
  assert.deepEqual(played.location, location);
  assert.equal(kernel.history({ action: "play", player: "B" }), 1);
  assert.equal(kernel.zone("A", "board").length, 0);
});

test("effect.token play evaluates an arithmetic count through the current card-dsl Expr contract", () => {
  const kernel = world().build();
  const amount = {
    kind: "arithmetic", operator: "add",
    operands: [literal(1), { kind: "linked", instructionId: "earlier", key: "bonus" }]
  };
  const run = runInstruction(token, args({ mode: literal("play"), amount }), { world: kernel, linked: { bonus: 2 } });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.token.amount, 3);
  assert.equal(tokens(kernel).length, 3);
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

for (const mode of ["create", "play"]) for (const status of ["replaced", "prevented", "impossible"]) {
  test(`effect.token ${mode} returns negated when the creation hook reports ${status}`, () => {
    const kernel = world().build();
    kernel.addReplacement(action => action.type === "create-token" ? status : null);
    const run = runInstruction(token, args({ mode: literal(mode), amount: literal(3) }), { world: kernel });
    assert.equal(run.result.status, "negated");
    assert.equal(run.result.reason, status === "replaced" ? "replaced" : "impossible");
    assert.equal(tokens(kernel).length, 0);
    assert.deepEqual(run.linked.token, {
      amount: 0, objects: [], objectsComplete: true,
      ...(mode === "play" ? { createdAmount: 0, createdObjects: [] } : {})
    });
    assert.deepEqual(kernel.pendingItems, []);
    assert.deepEqual(kernel.zone("A", "chain"), []);
    assert.equal(run.events.length, 1);
    assert.equal(run.events[0].outcome, status);
    assert.deepEqual(run.result.events, run.events);
  });
}

for (const status of ["replaced", "prevented", "impossible"]) {
  test(`effect.token negates a ${status} play and retains its actual Pending creation`, () => {
    const kernel = world().build();
    kernel.addReplacement(action => action.type === "play" ? status : null);
    const run = runInstruction(token, args({ mode: literal("play"), amount: literal(3) }), { world: kernel });
    assert.equal(run.result.status, "negated");
    assert.equal(run.result.reason, status === "replaced" ? "replaced" : "impossible");
    assert.equal(tokens(kernel).length, 0);
    assert.equal(kernel.objects.length, 1);
    const chainRef = kernel.zone("A", "chain")[0];
    assert.deepEqual(run.linked.token, {
      amount: 0, objects: [], objectsComplete: true, createdAmount: 1, createdObjects: [chainRef]
    });
    assert.equal(kernel.pendingItems.length, 1);
    assert.equal(kernel.history({ action: "play" }), 0);
    assert.deepEqual(run.events.map(event => event.action), ["create-token", "play"]);
    assert.equal(run.events[1].outcome, status);
    assert.deepEqual(run.result.events, run.events);
  });
}

for (const failedAction of ["create-token", "play"]) {
  test(`effect.token play retains earlier successful plays when the next ${failedAction} is prevented`, () => {
    const kernel = world().build();
    kernel.addReplacement((action, context) => action.type === failedAction && context.history({ action: "play" }) === 1 ? "prevented" : null);
    const run = runInstruction(token, args({ mode: literal("play"), amount: literal(3) }), { world: kernel });
    assert.equal(run.result.status, "negated");
    assert.equal(run.linked.token.amount, 1);
    assert.equal(run.linked["token.amount"], 1);
    assert.deepEqual(run.linked.token.objects, tokens(kernel).map(object => object.ref));
    assert.equal(run.linked.token.createdAmount, failedAction === "play" ? 2 : 1);
    assert.equal(kernel.pendingItems.length, failedAction === "play" ? 1 : 0);
    assert.deepEqual(run.events.map(event => event.action), ["create-token", "play", "create-token", ...(failedAction === "play" ? ["play"] : [])]);
    assert.equal(run.events.at(-1).outcome, "prevented");
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

for (const mode of ["create", "play"]) test(`effect.token ${mode} ignores a target whose old zoneEntryId was invalidated by leaving the Board`, () => {
  const kernel = world().unit("anchor").build();
  const stale = kernel.ref("anchor");
  assert.equal(kernel.perform({ type: "return-to-hand", object: stale }).status, "done");
  assert.equal(kernel.object(stale), null);
  const before = kernel.stateForTest();
  const run = runInstruction(token, { token: literal("mech"), mode: literal(mode), target: literal("here") }, {
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

for (const mode of ["create", "play"]) test(`effect.token ${mode} handles zero tokens without an action or an unnecessary location choice`, () => {
  const kernel = world().build();
  const run = runInstruction(token, {
    token: literal("mech"), mode: literal(mode), amount: literal(0), locations: literal([base, battlefield]), choiceId: literal("where")
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.asked, null);
  assert.equal(run.events.length, 0);
  assert.deepEqual(run.linked.token, {
    amount: 0, objects: [], objectsComplete: true,
    ...(mode === "play" ? { createdAmount: 0, createdObjects: [] } : {})
  });
  assert.deepEqual(kernel.pendingItems, []);
});

for (const mode of ["create", "play"]) test(`effect.token ${mode} exceeds the available cards or printed tokens (CR 181)`, () => {
  const kernel = world().build();
  assert.equal(kernel.player("A").deckSize, 0);
  assert.equal(tokens(kernel).length, 0);
  const run = runInstruction(token, args({ mode: literal(mode), amount: literal(12) }), { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(tokens(kernel).length, 12);
  assert.equal(run.linked.token.amount, 12);
  assert.equal(new Set(run.linked.token.objects.map(ref => ref.id)).size, 12);
  assert.equal(run.events.length, mode === "play" ? 24 : 12);
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

for (const mode of ["create", "play"]) test(`effect.token ${mode} suspends for a location choice and replays deterministically with the answer`, () => {
  const kernel = world().build();
  const input = { token: literal("mech"), mode: literal(mode), amount: literal(2), locations: literal([base, battlefield]), choiceId: literal("token-location") };
  const before = kernel.stateForTest();
  const asked = runInstruction(token, input, { world: kernel });
  assert.equal(asked.result, null);
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.deepEqual(asked.asked.request, {
    id: "token-location", type: "mode", chooser: "A", visibility: "public", options: [base, battlefield]
  });
  assert.deepEqual(kernel.stateForTest(), before);
  assert.deepEqual(asked.linked, {});
  assert.deepEqual(kernel.pendingItems, []);
  const answered = runInstruction(token, input, { world: kernel, answers: { "token-location": battlefield } });
  assert.equal(answered.result.status, "executed");
  assert.equal(answered.asked, null);
  assert.equal(tokens(kernel).length, 2);
  assert.deepEqual(tokens(kernel).map(object => object.location), [battlefield, battlefield]);
  const replay = runInstruction(token, input, { world: world().build(), answers: { "token-location": battlefield } });
  assert.deepEqual(answered.result, replay.result);
  assert.deepEqual(answered.linked, replay.linked);
  assert.deepEqual(answered.events, replay.events);
  assert.deepEqual(kernel.pendingItems, []);
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
  ["sfd-207-221 Emperor's Dais", "If you do, play a 2 Might Sand Soldier unit token here", "sand-soldier", 1, battlefield]
]) {
  test(`${card}: ${ability} uses Chain creation followed by play (CR 440.2.c)`, () => {
    const kernel = world().build();
    const run = runInstruction(token, args({ mode: literal("play"), token: literal(definition), amount: literal(amount), location: literal(location) }), { world: kernel });
    assert.equal(run.result.status, "executed");
    assert.equal(run.linked.token.amount, amount);
    assert.equal(run.linked.token.createdAmount, amount);
    assert.equal(tokens(kernel).length, amount);
    assert.ok(tokens(kernel).every(object => object.might === (definition === "mech" ? 3 : 2)));
    assert.deepEqual(tokens(kernel).map(object => object.location), Array.from({ length: amount }, () => location));
    assert.deepEqual(run.events.map(event => event.action), Array.from({ length: amount }, () => ["create-token", "play"]).flat());
    assert.equal(kernel.history({ action: "play" }), amount);
    assert.deepEqual(kernel.pendingItems, []);
  });
}

test("sfd-203-221 Battle Mistress: play a Gold gear token exhausted stays blocked on Gold ability dependencies", () => {
  const kernel = world().build();
  const run = runInstruction(token, args({ mode: literal("play"), token: literal("gold") }), { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.linked.token.blockedReason, "token-definition-or-abilities-judge-required");
  assert.equal(run.linked.token.amount, 0);
  assert.equal(run.linked.token.createdAmount, 0);
  assert.deepEqual(kernel.objects, []);
  assert.deepEqual(kernel.pendingItems, []);
  assert.deepEqual(run.events, []);
});

test("effect.token schema accepts the current card-dsl expression forms", () => {
  for (const expression of [
    literal(1), { kind: "literal", value: 1 },
    { kind: "object-property", object: { id: "unit", zoneEntryId: 1 }, property: "might" },
    { kind: "object-attribute", object: { id: "unit", zoneEntryId: 1 }, attribute: "might" },
    { kind: "linked", instructionId: "earlier" },
    { kind: "linked-value", instructionId: "earlier", key: "count" },
    { kind: "count", subject: "units", filter: { type: "unit" } },
    { kind: "arithmetic", operator: "multiply", operands: [literal(2), literal(3)] }
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
    args({ amount: { kind: "arithmetic", operator: "unknown", operands: [literal(1)] } }),
    args({ amount: { kind: "arithmetic", operator: "sub", operands: [literal(1)] } }),
    args({ amount: { kind: "arithmetic", operator: "add", operands: [] } }),
    args({ amount: { kind: "arithmetic", operator: "neg", operands: [literal(1), literal(2)] } }),
    args({ amount: { kind: "arithmetic", operator: "neg", operands: [cyclic] } }),
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
