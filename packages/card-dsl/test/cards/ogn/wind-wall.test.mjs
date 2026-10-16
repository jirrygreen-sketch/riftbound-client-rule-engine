import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/wind-wall.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import counter from "../../../../engine-core/dist/effects/instructions/effect.counter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-9403a9de45d88c83f5f8544042525f78e120da0c765a8e684b24ca0e9c7afd2d";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Counter a spell.";

const [reactionKeyword, play] = program.abilities;
const [counterInstruction] = play.body;
const targetSpec = counterInstruction.targets[0];

/** A finalized Chain item of another player, as the reference kernel models it. */
const chainSpell = (id, owner = "B") => ({
  zone: "chain",
  owner,
  controller: owner,
  types: ["spell"],
  cardId: id
});

test("ogn-064-298 Wind Wall: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-064-298 Wind Wall identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ogn-064-298 Wind Wall structure: [Reaction] keyword plus one chain-spell counter target", () => {
  assert.equal(program.abilities.length, 2);
  // 813: the keyword is a pure permission and is expanded by the keyword
  // registry; the card declares it without a value.
  assert.deepEqual(reactionKeyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(reactionKeyword.value, undefined);

  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.equal(play.body.length, 1);
  assert.equal(counterInstruction.id, "wind-wall.counter-spell");
  assert.equal(counterInstruction.op, "effect.counter");
  assert.deepEqual(counterInstruction.args, {
    target: { kind: "constant", value: "wind-wall.spell" }
  });
  assert.equal(counterInstruction.linkedTo, undefined);
  assert.equal(counterInstruction.picks, undefined);
  assert.equal(counterInstruction.condition, undefined);

  // "a spell" = a finalized object on the Chain (355.9.a.2); exactly one.
  assert.deepEqual(targetSpec, {
    id: "wind-wall.spell",
    filter: { type: "spell", zone: "chain" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("ogn-064-298 Wind Wall: the merged registries really carry the declared keyword and op", () => {
  assert.equal(instructionDefinitionsById.get("effect.counter"), counter);
  assert.equal(counter.op, "effect.counter");
  // 813's expansion is merged (effects/keywords/Reaction.ts); the permission
  // it grants is consumed by the chain's own timing check.
  assert.equal(keywordDefinitionsById.has("Reaction"), true);
  assert.equal(keywordDefinitionsById.get("Reaction").valued, false);
});

test("ogn-064-298 Wind Wall golden: countering clears the targeted spell from the Chain (426.1-426.3)", () => {
  const kernel = world().object("enemy-spell", chainSpell("enemy-spell", "B")).build();
  const target = kernel.ref("enemy-spell");

  const run = runInstruction(counter, { target: targetSpec.id }, {
    world: kernel,
    targets: { [targetSpec.id]: [target] }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.countered, 1);
  assert.deepEqual(run.linked.counteredObjects, [{ id: "enemy-spell", zoneEntryId: 1 }]);
  assert.deepEqual(run.events.map(event => event.action), ["counter"]);
  // 426.2: the countered card does nothing and is cleared from the Chain; the
  // kernel keeps its costs unrefunded (426.3) and moves the card to the Trash.
  assert.equal(kernel.getObject("enemy-spell").zone, "trash");
  assert.equal(kernel.object(target), null);
});

test("ogn-064-298 Wind Wall golden: a spell that already left the Chain is ignored, not re-countered (359.3.e)", () => {
  const kernel = world().object("gone-spell", chainSpell("gone-spell", "B")).build();
  const stale = kernel.ref("gone-spell");
  // The spell left the Chain after finalization but before Wind Wall resolves.
  kernel.perform({ type: "move-zone", object: stale, to: "trash" });

  const run = runInstruction(counter, { target: targetSpec.id }, {
    world: kernel,
    targets: { [targetSpec.id]: [stale] }
  });

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("gone-spell").zone, "trash");
});

test("ogn-064-298 Wind Wall golden: a Board permanent is not a legal Chain target", () => {
  // "a spell" never refers to a Board permanent (355.9.a.2 keeps "spell" on
  // the Chain), so a unit is ignored even if a caller locks it in.
  const kernel = world().unit("board-unit", { owner: "B" }).build();
  const run = runInstruction(counter, { target: targetSpec.id }, {
    world: kernel,
    targets: { [targetSpec.id]: [kernel.ref("board-unit")] }
  });

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("board-unit").zone, "board");
});

test.todo(
  "Wind Wall: [Reaction] admission itself (play during a Closed State on any player's turn, resolving " +
    "before the items already on the Chain, 813.1.b/813.1.c/159.2.b) belongs to the chain's canAct check " +
    "plus the continuous.timing consumer (contract 3.5 / RIFT-91)."
);

test.todo(
  "Wind Wall: became-target event for the countered Chain item and Finalize-time target locking " +
    "(355.8/355.15, 754) belong to the target system and chain batch (RIFT-90/RIFT-120)."
);
