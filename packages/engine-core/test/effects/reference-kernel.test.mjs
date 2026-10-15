import test from "node:test";
import assert from "node:assert/strict";
import {
  AwaitChoice,
  TestWorld,
  runInstruction,
  world
} from "../../dist/effects/testing/index.js";

const draw = {
  op: "effect.draw",
  argsSchema: { parse: value => value },
  execute(ctx, args) {
    const outcome = ctx.perform({ type: "draw", player: args.player, amount: args.amount });
    if (outcome.status !== "done") return { status: "negated", reason: outcome.status === "replaced" ? "replaced" : "impossible", events: [...outcome.events] };
    ctx.link("drawn", outcome.result ?? 0);
    return { status: "executed", events: [...outcome.events], linkedValues: { drawn: outcome.result ?? 0 } };
  }
};
const ref = (kernel, id) => kernel.ref(id);
const unit = (id = "u1") => world().unit(id).build();

 test("draw moves cards and returns actual count", () => {
  const kernel = world().deck("a").deck("b").build();
  const result = runInstruction(draw, { player: "A", amount: 1 }, { world: kernel });
  assert.equal(result.result.status, "executed");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(result.linked.drawn, 1);
});

test("all players have isolated resources", () => { const kernel = TestWorld.create(); kernel.perform({ type: "gain-energy", player: "A", amount: 2 }); assert.equal(kernel.player("A").energy, 2); assert.equal(kernel.player("B").energy, 0); });
test("discard invalidates the old reference", () => { const kernel = unit(); const old = ref(kernel, "u1"); kernel.perform({ type: "discard", object: old }); assert.equal(kernel.object(old), null); assert.equal(kernel.lastKnown(old).name, "u1"); });
test("recycle puts an object at deck bottom", () => { const kernel = world().hand("a").deck("b").build(); kernel.perform({ type: "recycle", object: ref(kernel, "a") }); assert.equal(kernel.player("A").deckSize, 2); });
test("banish changes zone", () => { const kernel = unit(); kernel.perform({ type: "banish", object: ref(kernel, "u1") }); assert.equal(kernel.getObject("u1").zone, "banishment"); });
test("mill burns cards", () => { const kernel = world().deck("a").deck("b").build(); const result = kernel.perform({ type: "mill", player: "A", amount: 2 }); assert.equal(result.result, 2); assert.equal(kernel.player("A").deckSize, 0); });
test("shuffle is deterministic", () => { const left = world(4).deck("a").deck("b").deck("c").build(); const right = world(4).deck("a").deck("b").deck("c").build(); left.perform({ type: "shuffle", player: "A" }); right.perform({ type: "shuffle", player: "A" }); assert.deepEqual(left.zone("A", "deck"), right.zone("A", "deck")); });
test("order-top preserves requested order", () => { const kernel = world().deck("a").deck("b").build(); const cards = kernel.zone("A", "deck"); kernel.perform({ type: "order-top", player: "A", objects: cards }); assert.equal(kernel.zone("A", "deck")[0].id, cards[0].id); });
test("return-to-hand moves a card", () => { const kernel = unit(); kernel.perform({ type: "return-to-hand", object: ref(kernel, "u1") }); assert.equal(kernel.getObject("u1").zone, "hand"); });
test("move-location updates Battlefield", () => { const kernel = unit(); const object = ref(kernel, "u1"); kernel.perform({ type: "move-location", object, to: { type: "battlefield", id: "battlefield-2" } }); assert.deepEqual(kernel.getObject("u1").location, { type: "battlefield", id: "battlefield-2" }); });
test("ready and exhaust toggle state", () => { const kernel = unit(); const object = ref(kernel, "u1"); kernel.perform({ type: "exhaust", object }); assert.equal(kernel.getObject("u1").exhausted, true); kernel.perform({ type: "ready", object: ref(kernel, "u1") }); assert.equal(kernel.getObject("u1").exhausted, false); });
test("stun applies state", () => { const kernel = unit(); kernel.perform({ type: "stun", object: ref(kernel, "u1") }); assert.equal(kernel.getObject("u1").stunned, true); });
test("kill sends a unit to Trash", () => { const kernel = unit(); kernel.perform({ type: "kill", object: ref(kernel, "u1") }); assert.equal(kernel.getObject("u1").zone, "trash"); });
test("attach links non-unit to unit", () => { const kernel = world().unit("u").object("gear", { types: ["gear"], zone: "board", location: { type: "battlefield", id: "battlefield-1" } }).build(); kernel.perform({ type: "attach", object: ref(kernel, "gear"), host: ref(kernel, "u") }); assert.equal(kernel.getObject("gear").attachedTo.id, "u"); });
test("detach clears attachment", () => { const kernel = world().unit("u").object("gear", { types: ["gear"], zone: "board", location: { type: "battlefield", id: "battlefield-1" } }).build(); kernel.perform({ type: "attach", object: ref(kernel, "gear"), host: ref(kernel, "u") }); kernel.perform({ type: "detach", object: ref(kernel, "gear") }); assert.equal(kernel.getObject("gear").attachedTo, null); });
test("take-control changes controller", () => { const kernel = unit(); kernel.perform({ type: "take-control", object: ref(kernel, "u1"), player: "B" }); assert.equal(kernel.getObject("u1").controller, "B"); });
test("damage marks a target", () => { const kernel = unit(); kernel.perform({ type: "damage", source: ref(kernel, "u1"), target: ref(kernel, "u1"), amount: 3, combat: true }); assert.equal(kernel.getObject("u1").damage, 3); });
test("heal removes damage up to amount", () => { const kernel = unit(); const object = ref(kernel, "u1"); kernel.perform({ type: "damage", source: object, target: object, amount: 3, combat: false }); kernel.perform({ type: "heal", object: ref(kernel, "u1"), amount: 2 }); assert.equal(kernel.getObject("u1").damage, 1); });
test("channel-rune moves runes", () => { const kernel = world().rune("r1").rune("r2").build(); const result = kernel.perform({ type: "channel-rune", player: "A", amount: 1 }); assert.equal(result.result, 1); assert.equal(kernel.player("A").runeDeckSize, 1); });
test("gain energy", () => { const kernel = TestWorld.create(); kernel.perform({ type: "gain-energy", player: "A", amount: 3 }); assert.equal(kernel.player("A").energy, 3); });
test("gain power", () => { const kernel = TestWorld.create(); kernel.perform({ type: "gain-power", player: "A", power: ["Calm", "Mind"] }); assert.deepEqual(kernel.player("A").power, ["Calm", "Mind"]); });
test("pay finalized energy", () => { const kernel = TestWorld.create(); kernel.perform({ type: "gain-energy", player: "A", amount: 2 }); const result = kernel.perform({ type: "pay", player: "A", plan: { finalized: true, energy: 1 } }); assert.equal(result.status, "done"); assert.equal(kernel.player("A").energy, 1); });
test("pay prevents insufficient energy", () => { const kernel = TestWorld.create(); const result = kernel.perform({ type: "pay", player: "A", plan: { finalized: true, energy: 1 } }); assert.equal(result.status, "prevented"); });
test("gain and spend XP", () => { const kernel = TestWorld.create(); kernel.perform({ type: "gain-xp", player: "A", amount: 4 }); kernel.perform({ type: "spend-xp", player: "A", amount: 2 }); assert.equal(kernel.player("A").xp, 2); });
test("buff and spend-buff", () => { const kernel = unit(); kernel.perform({ type: "buff", object: ref(kernel, "u1"), amount: 2 }); kernel.perform({ type: "spend-buff", object: ref(kernel, "u1"), amount: 1 }); assert.equal(kernel.getObject("u1").buffs, 1); });
test("empower and disempower", () => { const kernel = unit(); kernel.perform({ type: "empower", object: ref(kernel, "u1"), amount: 2 }); assert.equal(kernel.perform({ type: "disempower", object: ref(kernel, "u1") }).status, "done"); assert.equal(kernel.getObject("u1").name, "u1"); });
test("counter markers add and remove", () => { const kernel = unit(); kernel.perform({ type: "add-counter", object: ref(kernel, "u1"), counter: "charge", amount: 3 }); kernel.perform({ type: "remove-counter", object: ref(kernel, "u1"), counter: "charge", amount: 1 }); assert.equal(kernel.perform({ type: "remove-counter", object: ref(kernel, "u1"), counter: "charge", amount: 1 }).result, 1); });
test("create-token creates a Board object", () => { const kernel = TestWorld.create(); const result = kernel.perform({ type: "create-token", player: "A", token: { name: "Sprite", types: ["unit"], might: 1, energy: null, power: null }, location: { type: "base", player: "A" } }); assert.equal(result.status, "done"); assert.equal(kernel.objects.some(object => object.name === "Sprite"), true); });
test("copy creates copied characteristics", () => { const kernel = unit(); const result = kernel.perform({ type: "copy", source: ref(kernel, "u1"), player: "A", location: { type: "battlefield", id: "battlefield-1" } }); assert.equal(result.status, "done"); assert.equal(kernel.objects.filter(object => object.name === "u1").length, 2); });
test("play moves a card onto the Board", () => { const kernel = world().hand("spell", { types: ["spell"] }).build(); kernel.perform({ type: "play", object: ref(kernel, "spell"), player: "A", location: { type: "base", player: "A" } }); assert.equal(kernel.getObject("spell").zone, "board"); });
test("reveal is an information action", () => { const kernel = unit(); assert.equal(kernel.perform({ type: "reveal", object: ref(kernel, "u1") }).status, "done"); });
test("look is an information action", () => { const kernel = unit(); assert.equal(kernel.perform({ type: "look", objects: [ref(kernel, "u1")], player: "A" }).status, "done"); });
test("show-off is an information action", () => { const kernel = unit(); assert.equal(kernel.perform({ type: "show-off", object: ref(kernel, "u1"), properties: ["might"] }).status, "done"); });
test("counter invalidates its Chain object", () => { const kernel = world().object("spell", { zone: "chain" }).build(); const object = ref(kernel, "spell"); assert.equal(kernel.perform({ type: "counter", object }).status, "done"); assert.equal(kernel.object(object), null); });
test("score updates points", () => { const kernel = TestWorld.create(); kernel.perform({ type: "score", player: "A", amount: 2 }); assert.equal(kernel.player("A").score, 2); });
test("win records a game action", () => { const kernel = TestWorld.create(); assert.equal(kernel.perform({ type: "win", player: "A" }).status, "done"); });
test("query filters by zone and type", () => { const kernel = world().unit("u").hand("card", { types: ["spell"] }).build(); assert.equal(kernel.query({ zone: "board", type: "unit" }).length, 1); });
test("history counts actions", () => { const kernel = TestWorld.create(); kernel.perform({ type: "gain-energy", player: "A", amount: 1 }); kernel.perform({ type: "gain-energy", player: "A", amount: 1 }); assert.equal(kernel.history({ action: "gain-energy", player: "A" }), 2); });
test("events carry timing points", () => { const kernel = TestWorld.create(); kernel.perform({ type: "score", player: "A", amount: 1 }); assert.equal(kernel.events[0].timingPoint, "main-start"); });
test("replacement hook negates an action", () => { const kernel = TestWorld.create(); kernel.addReplacement(action => action.type === "score" ? "replaced" : null); assert.equal(kernel.perform({ type: "score", player: "A", amount: 1 }).status, "replaced"); assert.equal(kernel.player("A").score, 0); });
test("prevented hook leaves resources unchanged", () => { const kernel = TestWorld.create(); kernel.addReplacement(action => action.type === "gain-energy" ? "prevented" : null); assert.equal(kernel.perform({ type: "gain-energy", player: "A", amount: 1 }).status, "prevented"); assert.equal(kernel.player("A").energy, 0); });
test("impossible hook returns impossible", () => { const kernel = TestWorld.create(); kernel.addReplacement(action => action.type === "win" ? "impossible" : null); assert.equal(kernel.perform({ type: "win", player: "A" }).status, "impossible"); });
test("choice without answer suspends", () => { const kernel = unit(); const choose = { op: "effect.choose", argsSchema: { parse: value => value }, execute(ctx) { return { status: "executed", events: [], linkedValues: { answer: ctx.choose({ id: "pick", type: "optional", chooser: "A", visibility: "chooser-only" }) } }; } }; const run = runInstruction(choose, {}, { world: kernel }); assert.ok(run.asked instanceof AwaitChoice); assert.equal(kernel.events.length, 0); });
test("choice answer replays and commits", () => { const kernel = unit(); const choose = { op: "effect.choose", argsSchema: { parse: value => value }, execute(ctx) { const answer = ctx.choose({ id: "pick", type: "mode", options: ["yes", "no"], chooser: "A", visibility: "public" }); ctx.link("answer", answer); return { status: "executed", events: [], linkedValues: { answer } }; } }; const run = runInstruction(choose, {}, { world: kernel, answers: { pick: "yes" } }); assert.equal(run.result.status, "executed"); assert.equal(kernel.linked("answer"), "yes"); });
test("choice rollback removes prior actions", () => { const kernel = TestWorld.create(); const choose = { op: "effect.choose", argsSchema: { parse: value => value }, execute(ctx) { ctx.perform({ type: "gain-energy", player: "A", amount: 3 }); ctx.choose({ id: "pick", type: "number", min: 1, max: 2, chooser: "A", visibility: "chooser-only" }); return { status: "executed", events: [] }; } }; const asked = runInstruction(choose, {}, { world: kernel }); assert.ok(asked.asked); assert.equal(kernel.player("A").energy, 0); const answered = runInstruction(choose, {}, { world: kernel, answers: { pick: 2 } }); assert.equal(answered.result.status, "executed"); assert.equal(kernel.player("A").energy, 3); });
test("linked values are readable", () => { const kernel = TestWorld.create(); kernel.link("x", 7); assert.equal(kernel.linked("x"), 7); });
test("continuous effects are registered", () => { const kernel = TestWorld.create(); kernel.addContinuous({ id: "buff", layer: "arithmetic", filter: {}, effect: { kind: "might", value: 1 } }, { type: "end-of-turn" }); assert.equal(kernel.continuousEffects.length, 1); });
test("delayed triggers are registered", () => { const kernel = TestWorld.create(); kernel.registerDelayedTrigger({ at: "turn-end", filter: {} }, []); assert.equal(kernel.delayedTriggers.length, 1); });
test("object references include zone entry ids", () => { const kernel = unit(); const before = ref(kernel, "u1"); kernel.perform({ type: "move-zone", object: before, to: "hand" }); const after = ref(kernel, "u1"); assert.equal(after.zoneEntryId, before.zoneEntryId + 1); });
test("last-known information remains available", () => { const kernel = unit(); const before = ref(kernel, "u1"); kernel.perform({ type: "kill", object: before }); assert.equal(kernel.lastKnown(before).name, "u1"); assert.equal(kernel.lastKnown(before).zone, "board"); });
test("null printed values remain null", () => { const kernel = world().unit("u1", { energy: null, power: null }).build(); assert.equal(kernel.getObject("u1").energy, null); assert.equal(kernel.getObject("u1").power, null); });
