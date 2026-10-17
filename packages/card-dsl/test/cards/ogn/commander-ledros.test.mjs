import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/commander-ledros.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createEngineStaticBinder, createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";

const CANONICAL = "card.hash-c80681881ea8ea46056b7e0beb729fa6209936934189d25a1dda9a04ebf36b79";
const [deflect, ganking, play] = program.abilities;

test("ogn-231-298 Commander Ledros: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-231-298 Commander Ledros: identity, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /programs\/play\.ts/);
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /target\.tax/);
  assert.match(program.judgeReason, /routes/);
  assert.doesNotMatch(program.judgeReason, /转换成 Energy/);
  assert.equal(
    program.sourceText,
    "As you play me, you may kill any number of friendly units as an additional cost. " +
      "Reduce my cost by :rb_rune_order: for each killed this way.\n" +
      "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
      "[Ganking] (I can move from battlefield to battlefield.)"
  );
});

test("ogn-231-298 Commander Ledros: [Deflect] and [Ganking] are declared as keywords, not re-implemented", () => {
  // CR 809.1.b.3: Deflect with an omitted value is Deflect 1.
  assert.deepEqual(deflect, { kind: "keyword", keyword: "deflect", value: 1 });
  // CR 810: Ganking never carries a value.
  assert.deepEqual(ganking, { kind: "keyword", keyword: "ganking" });
});

test("ogn-231-298 Commander Ledros: the optional additional cost kills friendly units as a cost, not as a target", () => {
  assert.equal(play.kind, "play");
  assert.equal(play.cost.kind, "additional-cost");
  // CR 356.2.b.1: the "may" additional cost is declared at Finalize.
  assert.equal(play.cost.optional, true);
  assert.equal(play.cost.payments.length, 1);
  const [killPayment] = play.cost.payments;
  assert.equal(killPayment.kind, "kill");
  // CR 355.10.c: a game object mentioned only as part of a cost is not targeted,
  // so this is declared as a non-target choice.
  const choice = killPayment.choice;
  assert.equal(choice.id, "commander-ledros.killed-units");
  assert.deepEqual(choice.filter, {
    type: "unit",
    zone: "board",
    controller: "controller"
  });
  // CR 355.13: "any number" includes choosing zero.
  assert.equal(choice.min, 0);
  assert.equal(choice.selection, "any");
  assert.equal(killPayment.choice.targetSpec, undefined);
});

test("ogn-231-298 Commander Ledros: the discount is one Order power per unit killed this way", () => {
  // CR 356.4: discounts are applied in the cost plan's discount step.
  assert.deepEqual(play.cost.discount, {
    resource: "power",
    domains: ["Order"],
    amountPerKilled: 1,
    killedBy: "commander-ledros.killed-units"
  });
  // The card text is entirely a cost plus two keywords: no resolution-time instructions.
  assert.deepEqual(play.body, []);
});

test("ogn-231-298 Commander Ledros: the declared Ganking expands and binds to movement()", () => {
  const f = fixture({ cards: [{ id: "ledros", cardId: CANONICAL, types: ["unit"] }] });
  f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref("ledros"),
    to: "battlefield",
    location: { type: "battlefield", id: "battlefield-1" }
  });
  f.engine.advance();

  const source = f.kernel.getObject("ledros");
  const binding = createProgramBinding({ cardPrograms: [program] });
  const ability = binding.inspect(source).abilities.find(item =>
    item.kind === "static" && item.effect.kind === "continuous.movement"
  );
  assert.ok(ability, "Ganking must expand to a static movement permission");
  const handle = createEngineStaticBinder(f.engine).bindStatic(ability, source);

  const registration = f.engine.layers.registry.list().find(entry => entry.effect.effect.kind === "continuous.movement");
  assert.ok(registration);
  assert.equal(registration.effect.effect.kind, "continuous.movement");
  assert.equal(registration.effect.effect.permission, "battlefield-to-battlefield");
  // The binder registration is real, but movement() currently consumes the
  // normalized permission.routes shape and therefore cannot consume this
  // scalar KeywordDef payload yet.
  const query = movement(f.engine.layers.registry, source.ref, source, "A");
  assert.equal(query.canGank, false);

  handle.unbind();
  assert.equal(movement(f.engine.layers.registry, source.ref, source, "A").canGank, false);
});

test.todo(
  "ogn-231-298 Commander Ledros: collecting the optional kill additional cost and materializing " +
    "the per-killed Order discount needs the CardProgram → CostPlanInput binding for the declared " +
    "additional cost, kill receipt, and discount quantity (CR 204.2.a/356.2.b.1/356.4)"
);
test.todo(
  "ogn-231-298 Commander Ledros: [Deflect]'s mandatory target tax (CR 809.1.c/356.2.a.2) needs the " +
    "static target.tax declaration to reach target Finalize and become an unrestricted-domain Power payment"
);
test.todo(
  "ogn-231-298 Commander Ledros: [Ganking]'s battlefield-to-battlefield standard move (CR 810.1.b/" +
    "144.4.c.1) needs the scalar KeywordDef permission normalized to movement()'s permission.routes shape"
);
