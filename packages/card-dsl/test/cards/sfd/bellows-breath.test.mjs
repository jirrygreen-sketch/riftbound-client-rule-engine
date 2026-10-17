import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/bellows-breath.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import repeat from "../../../../engine-core/dist/effects/keywords/Repeat.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID = "card.hash-effd069140ba0a97aec2b49e85dfc04e38ae3517c75aea5b88e3fcb853a4ea2b";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "[Repeat] :rb_energy_1::rb_rune_mind: (You may pay the additional cost to repeat this spell's effect.)\n" +
  "Deal 1 to up to three units at the same location.";

const [action, play] = program.abilities;
const [deal] = play.body;
const targetSpec = deal.targets[0];

test("sfd-080-221 Bellows Breath: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("sfd-080-221 Bellows Breath: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("sfd-080-221 Bellows Breath: judgeReason names the group requirement and the Repeat wiring", () => {
  assert.match(program.judgeReason, /355\.11/);
  assert.match(program.judgeReason, /355\.11\.b/);
  assert.match(program.judgeReason, /optionalAdditional/);
});

test("sfd-080-221 Bellows Breath: [Action] keyword plus the printed [Repeat] additional cost", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(action, { kind: "keyword", keyword: "action" });
  assert.equal(action.value, undefined);

  assert.equal(play.cost.kind, "additional");
  assert.equal(play.cost.keyword, "repeat");
  assert.equal(play.cost.optional, true);
  const [energyPayment, powerPayment] = play.cost.payments;
  assert.equal(energyPayment.kind, "energy");
  assert.deepEqual(energyPayment.amount, { kind: "constant", value: 1 });
  assert.equal(energyPayment.choice.id, "bellows-breath.repeat-payment");
  assert.equal(powerPayment.kind, "power");
  assert.deepEqual(powerPayment.amount, { kind: "constant", value: 1 });
  assert.deepEqual(powerPayment.allowedDomains, ["Mind"]);
});

test("sfd-080-221 Bellows Breath: up-to-three unit targets with the same-location group intent", () => {
  assert.equal(play.body.length, 1);
  assert.equal(deal.id, "bellows-breath.deal-1");
  assert.equal(deal.op, "effect.damage");
  assert.equal(deal.linkedTo, undefined);
  assert.deepEqual(deal.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(deal.args.target, { kind: "constant", value: "bellows-breath.units" });
  // A fixed 1 per target is not split damage (355.14).
  assert.equal(deal.args.divide, undefined);

  // 355.12: each chosen unit is a target chosen independently of the Deal;
  // 355.13: "up to three" includes zero. kind "group" records the 355.11
  // same-location requirement (coherence is still unmerged).
  assert.deepEqual(targetSpec, {
    id: "bellows-breath.units",
    filter: { type: "unit", zone: "board" },
    min: 0,
    max: 3,
    selection: "up-to",
    kind: "group"
  });
  assert.equal(instructionDefinitionsById.get("effect.damage"), damage);
});

test("sfd-080-221 Bellows Breath: the merged Repeat keyword and interpreter repeat body execute the damage once", () => {
  const repeatAbilities = repeat.expand({
    host: { canonicalCardId: CANONICAL_ID },
    cost: {
      energy: 1,
      power: [{ amount: 1, allowedDomains: ["Mind"] }]
    }
  });
  assert.equal(repeatAbilities.length, 1);
  assert.equal(repeatAbilities[0].effect.kind, "repeat.cost");
  assert.deepEqual(repeatAbilities[0].effect.cost, {
    energy: 1,
    power: [{ amount: 1, allowedDomains: ["Mind"] }]
  });

  // Repeat's paid-instance count is not wired from Finalize for this card,
  // but the merged interpreter primitive can execute the real Bellows Breath
  // damage body. Its resolution-time target choice is supplied explicitly.
  const kernel = world().unit("one").unit("two").build();
  const repeated = [{
    id: "bellows-breath.repeat",
    op: "repeat",
    args: {
      count: { kind: "constant", value: 1 },
      body: { kind: "constant", value: play.body }
    }
  }];
  kernel.setAnswers({
    "bellows-breath.repeat/0/bellows-breath.deal-1/target%3Abellows-breath.units": [kernel.ref("one")]
  });

  const outcome = resolveChainBody(repeated, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results.at(-1).id, "bellows-breath.repeat");
  assert.equal(outcome.results.at(-1).result.linkedValues.count, 1);
  assert.equal(kernel.getObject("one").damage, 1);
  assert.equal(kernel.getObject("two").damage, 0);
});

test("sfd-080-221 Bellows Breath golden: 1 damage is dealt to each of the three chosen units", () => {
  const kernel = world()
    .unit("one", { owner: "A", controller: "A" })
    .unit("two", { owner: "B", controller: "B" })
    .unit("three", { owner: "A", controller: "A" })
    .unit("unlocked", { owner: "A", controller: "A" })
    .build();
  kernel.setTargets("bellows-breath.units", [
    kernel.ref("one"),
    kernel.ref("two"),
    kernel.ref("three")
  ]);

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.dealt, 3);
  assert.equal(outcome.results[0].result.linkedValues.dealtCount, 3);
  assert.deepEqual(
    outcome.results[0].result.linkedValues.dealtTo.map((entry) => [entry.target.id, entry.amount]),
    [["one", 1], ["two", 1], ["three", 1]]
  );
  assert.equal(kernel.getObject("one").damage, 1);
  assert.equal(kernel.getObject("two").damage, 1);
  assert.equal(kernel.getObject("three").damage, 1);
  assert.equal(kernel.getObject("unlocked").damage, 0);
});

test("sfd-080-221 Bellows Breath golden: choosing fewer than three units damages only them (355.13)", () => {
  const kernel = world().unit("one").unit("two").build();
  kernel.setTargets("bellows-breath.units", [kernel.ref("two")]);

  const outcome = resolveChainBody(play.body, kernel);

  // "up to three" may choose fewer, so locking a single legal target is a
  // complete resolution (355.13) with no mistargeting.
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.dealtCount, 1);
  assert.equal(kernel.getObject("one").damage, 0);
  assert.equal(kernel.getObject("two").damage, 1);
});

test("sfd-080-221 Bellows Breath golden: choosing zero units deals no damage (355.13)", () => {
  const kernel = world().unit("untouched").build();
  kernel.setTargets("bellows-breath.units", []);

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("untouched").damage, 0);
  assert.equal(outcome.events.length, 0);
});

test("sfd-080-221 Bellows Breath golden: only the still-legal member of a mistargeted group takes damage (359.3.e.8)", () => {
  const kernel = world().unit("staying").unit("leaving").build();
  const stale = kernel.ref("leaving");
  assert.equal(kernel.perform({ type: "return-to-hand", object: stale }).status, "done");
  kernel.setTargets("bellows-breath.units", [kernel.ref("staying"), stale]);

  const outcome = resolveChainBody(play.body, kernel);

  // One member of the group left the board, so the resolution is partial
  // (359.3.e.8) while the remaining legal unit still takes its damage.
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.dealtCount, 1);
  assert.equal(kernel.getObject("staying").damage, 1);
  assert.deepEqual(outcome.results[0].result.linkedValues.dealtTo, [
    { target: { id: "staying", zoneEntryId: 1 }, amount: 1 }
  ]);
});

test.todo(
  "sfd-080-221 Bellows Breath: 'at the same location' is a 355.11 group-targeting requirement — all chosen units " +
    "must share one Location, with the resolution-time legal-subset re-choice of 355.11.b. The merged target plan " +
    "only enforces per-member legality and min/max, so kind \"group\" is declared but not enforced."
);

test.todo(
  "sfd-080-221 Bellows Breath: [Repeat] :rb_energy_1::rb_rune_mind: must be collected at Finalize and the paid " +
    "instance count fed to the interpreter's repeat node (CR 820.1.c.1 / 820.1.d.1; the merged Repeat keyword, " +
    "effect.repeat primitive and cost-plan optionalAdditional input exist, but no card-to-Finalize wiring)."
);
