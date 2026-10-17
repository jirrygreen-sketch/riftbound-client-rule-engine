import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/draven-vanquisher.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import pay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";
import might from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { CostPlanError } from "../../../../engine-core/dist/cost/plan-types.js";
import { LayerEngine } from "../../../../engine-core/dist/layers/engine.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const ID = "card.hash-7aaef8697b1c10cad90fa125e7e906fb3e4902535478b033c827f7fcf6f94aa8";
const [, attack, defense] = program.abilities;

test("sfd-020-221 Draven, Vanquisher: validates identity and three abilities", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(ID), program);
  assert.equal(program.canonicalCardId, ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Gold/);
  assert.match(program.judgeReason, /combat-result/);
  assert.match(program.judgeReason, /entersExhausted/);
  assert.match(program.judgeReason, /attack-declared/);
  assert.equal(program.sourceText, "When I win a combat, play a Gold gear token exhausted.\nWhen I attack or defend, you may pay :rb_rune_fury:. If you do, give me +2 :rb_might: this turn.");
});

test("sfd-020-221 Draven, Vanquisher: combat-win token and attack/defense optional buffs", () => {
  const [win, attack, defense] = program.abilities;
  assert.equal(win.trigger.at, "combat-result");
  assert.deepEqual(win.trigger.filter, { event: "combat-result", filter: { source: "self", result: "win" } });
  assert.deepEqual(win.body[0].args.token, { kind: "constant", value: "gold" });
  assert.equal(win.body[0].args.entersExhausted.value, true);
  for (const ability of [attack, defense]) {
    assert.equal(ability.kind, "triggered");
    assert.equal(ability.optional, false);
    assert.equal(ability.body[0].op, "choice.optional");
    assert.deepEqual(ability.body[0].args.body.value.map((entry) => entry.op), ["cost.pay", "continuous.might"]);
  }
  assert.equal(attack.trigger.at, "attack-declared");
  assert.equal(defense.trigger.at, "defense-declared");
});

test("sfd-020-221 Draven, Vanquisher golden: the printed Fury payment validates and allocates one Fury Power", () => {
  const base = world().player("A", { power: ["Fury"] }).unit("draven", { might: 6 }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("draven") });
  const [payFury] = attack.body[0].args.body.value;
  // The card body supplies the printed one-Fury payment plan; the real
  // cost.pay primitive validates that domain list and produces its allocation.
  // TestWorld records the pay action but does not debit Power, so the receipt
  // and pool validation here do not claim end-to-end Power spending support.
  const run = runInstruction(pay, payFury.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.payment.paid, true);
  assert.deepEqual(run.linked.payment.total.power, [{ amount: 1, allowedDomains: ["Fury"] }]);
  assert.deepEqual(run.linked.payment.actions[0].action.plan.power, ["Fury"]);
  assert.deepEqual(run.linked.payment.power.power, [{ requirementIndex: 0, from: "Fury", amount: 1 }]);
  // The payment plan is checked against the player's actual Power pool, so a
  // controller without the printed Fury rune cannot pay.
  const bare = world().player("A").unit("draven", { might: 6 }).build();
  const emptyKernel = bare.clone({ sourceSnapshot: bare.getObject("draven") });
  assert.throws(
    () => runInstruction(pay, payFury.args, { world: emptyKernel }),
    (error) => error instanceof CostPlanError && error.reason === "cannot-pay-cost"
  );
});

test("sfd-020-221 Draven, Vanquisher golden: the printed +2 Might registers until end of turn", () => {
  const base = world().unit("draven", { might: 6 }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("draven") });
  const [, mightInstruction] = defense.body[0].args.body.value;
  const run = runInstruction(might, mightInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  const registration = kernel.continuousEffects[0];
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.source.id, "draven");
  assert.equal(registration.effect.effect.amount, 2);
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.deepEqual(run.linked.affected.objects, [kernel.ref("draven")]);
  const layers = new LayerEngine(kernel.objects);
  assert.equal(layers.snapshot(kernel.ref("draven")).might, 6);
  layers.addContinuous(registration.effect, registration.duration);
  assert.equal(layers.snapshot(kernel.ref("draven")).might, 8);
});

test("sfd-020-221 Draven, Vanquisher golden: the original optional body gates payment and the Might grant", () => {
  for (const ability of [attack, defense]) {
    for (const accepted of [true, false]) {
      const base = world().player("A", { power: ["Fury"] }).unit("draven", { might: 6 }).build();
      const kernel = base.clone({ sourceSnapshot: base.getObject("draven") });
      kernel.setAnswers({ [ability.body[0].id + "/optional"]: accepted });
      const outcome = resolveChainBody(ability.body, kernel);
      // A declined optional instruction is reported as negated/skipped,
      // making the interpreter outcome partial without executing its body.
      assert.equal(outcome.status, accepted ? "executed" : "partial");
      if (!accepted) {
        assert.deepEqual(outcome.results[0].result, { status: "negated", reason: "skipped", events: [] });
      }
      assert.deepEqual(outcome.events.map((event) => event.action), accepted ? ["pay"] : []);
      assert.equal(kernel.continuousEffects.length, accepted ? 1 : 0);
      if (accepted) {
        assert.deepEqual(kernel.continuousEffects[0].duration, { type: "end-of-turn" });
        assert.equal(outcome.results.find((entry) => entry.op === "cost.pay").result.status, "executed");
        assert.equal(outcome.results.find((entry) => entry.op === "continuous.might").result.status, "executed");
      }
    }
  }
});

test("sfd-020-221 Draven, Vanquisher golden: failed Fury payment aborts before granting Might", () => {
  const base = world().player("A", { power: ["Calm"] }).unit("draven", { might: 6 }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("draven") });
  kernel.setAnswers({ [attack.body[0].id + "/optional"]: true });
  assert.throws(
    () => resolveChainBody(attack.body, kernel),
    (error) => error instanceof CostPlanError && error.reason === "cannot-pay-cost"
  );
  assert.equal(kernel.continuousEffects.length, 0);
  assert.deepEqual(kernel.player("A").power, ["Calm"]);
  assert.deepEqual(kernel.events, []);
});

test.todo(
  "sfd-020-221 Draven, Vanquisher: emit combat-result and attack/defense declarations with this unit's combat identity " +
    "(468.3/407) before the original triggered bodies can run through program binding"
);

test.todo(
  "sfd-020-221 Draven, Vanquisher: play the original Gold token exhausted with a controller-relative Base destination " +
    "once effect.token supports the Gold ability, entry stipulation and relative LocationRef (187.5/184.1)"
);
