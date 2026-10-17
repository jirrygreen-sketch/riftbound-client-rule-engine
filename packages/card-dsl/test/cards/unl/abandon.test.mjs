import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/abandon.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import counter from "../../../../engine-core/dist/effects/instructions/effect.counter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { abilitySpeed } from "../../../../engine-core/dist/programs/keywords.js";
import { canAct } from "../../../../engine-core/dist/layers/rules/query.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-d09252c46a7b55e632764e08731ef10a6d95a5409873cada88871b4531a6e640";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Counter a spell. Return it to its owner's hand instead of putting it in their trash.\n" +
  "[Predict]. (Look at the top card of your Main Deck. You may recycle it.)";

const [reactionKeyword, predictKeyword, play] = program.abilities;
const [counterInstruction] = play.body;
const targetSpec = counterInstruction.targets[0];

const chainSpell = (id) => ({
  zone: "chain",
  owner: "B",
  controller: "B",
  types: ["spell"],
  cardId: id
});

test("unl-131-219 Abandon: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-131-219 Abandon: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /426\.1\.a\.1/);
  assert.match(program.judgeReason, /Predict/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-131-219 Abandon: [Reaction] + [Predict] keywords, printed 2 energy and a Chain-spell counter target", () => {
  // 813: a pure permission, declared without a value.
  assert.deepEqual(reactionKeyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(reactionKeyword.value, undefined);
  // 437.3.a: [Predict] without a printed count predicts one card; 817.1.b is
  // the sibling Vision spelling. The card only declares the keyword
  // (README section 5) - the expansion belongs to the keyword registry.
  assert.deepEqual(predictKeyword, { kind: "keyword", keyword: "predict" });
  assert.equal(predictKeyword.value, undefined);

  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 }
  });
  assert.equal(play.body.length, 1);
  assert.equal(counterInstruction.id, "abandon.counter-spell");
  assert.equal(counterInstruction.op, "effect.counter");
  assert.deepEqual(counterInstruction.args, {
    target: { kind: "constant", value: "abandon.spell" }
  });
  assert.equal(counterInstruction.linkedTo, undefined);

  // "a spell" = a finalized Chain object (355.9.a.2); 355.9.c and the pending
  // chain-item exclusion (contract 3.4) belong to the target system.
  assert.deepEqual(targetSpec, {
    id: "abandon.spell",
    filter: { type: "spell", zone: "chain" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("unl-131-219 Abandon golden: the counter half clears the targeted spell from the Chain (426.1-426.3)", () => {
  const kernel = world().object("enemy-spell", chainSpell("enemy-spell")).build();
  const spell = kernel.ref("enemy-spell");

  const run = runInstruction(counter, { target: targetSpec.id }, {
    world: kernel,
    targets: { [targetSpec.id]: [spell] }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.countered, 1);
  assert.deepEqual(run.linked.counteredObjects, [{ id: "enemy-spell", zoneEntryId: 1 }]);
  // The merged primitive performs the printed Counter (426.1.a: it does nothing
  // and is cleared). Its destination is the trash; Abandon's replacement of
  // that destination remains a separate unresolved capability.
  assert.equal(kernel.getObject("enemy-spell").zone, "trash");
  assert.deepEqual(run.events.map((event) => event.action), ["counter"]);
});

test("unl-131-219 Abandon golden: a spell that already left the Chain is ignored (359.3.e)", () => {
  const kernel = world().object("gone-spell", chainSpell("gone-spell")).build();
  const stale = kernel.ref("gone-spell");
  kernel.perform({ type: "move-zone", object: stale, to: "trash" });

  const run = runInstruction(counter, { target: targetSpec.id }, {
    world: kernel,
    targets: { [targetSpec.id]: [stale] }
  });

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
});

test.todo(
  "Abandon: \"Return it to its owner's hand instead of putting it in their trash\" is the destination rewrite of the " +
    "counter (CR 426.1.a.1). The frozen counter GameAction carries no destination (effects/contract.ts), and this is NOT " +
    "modelled as counter-then-move-from-trash: the card would enter the trash first and take a new object identity (124)."
);

test.todo(
  "Abandon: the printed [Predict] (CR 437.1 / 437.3 / 437.3.a) needs a Predict KeywordDef; the merged registry has none " +
    "(kw-predict, no assigned task number) and the merged Vision keyword only inlines Predict 1 for its own expansion"
);

test("unl-131-219 Abandon: the merged Reaction permission allows a Closed State response on the opponent's turn", () => {
  const source = world().object("abandon", { zone: "hand", types: ["spell"], cardId: CANONICAL_ID }).build().getObject("abandon");
  const definition = keywordDefinitionsById.get("Reaction");
  const [permission] = definition.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(permission.effect.kind, "continuous.timing");
  assert.equal(canAct({
    player: "A", speed: abilitySpeed(program.abilities, source),
    showdown: false, closedState: true, turnPlayer: "B", priorityHolder: "A",
    grants: permission.effect.grants
  }), true);
});
