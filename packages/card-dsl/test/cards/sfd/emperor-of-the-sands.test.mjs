import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/emperor-of-the-sands.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { translateRestriction } from "../../../../engine-core/dist/programs/play.js";
import { fixture } from "../../../../engine-core/test/programs/helpers.mjs";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-956993968d114577bbdd0afa0d90d3d311a8e7b76415282b08d0cf69194c7dbf";
const SOURCE_TEXT =
  "Your Sand Soldiers have [Weaponmaster].\n" +
  ":rb_energy_1:, :rb_exhaust:: Play a 2 :rb_might: Sand Soldier unit token to your base. " +
  "Use only if you've played an Equipment this turn.";

const [grantWeaponmaster, activatedAbility] = program.abilities;
const [controllerBaseInstruction, playSandSoldierInstruction] = activatedAbility.body;

const legendWorld = () => {
  const base = world()
    .player("A", { energy: 1 })
    .unit("emperor", { cardId: CARD_ID, types: ["legend"], energy: null, power: null, might: null, location: { type: "base", player: "A" } })
    .build();
  return base.clone({ sourceSnapshot: base.getObject("emperor") });
};

test("sfd-197-221 Emperor of the Sands: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-197-221 Emperor of the Sands: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /HistoryQuery/);
  assert.match(program.judgeReason, /054\.2/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.match(program.judgeReason, /821\.1\.c/);
  assert.match(program.judgeReason, /107\.4/);
  // The controller-relative Base binding is no longer a gap; the reason must
  // not keep claiming effect.token cannot resolve it.
  assert.doesNotMatch(program.judgeReason, /effect\.token 需要相对控制者的 Base LocationRef/);
});

test("sfd-197-221 Emperor of the Sands: 'Your Sand Soldiers have [Weaponmaster]' is a static keyword grant", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(grantWeaponmaster.kind, "static");
  assert.equal(grantWeaponmaster.condition, undefined);
  assert.equal(grantWeaponmaster.effect.kind, "grant-keyword");
  // 821: the keyword is only declared; its expansion belongs to
  // effects/keywords/Weaponmaster.ts (contract 3.7).
  assert.equal(grantWeaponmaster.effect.keyword, "weaponmaster");
  // 187.3: a Sand Soldier is a domainless 2 Might unit token with the Shurima
  // tag — its printed name is what "Sand Soldiers" refers to, not the tag
  // (other Shurima units exist).
  assert.deepEqual(grantWeaponmaster.effect.filter, {
    type: "unit",
    controller: "controller",
    zone: "board",
    characteristics: { name: "Sand Soldier" }
  });
});

test("sfd-197-221 Emperor of the Sands: the real static binder grants Weaponmaster only to your Sand Soldiers", () => {
  // Isolate the supported static ability with a Board fixture host. This does
  // not assert Legend Zone support or the granted keyword's Equip behavior.
  const f = fixture({ cards: [
    { id: "emperor", cardId: CARD_ID, name: "Emperor of the Sands", types: ["legend"], energy: null, power: null, might: null },
    { id: "soldier", name: "Sand Soldier", types: ["unit"], tags: ["Shurima"], might: 2 },
    { id: "other-shuriman", name: "Renekton", types: ["unit"], tags: ["Shurima"], might: 3 },
    { id: "enemy-soldier", owner: "B", name: "Sand Soldier", types: ["unit"], tags: ["Shurima"], might: 2 },
    { id: "gear", name: "Sand Soldier", types: ["gear"] }
  ] });
  for (const id of ["emperor", "soldier", "other-shuriman", "enemy-soldier", "gear"]) {
    const owner = f.kernel.getObject(id).owner;
    f.engine.commit({ type: "move-zone", object: f.kernel.ref(id), to: "base", location: { type: "base", player: owner } });
  }
  const handle = createEngineStaticBinder(f.engine).bindStatic(grantWeaponmaster, f.kernel.getObject("emperor"));
  f.engine.layers.setObjects(f.kernel.objects);
  const hasWeaponmaster = (id) => f.engine.layers.snapshot(f.kernel.ref(id)).keywords
    .some((keyword) => keyword.id === "weaponmaster");
  assert.equal(hasWeaponmaster("soldier"), true);
  for (const id of ["other-shuriman", "enemy-soldier", "gear"]) assert.equal(hasWeaponmaster(id), false);
  handle.unbind();
  assert.equal(hasWeaponmaster("soldier"), false);
});

test("sfd-197-221 Emperor of the Sands: :rb_energy_1:, :rb_exhaust: is an activated cost with the only-if restriction", () => {
  assert.equal(activatedAbility.kind, "activated");
  assert.equal(activatedAbility.timing, "action");
  assert.equal(activatedAbility.cost.kind, "activated");
  assert.deepEqual(activatedAbility.cost.energy, { kind: "constant", value: 1 });
  // 415.5: the printed :rb_exhaust: in an ability is the cost "Exhaust me".
  assert.deepEqual(activatedAbility.cost.payments, [{ kind: "exhaust", object: "self" }]);
  // 054.2: "Use only if you've played an Equipment this turn" is a restriction,
  // kept separate from the cost (contract 3.1).
  assert.deepEqual(activatedAbility.restriction, {
    kind: "use-only-if",
    value: { kind: "constant", value: "played-an-equipment-this-turn" }
  });
});

test("sfd-197-221 Emperor of the Sands: the body plays the CR 187.3 Sand Soldier token", () => {
  assert.equal(activatedAbility.body.length, 2);
  // 440.4 / 355.2.a: "your base" resolves against the ability controller, so
  // the destination is a runtime LocationRef evaluated by the merged
  // LocationExpr bridge (RIFT-357) rather than a hard-coded seat.
  assert.equal(controllerBaseInstruction.id, "emperor-of-the-sands.controller-base");
  assert.equal(controllerBaseInstruction.op, "condition.value");
  assert.deepEqual(controllerBaseInstruction.args, {
    value: { kind: "location", value: "ability-controller-base" }
  });
  assert.equal(playSandSoldierInstruction.id, "emperor-of-the-sands.play-sand-soldier");
  assert.equal(playSandSoldierInstruction.op, "effect.token");
  assert.deepEqual(playSandSoldierInstruction.args.token, { kind: "constant", value: "sand-soldier" });
  assert.deepEqual(playSandSoldierInstruction.args.amount, { kind: "constant", value: 1 });
  // 440.2.c / 185.2.a: "play a … token" creates it on the Chain and hands it to
  // the play flow.
  assert.deepEqual(playSandSoldierInstruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playSandSoldierInstruction.args.location, {
    kind: "linked-value",
    instructionId: "emperor-of-the-sands.controller-base",
    key: "value"
  });
  assert.deepEqual(playSandSoldierInstruction.args.linkKey, { kind: "constant", value: "sandSoldierToken" });
  assert.equal(playSandSoldierInstruction.targets, undefined);
  assert.equal(playSandSoldierInstruction.linkedTo, undefined);
});

test("sfd-197-221 Emperor of the Sands: the printed cost is charged for real (1 energy + exhaust self)", () => {
  const kernel = legendWorld();
  const plan = buildCostPlan(kernel, { id: "cost:emperor-of-the-sands", cost: activatedAbility.cost });

  assert.equal(plan.total.energy, 1);
  assert.deepEqual(plan.total.actions.map(entry => entry.action.type), ["exhaust"]);
  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.equal(kernel.player("A").energy, 0);
  assert.equal(kernel.getObject("emperor").exhausted, true);
});

test("sfd-197-221 Emperor of the Sands: the printed token is really created and played (CR 187.3)", () => {
  // "to your base" now runs through the card's own two-instruction body: the
  // merged LocationExpr resolves "ability-controller-base" and the linked value
  // is what effect.token consumes. Nothing about the seat is hard-coded.
  const base = world()
    .player("A", { energy: 1 })
    .player("B", { energy: 1 })
    .unit("emperor", {
      owner: "A",
      controller: "B",
      cardId: CARD_ID,
      types: ["legend"],
      energy: null,
      power: null,
      might: null,
      location: { type: "base", player: "A" }
    })
    .build();
  const kernel = base.clone({ controller: "B", sourceSnapshot: base.getObject("emperor") });

  const outcome = resolveChainBody(activatedAbility.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => entry.result.status), ["executed", "executed"]);
  assert.deepEqual(kernel.events.map(event => event.action), ["create-token", "play"]);
  const created = kernel.query({ zone: "board", type: "unit" });
  assert.equal(created.length, 1);
  const [soldier] = created;
  assert.equal(soldier.isToken, true);
  assert.equal(soldier.name, "Sand Soldier");
  assert.equal(soldier.might, 2);
  assert.deepEqual(soldier.tags, ["Shurima"]);
  // 440.4 / 182-183: the token belongs to and is controlled by the ability's
  // controller, and "your base" is that controller's Base.
  assert.deepEqual(soldier.location, { type: "base", player: "B" });
  assert.equal(soldier.controller, "B");
  // 185.3: tokens have no costs and no domains — null printed characteristics,
  // never 0.
  assert.equal(soldier.energy, null);
  assert.equal(soldier.power, null);
});

test("sfd-197-221 Emperor of the Sands: the pre-activation only-if restriction is still refused by the production adapter", () => {
  // 054.2's "Use only if…" must be checked before the ability can be
  // activated. The merged translateRestriction only forwards a Condition/Expr
  // (chain/engine.ts Finalize tests it), and the closed Condition/Expr unions
  // have no played-Equipment history member, so the authored declaration stays
  // judge-required instead of being approximated.
  assert.throws(() => translateRestriction(activatedAbility.restriction, CARD_ID), error => {
    assert.equal(error.code, "judge-required");
    assert.match(error.message, /use-only-if/);
    return true;
  });
});

test("sfd-197-221 Emperor of the Sands: merged history queries identify the controller's played Equipment", () => {
  // History counting is supported. Its use as a pre-activation Condition/Expr
  // remains pending, so this is evidence for that supported sub-operation only.
  const kernel = world()
    .hand("equipment", { types: ["gear"], tags: ["Equipment"] })
    .hand("other-gear", { types: ["gear"] })
    .hand("enemy-equipment", { owner: "B", types: ["gear"], tags: ["Equipment"] })
    .build();
  const historyBody = [{
    id: "equipment-history",
    op: "condition.history",
    args: {
      query: { kind: "constant", value: { scope: "turn", action: "play", player: "A", objectFilter: { tags: ["Equipment"] } } }
    }
  }];
  const count = () => {
    const outcome = resolveChainBody(historyBody, kernel);
    assert.equal(outcome.status, "executed");
    return outcome.linkedValues["equipment-history.count"];
  };
  assert.equal(count(), 0);
  for (const [id, player] of [["enemy-equipment", "B"], ["other-gear", "A"]]) {
    assert.equal(kernel.perform({ type: "play", object: kernel.ref(id), player }).status, "done");
    assert.equal(count(), 0);
  }
  assert.equal(kernel.perform({ type: "play", object: kernel.ref("equipment"), player: "A" }).status, "done");
  assert.equal(count(), 1);
  assert.equal(kernel.perform({ type: "banish", object: kernel.ref("equipment") }).status, "done");
  assert.equal(count(), 1, "the query uses the played object's historical characteristics");
});

test.todo(
  "sfd-197-221 Emperor of the Sands: the pre-activation only-if Restriction needs condition.history as a " +
    "Condition/Expr (054.2; RIFT-359); objectFilter history counting itself is covered above"
);

test.todo(
  "sfd-197-221 Emperor of the Sands: Weaponmaster needs authoritative Equip-cost binding and original [A] " +
    "symbol provenance for the printed discount (821.1.c.2/c.3); static keyword granting itself is covered above"
);
test.todo(
  "sfd-197-221 Emperor of the Sands: a Legend has no Legend Zone in contract 3.6's ZoneId (CR 107.4), so the " +
    "cost's 'exhaust me' host cannot be bound in production"
);
