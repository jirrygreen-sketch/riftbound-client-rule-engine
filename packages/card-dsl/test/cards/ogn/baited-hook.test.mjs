import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/baited-hook.js";
// effect.inspect / effect.play declare their selector arguments as Expr nodes
// (contract 3.2), so the body runs through the merged chain adapter, which
// wraps the primitive arguments for the interpreter exactly like the chain does.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";

const [ability] = program.abilities;
const [killInstruction, lookInstruction, optionalInstruction, recycleInstruction] = ability.body;
const [banishInstruction, playInstruction] = optionalInstruction.args.body.value;

// The golden run drives the body the way the production caller must:
// - TargetSpec declarations are dropped because the interpreter itself selects
//   and re-verifies targets (reselectTargets defaults to true); the Finalize-locked
//   answers arrive through the kernel's answer map, exactly as the chain does.
// - The look's `player` is supplied as the already-resolved controller value: the
//   card IR carries the contract-3.6 selector form, but the merged effect.inspect
//   argsSchema still validates that position as a runtime value (see judgeReason
//   and the contract-change request), so the caller resolves the selector first.
const callerBody = ability.body.map(({ targets, ...instruction }) => {
  if (instruction.op === "effect.inspect") {
    return { ...instruction, args: { ...instruction.args, player: { kind: "constant", value: "A" } } };
  }
  if (instruction.op === "choice.optional") {
    // The nested play records the printed controller-base placeholder; the
    // caller resolves it to the concrete player base, exactly as the merged
    // token/token-play goldens do for the same printed placeholder.
    const body = instruction.args.body.value.map(entry => entry.op === "effect.play"
      ? { ...entry, args: { ...entry.args, location: { kind: "constant", value: { type: "base", player: "A" } } } }
      : entry);
    return { ...instruction, args: { ...instruction.args, body: { kind: "constant", value: body } } };
  }
  return instruction;
});

/** A cost.pay stand-in that drives the real merged cost plan + payment pipeline. */
const costProbe = {
  op: "cost.probe",
  argsSchema: { parse: value => value },
  execute(context, args) {
    const receipt = payCostPlan(context, buildCostPlan(context, args));
    return {
      status: "executed",
      events: [...receipt.events],
      linkedValues: {
        paid: receipt.paid,
        energy: receipt.total.energy,
        power: receipt.power.power.map(allocation => [allocation.from, allocation.amount])
      }
    };
  }
};

/**
 * Drive the printed body through the real interpreter. The caller supplies the
 * Finalize-locked targets and picks, exactly as the production target pipeline
 * must: the killed unit is a target, the looked cards are an ordered Main Deck
 * slice (zoneSlice order, never a set query), and the banished card is a pick
 * among those looked cards.
 */
function runHook({ killedUnit = "ally", banishedIndex = 2, accept = true, boardUnit = true, deck = ["d1", "d2", "d3", "d4", "d5", "d6"] } = {}) {
  const kernel = world()
    .player("A", { energy: 20 })
    .base("baited-hook", { types: ["gear"], energy: 3, power: null, might: null, location: { type: "base", player: "A" } })
    .unit(killedUnit, { might: 2 })
    .deck(deck, { types: ["unit"], might: 3 })
    .build();
  const locked = kernel.ref(killedUnit);
  const looked = kernel.zoneSlice("A", "deck", "top", 5);
  const context = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("baited-hook")) });
  if (!boardUnit) {
    // CR 359.3.e.13's own worked example: the friendly unit left the Board
    // before resolution (returned to its owner's hand), so its Might reads null.
    context.perform({ type: "return-to-hand", object: locked });
  }
  context.setTargets("baited-hook.killed-unit", [locked]);
  context.setPicks("baited-hook.looked-cards", looked.map(object => object.ref));
  if (banishedIndex !== null) context.setPicks("baited-hook.banished-unit", [looked[banishedIndex].ref]);
  context.setAnswers({
    "baited-hook.kill-friendly-unit/target:baited-hook.killed-unit": [locked],
    "baited-hook.may-banish-and-play/optional": accept
  });
  return { kernel: context, looked, outcome: resolveChainBody(callerBody, context) };
}

test("baited-hook: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
});

test("baited-hook: identity, ruleset, status, judgeReason and printed text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-19b79a3d218afe3136508edfe7d9a7b84c7a83965281f09495785275ebd95ebd"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The gap is the "Might up to 1 more than the killed unit" legality bound.
  assert.match(program.judgeReason, /Might/);
  assert.match(program.judgeReason, /killed unit/);
  // The second gap: the merged effect.inspect schema rejects selector-valued
  // Expr arguments, so the caller must resolve the player expression.
  assert.match(program.judgeReason, /effect\.inspect/);
  // The third gap: the activated ability still needs the RIFT-257 binding.
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(
    program.sourceText,
    ":rb_energy_1::rb_rune_order:, :rb_exhaust:: Kill a friendly unit. Look at the top 5 cards of your Main Deck. " +
      "You may banish a unit from among them that has Might up to 1 more than the killed unit and play it, " +
      "ignoring its cost. Then recycle the rest."
  );
});

test("baited-hook: the printed cost is 1 energy + 1 Order power + the exhaust symbol", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.cost, {
    kind: "activated",
    energy: { kind: "constant", value: 1 },
    power: { kind: "constant", value: ["Order"] },
    payments: [{ kind: "exhaust" }]
  });
  // The cost is declared, never executed as a body instruction (contract 3.5).
  assert.deepEqual(ability.body.map(instruction => instruction.op), [
    "effect.kill",
    "effect.inspect",
    "choice.optional",
    "effect.recycle"
  ]);
});

test("baited-hook: \"Kill a friendly unit\" is one target, not a pick", () => {
  assert.equal(killInstruction.id, "baited-hook.kill-friendly-unit");
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args, { target: { kind: "constant", value: "baited-hook.killed-unit" } });
  assert.equal(killInstruction.picks, undefined);
  assert.equal(killInstruction.linkedTo, undefined);
  assert.equal(killInstruction.targets.length, 1);
  const [target] = killInstruction.targets;
  assert.equal(target.id, "baited-hook.killed-unit");
  assert.deepEqual(target.filter, { type: "unit", controller: "controller", zone: "board" });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
});

test("baited-hook: the look reads the top 5 of the Main Deck through an ordered pick range", () => {
  assert.equal(lookInstruction.id, "baited-hook.look-top-5");
  assert.equal(lookInstruction.op, "effect.inspect");
  // Not linked to the Kill: CR 359.3.e.13's worked example for Baited Hook has
  // the controller still look at the top 5 cards when the friendly unit is no
  // longer a legal target (so it cannot be killed and its Might reads null).
  assert.equal(lookInstruction.linkedTo, undefined);
  assert.deepEqual(lookInstruction.args.zone, { kind: "constant", value: "deck" });
  assert.deepEqual(lookInstruction.args.scope, { kind: "constant", value: "top" });
  assert.deepEqual(lookInstruction.args.amount, { kind: "constant", value: 5 });
  assert.deepEqual(lookInstruction.args.picksSpecId, { kind: "constant", value: "baited-hook.looked-cards" });
  // "your Main Deck": the looking player is the ability controller (190.6.d),
  // written with the contract-3.6 selector form, never a hard-coded player id.
  assert.deepEqual(lookInstruction.args.player, {
    kind: "object-attribute",
    object: "self",
    attribute: "controller"
  });
  // The ordered references (not the count) feed the following instructions.
  assert.deepEqual(lookInstruction.args.pickedKey, { kind: "constant", value: "looked" });
  assert.equal(lookInstruction.targets, undefined);
  assert.equal(lookInstruction.picks.length, 1);
  assert.equal(lookInstruction.picks[0].id, "baited-hook.looked-cards");
  assert.equal(lookInstruction.picks[0].selection, "all");
});

test("baited-hook: \"You may …\" is a choice.optional wrapping the chosen instructions (contract 3.9)", () => {
  assert.equal(optionalInstruction.id, "baited-hook.may-banish-and-play");
  assert.equal(optionalInstruction.op, "choice.optional");
  assert.equal(optionalInstruction.linkedTo, undefined);
  assert.equal(optionalInstruction.args.body.kind, "constant");
  assert.deepEqual(
    optionalInstruction.args.body.value.map(instruction => instruction.id),
    ["baited-hook.banish-unit", "baited-hook.play-banished"]
  );
});

test("baited-hook: the banish is a non-target pick and the play is a cost-waived Limited Play", () => {
  assert.equal(banishInstruction.op, "effect.banish");
  assert.deepEqual(banishInstruction.args.objects, {
    kind: "constant",
    value: { pick: "baited-hook.banished-unit" }
  });
  // 428.2.a: the banished card is not killed or discarded; 355.10: a pick is not
  // a target, so this is not part of target-trigger rules.
  assert.equal(banishInstruction.targets, undefined);
  assert.equal(banishInstruction.picks.length, 1);
  assert.equal(banishInstruction.picks[0].id, "baited-hook.banished-unit");
  assert.equal(banishInstruction.picks[0].selection, "one");

  assert.equal(playInstruction.op, "effect.play");
  assert.equal(playInstruction.linkedTo, "baited-hook.banish-unit");
  assert.deepEqual(playInstruction.args.object, {
    kind: "linked-value",
    instructionId: "baited-hook.banish-unit",
    key: "banishedUnitObject"
  });
  // "ignoring its cost" — a Finalized zero plan, never a derived printed cost
  // (420.3.b.1); effect.play never derives costs itself.
  assert.deepEqual(playInstruction.args.cost, {
    kind: "constant",
    value: { finalized: true, energy: 0, power: [], xp: 0 }
  });
});

test("baited-hook: the final instruction recycles the looked cards and is not linked to the optional", () => {
  assert.equal(recycleInstruction.id, "baited-hook.recycle-rest");
  assert.equal(recycleInstruction.op, "effect.recycle");
  // "Then recycle the rest." stands on its own: when the optional is declined
  // the whole looked set still recycles (359.3.e.11).
  assert.equal(recycleInstruction.linkedTo, undefined);
  assert.deepEqual(recycleInstruction.args.objects, {
    kind: "linked-value",
    instructionId: "baited-hook.look-top-5",
    key: "looked"
  });
  assert.equal(recycleInstruction.targets, undefined);
  assert.equal(recycleInstruction.picks, undefined);
});

test("baited-hook golden: the printed cost pays 1 energy, 1 Order power and exhausts the gear", () => {
  const kernel = world()
    .player("A", { energy: 5, power: ["Order"] })
    .base("baited-hook", { types: ["gear"], energy: 3, power: null })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("baited-hook")) });
  const run = runInstruction(costProbe, { id: "baited-hook:cost", cost: ability.cost }, { world: context });

  assert.equal(run.result.status, "executed");
  // The finalized plan charges exactly 1 energy and 1 Order power (allocated
  // from the matching Rune Pool power), and exhausts the Gear as a nonstandard
  // cost action (415.4/415.5). The reference kernel's `pay` action settles
  // Energy and XP; the Power allocation is asserted from the receipt.
  assert.equal(run.result.linkedValues.energy, 1);
  assert.deepEqual(run.result.linkedValues.power, [["Order", 1]]);
  assert.equal(context.player("A").energy, 4);
  assert.equal(context.getObject("baited-hook").exhausted, true);
  assert.deepEqual(run.events.map(event => event.action), ["pay", "exhaust"]);
});

test("baited-hook golden: accepting kills the unit, banishes a looked unit, plays it for free and recycles the rest", () => {
  const { kernel, looked, outcome } = runHook({ banishedIndex: 2 });
  const resultOf = (id) => outcome.results.find(result => result.id === id);

  for (const result of outcome.results) {
    assert.equal(result.result.status !== "ignored", true, `${result.id} was ignored: ${JSON.stringify(result.result)}`);
  }

  // 1. "Kill a friendly unit." — CR 429.1 / 429.2.a: the unit moved to its Trash.
  assert.equal(kernel.getObject("ally").zone, "trash");
  assert.equal(resultOf("baited-hook.kill-friendly-unit").result.linkedValues.killed.length, 1);

  // 2. "Look at the top 5 cards" — 432.1.c: the cards were shown in deck order
  // and stayed in the Main Deck.
  const look = resultOf("baited-hook.look-top-5");
  assert.equal(look.result.linkedValues.inspected, 5);
  assert.deepEqual(look.result.linkedValues.looked.map(ref => ref.id), ["d1", "d2", "d3", "d4", "d5"]);

  // 3. "You may banish a unit from among them …" — 428.1: the banish moved the
  // chosen card to its owner's Banishment, and the recorded banishment receipt
  // names that card (its later play leaves Banishment again, step 4).
  const banish = resultOf("baited-hook.banish-unit");
  assert.equal(banish.result.status, "executed");
  assert.equal(banish.result.linkedValues.banishedUnitCount, 1);
  assert.deepEqual(banish.result.linkedValues.banishedUnitObjects.map(ref => ref.id), ["d3"]);

  // 4. "… and play it, ignoring its cost" — 420.3: the banished unit is played
  // for a Finalized zero cost and enters the controller's base.
  const played = kernel.getObject("d3");
  assert.equal(played.zone, "board");
  assert.deepEqual(played.location, { type: "base", player: "A" });
  assert.equal(played.controller, "A");
  assert.equal(resultOf("baited-hook.play-banished").result.linkedValues.played, 1);

  // 5. "Then recycle the rest." — 417.1/417.4: the four remaining looked cards
  // go to the bottom of the Main Deck in order; the played card is not recycled
  // because its old deck identity was invalidated (124 / 359.3.e.4).
  const recycle = resultOf("baited-hook.recycle-rest");
  assert.equal(recycle.result.status, "executed");
  assert.deepEqual(recycle.result.linkedValues.recycled.map(ref => ref.id), ["d1", "d2", "d4", "d5"]);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["d6", "d1", "d2", "d4", "d5"]);
  // The played unit is on the Board, not in the Trash and not recycled.
  assert.equal(kernel.zone("A", "trash").map(ref => ref.id).includes("d3"), false);
  // The recycled cards were not targeted (417.6): the recycle instruction
  // declares no TargetSpec and no PickSpec of its own.
  assert.equal(looked.length, 5);
});

test("baited-hook golden: declining the optional recycles the whole looked set and plays nothing", () => {
  const { kernel, looked, outcome } = runHook({ accept: false, banishedIndex: null });

  // The optional wrapper is negated as skipped; the following recycle still runs
  // (contract 3.9 / 359.3.e.11).
  const optional = outcome.results.find(result => result.id === "baited-hook.may-banish-and-play");
  assert.equal(optional.result.status, "negated");
  assert.equal(optional.result.reason, "skipped");
  assert.equal(kernel.zone("A", "banishment").length, 0);

  const recycled = outcome.results.find(result => result.id === "baited-hook.recycle-rest");
  assert.equal(recycled.result.status, "executed");
  // "Then recycle the rest." — the whole looked set recycles, in the looked order
  // (417.1.a places them on the bottom of the Main Deck in that order).
  assert.deepEqual(
    recycled.result.linkedValues.recycled.map(ref => ref.id),
    looked.map(snapshot => snapshot.ref.id)
  );
  assert.equal(recycled.result.linkedValues.recycledCount, 5);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["d6", "d1", "d2", "d3", "d4", "d5"]);
  // The killed unit still went to the Trash: refusals never unwind earlier steps.
  assert.equal(kernel.getObject("ally").zone, "trash");
});

test("baited-hook golden: a killed unit that left the board before resolution makes the kill ignored and its Might null (CR 359.3.e.12/359.3.e.13)", () => {
  // CR 359.3.e.13 uses Baited Hook as its own worked example: the friendly unit
  // is returned to its owner's hand in response, so it is no longer a legal
  // target, cannot be killed, and its Might reads null — while the controller
  // still looks at the top 5 cards of their Main Deck.
  const { kernel, outcome } = runHook({ accept: false, banishedIndex: null, boardUnit: false });

  const kill = outcome.results.find(result => result.id === "baited-hook.kill-friendly-unit");
  assert.equal(kill.result.status, "ignored");
  assert.equal(kill.result.reason, "mistargeted");
  // The look is deliberately independent of the Kill (see the card comment):
  // the printed example requires the controller to still look at the top 5.
  const look = outcome.results.find(result => result.id === "baited-hook.look-top-5");
  assert.equal(look.result.status, "executed");
  assert.equal(look.result.linkedValues.looked.length, 5);
  // The unit is in hand now: it was not killed.
  assert.equal(kernel.getObject("ally").zone, "hand");
  assert.equal(kernel.zone("A", "trash").length, 0);
});

test.todo(
  "baited-hook: 'a unit … that has Might up to 1 more than the killed unit' as a selection legality " +
    "bound (each candidate's current Might compared with the killed unit's last-known Might, " +
    "359.3.e.13 / contract 3.6 lastKnown); no merged filter value can relate two objects or a " +
    "linked value, so the descriptive mightUpTo key on the pick is not enforced — see judgeReason."
);
test.todo(
  "baited-hook: the activated ability's production binding (RIFT-257 describeActivate) must " +
    "generate the Finalize cost plan, the kill target and the look picks; the golden drives the " +
    "card's own body through the merged chain adapter with caller-supplied locked sets instead."
);
