import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/retreat.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-e6e5c4f19dfe34b964bd6348cc46c60d1d565fb1949561f4c5c749101ed39bcf";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Return a friendly unit to its owner's hand. Its owner channels 1 rune exhausted.";

const speed = program.abilities[0];
const play = program.abilities[1];
const [returnUnit, channelRune] = play.body;

// Finalize-time target locking is supplied to the kernel directly (the
// reference kernel compares filter values literally, so the card layer's
// friendly/enemy placeholders are resolved by the production target pipeline,
// not by the fixture). The TargetSpec itself is asserted structurally above.
const bodyWithoutTargetSpecs = play.body.map(({ targets, ...rest }) => rest);

test("Retreat program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Retreat identity, status and printed text match the catalog", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("Retreat structure: [Reaction] keyword, targeted return, linked owner channel", () => {
  assert.deepEqual(speed, { kind: "keyword", keyword: "reaction" });

  assert.equal(play.kind, "play");
  assert.deepEqual(play.body.map(instruction => instruction.id), ["return-unit", "channel-rune"]);

  // "Return a friendly unit to its owner's hand": a Board unit chosen
  // specifically is Targeted (355.7 / 355.9.a.1).
  assert.equal(returnUnit.op, "effect.zone");
  assert.equal(returnUnit.targets.length, 1);
  assert.deepEqual(returnUnit.targets[0], {
    id: "friendly-unit",
    filter: { type: "unit", controller: "self" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.deepEqual(returnUnit.args.target, { kind: "constant", value: "friendly-unit" });
  assert.deepEqual(returnUnit.args.to, { kind: "constant", value: "hand" });

  // "Its owner channels 1 rune exhausted" — the channeler is read from the
  // target's owner (owner routing, 108.6 / 417.1.c); the instruction is linked
  // to the return because it references that same object (359.3.e.14).
  assert.equal(channelRune.op, "effect.channel");
  assert.equal(channelRune.linkedTo, "return-unit");
  assert.deepEqual(channelRune.args.player, {
    kind: "object-property",
    object: { target: "friendly-unit" },
    property: "owner"
  });
  assert.deepEqual(channelRune.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(channelRune.args.exhausted, { kind: "constant", value: true });
  assert.equal(channelRune.targets, undefined);
});

test("Retreat golden: the unit returns to its owner's hand and that owner channels 1 exhausted rune", () => {
  // The unit is owned by B but controlled by A: the return goes to B's hand
  // and B — not the spell's controller — channels the rune.
  const kernel = world()
    .unit("borrowed", { owner: "B", controller: "A" })
    .rune(["b-rune-1", "b-rune-2"], { owner: "B" })
    .build();
  kernel.setTargets("friendly-unit", [kernel.ref("borrowed")]);
  // The reference kernel's channel handler does not model entry state, so the
  // submitted GameAction is captured to prove the printed stipulation reaches
  // it (CR 431.2); the hook observes the action and applies no replacement.
  const submitted = [];
  kernel.addReplacement(action => {
    submitted.push(action);
    return null;
  });

  const outcome = resolveChainBody(bodyWithoutTargetSpecs, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => result.result.status), ["executed", "executed"]);
  assert.deepEqual(outcome.events.map(event => event.action), ["return-to-hand", "channel-rune"]);
  assert.deepEqual(submitted.at(-1), { type: "channel-rune", player: "B", amount: 1, exhausted: true });
  assert.equal(kernel.getObject("borrowed").zone, "hand");
  assert.equal(kernel.player("B").handSize, 1);
  assert.equal(kernel.player("B").runeDeckSize, 1);
  assert.equal(kernel.player("B").runePool.length, 1);
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(kernel.player("A").runeDeckSize, 0);
});

test("Retreat golden: a short Rune Deck still channels as many runes as possible (CR 431.3)", () => {
  const kernel = world().unit("ally", { owner: "B" }).build();
  kernel.setTargets("friendly-unit", [kernel.ref("ally")]);

  const outcome = resolveChainBody(bodyWithoutTargetSpecs, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => result.result.status), ["executed", "executed"]);
  assert.equal(kernel.player("B").handSize, 1);
  assert.equal(kernel.player("B").runePool.length, 0);
  // The shortfall is not a failure: the linked count records the real channel.
  assert.equal(outcome.linkedValues["channel-rune.channeled"], 0);
});

test("Retreat golden: a stale target ignores the return and the linked channel (CR 359.3.e.7 / .14)", () => {
  const kernel = world().unit("ally", { owner: "B" }).rune(["rune"], { owner: "B" }).build();
  const stale = kernel.ref("ally");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  kernel.setTargets("friendly-unit", [stale]);

  const outcome = resolveChainBody(bodyWithoutTargetSpecs, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(result => result.result), [
    { status: "ignored", reason: "mistargeted" },
    { status: "ignored", reason: "linked-ignored" }
  ]);
  assert.equal(kernel.player("B").runeDeckSize, 1);
});

test("Retreat golden: a controller-agnostic owner channel leaves the caster's rune deck alone", () => {
  // "Its owner channels": the channeler is read from the returned unit, never
  // from the spell's controller, even when the two differ (108.6 / 417.1.c).
  const kernel = world()
    .unit("borrowed", { owner: "B", controller: "A" })
    .rune(["caster-rune"])
    .build();
  kernel.setTargets("friendly-unit", [kernel.ref("borrowed")]);

  const outcome = resolveChainBody(bodyWithoutTargetSpecs, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("B").runeDeckSize, 0);
  assert.equal(kernel.player("B").runePool.length, 0);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.player("A").runePool.length, 0);
  assert.equal(outcome.linkedValues["channel-rune.channeled"], 0);
});

test.todo(
  "Retreat: [Reaction] admission (Closed State play, resolving before existing " +
    "chain items, 159.2.b.2/.3) belongs to the chain plus the continuous.timing " +
    "layer consumer (RIFT-91)."
);

test.todo(
  "Retreat: became-target events for the returned unit and Finalize-time target " +
    "locking belong to the target system (RIFT-90)."
);
