import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/irelia-fervent.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";

const CARD_ID = "card.hash-cdc4606d9f9f7a0a63ed596fdbdee4a120ac153f9b1a74dd38db8c4c34616644";
const SOURCE_TEXT =
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
  "When you choose or ready me, give me +1 :rb_might: this turn.";

const [deflectAbility, chooseTrigger, readyTrigger] = program.abilities;

test("sfd-057-221 Irelia, Fervent: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-057-221 Irelia, Fervent: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /became-target/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-057-221 Irelia, Fervent: [Deflect] plus two parallel trigger subscriptions for \"or\"", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(deflectAbility, { kind: "keyword", keyword: "deflect" });

  // 383.4.b / 383.4.b.1: "When you choose me" is a Targeting Effect, so it
  // subscribes to the became-target timing point.
  assert.equal(chooseTrigger.kind, "triggered");
  assert.equal(chooseTrigger.trigger.at, "became-target");
  assert.deepEqual(chooseTrigger.trigger.filter, {
    event: "became-target",
    target: { source: "self" }
  });
  assert.equal(chooseTrigger.optional, false);

  // 416 / 412.4: "or ready me" is a second, independent subscription — the
  // printed "or" joins trigger conditions, it is not a 355.11 mode choice.
  assert.equal(readyTrigger.kind, "triggered");
  assert.equal(readyTrigger.trigger.at, "object-readied");
  assert.deepEqual(readyTrigger.trigger.filter, { event: "object-readied", filter: { source: "self" } });
  assert.equal(readyTrigger.optional, false);
});

test("sfd-057-221 Irelia, Fervent: each trigger grants +1 Might this turn via a Might modification (not a Buff)", () => {
  for (const [trigger, id] of [
    [chooseTrigger, "irelia-fervent.choose-plus-1-might"],
    [readyTrigger, "irelia-fervent.ready-plus-1-might"]
  ]) {
    assert.equal(trigger.body.length, 1);
    const [instruction] = trigger.body;
    assert.equal(instruction.id, id);
    // 143.2.a / 475-477: temporary Might belongs to the arithmetic layer.
    assert.equal(instruction.op, "continuous.might");
    assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
    assert.deepEqual(instruction.args.duration, { kind: "constant", value: "this-turn" });
    // "me" is the ability host, so no fresh target choice is authored.
    assert.equal(instruction.targets, undefined);
    assert.equal(instruction.picks, undefined);
    assert.equal(instruction.linkedTo, undefined);
  }
});

test("sfd-057-221 Irelia, Fervent: the Deflect keyword definition stays a target tax, never a Might bonus", () => {
  assert.equal(deflect.keyword, "Deflect");
  const [tax] = deflect.expand({ value: undefined, host: { canonicalCardId: CARD_ID } });
  assert.equal(tax.effect.kind, "target.tax");
});

test.todo(
  "sfd-057-221 Irelia, Fervent: 'give me +1 :rb_might: this turn' needs a registered continuous.might " +
    "instruction that lands a consumable arithmetic-layer effect via ResolveContext.addContinuous and " +
    "expires at end of turn — never a Buff counter (702/703) — RIFT-9 / RIFT-91"
);

test.todo(
  "sfd-057-221 Irelia, Fervent: both subscriptions must reach the chain as Pending items (383.4.b.2 for " +
    "became-target, 412.4 for becomes-ready) through a CardProgram trigger registration — RIFT-120"
);

test.todo(
  "sfd-057-221 Irelia, Fervent: [Deflect]'s tax must be collected as any-domain Power when an opponent " +
    "chooses this unit (809.1.c.1) — RIFT-90 / RIFT-89"
);
