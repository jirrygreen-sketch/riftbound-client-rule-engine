import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/emperor-of-the-sands.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-956993968d114577bbdd0afa0d90d3d311a8e7b76415282b08d0cf69194c7dbf";
const SOURCE_TEXT =
  "Your Sand Soldiers have [Weaponmaster].\n" +
  ":rb_energy_1:, :rb_exhaust:: Play a 2 :rb_might: Sand Soldier unit token to your base. " +
  "Use only if you've played an Equipment this turn.";

const [grantWeaponmaster, activatedAbility] = program.abilities;
const [playSandSoldierInstruction] = activatedAbility.body;

/** A minimal layered snapshot for the production filter matcher. */
const layeredSnapshot = overrides => ({
  ref: { id: "x", zoneEntryId: 1 },
  cardId: null,
  name: "x",
  types: ["unit"],
  tags: [],
  keywords: [],
  owner: "A",
  controller: "A",
  zone: "board",
  location: { type: "base", player: "A" },
  might: 2,
  energy: null,
  power: null,
  exhausted: false,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: true,
  printed: null,
  actionTimings: [],
  availableTimings: [],
  movement: { allowed: true, canMove: true, canGank: false, restrictions: [] },
  text: null,
  effectText: null,
  ...overrides
});

const legendWorld = () => {
  const base = world()
    .unit("emperor", { types: ["legend"], location: { type: "base", player: "A" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("emperor") });
  kernel.addPlayer("A", { energy: 1 });
  return kernel;
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
  assert.match(program.judgeReason, /LocationRef/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /RIFT-261/);
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

test("sfd-197-221 Emperor of the Sands: the declared Sand Soldier filter selects exactly those units", () => {
  // The production matcher (layers/filter.ts) really evaluates "type +
  // controller + zone + characteristics.name". Its controller placeholder is
  // bound to the ability controller here, exactly as the pipeline does for the
  // `self`/`opponent` selectors it already normalizes (events/pipeline-match.ts)
  // and as the target/query path is responsible for `"controller"`
  // (chain/engine.ts's query normalization is the recorded follow-up).
  const controller = "A";
  const filter = Object.fromEntries(
    Object.entries(grantWeaponmaster.effect.filter).map(([key, value]) => [
      key,
      value === "controller" ? controller : value
    ])
  );

  // A Sand Soldier incarnation (187.3: domainless 2 Might unit token, Shurima
  // tag, printed name Sand Soldier) matches.
  assert.equal(matchesObjectFilter(filter, layeredSnapshot({ name: "Sand Soldier", tags: ["Shurima"] })), true);
  // Other Shurima units are not "Sand Soldiers" — the tag alone would over-match.
  assert.equal(matchesObjectFilter(filter, layeredSnapshot({ name: "Renekton", tags: ["Shurima"] })), false);
  // "unit" is part of the grant's scope: a Gold-style gear token never matches.
  assert.equal(
    matchesObjectFilter(filter, layeredSnapshot({ name: "Sand Soldier", types: ["gear"] })),
    false
  );
  // 740.1.a: the grant covers the controller's Sand Soldiers only.
  assert.equal(
    matchesObjectFilter(filter, layeredSnapshot({ name: "Sand Soldier", controller: "B" })),
    false
  );
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
  assert.equal(activatedAbility.body.length, 1);
  assert.equal(playSandSoldierInstruction.id, "emperor-of-the-sands.play-sand-soldier");
  assert.equal(playSandSoldierInstruction.op, "effect.token");
  assert.deepEqual(playSandSoldierInstruction.args.token, { kind: "constant", value: "sand-soldier" });
  assert.deepEqual(playSandSoldierInstruction.args.amount, { kind: "constant", value: 1 });
  // 440.2.c / 185.2.a: "play a … token" creates it on the Chain and hands it to
  // the play flow.
  assert.deepEqual(playSandSoldierInstruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playSandSoldierInstruction.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
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
  // The printed destination "to your base" has no controller-relative spelling
  // in the frozen IR (see judgeReason), so the concrete seat its controller
  // occupies is substituted here; the token definition, amount and play mode
  // are the card's own arguments.
  const kernel = legendWorld();
  const base = { type: "base", player: "A" };
  const body = [
    {
      ...playSandSoldierInstruction,
      args: { ...playSandSoldierInstruction.args, location: { kind: "constant", value: base } }
    }
  ];

  const outcome = resolveChainBody(body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.events.map(event => event.action), ["create-token", "play"]);
  const created = kernel.query({ zone: "board", type: "unit" });
  assert.equal(created.length, 1);
  const [soldier] = created;
  assert.equal(soldier.isToken, true);
  assert.equal(soldier.name, "Sand Soldier");
  assert.equal(soldier.might, 2);
  assert.deepEqual(soldier.tags, ["Shurima"]);
  assert.deepEqual(soldier.location, base);
  assert.equal(soldier.controller, "A");
  // 185.3: tokens have no costs and no domains — null printed characteristics,
  // never 0.
  assert.equal(soldier.energy, null);
  assert.equal(soldier.power, null);
});

test.todo(
  "sfd-197-221 Emperor of the Sands: 'played an Equipment this turn' (054.2) needs a history predicate over " +
    "played cards filtered by type/tag — HistoryQuery (effects/contract.ts) only exposes " +
    "scope/action/timingPoint/player/object — plus a consumer for card Restrictions at Finalize"
);
test.todo(
  "sfd-197-221 Emperor of the Sands: 'Play a … token to your base' needs a controller-relative LocationRef for " +
    "effect.token (it only accepts a literal PlayerId that must equal ctx.controller; effect.move already resolves " +
    "'controller-base')"
);
test.todo(
  "sfd-197-221 Emperor of the Sands: the static grant-keyword needs a CardProgram -> LayerEngine registration path, " +
    "the controller: \"controller\" placeholder binding in layers/filter.ts, and the Weaponmaster expansion " +
    "(821.1.c Equip discount needs cost.modify / cost.pay) — RIFT-257 / RIFT-261"
);
test.todo(
  "sfd-197-221 Emperor of the Sands: a Legend has no Legend Zone in contract 3.6's ZoneId (CR 108.3), so the " +
    "cost's 'exhaust me' host cannot be bound in production"
);
