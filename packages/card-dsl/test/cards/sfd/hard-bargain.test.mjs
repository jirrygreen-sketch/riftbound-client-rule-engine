import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/hard-bargain.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import counter from "../../../../engine-core/dist/effects/instructions/effect.counter.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-55adf64cca0264ddf7c18b80652ab54d84af691e7b2866565c41d9b05391ac81";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
  "Counter a spell unless its controller pays :rb_energy_2:.";

const [speed, play] = program.abilities;
const [choiceInstruction] = play.body;
const targetSpec = choiceInstruction.targets[0];
const [paysMode, declinesMode] = choiceInstruction.args.modes.value;
const [payInstruction] = paysMode.body;
const [counterInstruction] = declinesMode.body;

const runCounter = (kernel) =>
  runInstruction(
    counter,
    { target: counterInstruction.args.target.value },
    { world: kernel, targets: { [targetSpec.id]: [kernel.ref("enemy-spell")] } }
  );

const chainSpell = (id, owner = "B") => ({
  zone: "chain",
  owner,
  controller: owner,
  types: ["spell"],
  cardId: id,
  energy: 3
});

test("sfd-136-221 Hard Bargain: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-136-221 Hard Bargain: judgeReason names the payment and [Repeat] gaps", () => {
  assert.match(program.judgeReason, /204\.3/);
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /RIFT-86/);
  // The card-program binding's own refusal of the additional-cost shape is
  // part of the current gap record.
  assert.match(program.judgeReason, /additional-cost/);
  // The Counter half is merged and executed; the judgment records that.
  assert.match(program.judgeReason, /golden 已真实执行/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("sfd-136-221 Hard Bargain: [Reaction] keyword and the [Repeat] additional cost", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(speed, { kind: "keyword", keyword: "reaction" });
  assert.equal(speed.value, undefined);
  assert.equal(play.kind, "play");
  // Printed base cost 2 energy (356.1.c); [Repeat] :rb_energy_2: (820.1.c) is
  // declared in the merged sfd/frigid-touch shape without a collector.
  assert.deepEqual(play.cost, {
    kind: "additional-cost",
    keyword: "repeat",
    energy: { kind: "literal", value: 2 }
  });
});

test("sfd-136-221 Hard Bargain: the target spell's controller chooses pay-or-counter", () => {
  assert.equal(play.body.length, 1);
  assert.equal(choiceInstruction.id, "hard-bargain.counter-unless-paid");
  assert.equal(choiceInstruction.op, "choice.mode");
  assert.equal(choiceInstruction.linkedTo, undefined);
  // 355.18: the choice is mandatory and made at resolution; the payer is the
  // targeted spell's controller, never the caster (204.3's "its controller").
  assert.deepEqual(choiceInstruction.args.chooser, {
    kind: "object-property",
    object: { target: "hard-bargain.spell" },
    property: "controller"
  });
  assert.deepEqual(choiceInstruction.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(choiceInstruction.args.different, { kind: "constant", value: true });

  // 355.9.a.2: "a spell" is a finalized object on the Chain; contract 3.4
  // excludes Pending chain items from target candidates (355.9.c also forbids
  // this spell targeting itself).
  assert.deepEqual(targetSpec, {
    id: "hard-bargain.spell",
    filter: { type: "spell", zone: "chain" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("sfd-136-221 Hard Bargain: the paying mode is the pending Cost within Instructions", () => {
  assert.equal(paysMode.id, "hard-bargain.pays");
  assert.equal(paysMode.body.length, 1);
  assert.equal(payInstruction.id, "hard-bargain.pay-two-energy");
  // 204.3 / 204.3.a: a Cost within Instructions in a spell, paid as it
  // resolves to get the linked effect. No merged primitive implements it, so
  // the op stays a named pending op rather than a fabricated payment.
  assert.equal(payInstruction.op, "cost.pay");
  assert.deepEqual(payInstruction.args, { energy: { kind: "constant", value: 2 } });
});

test("sfd-136-221 Hard Bargain: the declining mode counters the targeted spell", () => {
  assert.equal(declinesMode.id, "hard-bargain.declines");
  assert.equal(declinesMode.body.length, 1);
  assert.equal(counterInstruction.id, "hard-bargain.counter");
  assert.equal(counterInstruction.op, "effect.counter");
  assert.equal(counterInstruction.linkedTo, undefined);
  assert.deepEqual(counterInstruction.args, {
    target: { kind: "constant", value: "hard-bargain.spell" }
  });
  assert.equal(counterInstruction.targets, undefined);
});

test("sfd-136-221 Hard Bargain golden: the Counter clause really clears the chain spell (426.1/426.1.a)", () => {
  const kernel = world().object("enemy-spell", chainSpell("enemy-spell", "B")).build();
  const run = runCounter(kernel);

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.countered, 1);
  assert.deepEqual(run.linked.counteredObjects, [{ id: "enemy-spell", zoneEntryId: 1 }]);
  // 426.1.a.1: the countered card is cleared from the Chain into the trash, and
  // 426.1.c: nothing is refunded (the payments are the kernel's business).
  assert.equal(kernel.getObject("enemy-spell").zone, "trash");
  assert.equal(kernel.object(run.linked.counteredObjects[0]), null);
  assert.deepEqual(run.events.map((event) => event.action), ["counter"]);
});

test("sfd-136-221 Hard Bargain golden: a spell that left the Chain is a mistargeted Counter (359.3.e)", () => {
  const kernel = world().object("enemy-spell", chainSpell("enemy-spell", "B")).build();
  const stale = kernel.ref("enemy-spell");
  kernel.perform({ type: "move-zone", object: stale, to: "trash" });
  const run = runInstruction(
    counter,
    { target: counterInstruction.args.target.value },
    { world: kernel, targets: { [targetSpec.id]: [stale] } }
  );

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("enemy-spell").zone, "trash");
});

test("sfd-136-221 Hard Bargain golden: the payer is the target's controller, not the caster", () => {
  const kernel = world().object("enemy-spell", chainSpell("enemy-spell", "B")).build();
  kernel.setTargets(targetSpec.id, [kernel.ref("enemy-spell")]);

  // The caster is A; the targeted spell is controlled by B, so B must be asked.
  assert.throws(
    () => resolveChainBody(play.body, kernel),
    (error) => {
      assert.ok(error instanceof AwaitChoice);
      assert.equal(error.request.type, "mode");
      assert.equal(error.request.chooser, "B");
      assert.deepEqual(error.request.options, ["hard-bargain.pays", "hard-bargain.declines"]);
      return true;
    }
  );
});

test("sfd-136-221 Hard Bargain golden: declining runs the real Counter against the chain spell", () => {
  const kernel = world().object("enemy-spell", chainSpell("enemy-spell", "B")).build();
  kernel.setTargets(targetSpec.id, [kernel.ref("enemy-spell")]);
  kernel.setAnswers({ "hard-bargain.counter-unless-paid/mode%3A0": "hard-bargain.declines" });

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("enemy-spell").zone, "trash");
  assert.deepEqual(outcome.events.map((event) => event.action), ["counter"]);
  // The mode body runs under its own execution path, so the Counter's linked
  // receipt is namespaced by the chosen mode (interpreter README's stable ids).
  assert.deepEqual(
    outcome.linkedValues[
      "hard-bargain.counter-unless-paid/hard-bargain.declines/0/hard-bargain.counter.counteredObjects"
    ],
    [{ id: "enemy-spell", zoneEntryId: 1 }]
  );
});

test.todo(
  "sfd-136-221 Hard Bargain: 'unless its controller pays :rb_energy_2:' must be executable as a Cost within " +
    "Instructions (204.3/204.3.a) and its payment receipt must gate the Counter (356.4.f.1-style binding) — " +
    "needs the cost.pay primitive and a result binding (RIFT-261)"
);

test.todo(
  "sfd-136-221 Hard Bargain: [Repeat] :rb_energy_2: — collecting the optional additional cost at Finalize " +
    "and executing the effect one extra time per paid instance (820.1.b/820.1.d) needs the Repeat keyword " +
    "expansion (RIFT-86) and the cost plan (RIFT-261); the merged card-program binding also rejects the " +
    "additional-cost CostSpec shape outright (programs/play.ts)"
);

test.todo(
  "sfd-136-221 Hard Bargain: the printed [Reaction] Closed-State permission and the chain admission " +
    "(813.1.c, contract 3.5 canAct) need the play draft to survive the card-program binding, which today " +
    "rejects the [Repeat] additional-cost shape (programs/play.ts 'Unsupported play cost field keyword') " +
    "— RIFT-86/RIFT-261 cost-collection batch"
);
