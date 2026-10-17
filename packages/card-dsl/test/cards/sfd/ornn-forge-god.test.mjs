import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/ornn-forge-god.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";

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
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /reduce-equip-cost/);
  assert.match(program.judgeReason, /count 表达式/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("sfd-085-221 Ornn, Forge God: the merged static binder refuses the Deflect target tax", () => {
  // 809.1.b.2/809.1.d: Deflect 2 expands to a static target.tax. The merged
  // production binder has no layer for that kind, so the printed additional cost
  // still has no producer. This is executed evidence for gap (1).
  const kernel = world()
    .unit("ornn", { cardId: CARD_ID, might: 4, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const source = kernel.getObject("ornn");
  const [tax] = deflect.expand({ value: 2, host: { canonicalCardId: CARD_ID } });
  assert.equal(tax.effect.kind, "target.tax");
  assert.deepEqual(tax.effect.value, { kind: "constant", value: 2 });
  assert.throws(
    () => createEngineStaticBinder({ layers: createLayerEngine([source]) }).bindStatic(tax, source),
    /Static ability kind target\.tax has no layer mapping/
  );
});

test("sfd-085-221 Ornn, Forge God: the friendly-gear count is registered but never evaluated", () => {
  // 143.2.a / 475-478: the +1 Might is a dynamic count over friendly gear. The
  // merged static binder accepts the ability, but layers/engine.ts valueOf has no
  // count branch, so the counted amount resolves to no arithmetic increase. This
  // is executed evidence for gap (3), and it is why the card is never claimed
  // executable on the strength of registration alone.
  const kernel = world()
    .unit("ornn", { cardId: CARD_ID, might: 4, location: { type: "battlefield", id: "bf-1" } })
    .card("gear-a", { owner: "A", controller: "A", zone: "board", types: ["gear"], location: { type: "battlefield", id: "bf-1" } })
    .card("gear-b", { owner: "A", controller: "A", zone: "board", types: ["gear"], location: { type: "battlefield", id: "bf-1" } })
    .build();
  const source = kernel.getObject("ornn");
  const layers = createLayerEngine([source, kernel.getObject("gear-a"), kernel.getObject("gear-b")]);
  const handle = createEngineStaticBinder({ layers }).bindStatic(gearBonus, source);
  const registered = layers.registry.list();
  assert.equal(registered.length, 1);
  assert.deepEqual(registered[0].effect.effect.amount, gearBonus.effect.amount);
  // Two friendly gears are on the board, yet the counted bonus contributes nothing.
  assert.equal(layers.evaluate(source.ref).might, 4);
  assert.equal(layers.evaluate(source.ref).buffs, 0);
  handle.unbind();
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
    "opposing spell/ability that chooses this unit (CR 809.1.c/809.1.c.1/809.1.d, 356.2.a.2) — target-tax " +
    "production wiring is missing and the chain Finalize books taxes as Energy"
);
test.todo(
  "sfd-085-221 Ornn, Forge God: [Weaponmaster]'s play effect chooses one of the controller's Equipment and " +
    "attaches it after paying its Equip cost reduced by one any-Domain Power, without activating Equip " +
    "(CR 821.1.b/821.1.c/821.1.c.2/821.1.c.6; the reduce-equip-cost branch needs the original " +
    "[A]/[C] symbol binding)"
);
test.todo(
  "sfd-085-221 Ornn, Forge God: 'I have +1 Might for each friendly gear' requires the merged " +
    "continuous.might instruction plus count-expression evaluation in the arithmetic layer " +
    "(CR 143.2.a/475-478; generic card-static layer binding is already present) — never a Buff counter"
);
