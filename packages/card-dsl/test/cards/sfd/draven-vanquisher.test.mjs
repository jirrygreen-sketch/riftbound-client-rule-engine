import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/draven-vanquisher.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import pay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";
import might from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const ID = "card.hash-7aaef8697b1c10cad90fa125e7e906fb3e4902535478b033c827f7fcf6f94aa8";
const [win, attack, defense] = program.abilities;

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
  assert.match(program.judgeReason, /RIFT-124/);
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

test("sfd-020-221 Draven, Vanquisher golden: the printed Fury payment really spends one Fury Power", () => {
  const base = world().player("A", { power: ["Fury"] }).unit("draven", { might: 6 }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("draven") });
  const [payFury] = attack.body[0].args.body.value;
  // The card body supplies the printed one-Fury payment plan; the real
  // cost.pay primitive turns that domain list into a real resource payment.
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
    /insufficient matching Power/
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
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.deepEqual(run.linked.affected.objects, [kernel.ref("draven")]);
});
