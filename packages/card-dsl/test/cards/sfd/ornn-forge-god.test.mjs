import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/ornn-forge-god.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-d608aa993147100b60121de9bd89000a5f21f0b389c96138c079609d8ffa4004";

const [deflectKeyword, weaponmasterKeyword, gearBonus] = program.abilities;

test("sfd-085-221 Ornn, Forge God: program validates, is registered and stays judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Deflect 2] (Opponents must pay :rb_rune_rainbow::rb_rune_rainbow: to choose me with a spell or ability.)\n" +
      "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)\n" +
      "I have +1 :rb_might: for each friendly gear."
  );
});

test("sfd-085-221 Ornn, Forge God: judgeReason names Deflect, Weaponmaster and the Might-layer gaps", () => {
  assert.match(program.judgeReason, /809\.1\.b\.2/);
  assert.match(program.judgeReason, /821\.1\.c/);
  assert.match(program.judgeReason, /143\.2\.a/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("sfd-085-221 Ornn, Forge God: Deflect 2 and Weaponmaster are declared as keywords, not expanded", () => {
  // 809.1.b.2: the printed number is the Deflect Value; 821.1.b: Weaponmaster is
  // a Play Effect keyword. Contract 3.7 keeps the expansion in the keyword
  // registry, so the card only names them.
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(deflectKeyword, { kind: "keyword", keyword: "deflect", value: 2 });
  assert.deepEqual(weaponmasterKeyword, { kind: "keyword", keyword: "weaponmaster" });
  assert.equal(weaponmasterKeyword.value, undefined);
});

test("sfd-085-221 Ornn, Forge God: '+1 Might for each friendly gear' is a counting static self modification", () => {
  // 143.2.a / 475-478: the bonus is applied in the arithmetic layer; "for each
  // friendly gear" is counted when the layer is evaluated (356.4.g style). It is
  // never a Buff counter (702/703).
  assert.equal(gearBonus.kind, "static");
  assert.equal(gearBonus.effect.kind, "continuous.might");
  assert.equal(gearBonus.effect.mode, "add");
  assert.equal(gearBonus.effect.layer, "arithmetic");
  assert.equal(gearBonus.effect.appliesTo, "self");
  assert.equal(gearBonus.effect.perObject, true);
  assert.equal(gearBonus.effect.amount.kind, "count");
  assert.equal(gearBonus.effect.amount.subject, "friendly-gear");
  assert.deepEqual(gearBonus.effect.amount.filter, {
    type: "gear",
    zone: "board",
    controller: "self"
  });
  assert.equal(gearBonus.condition, undefined);
});

test.todo(
  "sfd-085-221 Ornn, Forge God: [Deflect 2] expands to target.tax and appends two any-Domain Power to an " +
    "opposing spell/ability that chooses this unit (CR 809.1.c/809.1.c.1/809.1.d, 356.2.a.2) — the layers " +
    "consumer of the Deflect expansion and the card keyword registration are unmerged (RIFT-90)"
);
test.todo(
  "sfd-085-221 Ornn, Forge God: [Weaponmaster]'s play effect chooses one of the controller's Equipment and " +
    "attaches it after paying its Equip cost reduced by one any-Domain Power, without activating Equip " +
    "(CR 821.1.b/821.1.c/821.1.c.2/821.1.c.6; RIFT-261 cost wiring plus the keyword target layer)"
);
test.todo(
  "sfd-085-221 Ornn, Forge God: 'I have +1 Might for each friendly gear' requires the merged " +
    "continuous.might instruction plus a card-static registration path and count-expression evaluation " +
    "in the arithmetic layer (CR 143.2.a/475-478; RIFT-257 static binding plus RIFT-91 count follow-up) — never a Buff counter"
);
