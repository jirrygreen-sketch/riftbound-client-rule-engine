import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/rebuttal.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import control from "../../../../engine-core/dist/effects/instructions/effect.control.js";
import counter from "../../../../engine-core/dist/effects/instructions/effect.counter.js";
import costPay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-a4302d5534972d519025714467e05c69796d7a87f0fa2b4fc17978846a4f1df9";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Choose a spell with Energy cost no more than :rb_energy_4:.  You may pay :rb_rune_rainbow:. " +
  "If you do, gain control of it and you may make new choices for it. Otherwise, counter it.";

const [reaction, play] = program.abilities;
const [paymentBranch] = play.body;
const [paidMode, counterMode] = paymentBranch.args.modes.value;
const [payRainbow, gainControl, mayRemake] = paidMode.body;
const [counterOtherwise] = counterMode.body;
const [remakeChoices] = mayRemake.args.body.value;
const [chosenSpell] = paymentBranch.targets;

const chainSpell = (id, owner, energy) => ({
  zone: "chain",
  owner,
  controller: owner,
  types: ["spell"],
  cardId: id,
  energy
});

test("ven-152-166 Rebuttal: program passes validateCardProgram as judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("ven-152-166 Rebuttal: judgeReason names the real branch, printed-cost predicate and remake gap", () => {
  assert.match(program.judgeReason, /206/);
  assert.match(program.judgeReason, /energyMax/);
  assert.match(program.judgeReason, /choice-plan/);
  assert.match(program.judgeReason, /payments\.power/);
  assert.match(program.judgeReason, /750-755/);
  assert.match(program.judgeReason, /753\.2/);
  assert.match(program.judgeReason, /通用地点选择/);
  assert.match(program.judgeReason, /choice\.remake-chain-item-choices/);
  assert.match(program.judgeReason, /condition\.result/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(89|90|120)/);
  assert.doesNotMatch(program.judgeReason, /cost\.pay 原语虽已注册/);
  assert.doesNotMatch(program.judgeReason, /没有 \[A\] 付费种类/);
});

test("ven-152-166 Rebuttal: [Reaction] is declared as a keyword, not re-implemented", () => {
  // 813.1.c.1: the closed-state permission belongs to the keyword expansion and
  // the chain's admission check (contract 3.5 / 3.7); the card only names it.
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.equal(reaction.value, undefined);
  assert.equal(keywordDefinitionsById.has("Reaction"), true);
});

test("ven-152-166 Rebuttal: the spell target is one finalized chain item with a descriptive printed-cost ceiling", () => {
  // 355.9.a.2: "spell" means a finalized object on the Chain. The 206 printed
  // Energy ceiling is kept as a descriptive key: no merged predicate evaluates
  // it, so the group is deliberately not treated as finalizable today.
  assert.equal(paymentBranch.op, "choice.mode");
  assert.equal(paymentBranch.linkedTo, undefined);
  assert.equal(paymentBranch.targets.length, 1);
  assert.deepEqual(chosenSpell, {
    id: "rebuttal.chosen-spell",
    filter: { type: "spell", zone: "chain", energyMax: 4 },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(paymentBranch.picks, undefined);
  assert.deepEqual(paymentBranch.args.prompt, {
    kind: "constant",
    value: "Pay :rb_rune_rainbow: or counter that spell?"
  });
  assert.equal(paymentBranch.args.modes.kind, "constant");
  assert.deepEqual(paymentBranch.args.modes.value.map((mode) => mode.id), [
    "rebuttal.pays-rainbow",
    "rebuttal.counter-branch"
  ]);
  assert.deepEqual(paidMode.body.map((instruction) => instruction.id), [
    "rebuttal.pay-rainbow",
    "rebuttal.gain-control",
    "rebuttal.may-remake-choices"
  ]);
  assert.deepEqual(counterMode.body.map((instruction) => instruction.id), [
    "rebuttal.counter-otherwise"
  ]);
});

test("ven-152-166 Rebuttal: paying [A], taking control and remaking choices all sit inside the may body", () => {
  // Contract 3.9: the paid mode wraps its body; the payment and follow-up
  // instructions remain linked so a failed payment cannot reach control.
  assert.equal(payRainbow.op, "cost.pay");
  assert.deepEqual(payRainbow.args.payments, { kind: "constant", value: { power: 1 } });
  assert.equal(payRainbow.args.power, undefined);

  // RIFT-117 merged effect.control: the chain item's control layer is rewritten
  // through the frozen take-control action, rechecking 359.3.e underneath.
  assert.equal(gainControl.op, "effect.control");
  assert.equal(gainControl.linkedTo, "rebuttal.pay-rainbow");
  assert.deepEqual(gainControl.args.objects, {
    kind: "constant",
    value: { target: chosenSpell.id }
  });
  assert.deepEqual(gainControl.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(gainControl.args.linkKey, { kind: "constant", value: "rebuttal-controlled" });
  assert.deepEqual(gainControl.condition, {
    kind: "compare",
    left: { kind: "linked-value", instructionId: "rebuttal.pay-rainbow", key: "paid" },
    operator: "eq",
    right: { kind: "constant", value: true }
  });

  // "you may make new choices for it" is the 750-755 procedure; 752.1 narrows
  // the remake classes and 753 requires remaking all of them.
  assert.equal(mayRemake.op, "choice.optional");
  assert.equal(mayRemake.linkedTo, "rebuttal.gain-control");
  assert.deepEqual(mayRemake.args.body.value.map((instruction) => instruction.id), [
    "rebuttal.remake-choices"
  ]);
  assert.equal(remakeChoices.op, "choice.remake-chain-item-choices");
  assert.deepEqual(remakeChoices.args.choices, {
    kind: "constant",
    value: ["location", "mode", "destination", "target"]
  });
  assert.deepEqual(remakeChoices.args.remakeAll, { kind: "constant", value: true });
});

test("ven-152-166 Rebuttal: the two settlement modes are mutually exclusive", () => {
  // 426.1-426.3: the second mode counters the target; the first mode pays and
  // gates control on the actual payment receipt. The production adapter still
  // blocks this choice.mode surface, which is the remaining branch gap.
  assert.equal(counterOtherwise.id, "rebuttal.counter-otherwise");
  assert.equal(counterOtherwise.op, "effect.counter");
  assert.deepEqual(counterOtherwise.args.target, { kind: "constant", value: chosenSpell.id });
  assert.equal(counterOtherwise.linkedTo, undefined);
  assert.equal(counterOtherwise.targets, undefined);
  assert.equal(counterOtherwise.condition, undefined);
});

test("ven-152-166 Rebuttal: the control and counter primitives the card names are the merged registry entries", () => {
  assert.equal(instructionDefinitionsById.get("effect.control"), control);
  assert.equal(instructionDefinitionsById.get("effect.counter"), counter);
});

test("ven-152-166 Rebuttal golden: the merged control clause rewrites the chain item's control", () => {
  const kernel = world()
    .object("enemy-spell", chainSpell("enemy-spell", "B", 3))
    .object("rebuttal", chainSpell("rebuttal", "A", 1))
    .build();
  const run = runInstruction(control, gainControl.args, {
    world: kernel,
    targets: { [chosenSpell.id]: [kernel.ref("enemy-spell")] }
  });

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked["rebuttal-controlled"], {
    count: 1,
    objects: [kernel.ref("enemy-spell")],
    changes: [{ object: kernel.ref("enemy-spell"), owner: "B", from: "B", to: "A" }]
  });
  assert.deepEqual(run.events.map((event) => event.action), ["take-control"]);
  // The chain item stays on the Chain (127 control is not a zone change) and
  // keeps its owner; only the controller changes.
  assert.equal(kernel.getObject("enemy-spell").zone, "chain");
  assert.equal(kernel.getObject("enemy-spell").controller, "A");
  assert.equal(kernel.getObject("enemy-spell").owner, "B");
});

test("ven-152-166 Rebuttal golden: the original cost.pay args pay one universal Power and expose a receipt", () => {
  const kernel = world()
    .player("A", { power: ["Calm"] })
    .object("rebuttal", {
      zone: "chain",
      owner: "A",
      controller: "A",
      types: ["spell"],
      energy: 1,
      power: []
    })
    .build();

  const run = runInstruction(costPay, payRainbow.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.payment.paid, true);
  assert.equal(run.linked.payment.total.power.length, 1);
  assert.equal(run.linked.payment.power.power.length, 1);
  assert.deepEqual(run.events.map((event) => event.action), ["pay"]);
  assert.deepEqual(run.linked.payment.actions[0].action.plan.power, ["Calm"]);
});

test("ven-152-166 Rebuttal golden: the merged counter clause clears the chain item (CR 426.1-426.3)", () => {
  const kernel = world().object("enemy-spell", chainSpell("enemy-spell", "B", 3)).build();
  const lockedRef = kernel.ref("enemy-spell");
  // effect.counter's schema takes the TargetSpec id itself (the chain adapter
  // unwraps the card's constant envelope for that literal field).
  const run = runInstruction(counter, { target: chosenSpell.id }, {
    world: kernel,
    targets: { [chosenSpell.id]: [lockedRef] }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.countered, 1);
  // 426.1/426.3 + 124: the countered card leaves the Chain for its owner's
  // Trash, so its zone identity advances; the receipt keeps the lived reference.
  assert.deepEqual(run.linked.counteredObjects, [lockedRef]);
  assert.deepEqual(run.events.map((event) => event.action), ["counter"]);
  assert.equal(kernel.getObject("enemy-spell").zone, "trash");
});

test("ven-152-166 Rebuttal golden: both merged clauses ignore a chain item that already left the Chain", () => {
  // 359.3.e: a locked reference that changed zones is no longer current, so the
  // primitive refuses to act on it instead of rebinding by id.
  const kernel = world().object("enemy-spell", chainSpell("enemy-spell", "B", 3)).build();
  const stale = kernel.ref("enemy-spell");
  kernel.perform({ type: "move-zone", object: stale, to: "trash" });

  const controlRun = runInstruction(control, gainControl.args, {
    world: kernel,
    targets: { [chosenSpell.id]: [stale] }
  });
  assert.deepEqual(controlRun.result, { status: "ignored", reason: "mistargeted" });
  const counterRun = runInstruction(counter, { target: chosenSpell.id }, { world: kernel, targets: { [chosenSpell.id]: [stale] } });
  assert.deepEqual(counterRun.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(counterRun.events.length, 0);
  // The card's own target filter keeps the item on the Chain (355.9.a.2), so the
  // stale reference case above is the mistargeted one, not a legal re-target.
  assert.equal(chosenSpell.filter.zone, "chain");
});

test.todo(
  "ven-152-166 Rebuttal: 'a spell with Energy cost no more than :rb_energy_4:' must restrict target legality by the " +
    "printed/copied cost (CR 206 / 206.1, ignoring paid additional costs) — needs a printed-cost target predicate in the " +
    "target/chain condition plan (programs/filters.ts); today the descriptive energyMax key is evaluated by no merged code"
);

test.todo(
  "ven-152-166 Rebuttal: the payment/counter choice.mode needs the chain Finalize/Resolve choice-plan adapter " +
  "before the two settlement modes can execute through the production play pipeline"
);

test.todo(
  "ven-152-166 Rebuttal: 'you may make new choices for it' (CR 750-755) needs chain/target-plan re-selection: remake " +
    "locations/modes/destinations/targets only (752.1), remake all of them (753/753.3), negate when no legal choice exists " +
    "(753.2), re-trigger targeting effects (754) and ignore resulting to-play costs (755) — chain item choice-plan rebuild adapter"
);
