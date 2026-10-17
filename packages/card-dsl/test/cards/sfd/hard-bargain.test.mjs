import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/hard-bargain.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import counter from "../../../../engine-core/dist/effects/instructions/effect.counter.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createProgramBinding, translateCost } from "../../../../engine-core/dist/programs/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

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
const COST_PAY_KEYS = ["cost", "power", "nonstandardOrder", "payments", "linkKey"];

const chainSpell = (id, owner = "B") => ({
  zone: "chain",
  owner,
  controller: owner,
  types: ["spell"],
  cardId: id,
  energy: 3
});

const runCounter = (kernel) => resolveChainBody([counterInstruction], kernel);

test("sfd-136-221 Hard Bargain: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-136-221 Hard Bargain: judgeReason names the payer-identity and [Repeat] gaps", () => {
  assert.match(program.judgeReason, /204\.3/);
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /cost\/payment\.ts/);
  assert.match(program.judgeReason, /ctx\.controller/);
  assert.match(program.judgeReason, /repeat\.cost/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /additional-cost/);
  // The Counter half is merged and executed; the judgment records that.
  assert.match(program.judgeReason, /golden 已真实执行/);
  assert.doesNotMatch(program.judgeReason, /RIFT-261|RIFT-86|没有 cost\.pay 指令/);
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

  // 355.9.a.2: "a spell" is a finalized object on the Chain.
  assert.deepEqual(targetSpec, {
    id: "hard-bargain.spell",
    filter: { type: "spell", zone: "chain" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("sfd-136-221 Hard Bargain: the paying mode records the printed payment in the merged cost.pay shape", () => {
  assert.equal(paysMode.id, "hard-bargain.pays");
  assert.equal(paysMode.body.length, 1);
  assert.equal(payInstruction.id, "hard-bargain.pay-two-energy");
  // 204.3 / 204.3.a: a Cost within Instructions in a spell. The record uses
  // the argument names the merged primitive actually accepts, so the pending
  // status is a rules gap (who pays), not a malformed program.
  assert.equal(payInstruction.op, "cost.pay");
  assert.deepEqual(Object.keys(payInstruction.args).sort(), ["payments"]);
  for (const key of Object.keys(payInstruction.args)) {
    assert.equal(COST_PAY_KEYS.includes(key), true, `${key} must be a cost.pay argument`);
  }
  assert.deepEqual(payInstruction.args, { payments: { kind: "constant", value: { energy: 2 } } });
  assert.equal(payInstruction.linkedTo, undefined);
});

test("sfd-136-221 Hard Bargain boundary: cost.pay always charges ctx.controller, so it cannot pay as the target's controller", () => {
  // The primitive and its payer are merged, but the payer identity is fixed:
  // cost/payment.ts rejects any plan whose player differs from ctx.controller.
  // Running the recorded payment shape with the caster as ctx.controller charges
  // the caster — the wrong player — which is exactly why the mode stays
  // judge-required instead of being wired up.
  const kernel = world()
    .player("A", { energy: 5 })
    .player("B", { energy: 5 })
    .object("enemy-spell", chainSpell("enemy-spell", "B"))
    .build();
  const caster = kernel.clone({ source: kernel.getObject("enemy-spell"), controller: "A" });
  const outcome = resolveChainBody([payInstruction], caster);

  assert.equal(outcome.status, "executed");
  assert.equal(caster.player("A").energy, 3);
  // 204.3's payer is the targeted spell's controller: B paid nothing.
  assert.equal(caster.player("B").energy, 5);
  assert.equal(outcome.linkedValues["hard-bargain.pay-two-energy.payment"].player, "A");
});

test("sfd-136-221 Hard Bargain boundary: the [Repeat] cost has no merged collection path", () => {
  // 820.1.c.1: the optional additional cost must be collected at Finalize.
  // The merged translateCost refuses the card's declared shape.
  assert.throws(
    () => translateCost(play.cost, "hard-bargain:play", "play"),
    (error) => error.name === "ProgramBindingError" && /Unsupported play cost field keyword/.test(error.message)
  );
  // Repeat's own expansion is a static repeat.cost effect, and the production
  // static binder has no layer for it.
  const repeat = keywordDefinitionsById.get("Repeat");
  assert.ok(repeat, "effects/keywords/Repeat.ts must be registered");
  assert.deepEqual(repeat.expand({ host: { canonicalCardId: CANONICAL }, cost: { energy: 2 } }), [{
    kind: "static",
    effect: {
      kind: "repeat.cost",
      appliesTo: "self",
      host: CANONICAL,
      count: 1,
      cost: { energy: 2 }
    }
  }]);
});

test("sfd-136-221 Hard Bargain boundary: the production play binding rejects the whole card", () => {
  // The registry gate passes on an executable clone; describePlay then refuses
  // the body (a resolving choice.mode needs the Finalize/Resolve choice-plan
  // adapter), before the [Repeat] declaration would be refused by translateCost
  // (asserted directly in the previous test). No play draft exists either way.
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const kernel = world()
    .player("A", { energy: 5 })
    .player("B", { energy: 5 })
    .object("hard-bargain", {
      cardId: CANONICAL,
      name: "Hard Bargain",
      types: ["spell"],
      zone: "hand",
      owner: "A",
      controller: "A",
      energy: 2,
      power: null
    })
    .build();
  const source = kernel.getObject("hard-bargain");
  assert.throws(
    () => binding.describePlay({ type: "play", object: source.ref, player: "A" }, source),
    (error) =>
      error.name === "ProgramBindingError" &&
      /Mode choices require a Finalize\/Resolve choice-plan adapter/.test(error.message)
  );
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
  kernel.setTargets(targetSpec.id, [kernel.ref("enemy-spell")]);
  const outcome = runCounter(kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("enemy-spell").zone, "trash");
  assert.deepEqual(outcome.events.map((event) => event.action), ["counter"]);
  // 426.1.c: nothing is refunded (the payments are the kernel's business).
  assert.deepEqual(outcome.linkedValues["hard-bargain.counter.counteredObjects"], [
    { id: "enemy-spell", zoneEntryId: 1 }
  ]);
});

test("sfd-136-221 Hard Bargain golden: a spell that left the Chain is a mistargeted Counter (359.3.e)", () => {
  const kernel = world().object("enemy-spell", chainSpell("enemy-spell", "B")).build();
  const stale = kernel.ref("enemy-spell");
  kernel.perform({ type: "move-zone", object: stale, to: "trash" });
  kernel.setTargets(targetSpec.id, [stale]);
  const outcome = runCounter(kernel);

  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(outcome.events.length, 0);
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
    "Instructions (204.3/204.3.a) with the targeted spell's controller as the payer and its receipt gating the " +
    "Counter - the merged cost.pay only charges ctx.controller (cost/payment.ts)"
);

test.todo(
  "sfd-136-221 Hard Bargain: [Repeat] :rb_energy_2: - collecting the optional additional cost at Finalize and " +
    "executing the effect one extra time per paid instance (820.1.b/820.1.d) needs the Repeat collection path " +
    "(the repeat.cost static kind has no layer mapping) plus the play additional-cost translateCost wiring"
);

test.todo(
  "sfd-136-221 Hard Bargain: the printed [Reaction] Closed-State permission and the chain admission " +
    "(813.1.c, contract 3.5 canAct) need the play draft to survive the card-program binding, which today " +
    "rejects the [Repeat] additional-cost shape (programs/play.ts 'Unsupported play cost field keyword')"
);

