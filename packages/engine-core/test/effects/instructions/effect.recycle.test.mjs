import assert from "node:assert/strict";
import test from "node:test";
import recycle from "../../../src/effects/instructions/effect.recycle.ts";
import { runInstruction, world, AwaitChoice } from "../../../src/effects/testing/index.ts";

const constant = value => ({ kind: "constant", value });
const refValue = ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId });


test("argsSchema rejects malformed args", () => {
  assert.throws(() => recycle.argsSchema.parse(null), /must be an object/);
  assert.throws(() => recycle.argsSchema.parse({}), /requires at least one/);
  assert.throws(() => recycle.argsSchema.parse({ from: { zone: "limbo", amount: constant(1) } }), /from.zone/);
  assert.throws(() => recycle.argsSchema.parse({ from: { zone: "trash", amount: { nope: 1 } } }), /from.amount/);
  assert.throws(() => recycle.argsSchema.parse({ target: "" }), /TargetSpec id/);
});

test("recycles targeted cards to the bottom of the owner's deck, preserving order", () => {
  const kernel = world()
    .card("t1", { zone: "trash" })
    .card("t2", { zone: "trash" })
    .deck("existing")
    .build();
  const targets = [kernel.ref("t1"), kernel.ref("t2")];
  const run = runInstruction(recycle, { target: "victims" }, { world: kernel, targets: { victims: targets } });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").deckSize, 3);
  const deckIds = kernel.zone("A", "deck").map(ref => ref.id);
  assert.deepEqual(deckIds, ["existing", "t1", "t2"], "recycled cards land on the deck bottom in order");
  assert.equal(kernel.player("A").handSize, 0);
  assert.deepEqual(run.linked.recycledCount, 2);
  assert.deepEqual(run.linked.recycled.map(refValue), targets.map(refValue));
});

test("sfd-215 Ravenbloom Conservatory (Rumble deck): recycles the revealed top card via objects", () => {
  // "When you defend here, reveal the top card of your Main Deck. If it's a spell,
  //  put it in your hand. Otherwise, recycle it." — the revealed card is moved
  //  from the deck top to the deck bottom by a non-targeting object reference.
  // NB: the builder unshifts, so "below" is stacked under "revealed-gear".
  const kernel = world()
    .deck("below")
    .deck("revealed-gear", { types: ["gear"] })
    .build();
  const topCard = kernel.zone("A", "deck")[0];
  assert.equal(topCard.id, "revealed-gear");
  const run = runInstruction(
    recycle,
    { objects: constant(refValue(topCard)) },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").deckSize, 2);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["below", "revealed-gear"]);
  assert.equal(run.linked.recycledCount, 1);
});

test("sfd-019 Assembly Rig (Rumble deck): 'Recycle a unit from your trash' returns an opponent-owned card to its own deck (417.1.c)", () => {
  // "Recycle a unit from your trash" — the named object is a target; a stolen
  //  card owned by B in A's trash recycles to B's deck, not A's (417.1.c).
  const kernel = world()
    .card("stolen-mech", { zone: "trash", owner: "B", types: ["unit"], tags: ["Mech"] })
    .deck("a-deck")
    .build();
  const target = kernel.ref("stolen-mech");
  const run = runInstruction(recycle, { target: "rig-target" }, { world: kernel, targets: { "rig-target": [target] } });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").deckSize, 1, "A's deck unchanged");
  assert.equal(kernel.player("B").deckSize, 1, "card returned to its owner's deck");
  assert.equal(kernel.zone("B", "deck")[0].id, "stolen-mech");
});

test("ogn-099 Garbage Grabber: 'Recycle 3 from your trash' suspends for a choice and replays with the answer (417.6)", () => {
  const kernel = world()
    .card("g1", { zone: "trash" })
    .card("g2", { zone: "trash" })
    .card("g3", { zone: "trash" })
    .card("g4", { zone: "trash" })
    .build();
  const args = { from: { zone: "trash", amount: constant(3) } };

  const asked = runInstruction(recycle, args, { world: kernel });
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.equal(asked.asked.request.type, "select-objects");
  assert.equal(asked.asked.request.min, 3);
  assert.equal(asked.asked.request.max, 3);
  assert.equal(asked.asked.request.options.length, 4);
  assert.equal(kernel.player("A").deckSize, 0, "world rolled back while awaiting the choice");

  const picked = ["g4", "g2", "g1"].map(id => refValue(kernel.ref(id)));
  const run = runInstruction(recycle, args, {
    world: kernel,
    answers: { [asked.asked.request.id]: picked }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").deckSize, 3);
  assert.deepEqual(
    kernel.zone("A", "deck").map(ref => ref.id),
    ["g4", "g2", "g1"],
    "chosen cards land on the deck bottom in the chosen order"
  );
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["g3"]);
  assert.equal(run.linked.recycledCount, 3);
});

test("417.4 shortfall: 'recycle 3 from your trash' with fewer cards recycles as many as possible", () => {
  const kernel = world()
    .card("only-one", { zone: "trash" })
    .build();
  const args = { from: { zone: "trash", amount: constant(3) } };
  const asked = runInstruction(recycle, args, { world: kernel });
  assert.ok(asked.asked, "the sole card still gets chosen via select-objects");
  assert.equal(asked.asked.request.min, 1);
  const run = runInstruction(recycle, args, {
    world: kernel,
    answers: { [asked.asked.request.id]: [refValue(kernel.ref("only-one"))] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").deckSize, 1);
  assert.equal(run.linked.recycledCount, 1);
});

test("amount 0 recycles nothing without asking for a choice", () => {
  const kernel = world().card("c1", { zone: "trash" }).build();
  const run = runInstruction(recycle, { from: { zone: "trash", amount: constant(0) } }, { world: kernel });
  assert.equal(run.asked, null);
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").deckSize, 0);
  assert.equal(run.linked.recycledCount, 0);
  assert.deepEqual(run.linked.recycled, []);
});

test("from-zone empty recycles nothing as an executed no-op (417.4)", () => {
  const kernel = world().deck("d1").build();
  const run = runInstruction(recycle, { from: { zone: "trash", amount: constant(2) } }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").deckSize, 1);
  assert.equal(run.linked.recycledCount, 0);
});

test("a replacement hook on the recycle action negates the instruction", () => {
  const kernel = world().card("t1", { zone: "trash" }).build();
  kernel.addReplacement(action => (action.type === "recycle" ? "replaced" : null));
  const run = runInstruction(
    recycle,
    { target: "victims" },
    { world: kernel, targets: { victims: [kernel.ref("t1")] } }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "replaced");
  assert.equal(run.result.events.length, 1);
  assert.equal(kernel.player("A").deckSize, 0, "the card stayed in the trash");
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["t1"]);
});

test("a prevented recycle negates the instruction", () => {
  const kernel = world().card("t1", { zone: "trash" }).build();
  kernel.addReplacement(action => (action.type === "recycle" ? "prevented" : null));
  const run = runInstruction(
    recycle,
    { target: "victims" },
    { world: kernel, targets: { victims: [kernel.ref("t1")] } }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
});

test("all targets stale (old zoneEntryId after the object left its zone) -> ignored", () => {
  const kernel = world().card("t1", { zone: "trash" }).build();
  const stale = kernel.ref("t1");
  kernel.perform({ type: "discard", object: stale }); // moves zones -> new zoneEntryId
  assert.equal(kernel.object(stale), null);
  const run = runInstruction(
    recycle,
    { target: "victims" },
    { world: kernel, targets: { victims: [stale] } }
  );
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.player("A").deckSize, 0);
});

test("partially stale targets: live ones recycle, the instruction still executes", () => {
  const kernel = world()
    .card("live", { zone: "trash" })
    .card("gone", { zone: "trash" })
    .build();
  const liveRef = kernel.ref("live");
  const staleRef = kernel.ref("gone");
  kernel.perform({ type: "banish", object: staleRef });
  const run = runInstruction(
    recycle,
    { target: "victims" },
    { world: kernel, targets: { victims: [liveRef, staleRef] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["live"]);
  assert.equal(run.linked.recycledCount, 1);
});

test("recycling a rune performs the recycle action (Rune Deck routing is kernel-owned, 417.1.b/161.2.b)", () => {
  // The reference kernel routes every recycle to the owner's Main Deck bottom and
  // does not yet special-case runes to the Rune Deck; that destination decision
  // belongs to the kernel (see the final report). This test pins the primitive's
  // part: a rune object is accepted and one recycle action is performed for it.
  const kernel = world()
    .card("spent-rune", { zone: "rune-zone", types: ["rune"], owner: "A" })
    .deck("deck-card")
    .build();
  const runeRef = kernel.ref("spent-rune");
  const run = runInstruction(
    recycle,
    { objects: constant(refValue(runeRef)) },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.recycled, [refValue(runeRef)]);
  assert.equal(run.events.length, 1);
  assert.equal(run.events[0].action, "recycle");
  assert.equal(kernel.getObject("spent-rune").zone, "deck", "kernel's current recycle routing");
  assert.equal(kernel.player("A").runeDeckSize, 0);
});
