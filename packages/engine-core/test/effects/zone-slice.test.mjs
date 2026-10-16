import assert from "node:assert/strict";
import test from "node:test";
import { runInstruction, world } from "../../dist/effects/testing/index.js";

const ids = objects => objects.map(object => object.ref.id);
const orderedDeck = (seed = 7) => world(seed).deck(["top", "middle", "bottom"]).build();

function perform(kernel, action) {
  const outcome = kernel.perform(action);
  assert.equal(outcome.status, "done");
  return outcome;
}

test("deck array builder accepts cards from top to bottom", () => {
  const kernel = orderedDeck();
  assert.deepEqual(ids(kernel.zoneSlice("A", "deck", "top")), ["top", "middle", "bottom"]);
});

test("deck array builder prepends an ordered block and preserves existing cards", () => {
  const kernel = world().deck("existing").deck(["first", "second"]).build();
  assert.deepEqual(ids(kernel.zoneSlice("A", "deck", "top")), ["first", "second", "existing"]);
});

test("single-card deck builder preserves its existing stack-on-top behavior", () => {
  const kernel = world().deck("bottom").deck("middle").deck("top").build();
  assert.deepEqual(ids(kernel.zoneSlice("A", "deck", "top", 2)), ["top", "middle"]);
});

test("rune array builder specifies the Rune Deck from top to bottom", () => {
  const kernel = world().rune("existing").rune(["top", "middle", "bottom"]).build();
  const runes = kernel.zoneSlice("A", "rune-deck", "top");
  assert.deepEqual(ids(runes), ["top", "middle", "bottom", "existing"]);
  assert.ok(runes.every(object => object.types.includes("rune")));
});

test("adding an object honors its destination without leaving duplicate zone entries", () => {
  const kernel = orderedDeck();
  kernel.addObject(kernel.getObject("top"), "hand");
  assert.deepEqual(ids(kernel.zoneSlice("A", "deck", "top")), ["middle", "bottom"]);
  const [moved] = kernel.zoneSlice("A", "hand", "top");
  assert.equal(moved.ref.id, "top");
  assert.equal(moved.zone, "hand");
});

test("top and bottom slices keep the selected cards in zone order", () => {
  const kernel = orderedDeck();
  assert.deepEqual(ids(kernel.zoneSlice("A", "deck", "top", 2)), ["top", "middle"]);
  assert.deepEqual(ids(kernel.zoneSlice("A", "deck", "bottom", 2)), ["middle", "bottom"]);
});

for (const from of ["top", "bottom"]) {
  test(`${from}: omitted count returns the entire ordered zone`, () => {
    assert.deepEqual(ids(orderedDeck().zoneSlice("A", "deck", from)), ["top", "middle", "bottom"]);
  });

  test(`${from}: zero count returns no objects`, () => {
    assert.deepEqual(orderedDeck().zoneSlice("A", "deck", from, 0), []);
  });

  test(`${from}: exact or excessive count returns the entire ordered zone`, () => {
    const kernel = orderedDeck();
    assert.deepEqual(ids(kernel.zoneSlice("A", "deck", from, 3)), ["top", "middle", "bottom"]);
    assert.deepEqual(ids(kernel.zoneSlice("A", "deck", from, 20)), ["top", "middle", "bottom"]);
  });

  test(`${from}: an empty deck stays empty with any valid count`, () => {
    const kernel = world().deck([]).build();
    for (const count of [undefined, 0, 2]) assert.deepEqual(kernel.zoneSlice("A", "deck", from, count), []);
  });

  test(`${from}: count must be a nonnegative safe integer`, () => {
    const kernel = orderedDeck();
    for (const count of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => kernel.zoneSlice("A", "deck", from, count), RangeError);
    }
    assert.deepEqual(ids(kernel.zoneSlice("A", "deck", "top")), ["top", "middle", "bottom"]);
  });
}

test("zoneSlice isolates each player's zones", () => {
  const kernel = world()
    .deck(["a-top", "a-bottom"])
    .deck(["b-top", "b-bottom"], { owner: "B" })
    .hand("hand", { owner: "B" })
    .build();
  assert.deepEqual(ids(kernel.zoneSlice("A", "deck", "top")), ["a-top", "a-bottom"]);
  assert.deepEqual(ids(kernel.zoneSlice("B", "deck", "bottom", 1)), ["b-bottom"]);
  assert.deepEqual(ids(kernel.zoneSlice("B", "hand", "top")), ["hand"]);
  assert.deepEqual(kernel.zoneSlice("A", "hand", "top"), []);
  assert.throws(() => kernel.zoneSlice("unknown", "deck", "top"), /Unknown player/);
});

test("zoneSlice returns detached snapshots without events or random consumption", () => {
  const kernel = orderedDeck();
  const before = kernel.stateForTest();
  const seed = kernel.randomState;
  const cards = kernel.zoneSlice("A", "deck", "top");
  cards[0].ref.zoneEntryId = 999;
  cards[0].types.push("gear");
  cards.pop();
  assert.deepEqual(kernel.stateForTest(), before);
  assert.equal(kernel.randomState, seed);
});

test("move-zone deck-top inserts before the current top", () => {
  const kernel = world().deck(["top", "bottom"]).hand("incoming").build();
  const old = kernel.ref("incoming");
  perform(kernel, { type: "move-zone", object: old, to: "deck-top" });
  assert.deepEqual(ids(kernel.zoneSlice("A", "deck", "top")), ["incoming", "top", "bottom"]);
  assert.equal(kernel.object(old), null);
  assert.equal(kernel.zoneSlice("A", "deck", "top", 1)[0].ref.zoneEntryId, old.zoneEntryId + 1);
  assert.deepEqual(kernel.zoneSlice("A", "hand", "top"), []);
});

test("move-zone deck-bottom inserts after the current bottom", () => {
  const kernel = world().deck(["top", "bottom"]).hand("incoming").build();
  perform(kernel, { type: "move-zone", object: kernel.ref("incoming"), to: "deck-bottom" });
  assert.deepEqual(ids(kernel.zoneSlice("A", "deck", "bottom", 2)), ["bottom", "incoming"]);
  assert.deepEqual(ids(kernel.zoneSlice("A", "deck", "top")), ["top", "bottom", "incoming"]);
});

test("moving within a deck changes order without duplicating or losing cards", () => {
  const kernel = orderedDeck();
  perform(kernel, { type: "move-zone", object: kernel.ref("top"), to: "deck-bottom" });
  assert.deepEqual(ids(kernel.zoneSlice("A", "deck", "top")), ["middle", "bottom", "top"]);
  perform(kernel, { type: "move-zone", object: kernel.ref("bottom"), to: "deck-top" });
  assert.deepEqual(ids(kernel.zoneSlice("A", "deck", "top")), ["bottom", "middle", "top"]);
  assert.equal(kernel.player("A").deckSize, 3);
});

test("order-top preserves the requested order and the unselected tail", () => {
  const kernel = world().deck(["first", "second", "third", "fourth"]).build();
  const refs = [kernel.ref("third"), kernel.ref("first")];
  perform(kernel, { type: "order-top", player: "A", objects: refs });
  assert.deepEqual(ids(kernel.zoneSlice("A", "deck", "top")), ["third", "first", "second", "fourth"]);
  assert.deepEqual(kernel.zoneSlice("A", "deck", "top", 2).map(object => object.ref), refs);
  perform(kernel, { type: "order-top", player: "A", objects: [] });
  assert.deepEqual(ids(kernel.zoneSlice("A", "deck", "top")), ["third", "first", "second", "fourth"]);
});

test("order-top rejects duplicate, foreign, stale, and wrong-zone references atomically", () => {
  const kernel = world().deck(["a1", "a2"]).deck(["b1"], { owner: "B" }).hand("hand").build();
  const stale = kernel.ref("hand");
  perform(kernel, { type: "move-zone", object: stale, to: "deck-top" });
  for (const objects of [[kernel.ref("a1"), kernel.ref("a1")], [kernel.ref("b1")], [stale]]) {
    assert.equal(kernel.perform({ type: "order-top", player: "A", objects }).status, "impossible");
    assert.deepEqual(ids(kernel.zoneSlice("A", "deck", "top")), ["hand", "a1", "a2"]);
    assert.deepEqual(ids(kernel.zoneSlice("B", "deck", "top")), ["b1"]);
  }
  perform(kernel, { type: "move-zone", object: kernel.ref("hand"), to: "hand" });
  assert.equal(kernel.perform({ type: "order-top", player: "A", objects: [kernel.ref("hand")] }).status, "impossible");
  assert.deepEqual(ids(kernel.zoneSlice("A", "deck", "top")), ["a1", "a2"]);
});

test("query remains a set query while zoneSlice follows order-top", () => {
  const kernel = world().deck(["first", "second", "third"]).build();
  perform(kernel, { type: "order-top", player: "A", objects: [kernel.ref("second"), kernel.ref("first")] });
  assert.deepEqual(ids(kernel.zoneSlice("A", "deck", "top", 2)), ["second", "first"]);
  assert.deepEqual(ids(kernel.query({ owner: "A", zone: "deck" })).sort(), ["first", "second", "third"]);
});

test("shuffle changes deck order deterministically without changing identities", () => {
  const initial = ["a", "b", "c", "d", "e", "f"];
  const left = world(7).deck(initial).build();
  const right = world(7).deck(initial).build();
  const refs = left.zoneSlice("A", "deck", "top").map(object => object.ref);
  for (const kernel of [left, right]) perform(kernel, { type: "shuffle", player: "A" });
  const shuffled = left.zoneSlice("A", "deck", "top");
  assert.deepEqual(shuffled, right.zoneSlice("A", "deck", "top"));
  assert.notDeepEqual(ids(shuffled), initial);
  assert.deepEqual(ids(shuffled).sort(), initial);
  for (const ref of refs) assert.deepEqual(left.object(ref).ref, ref);
  assert.deepEqual(ids(left.zoneSlice("A", "deck", "bottom", 2)), ids(shuffled).slice(-2));
});

test("draw consumes the actual shuffled top and appends cards to Hand in order", () => {
  const kernel = world(7).deck(["a", "b", "c", "d"]).hand("held").build();
  perform(kernel, { type: "shuffle", player: "A" });
  const before = kernel.zoneSlice("A", "deck", "top");
  assert.equal(perform(kernel, { type: "draw", player: "A", amount: 2 }).result, 2);
  assert.deepEqual(ids(kernel.zoneSlice("A", "hand", "top")), ["held", ...ids(before.slice(0, 2))]);
  assert.deepEqual(ids(kernel.zoneSlice("A", "deck", "top")), ids(before.slice(2)));
  for (const card of before.slice(0, 2)) assert.equal(kernel.object(card.ref), null);
});

test("mill consumes ordered top cards and appends them to Trash in order", () => {
  const kernel = world().deck(["first", "second", "third"]).card("trashed", { zone: "trash" }).build();
  perform(kernel, { type: "order-top", player: "A", objects: [kernel.ref("third"), kernel.ref("first")] });
  assert.equal(perform(kernel, { type: "mill", player: "A", amount: 2 }).result, 2);
  assert.deepEqual(ids(kernel.zoneSlice("A", "trash", "top")), ["trashed", "third", "first"]);
  assert.deepEqual(ids(kernel.zoneSlice("A", "deck", "top")), ["second"]);
});

test("draw and mill beyond deck size consume only the available ordered cards", () => {
  const drawWorld = orderedDeck();
  assert.equal(perform(drawWorld, { type: "draw", player: "A", amount: 20 }).result, 3);
  assert.deepEqual(ids(drawWorld.zoneSlice("A", "hand", "top")), ["top", "middle", "bottom"]);
  assert.deepEqual(drawWorld.zoneSlice("A", "deck", "top"), []);
  assert.equal(perform(drawWorld, { type: "draw", player: "A", amount: 1 }).result, 0);
  const millWorld = orderedDeck();
  assert.equal(perform(millWorld, { type: "mill", player: "A", amount: 20 }).result, 3);
  assert.deepEqual(ids(millWorld.zoneSlice("A", "trash", "top")), ["top", "middle", "bottom"]);
  assert.deepEqual(millWorld.zoneSlice("A", "deck", "bottom"), []);
});

test("recycle appends cards to their owner's deck in action order", () => {
  const kernel = world().deck(["a-top", "a-bottom"]).deck(["b-top"], { owner: "B" })
    .hand("mine").card("theirs", { owner: "B", zone: "trash" }).build();
  perform(kernel, { type: "recycle", object: kernel.ref("mine") });
  perform(kernel, { type: "recycle", object: kernel.ref("a-top") });
  perform(kernel, { type: "recycle", object: kernel.ref("theirs") });
  assert.deepEqual(ids(kernel.zoneSlice("A", "deck", "top")), ["a-bottom", "mine", "a-top"]);
  assert.deepEqual(ids(kernel.zoneSlice("B", "deck", "top")), ["b-top", "theirs"]);
});

for (const [zone, to] of [["hand", "hand"], ["trash", "trash"], ["banishment", "banishment"], ["board", "base"], ["chain", "chain"], ["rune-zone", "rune-zone"]]) {
  test(`${zone} keeps entry order when objects leave and re-enter`, () => {
    const kernel = world().card("earlier", { zone }).card("later", { zone }).hand("incoming").build();
    assert.deepEqual(ids(kernel.zoneSlice("A", zone, "top", 2)), ["earlier", "later"]);
    perform(kernel, { type: "move-zone", object: kernel.ref("earlier"), to: "deck-top" });
    perform(kernel, { type: "move-zone", object: kernel.ref("earlier"), to });
    assert.deepEqual(ids(kernel.zoneSlice("A", zone, "bottom", 1)), ["earlier"]);
    assert.deepEqual(ids(kernel.zoneSlice("A", zone, "top")), zone === "hand" ? ["later", "incoming", "earlier"] : ["later", "earlier"]);
  });
}

test("discard, kill, banish, and return-to-hand preserve destination entry order", () => {
  const kernel = world().hand("old-hand").card("old-trash", { zone: "trash" })
    .card("old-banishment", { zone: "banishment" }).hand("discarded").unit("killed").unit("banished").unit("returned").build();
  perform(kernel, { type: "discard", object: kernel.ref("discarded") });
  perform(kernel, { type: "kill", object: kernel.ref("killed") });
  perform(kernel, { type: "banish", object: kernel.ref("banished") });
  perform(kernel, { type: "return-to-hand", object: kernel.ref("returned") });
  assert.deepEqual(ids(kernel.zoneSlice("A", "trash", "top")), ["old-trash", "discarded", "killed"]);
  assert.deepEqual(ids(kernel.zoneSlice("A", "banishment", "top")), ["old-banishment", "banished"]);
  assert.deepEqual(ids(kernel.zoneSlice("A", "hand", "top")), ["old-hand", "returned"]);
});

test("Rune Deck order is independent from the Main Deck and other players", () => {
  const kernel = world(7).deck(["main-top", "main-bottom"])
    .rune("r-bottom").rune("r-middle").rune("r-top")
    .rune("b-rune", { owner: "B" }).build();
  assert.deepEqual(ids(kernel.zoneSlice("A", "rune-deck", "top")), ["r-top", "r-middle", "r-bottom"]);
  perform(kernel, { type: "order-top", player: "A", zone: "rune-deck", objects: [kernel.ref("r-middle"), kernel.ref("r-bottom")] });
  assert.deepEqual(ids(kernel.zoneSlice("A", "rune-deck", "top")), ["r-middle", "r-bottom", "r-top"]);
  perform(kernel, { type: "shuffle", player: "A", zone: "rune-deck" });
  const runeOrder = ids(kernel.zoneSlice("A", "rune-deck", "top"));
  perform(kernel, { type: "channel-rune", player: "A", amount: 2 });
  assert.deepEqual(ids(kernel.zoneSlice("A", "rune-zone", "top")), runeOrder.slice(0, 2));
  assert.deepEqual(ids(kernel.zoneSlice("A", "rune-deck", "top")), runeOrder.slice(2));
  assert.deepEqual(ids(kernel.zoneSlice("A", "deck", "top")), ["main-top", "main-bottom"]);
  assert.deepEqual(ids(kernel.zoneSlice("B", "rune-deck", "top")), ["b-rune"]);
});

test("recycled Runes go to the bottom of the Rune Deck", () => {
  const kernel = world().deck(["main"]).rune(["top", "bottom"]).build();
  perform(kernel, { type: "channel-rune", player: "A", amount: 1 });
  perform(kernel, { type: "recycle", object: kernel.ref("top") });
  assert.deepEqual(ids(kernel.zoneSlice("A", "rune-deck", "top")), ["bottom", "top"]);
  assert.deepEqual(kernel.zoneSlice("A", "rune-zone", "top"), []);
  assert.deepEqual(ids(kernel.zoneSlice("A", "deck", "top")), ["main"]);
});

test("cloning and restoring a world retain independent ordered zone arrays", () => {
  const kernel = orderedDeck();
  const saved = kernel.snapshot();
  const copy = kernel.clone();
  perform(copy, { type: "draw", player: "A", amount: 1 });
  assert.deepEqual(ids(copy.zoneSlice("A", "deck", "top")), ["middle", "bottom"]);
  assert.deepEqual(ids(kernel.zoneSlice("A", "deck", "top")), ["top", "middle", "bottom"]);
  perform(kernel, { type: "order-top", player: "A", objects: [kernel.ref("bottom")] });
  kernel.restore(saved);
  assert.deepEqual(ids(kernel.zoneSlice("A", "deck", "top")), ["top", "middle", "bottom"]);
});

test("AwaitChoice rolls back ordered zones and random state before replay", () => {
  const kernel = world(7).deck(["a", "b", "c", "d"]).hand("incoming").card("recycled", { zone: "trash" }).build();
  const incoming = kernel.ref("incoming");
  const recycled = kernel.ref("recycled");
  const instruction = {
    op: "test.ordered-zone-transaction",
    argsSchema: { parse: value => value },
    execute(ctx) {
      const outcomes = [ctx.perform({ type: "shuffle", player: "A" })];
      outcomes.push(ctx.perform({ type: "draw", player: "A", amount: 1 }));
      outcomes.push(ctx.perform({ type: "recycle", object: recycled }));
      outcomes.push(ctx.perform({ type: "move-zone", object: incoming, to: "deck-top" }));
      outcomes.push(ctx.perform({ type: "order-top", player: "A", objects: ctx.zoneSlice("A", "deck", "top", 2).reverse().map(object => object.ref) }));
      outcomes.push(ctx.perform({ type: "mill", player: "A", amount: 1 }));
      ctx.choose({ id: "confirm", type: "optional", chooser: "A", visibility: "chooser-only" });
      return { status: "executed", events: outcomes.flatMap(outcome => outcome.events) };
    }
  };
  const before = kernel.stateForTest();
  const seed = kernel.randomState;
  const first = runInstruction(instruction, {}, { world: kernel });
  assert.equal(first.result, null);
  assert.equal(first.asked.request.id, "confirm");
  assert.deepEqual(kernel.stateForTest(), before);
  assert.equal(kernel.randomState, seed);
  const control = kernel.clone();
  const replay = runInstruction(instruction, {}, { world: kernel, answers: { confirm: true } });
  const expected = runInstruction(instruction, {}, { world: control, answers: { confirm: true } });
  assert.equal(replay.result.status, "executed");
  assert.deepEqual(replay.events, expected.events);
  assert.deepEqual(kernel.stateForTest(), control.stateForTest());
  assert.equal(kernel.randomState, control.randomState);
  assert.deepEqual(ids(kernel.zoneSlice("A", "deck", "top")), ids(control.zoneSlice("A", "deck", "top")));
});
