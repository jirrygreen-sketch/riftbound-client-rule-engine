import assert from "node:assert/strict";
import test from "node:test";
import { runInstruction, world } from "../../dist/effects/testing/index.js";

const token = { name: "Sprite", types: ["unit"], might: 1, energy: null, power: null };
const base = { type: "base", player: "A" };
const create = (kernel, to = "chain", extra = {}) => kernel.perform({
  type: "create-token", player: "A", token, to, ...(to === "board" ? { location: base } : {}), ...extra
});

test("create-token on the Board returns the live new ObjectRef", () => {
  const kernel = world().build();
  const outcome = create(kernel, "board");
  assert.equal(outcome.status, "done");
  assert.deepEqual(outcome.result, kernel.ref("token-1"));
  const object = kernel.object(outcome.result);
  assert.equal(object.zone, "board");
  assert.deepEqual(object.location, base);
  assert.equal(object.isToken, true);
  assert.equal(object.energy, null);
  assert.equal(object.power, null);
  assert.deepEqual(kernel.pendingItems, []);
});

test("legacy create-token without to keeps its Board destination", () => {
  const kernel = world().build();
  const observed = [];
  kernel.addReplacement(action => { observed.push(action); return null; });
  const outcome = kernel.perform({ type: "create-token", player: "A", token, location: base });
  assert.equal(kernel.object(outcome.result).zone, "board");
  assert.equal(observed[0].to, "board");
});

test("create-token on the Chain creates the object of a Pending item", () => {
  const kernel = world().build();
  const outcome = create(kernel);
  assert.equal(outcome.status, "done");
  assert.deepEqual(outcome.result, kernel.ref("token-1"));
  assert.equal(kernel.object(outcome.result).zone, "chain");
  assert.equal(kernel.object(outcome.result).location, null);
  assert.deepEqual(kernel.zone("A", "chain"), [outcome.result]);
  assert.deepEqual(kernel.zone("A", "board"), []);
  assert.deepEqual(kernel.pendingItems, [{ object: outcome.result, controller: "A", status: "pending" }]);
  assert.equal(outcome.events[0].timingPoint, "chain-item-pending");
  assert.equal(kernel.history({ action: "play" }), 0);
});

test("Chain creation preserves the creating player's identity and entry order", () => {
  const kernel = world().build();
  const first = create(kernel, "chain", { player: "B" }).result;
  const second = create(kernel, "chain", { player: "B" }).result;
  assert.deepEqual(kernel.zone("B", "chain"), [first, second]);
  assert.deepEqual(kernel.zone("A", "chain"), []);
  assert.equal(kernel.object(first).owner, "B");
  assert.equal(kernel.object(first).controller, "B");
});

test("token generation never overwrites an existing object with a generated id", () => {
  const kernel = world().hand("token-1").build();
  const existing = kernel.ref("token-1");
  const outcome = create(kernel);
  assert.notEqual(outcome.result.id, existing.id);
  assert.equal(kernel.object(existing).zone, "hand");
});

test("returned token references and Pending snapshots are detached", () => {
  const kernel = world().build();
  const outcome = create(kernel);
  outcome.result.zoneEntryId = 99;
  kernel.pendingItems[0].object.zoneEntryId = 100;
  assert.equal(kernel.object(kernel.ref("token-1")).zone, "chain");
  assert.equal(kernel.pendingItems[0].object.zoneEntryId, 1);
});

test("play takes over a Chain token, consumes Pending, and invalidates the old reference", () => {
  const kernel = world().deck(["top", "bottom"]).build();
  const created = create(kernel).result;
  const outcome = kernel.perform({ type: "play", object: created, player: "A", location: base });
  assert.equal(outcome.status, "done");
  assert.equal(kernel.object(created), null);
  assert.equal(kernel.lastKnown(created).zone, "chain");
  assert.equal(kernel.getObject(created.id).zone, "board");
  assert.deepEqual(kernel.getObject(created.id).location, base);
  assert.equal(kernel.getObject(created.id).isToken, true);
  assert.deepEqual(kernel.pendingItems, []);
  assert.deepEqual(kernel.zone("A", "chain"), []);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["top", "bottom"]);
  assert.equal(outcome.events.at(-1).timingPoint, "card-played");
});

test("play defaults a Chain token to its player's Base", () => {
  const kernel = world().build();
  const object = create(kernel, "chain", { player: "B" }).result;
  assert.equal(kernel.perform({ type: "play", object, player: "B" }).status, "done");
  assert.deepEqual(kernel.getObject(object.id).location, { type: "base", player: "B" });
});

test("token creation and play history use the emitted Pending and played timing points", () => {
  const kernel = world().build();
  const object = create(kernel).result;
  assert.equal(kernel.history({ action: "create-token", timingPoint: "chain-item-pending" }), 1);
  kernel.perform({ type: "play", object, player: "A" });
  assert.equal(kernel.history({ action: "play", timingPoint: "card-played" }), 1);
  assert.equal(kernel.history({ action: "play", timingPoint: "chain-item-pending" }), 0);
});

test("play applies a finalized cost to a Chain token", () => {
  const kernel = world().player("A", { energy: 3 }).build();
  const object = create(kernel).result;
  assert.equal(kernel.perform({ type: "play", object, player: "A", cost: { finalized: true, energy: 2 } }).status, "done");
  assert.equal(kernel.player("A").energy, 1);
  assert.equal(kernel.getObject(object.id).zone, "board");
});

test("an unpaid play leaves the Chain token Pending", () => {
  const kernel = world().build();
  const object = create(kernel).result;
  assert.equal(kernel.perform({ type: "play", object, player: "A", cost: { finalized: true, energy: 2 } }).status, "prevented");
  assert.equal(kernel.object(object).zone, "chain");
  assert.equal(kernel.pendingItems.length, 1);
});

test("leaving the Chain removes the token's Pending item", () => {
  const kernel = world().build();
  const object = create(kernel).result;
  kernel.perform({ type: "move-zone", object, to: "banishment" });
  assert.deepEqual(kernel.pendingItems, []);
  assert.equal(kernel.perform({ type: "play", object, player: "A" }).status, "impossible");
});

for (const status of ["replaced", "prevented", "impossible"]) {
  test(`${status} token creation produces no token or result reference`, () => {
    const kernel = world().build();
    kernel.addReplacement(action => action.type === "create-token" ? status : null);
    const outcome = create(kernel);
    assert.equal(outcome.status, status);
    assert.equal(Object.hasOwn(outcome, "result"), false);
    assert.deepEqual(kernel.objects, []);
    assert.deepEqual(kernel.pendingItems, []);
  });
}

test("replacement of play leaves the existing Pending token unchanged", () => {
  const kernel = world().build();
  const object = create(kernel).result;
  kernel.addReplacement(action => action.type === "play" ? "replaced" : null);
  assert.equal(kernel.perform({ type: "play", object, player: "A" }).status, "replaced");
  assert.equal(kernel.object(object).zone, "chain");
  assert.equal(kernel.pendingItems.length, 1);
});

test("choice replay rolls back Chain token creation and its generated identity", () => {
  const kernel = world().build();
  const definition = {
    op: "test.play-token", argsSchema: { parse: args => args },
    execute(context) {
      const created = create(context);
      context.choose({ id: "continue", type: "optional", chooser: "A", visibility: "public" });
      const played = context.perform({ type: "play", object: created.result, player: "A", location: base });
      return { status: "executed", events: [...created.events, ...played.events] };
    }
  };
  assert.ok(runInstruction(definition, {}, { world: kernel }).asked);
  assert.deepEqual(kernel.objects, []);
  assert.deepEqual(kernel.pendingItems, []);
  assert.deepEqual(kernel.events, []);
  const replayed = runInstruction(definition, {}, { world: kernel, answers: { continue: true } });
  assert.equal(replayed.result.status, "executed");
  assert.equal(kernel.objects.length, 1);
  assert.equal(kernel.getObject("token-1").zone, "board");
  assert.deepEqual(kernel.events.map(event => event.action), ["create-token", "play"]);
});

const infoAction = (kernel, type, id = "top") => type === "look"
  ? { type, objects: [kernel.ref(id)], player: "A" }
  : { type, object: kernel.ref(id), ...(type === "show-off" ? { properties: ["might"] } : {}) };

for (const type of ["reveal", "look", "show-off"]) {
  test(`${type} returns a detached list of the actual object references`, () => {
    const kernel = world().deck(["top", "bottom"]).build();
    const object = kernel.ref("top");
    const before = kernel.zone("A", "deck");
    const outcome = kernel.perform(infoAction(kernel, type));
    assert.equal(outcome.status, "done");
    assert.deepEqual(outcome.result, [object]);
    assert.deepEqual(kernel.zone("A", "deck"), before);
    outcome.result[0].zoneEntryId = 42;
    assert.equal(kernel.object(object).zone, "deck");
  });

  test(`${type} does not report stale references as displayed`, () => {
    const kernel = world().deck("top").build();
    const action = infoAction(kernel, type);
    kernel.perform({ type: "draw", player: "A", amount: 1 });
    const outcome = kernel.perform(action);
    assert.equal(outcome.status, "impossible");
    assert.equal(Object.hasOwn(outcome, "result"), false);
  });

  test(`${type} replacement does not return displayed references`, () => {
    const kernel = world().deck("top").build();
    kernel.addReplacement(action => action.type === type ? "replaced" : null);
    const outcome = kernel.perform(infoAction(kernel, type));
    assert.equal(outcome.status, "replaced");
    assert.equal(Object.hasOwn(outcome, "result"), false);
  });
}

test("look returns selected Main Deck cards in zone order instead of request or insertion order", () => {
  const kernel = world().deck(["top", "middle", "bottom"]).build();
  const outcome = kernel.perform({ type: "look", player: "A", objects: [kernel.ref("bottom"), kernel.ref("top")] });
  assert.deepEqual(outcome.result, [kernel.ref("top"), kernel.ref("bottom")]);
});

test("look follows order-top changes", () => {
  const kernel = world().deck(["top", "middle", "bottom"]).build();
  const selected = [kernel.ref("middle"), kernel.ref("bottom"), kernel.ref("top")];
  kernel.perform({ type: "order-top", player: "A", objects: selected });
  const outcome = kernel.perform({ type: "look", player: "A", objects: [...selected].reverse() });
  assert.deepEqual(outcome.result, selected);
});

test("look returns Hand and Trash cards in their entry order", () => {
  const kernel = world().hand("first").hand("second").hand("third").build();
  for (const zone of ["hand", "trash"]) {
    if (zone === "trash") for (const id of ["third", "first", "second"]) kernel.perform({ type: "discard", object: kernel.ref(id) });
    const outcome = kernel.perform({ type: "look", player: "A", objects: [kernel.ref("second"), kernel.ref("third"), kernel.ref("first")] });
    assert.deepEqual(outcome.result, kernel.zone("A", zone));
  }
});

test("look omits stale and duplicate references but retains actual viewed cards", () => {
  const kernel = world().deck(["top", "middle", "bottom"]).build();
  const stale = kernel.ref("top");
  kernel.perform({ type: "draw", player: "A", amount: 1 });
  const middle = kernel.ref("middle");
  const outcome = kernel.perform({ type: "look", player: "A", objects: [stale, middle, middle] });
  assert.deepEqual(outcome.result, [middle]);
});

test("an empty look has no displayed result", () => {
  const outcome = world().build().perform({ type: "look", player: "A", objects: [] });
  assert.equal(outcome.status, "impossible");
  assert.equal(Object.hasOwn(outcome, "result"), false);
});
