import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/akali-deadly-weapon.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-7b24e8fb2cf27a115102e669fe4fd9219a98b10d2411cc5caf4bb1826db5e3c6";
const SOURCE_TEXT =
  "[Empower] :rb_energy_2::rb_rune_fury: (:rb_energy_2::rb_rune_fury:: Empower me. Use only if not Empowered.)\n" +
  "When I move, you may deal 1 to a unit at a battlefield I moved to or from. If I'm [Empowered], deal 2 instead.\n" +
  "[Empowered][>] I have +1 :rb_might:.";

const [empower, moveTrigger, mightBonus] = program.abilities;
const [mayDeal] = moveTrigger.body;
const [dealDamage] = mayDeal.args.body.value;
const OPTIONAL_ID = "akali.may-deal-damage/optional";

const akaliWorld = () =>
  world()
    .unit("akali", {
      controller: "A",
      might: 3,
      location: { type: "battlefield", id: "bf-1" }
    })
    .unit("enemy", {
      owner: "B",
      controller: "B",
      location: { type: "battlefield", id: "bf-1" }
    })
    .build();

test("ven-021-166 Akali, Deadly Weapon: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-021-166 Akali: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /442\.1\.a/);
  assert.match(program.judgeReason, /object-moved/);
  assert.match(program.judgeReason, /continuous\.might/);
});

test("ven-021-166 Akali: [Empower] is declared as a bare keyword (no card-side expansion)", () => {
  // 827.1.c.1's "[2 Energy + 1 Fury Power]: Empower me. Play only if not
  // Empowered." is the keyword's expansion; the card declares the keyword only
  // (contract 3.7) and records the printed cost in the header/judgeReason.
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  assert.equal(empower.value, undefined);
});

test("ven-021-166 Akali: the move trigger wraps the may-deal instruction in choice.optional", () => {
  assert.equal(moveTrigger.kind, "triggered");
  assert.equal(moveTrigger.optional, false);
  // 421.1 / 449.1-2: "When I move" observes the closed object-moved timing point;
  // 458.1 keeps Recalls from triggering move abilities.
  assert.equal(moveTrigger.trigger.at, "object-moved");
  assert.deepEqual(moveTrigger.trigger.filter, {
    event: "object-moved",
    filter: { source: "self" }
  });
  // 383.3.a / contract 3.9: the printed "you may" wraps the chosen instruction
  // in choice.optional's body (never a bare choice plus linkedTo).
  assert.equal(moveTrigger.body.length, 1);
  assert.equal(mayDeal.id, "akali.may-deal-damage");
  assert.equal(mayDeal.op, "choice.optional");
  assert.deepEqual(mayDeal.args.body.kind, "constant");
  assert.equal(mayDeal.linkedTo, undefined);
  assert.equal(mayDeal.targets, undefined);
  assert.equal(mayDeal.picks, undefined);
});

test("ven-021-166 Akali: the damage instruction records the Empowered-dependent amount and target", () => {
  assert.deepEqual(mayDeal.args.body.value.map((instruction) => instruction.id), [
    "akali.deal-damage-at-moved-battlefield"
  ]);
  assert.equal(dealDamage.op, "effect.damage");
  // "deal 1 … If I'm [Empowered], deal 2 instead": the replacement amount is
  // gated on the host's Empowered status (442.1.a), which has no evaluable
  // predicate in the frozen IR. Nothing is hard-coded: the read is descriptive
  // and fails closed as missing information instead of inventing a branch.
  assert.equal(dealDamage.args.amount.kind, "object-property");
  assert.equal(dealDamage.args.amount.property, "empoweredReplacementDamage");
  assert.equal(dealDamage.args.amount.object, "source");
  assert.deepEqual(dealDamage.args.target, {
    kind: "constant",
    value: "akali.unit-at-moved-battlefield"
  });
  assert.equal(dealDamage.targets.length, 1);
  const spec = dealDamage.targets[0];
  assert.equal(spec.id, "akali.unit-at-moved-battlefield");
  // 355.9.a.1 / 355.9.b: "a unit at a battlefield" is a targeting restriction;
  // "that I moved to or from" needs the move event's from/to payload (449.1-2),
  // recorded as the descriptive pending key.
  assert.deepEqual(spec.filter, {
    type: "unit",
    zone: "board",
    location: "battlefield",
    movedToOrFrom: "self"
  });
  assert.equal(spec.selection, "one");
});

test("ven-021-166 Akali: the [Empowered] Might bonus is a gated arithmetic-layer static", () => {
  // 828.1.b.1 / 828.1.c: the dependent ability is active only while the host has
  // the Empowered status; 479 puts +1 Might in the arithmetic layer.
  assert.equal(mightBonus.kind, "static");
  assert.equal(mightBonus.effect.kind, "continuous.might");
  assert.equal(mightBonus.effect.mode, "add");
  assert.equal(mightBonus.effect.layer, "arithmetic");
  assert.deepEqual(mightBonus.effect.amount, { kind: "constant", value: 1 });
  assert.equal(mightBonus.effect.appliesTo, "self");
  assert.deepEqual(mightBonus.condition, {
    kind: "expression",
    value: { kind: "constant", value: "empowered" }
  });
});

test("ven-021-166 golden: declining the may wraps the whole damage half away", () => {
  const kernel = akaliWorld();
  kernel.setAnswers({ [OPTIONAL_ID]: false });

  const outcome = runAbilityBody(moveTrigger.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map((entry) => [entry.result.status, entry.result.reason]), [
    ["negated", "skipped"]
  ]);
  assert.equal(kernel.getObject("enemy").damage, 0);
  assert.deepEqual(kernel.events, []);
});

test("ven-021-166 Akali: accepting the may cannot invent the Empowered replacement amount", () => {
  const kernel = akaliWorld();
  kernel.setAnswers({ [OPTIONAL_ID]: true });

  // The nested damage instruction reads a characteristic that does not exist on
  // the source snapshot, so it is ignored as missing information: no damage is
  // dealt and no amount is guessed (contract 3.6 / 359.3.e.6).
  const outcome = runAbilityBody(moveTrigger.body, kernel);
  assert.equal(kernel.getObject("enemy").damage, 0);
  assert.deepEqual(kernel.events, []);
  const inner = outcome.results.find(
    (entry) => entry.id === "akali.deal-damage-at-moved-battlefield"
  );
  assert.equal(inner.result.status, "ignored");
  assert.equal(inner.result.reason, "mistargeted");
});

test.todo(
  "ven-021-166 Akali: [Empower] 2 Energy + 1 Fury Power expansion (827.1.c.1 activation cost, 'use " +
    "only if not Empowered' restriction) needs an Empower/Empowered KeywordDef — none is merged"
);

test.todo(
  "ven-021-166 Akali: 'If I'm [Empowered], deal 2 instead' needs an Empowered status predicate " +
    "(442.1.a) that Condition/object-property can evaluate (RIFT-87/RIFT-91)"
);

test.todo(
  "ven-021-166 Akali: 'a battlefield I moved to or from' needs the move event's from/to location " +
    "payload (449.1/449.2) plus the object-moved source binding (RIFT-120)"
);

test.todo(
  "ven-021-166 Akali: '[Empowered][>] I have +1 :rb_might:.' needs the card-side continuous.might " +
    "primitive and layers registration with the Empowered gate (RIFT-91)"
);
