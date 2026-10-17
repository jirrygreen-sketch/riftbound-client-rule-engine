// Partial execution evidence for the merged counter primitive is consolidated
// in ../templates/keyword-play-effect-counter-676.test.mjs; Defy's printed
// cost restriction remains judge-required until Finalize can compare costs.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import defy from "../../../dist/cards/ogn/defy.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import counter from "../../../../engine-core/dist/effects/instructions/effect.counter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { evaluatePrintedCharacteristic } from "../../../../engine-core/dist/effects/interpreter/predicates/printed.js";

const CANONICAL = "card.hash-62dafcca4e54056f0f4c441cffa5d06b600b5993b1e3cbd18574fe8feb466684";

const [keyword, play] = defy.abilities;
const [counterInstruction] = play.body;
const forged = { ...defy, status: "executable", judgeReason: undefined };

const chainSpell = (id, owner, energy) => ({
  zone: "chain",
  owner,
  controller: owner,
  types: ["spell"],
  cardId: id,
  energy
});

test("Defy program is structurally valid EffectIR v2 data", () => {
  const result = validateCardProgram(defy);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Defy identity, ruleset, status and printed text", () => {
  assert.equal(defy.canonicalCardId, CANONICAL);
  assert.equal(defy.rulesetVersion, "core-1.5");
  assert.equal(defy.status, "judge-required");
  assert.equal(
    defy.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "Counter a spell that costs no more than :rb_energy_4: and no more than :rb_rune_rainbow:."
  );
  assert.match(defy.judgeReason, /206/);
  assert.match(defy.judgeReason, /energyMax/);
  assert.match(defy.judgeReason, /RIFT-359/);
  assert.equal(cardRegistryById.get(defy.canonicalCardId), defy);
});

test("Defy keeps the printed [Reaction] keyword (CR 813) and one play ability", () => {
  assert.equal(defy.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(keyword.value, undefined);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 1 },
    power: { kind: "constant", value: 1 }
  });
});

test("Defy target: one chain spell carrying the cost restriction as descriptive keys", () => {
  assert.equal(play.body.length, 1);
  assert.equal(counterInstruction.id, "counter-spell");
  assert.equal(counterInstruction.op, "effect.counter");
  assert.deepEqual(counterInstruction.args, {
    target: { kind: "constant", value: "costed-spell" }
  });
  assert.equal(counterInstruction.picks, undefined);
  assert.equal(counterInstruction.linkedTo, undefined);
  assert.equal(counterInstruction.targets.length, 1);
  assert.deepEqual(counterInstruction.targets[0], {
    id: "costed-spell",
    filter: { type: "spell", zone: "chain", energyMax: 4, powerMax: 1 },
    min: 1,
    max: 1,
    selection: "one"
  });
  // The cost restriction is NOT approximated away: energyMax/powerMax stay on
  // the target filter even though no merged predicate evaluates them.
  assert.equal(counterInstruction.targets[0].filter.energyMax, 4);
  assert.equal(counterInstruction.targets[0].filter.powerMax, 1);
});

test("Defy golden: the counter clause removes a chain spell (CR 426.1-426.3)", () => {
  const kernel = world().object("enemy-spell", chainSpell("enemy-spell", "B", 4)).build();
  const spell = kernel.ref("enemy-spell");
  const run = runInstruction(
    counter,
    { target: "costed-spell" },
    { world: kernel, targets: { "costed-spell": [spell] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.countered, 1);
  assert.deepEqual(run.linked.counteredObjects, [{ id: "enemy-spell", zoneEntryId: 1 }]);
  assert.equal(run.events[0].action, "counter");
  // 426.1/426.3: the countered card does nothing and is cleared from the chain.
  assert.equal(kernel.getObject("enemy-spell").zone, "trash");
  assert.equal(kernel.object(spell), null);
});

test("Defy golden: a spell that already left the chain is ignored (359.3.e)", () => {
  const kernel = world().object("enemy-spell", chainSpell("enemy-spell", "B", 2)).build();
  const stale = kernel.ref("enemy-spell");
  kernel.perform({ type: "move-zone", object: stale, to: "trash" });
  const run = runInstruction(
    counter,
    { target: "costed-spell" },
    { world: kernel, targets: { "costed-spell": [stale] } }
  );

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
});

test("Defy current gap: the card's own program cannot even be described for play (translateObjectFilter rejects energyMax)", () => {
  // programs/filters.ts translateObjectFilter runs over every TargetSpec when a
  // card program is bound. It allows a fixed key set, so the card's own
  // descriptive cost keys throw before Finalize can ever consider the target.
  const state = fixture({ cards: [{ id: "defy", cardId: CANONICAL, types: ["spell"], energy: 1, power: ["Calm"] }] });
  const binding = createProgramBinding({ cardPrograms: [forged] });
  assert.throws(
    () => binding.describePlay({ type: "play", object: state.kernel.ref("defy"), player: "A" }, state.kernel.getObject("defy")),
    error => error instanceof Error && /Unsupported filter field energyMax/.test(error.message)
  );
});

test("Defy current gap: RIFT-359's printed-characteristic predicate only reads an event payload, never a target filter", () => {
  // The merged condition vocabulary covers "a printed characteristic carried by
  // an event object". That is not a TargetSpec filter: it needs an event
  // payload, and it cannot restrict which chain spells are legal choices.
  assert.throws(
    () => evaluatePrintedCharacteristic(
      { kind: "printed-characteristic", object: "object", characteristic: "energy", operator: "lte", right: { kind: "constant", value: 4 } },
      { context: world().build(), linked: () => undefined, canLookBack: () => true, isIgnored: () => false }
    ),
    error => error instanceof Error && /no object/.test(error.message)
  );
  // With a payload it does compare the printed cost, which is the capability
  // the card would need to borrow for its target legality.
  const kernel = world().object("enemy-spell", chainSpell("enemy-spell", "B", 6)).build();
  const context = kernel;
  const evaluates = evaluatePrintedCharacteristic(
    { kind: "printed-characteristic", object: "object", characteristic: "energy", operator: "lte", right: { kind: "constant", value: 4 } },
    {
      context,
      event: { object: { printedEnergy: 3 } },
      linked: () => undefined,
      canLookBack: () => true,
      isIgnored: () => false
    }
  );
  assert.equal(evaluates, true);
});

test.todo(
  "Defy cost restriction (CR 206): finalize the chain-spell target against its printed/copied " +
    "Energy cost (<= 4) and printed Power requirement (<= 1 rainbow), ignoring paid additional costs - " +
    "needs a printed-cost target filter or a printed-cost target expression the Finalize candidate query can evaluate"
);

