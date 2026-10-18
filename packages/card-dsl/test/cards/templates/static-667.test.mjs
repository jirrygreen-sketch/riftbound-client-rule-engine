// RIFT-667 / cards/README.md 4.1 — template-level parameterized golden for the
// twelve `static||` cards (ability kind | timing points | instruction sequence).
//
// One row per canonical card, and each row is an independently named node:test
// case: the row carries that card's own object setup, its own operations and its
// own expected assertions, and the scenario runs through the generic card
// execution harness (engine-core/src/effects/testing/scenario, RIFT-592) so card
// entry, play/cost settlement, target locking, layer reads and rule queries all go
// through production code paths.
//
// The harness accepts `executable` programs only, so each row builds a test-only
// candidate view of the published program: identical abilities, sourceText and
// canonicalCardId, metadata-only status lift. The published program is read from
// `dist/cards/registry.generated.js` and its real status is asserted, so no row
// can silently promote a card.
//
// programs/lifecycle.ts has no error sink, so the lifecycle swallows static
// binding failures: a scenario that merely completes is NOT evidence for a
// static ability. Every row therefore also binds its own declared static ability
// through the production engine binder (programs/statics.ts) and asserts the
// measured outcome — either the registration that really happened, or the exact
// fail-closed ProgramBindingError. Rows whose printed effect cannot run yet keep
// the printed expectation as a `test.todo` naming the measured gap.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { ProgramBindingError } from "../../../../engine-core/dist/programs/errors.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { movement, restrictions } from "../../../../engine-core/dist/layers/rules/query.js";
import { moveDuelUnitsStandard } from "../../../../engine-core/dist/zones/movement.js";
import { createDuelBoard, placeDuelUnit, selectDuelBattlefields } from "../../../../engine-core/dist/duel/battlefields.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

import flash from "../../../dist/cards/ogs/flash.js";
import hextechRay from "../../../dist/cards/ogn/hextech-ray.js";
import orbOfRegret from "../../../dist/cards/ogn/orb-of-regret.js";

const IDS = {
  trifarianWarCamp: "card.hash-ca6330500fc019b19ccf0df937fc22945cc8bf28a51c21eaef572c53cc31387f",
  vilemawsLair: "card.hash-3e2d969f2528a782a98c698fc45d9937d376dd06244c444271adf9cbd4100e77",
  voidGate: "card.hash-914c78ed19d1829c8172e4fcce5b399b51f05e15d1a02fb7eaaaf64e7132bc08",
  masterYiMeditative: "card.hash-87c4e90c814243a78c356216704a1ec163c6f16ccaba9de6697847335b8f6601",
  wujuBladesmanStarter: "card.hash-cf38f851f4d3c20ede56526fcc1ad4c1ed2581cc73341deaa53ea09e51c15790",
  forgottenMonument: "card.hash-b6280b20779b152b78ff7c32ddd405d6d7c490bb00b2e8939b821030dffcab90",
  ireliaGraceful: "card.hash-4226ae419dd851644c384f3f4d645badcec767b55055e62cb45fcc436ec55e03",
  legionQuartermaster: "card.hash-a010c6a3b5692bc45e1c1a552db574267b69092695de19dc7869f7089ece7cb2",
  maraiSpire: "card.hash-e00a3fe8d0f18d062b1743d6d5d1eb534e884d83303af037d7c1d05c3a6a21bd",
  minotaurReckoner: "card.hash-4707dc730254c2d3c4ed3484a961094d03925ec45f647f561ff4b106e7e22ebe",
  ornnsForge: "card.hash-44e95dd0a87b7dfcd7565b73a33e204f85c97ac82e004a6127ff7ed649fb41ad",
  purifier: "card.hash-d6988e3c4bfaf3cd84e8451ade514abc99df9e47acaa479d8e17bd78b14d1db5",
};

const HERE = { type: "battlefield", id: "static-667-here" };
const ELSEWHERE = { type: "battlefield", id: "static-667-elsewhere" };
const ENEMY_LOCATION = { type: "battlefield", id: "static-667-enemy" };
const BATTLEFIELD = { types: ["battlefield"], energy: null, power: null };
const LEGEND = { types: ["legend"], energy: null, power: null };

/** The published program for one canonical identity; each row's source of truth. */
function published(canonicalCardId) {
  const program = cardProgramsById.get(canonicalCardId);
  assert.ok(program, "generated card program " + canonicalCardId + " is present");
  return program;
}

/**
 * Test-only candidate view. Only the validation metadata changes: abilities,
 * sourceText, canonicalCardId and rulesetVersion stay identical, and every row
 * still asserts that the published program is judge-required with a concrete
 * judgeReason, so no row can promote a card.
 */
function candidate(canonicalCardId) {
  const program = published(canonicalCardId);
  assert.equal(program.status, "judge-required", canonicalCardId + " must stay judge-required");
  assert.ok(program.judgeReason && program.judgeReason.trim(), canonicalCardId + " keeps a concrete judgeReason");
  const view = { ...program, status: "executable", judgeReason: undefined };
  assert.equal(view.abilities, program.abilities, "the candidate view never rewrites abilities");
  assert.equal(view.sourceText, program.sourceText, "the candidate view never rewrites sourceText");
  assert.equal(view.canonicalCardId, program.canonicalCardId);
  assert.equal(view.rulesetVersion, program.rulesetVersion);
  return view;
}

/** A complete snapshot for the production static binder and the layer engine. */
function snapshot(id, values = {}) {
  return {
    ref: { id, zoneEntryId: 1 },
    cardId: values.cardId ?? null,
    name: id,
    types: values.types ?? ["unit"],
    tags: values.tags ?? [],
    keywords: values.keywords ?? [],
    owner: values.owner ?? "A",
    controller: values.controller ?? values.owner ?? "A",
    zone: values.zone ?? "board",
    location: values.location === undefined ? HERE : values.location,
    combatRole: values.combatRole ?? null,
    might: values.might ?? null,
    energy: values.energy ?? null,
    power: values.power ?? null,
    exhausted: values.exhausted ?? false,
    damage: values.damage ?? 0,
    stunned: values.stunned ?? false,
    buffs: values.buffs ?? 0,
    attachedTo: values.attachedTo ?? null,
    faceDown: values.faceDown ?? false,
    isToken: values.isToken ?? false,
  };
}

/** Bind one real ability through the production static binder on a fresh engine. */
function bindStatic(ability, source) {
  const engine = fixture({ cards: [] }).engine;
  let handle = null;
  let error = null;
  try {
    handle = createEngineStaticBinder(engine).bindStatic(ability, source);
  } catch (caught) {
    error = caught;
  }
  return { engine, handle, error };
}

/** Fail-closed evidence: the production binder rejects the declared static ability. */
function expectBindingError(ability, source, pattern) {
  const { engine, error } = bindStatic(ability, source);
  assert.ok(error instanceof ProgramBindingError, "expected a fail-closed ProgramBindingError for " + ability.effect.kind);
  assert.equal(error.code, "judge-required");
  assert.match(error.message, pattern);
  assert.deepEqual(engine.layers.registry.list(), [], "a rejected static ability registers no layer");
}

/** Registration evidence: the production binder really added the layer entry. */
function expectRegistration(ability, source) {
  const { engine, handle, error } = bindStatic(ability, source);
  assert.equal(error, null, "the production static binder accepted this declaration");
  assert.ok(handle, "the production binder returned a binding handle");
  const entries = engine.layers.registry.list();
  assert.equal(entries.length, 1, "exactly one continuous effect is registered");
  const [entry] = entries;
  assert.equal(entry.effect.source.id, source.ref.id);
  const effect = entry.effect.effect;
  // Unbinding really removes the registration; verified on a throwaway binder so
  // this row keeps the live entry for its layer and rule-query reads.
  const probe = bindStatic(ability, source);
  probe.handle.unbind();
  assert.deepEqual(probe.engine.layers.registry.list(), [], "unbinding removes the registration");
  return { engine, entry, effect, handle };
}

/**
 * A real Standard Move probe over a real duel board. Omitting `registry`
 * reproduces the shipped lifecycle: duel/standard-move-executor-v2.ts calls
 * moveDuelUnitsWithMetadata without a DuelMovementRuleContext, so no movement
 * rule query runs at all.
 */
function standardMoveProbe({ controller, unit, destinationId }) {
  const selection = selectDuelBattlefields(["A", "B"].map(playerId => ({
    playerId,
    battlefields: [1, 2, 3].map(index => ({ instanceId: playerId + "-" + index, cardId: playerId + "-field-" + index })),
  })), () => 0);
  let board = createDuelBoard(selection);
  const battlefield = board.battlefields[0].locationId;
  const bases = Object.fromEntries(board.bases.map(base => [base.ownerPlayerId, base.locationId]));
  board = placeDuelUnit(board, { objectId: unit, controllerPlayerId: controller, locationId: battlefield });
  const request = {
    actor: controller,
    unitUIDs: [unit],
    destinationLocationId: destinationId === "base" ? bases[controller] : destinationId,
    timing: { phase: "main", stateOpen: true, turnPlayerId: controller, priorityPlayerId: controller },
  };
  return {
    battlefield,
    destination: request.destinationLocationId,
    move: rules => moveDuelUnitsStandard(board, [{ objectId: unit, readied: true, hasGanking: false }], request, rules),
  };
}

// ---------------------------------------------------------------------------
// One row per assigned card. Every row: its own scenario through the real
// lifecycle, its own assertions, and the measured outcome of binding its own
// declared static ability with the production binder.
// ---------------------------------------------------------------------------
const rows = [
  {
    // 053.3 + 479.4: the +1 really registers as an arithmetic-layer entry, but
    // staticFilter carries the source LocationRef value and layers/filter.ts
    // compares structured locations by reference (measured below: identical
    // object true, equal value false). Layer snapshots are cloned, so the
    // registered aura reaches nobody.
    name: "Trifarian War Camp · units here keep their printed Might because the bound here-filter never matches",
    canonicalCardId: IDS.trifarianWarCamp,
    program: candidate(IDS.trifarianWarCamp),
    scenario: {
      objects: [
        { id: "camp", cardId: IDS.trifarianWarCamp, ...BATTLEFIELD, zone: "board", location: HERE },
        { id: "own-here", types: ["unit"], zone: "board", location: { ...HERE }, might: 2 },
        { id: "enemy-here", owner: "B", types: ["unit"], zone: "board", location: { ...HERE }, might: 5 },
        { id: "elsewhere", types: ["unit"], zone: "board", location: ELSEWHERE, might: 4 },
      ],
      operations: [],
      expect: {
        objects: {
          camp: { zone: "board", location: HERE, energy: null, power: null },
          "own-here": { zone: "board", location: HERE, might: 2 },
          "enemy-here": { zone: "board", location: HERE, might: 5 },
          elsewhere: { zone: "board", location: ELSEWHERE, might: 4 },
        },
        events: { exact: [] },
      },
    },
    verify(result) {
      const [ability] = published(IDS.trifarianWarCamp).abilities;
      const source = snapshot("camp", { types: ["battlefield"], location: HERE, energy: null, power: null });
      const { engine, entry, effect } = expectRegistration(ability, source);
      assert.equal(entry.effect.layer, "arithmetic");
      assert.equal(effect.kind, "continuous.might");
      assert.equal(effect.mode, "add");
      // staticFilter literalizes the declared amount on the registered spec.
      assert.equal(effect.amount, 1);
      // staticFilter resolved sameLocationAs:self into the source LocationRef.
      assert.deepEqual(entry.effect.filter, { type: "unit", zone: "board", location: HERE });
      const identical = snapshot("own-here", { location: HERE, might: 2 });
      const cloned = snapshot("own-here", { location: { ...HERE }, might: 2 });
      assert.equal(matchesObjectFilter(entry.effect.filter, identical), true);
      assert.equal(matchesObjectFilter(entry.effect.filter, cloned), false);
      // The production scenario state really holds printed Might for both
      // controllers at this battlefield, which is exactly the gap.
      assert.equal(result.state.objects.find(object => object.ref.id === "own-here").might, 2);
      assert.equal(result.state.objects.find(object => object.ref.id === "enemy-here").might, 5);
      return result;
    },
  },
  {
    // 054.1 / 358.3.a: the prohibition really reaches the rule query for both
    // players and only at this battlefield. Its effect-move side is still open.
    name: "Vilemaw's Lair · the rule query prohibits both players from moving here to base",
    canonicalCardId: IDS.vilemawsLair,
    program: candidate(IDS.vilemawsLair),
    scenario: {
      objects: [
        { id: "lair", cardId: IDS.vilemawsLair, ...BATTLEFIELD, zone: "board", location: HERE },
        { id: "own-here", types: ["unit"], zone: "board", location: { ...HERE }, might: 2 },
        { id: "enemy-here", owner: "B", types: ["unit"], zone: "board", location: { ...HERE }, might: 5 },
        { id: "away", types: ["unit"], zone: "board", location: ELSEWHERE, might: 4 },
      ],
      operations: [],
      expect: {
        objects: {
          lair: { zone: "board", location: HERE, energy: null, power: null },
          "own-here": { zone: "board", location: HERE, might: 2 },
          "enemy-here": { zone: "board", location: HERE, might: 5 },
          away: { zone: "board", location: ELSEWHERE, might: 4 },
        },
        events: { exact: [] },
      },
    },
    verify(result) {
      const [ability] = published(IDS.vilemawsLair).abilities;
      const source = snapshot("lair", { types: ["battlefield"], location: HERE, energy: null, power: null });
      const { engine, effect } = expectRegistration(ability, source);
      assert.equal(effect.kind, "continuous.movement");
      // Both spellings ship: the rule query reads the plural, the layer fold the
      // singular (053.3 scope, 054.1 prohibition, 144.4.b route).
      assert.equal(effect.restriction, "move-from-here-to-base");
      assert.deepEqual(effect.restrictions, ["move-from-here-to-base"]);
      assert.equal(effect.addsPermission, false);
      const own = snapshot("own-here", { location: { ...HERE }, might: 2 });
      const enemy = snapshot("enemy-here", { owner: "B", location: { ...HERE }, might: 5 });
      const away = snapshot("away", { location: ELSEWHERE, might: 4 });
      const gear = snapshot("gear-here", { types: ["gear"], location: { ...HERE } });
      engine.layers.setObjects([own, enemy, away, gear]);
      for (const unit of [own, enemy]) {
        const view = movement(engine.layers.registry, unit.ref, unit, "A");
        assert.deepEqual(view.restrictions, ["move-from-here-to-base"]);
        assert.equal(view.canMove, true, "a prohibition grants nothing");
        assert.equal(view.canGank, false);
      }
      // Other locations and non-units at this location are untouched.
      assert.deepEqual(movement(engine.layers.registry, away.ref, away, "A").restrictions, []);
      assert.deepEqual(movement(engine.layers.registry, gear.ref, gear, "A").restrictions, []);
      // The layer snapshot path compares the source LocationRef by reference, so
      // it folds the restriction only for a snapshot built from that object.
      assert.deepEqual(engine.layers.snapshot(own.ref).movement.restrictions, [], "a cloned LocationRef misses the layer fold too");
      // The effect-move action name is not restricted anywhere: the open gap.
      assert.deepEqual(restrictions(engine.layers.registry, "move-location", own.ref, own, "A"), []);
      assert.deepEqual(restrictions(engine.layers.registry, "move", own.ref, own, "A"), []);
      return result;
    },
  },
  {
    // 418.4 / 713: the declared "+1 Bonus Damage per Deal action" never binds,
    // and the real Deal action in this scenario dealt exactly the printed 3.
    name: "Void Gate · the Bonus Damage grant fails closed and a real Deal action stays at 3",
    canonicalCardId: IDS.voidGate,
    program: candidate(IDS.voidGate),
    scenario: {
      players: { A: { energy: 1, power: ["Fury"] } },
      objects: [
        { id: "gate", cardId: IDS.voidGate, ...BATTLEFIELD, zone: "board", location: HERE },
        { id: "victim", owner: "B", types: ["unit"], zone: "board", location: { ...HERE }, might: 5 },
        { id: "ray", program: hextechRay, cardId: hextechRay.canonicalCardId, types: ["spell"], zone: "hand", energy: 1, power: ["Fury"] },
      ],
      answers: { "target:hextech-ray.unit-at-battlefield": ["victim"] },
      operations: [
        { type: "play", object: "ray", player: "A" },
        { type: "pass", player: "A" }, { type: "pass", player: "B" },
      ],
      expect: {
        objects: {
          gate: { zone: "board", location: HERE, energy: null, power: null },
          victim: { zone: "board", location: HERE, might: 5, damage: 3 },
          ray: { zone: "trash" },
        },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "damage-dealt", action: { type: "damage", amount: 3 } }] },
      },
    },
    verify(result) {
      const [ability] = published(IDS.voidGate).abilities;
      assert.equal(ability.effect.kind, "continuous.bonus-damage");
      assert.deepEqual(ability.effect.amount, { kind: "constant", value: 1 });
      assert.equal(ability.effect.appliesTo, "deal-actions");
      // The merged binder has no action-target binding for this anchor.
      expectBindingError(
        ability,
        snapshot("gate", { types: ["battlefield"], location: HERE, energy: null, power: null }),
        /^Unsupported static appliesTo "deal-actions"$/,
      );
      const dealt = result.events.filter(event => event.timingPoint === "damage-dealt");
      assert.equal(dealt.length, 1, "exactly one Deal action resolved");
      assert.equal(dealt[0].action.amount, 3, "measured: the here-scoped +1 Bonus Damage never reached this Deal");
      return result;
    },
  },
  {
    // 143.2 / 478.1.a: the +4 is a real arithmetic static, but the declared
    // condition cannot count the controller's runes through the production path.
    name: "Master Yi, Meditative · eight runes in the rune zone still grant no Might",
    canonicalCardId: IDS.masterYiMeditative,
    program: candidate(IDS.masterYiMeditative),
    scenario: {
      objects: [
        { id: "yi", cardId: IDS.masterYiMeditative, types: ["unit"], zone: "board", location: HERE, might: 4, energy: 5, power: ["Order"] },
        ...[0, 1, 2, 3, 4, 5, 6, 7].map(index => ({ id: "rune-" + index, owner: "A", types: ["rune"], zone: "rune-zone" })),
      ],
      operations: [],
      expect: {
        objects: { yi: { zone: "board", location: HERE, might: 4, energy: 5, power: ["Order"] } },
        players: { A: { energy: 0, power: [], runeDeckCount: 0, handCount: 0 } },
        events: { exact: [] },
      },
    },
    verify(result) {
      assert.equal(result.state.players.A.runes.length, 8, "the eight runes really sit in A's rune pool");
      const [ability] = published(IDS.masterYiMeditative).abilities;
      assert.equal(ability.effect.kind, "continuous.might");
      assert.deepEqual(ability.effect.amount, { kind: "constant", value: 4 });
      // 133.5.a.1 / 431.1: the condition counts runes in the rune zone, and the
      // same filter carries the relative controller anchor.
      assert.equal(ability.condition.left.kind, "count");
      assert.equal(ability.condition.left.subject, "runes");
      assert.deepEqual(ability.condition.left.filter, { type: "rune", controller: "controller", zone: "rune-zone" });
      assert.equal(ability.condition.operator, "gte");
      assert.deepEqual(ability.condition.right, { kind: "constant", value: 8 });
      const source = snapshot("yi", { types: ["unit"], location: HERE, might: 4, energy: 5, power: ["Order"] });
      const { engine, effect } = expectRegistration(ability, source);
      // The binder really wraps the declared condition for the layer engine...
      assert.equal(typeof effect.condition, "function");
      const runes = [...Array(8).keys()].map(index => snapshot("rune-" + index, { owner: "A", controller: "A", types: ["rune"], zone: "rune-zone", location: null }));
      engine.layers.setObjects([source, ...runes]);
      assert.equal(engine.layers.snapshot(source.ref).might, 4, "measured: 8 runes still yield +0 through the production binding");
      // Control: the count vocabulary itself is merged. The very same count with
      // a concrete player id really turns the +4 on.
      const direct = snapshot("yi-direct", { location: HERE, might: 4 });
      const directEngine = fixture({ cards: [] }).engine;
      directEngine.layers.addContinuous({
        id: "rift-667-master-yi-direct-condition",
        layer: "arithmetic",
        source: direct.ref,
        filter: { objectId: "yi-direct", zone: "board" },
        effect: {
          kind: "continuous.might",
          amount: 4,
          condition: {
            kind: "compare",
            left: { kind: "count", subject: "runes", filter: { type: "rune", controller: "A", zone: "rune-zone" } },
            operator: "gte",
            right: { kind: "constant", value: 8 },
          },
        },
      }, { type: "permanent" });
      directEngine.layers.setObjects([direct, ...runes]);
      assert.equal(directEngine.layers.snapshot(direct.ref).might, 8, "control: the same count with an absolute player really applies +4");
      return result;
    },
  },
];

const moreRows = [
  {
    // 466.2.c.3 / 814.1.d / 740.2.a: the per-recipient "defends alone" predicate
    // has no static binding, so the aura fails closed before it registers.
    name: "Wuju Bladesman, Starter · the defends-alone guard fails closed before any aura registers",
    canonicalCardId: IDS.wujuBladesmanStarter,
    program: candidate(IDS.wujuBladesmanStarter),
    scenario: {
      objects: [
        { id: "wuju", cardId: IDS.wujuBladesmanStarter, ...LEGEND, zone: "board", location: HERE },
        { id: "defender", types: ["unit"], zone: "board", location: HERE, might: 2 },
        { id: "attacker", owner: "B", types: ["unit"], zone: "board", location: HERE, might: 3 },
      ],
      operations: [],
      expect: {
        objects: {
          wuju: { zone: "board", location: HERE, energy: null, power: null },
          defender: { zone: "board", location: HERE, might: 2 },
          attacker: { zone: "board", location: HERE, might: 3 },
        },
        events: { exact: [] },
      },
    },
    verify(result) {
      const [ability] = published(IDS.wujuBladesmanStarter).abilities;
      assert.equal(ability.effect.kind, "continuous.might");
      assert.deepEqual(ability.effect.amount, { kind: "constant", value: 2 });
      assert.equal(ability.effect.filter.controller, "self");
      assert.equal(ability.effect.filter.defendsAlone, true);
      const source = snapshot("wuju", { types: ["legend"], location: HERE, energy: null, power: null });
      expectBindingError(ability, source, /^Unsupported static filter field defendsAlone$/);
      // Control: the friendly-controller normalization itself is merged. With the
      // unmatched guard key removed, the registered filter resolves controller
      // "self" to the source controller and really selects friendly board units.
      const bindable = { ...ability, effect: { ...ability.effect, filter: { ...ability.effect.filter } } };
      delete bindable.effect.filter.defendsAlone;
      const { entry } = expectRegistration(bindable, source);
      assert.deepEqual(entry.effect.filter, { type: "unit", controller: "A", zone: "board" });
      assert.equal(matchesObjectFilter(entry.effect.filter, snapshot("ally", { owner: "A", controller: "A" })), true);
      assert.equal(matchesObjectFilter(entry.effect.filter, snapshot("enemy", { owner: "B", controller: "B" })), false);
      // Nothing in the real lifecycle added Might to either board unit.
      assert.equal(result.state.objects.find(object => object.ref.id === "defender").might, 2);
      return result;
    },
  },
  {
    // 470.1 / 471: the printed score window cannot bind, and nothing scores here
    // in this scenario -- so the measured state is inactivity, not enforcement.
    name: "Forgotten Monument · the score restriction fails closed at the battlefield anchor",
    canonicalCardId: IDS.forgottenMonument,
    program: candidate(IDS.forgottenMonument),
    scenario: {
      objects: [
        { id: "monument", cardId: IDS.forgottenMonument, ...BATTLEFIELD, zone: "board", location: HERE },
        { id: "unit", types: ["unit"], zone: "board", location: HERE, might: 3 },
      ],
      operations: [],
      expect: {
        objects: {
          monument: { zone: "board", location: HERE, energy: null, power: null },
          unit: { zone: "board", location: HERE, might: 3 },
        },
        players: { A: { score: 0 }, B: { score: 0 } },
        events: { exact: [] },
      },
    },
    verify(result) {
      const [ability] = published(IDS.forgottenMonument).abilities;
      assert.equal(ability.effect.kind, "continuous.restrict");
      assert.deepEqual(ability.effect.actions, ["score"]);
      assert.equal(ability.effect.restriction, "forgotten-monument");
      // 470.1/471: "here" is the ability host, so the merged source-relative
      // anchor binds to this battlefield's exact zone entry.
      assert.equal(ability.effect.appliesTo, "self");
      assert.deepEqual(ability.effect.until, { perPlayerTurn: 3 });
      const source = snapshot("monument", { types: ["battlefield"], location: HERE, energy: null, power: null });
      // The declaration itself now binds through the production binder.
      const bound = bindStatic(ability, source);
      assert.equal(bound.error, null, "the merged binder resolves the self anchor");
      assert.deepEqual(bound.engine.layers.registry.list().map(entry => entry.effect.filter), [
        { objectId: source.ref.id, zone: "board", zoneEntryId: source.ref.zoneEntryId }
      ]);
      assert.deepEqual(restrictions(bound.engine.layers.registry, "score").map(entry => entry.name), ["forgotten-monument"]);
      assert.deepEqual(restrictions(bound.engine.layers.registry, "move"), []);
      bound.handle?.unbind();
      assert.equal(result.state.players.A.score, 0);
      // The remaining gap is the consumer: nothing in scoring/scoring.ts reads
      // this registry, and the printed window has no slot on the restriction.
      return result;
    },
  },
  {
    // 355.6 / 356.4.b: a spell that chose her really paid its full printed 2
    // Energy -- the declared 1-Energy (or 1 Universal Power) discount is absent.
    name: "Irelia, Graceful · a spell that chooses her still pays the full printed cost",
    canonicalCardId: IDS.ireliaGraceful,
    program: candidate(IDS.ireliaGraceful),
    scenario: {
      players: { A: { energy: 2 } },
      objects: [
        { id: "irelia", cardId: IDS.ireliaGraceful, types: ["unit"], zone: "board", location: HERE, might: 4, energy: 4, power: ["Chaos"] },
        { id: "flash", program: flash, cardId: flash.canonicalCardId, types: ["spell"], zone: "hand", energy: 2, power: null },
      ],
      answers: { "target:flash.friendly-units": ["irelia"] },
      operations: [
        { type: "play", object: "flash", player: "A" },
        { type: "pass", player: "A" }, { type: "pass", player: "B" },
      ],
      expect: {
        objects: {
          irelia: { zone: "board", location: { type: "base", player: "A" }, might: 4 },
          flash: { zone: "trash" },
        },
        players: { A: { energy: 0 } },
        events: { includes: [{ action: { type: "move-location", object: "irelia" } }] },
      },
    },
    verify(result) {
      const [ability] = published(IDS.ireliaGraceful).abilities;
      assert.equal(ability.effect.kind, "continuous.cost-modification");
      assert.equal(ability.effect.stage, "discount");
      assert.equal(ability.effect.resource, "energy");
      assert.deepEqual(ability.effect.amount, { kind: "constant", value: 1 });
      // 163.2.b: the printed "or [A]" alternative keeps [A] explicit, never a
      // named domain.
      assert.deepEqual(ability.effect.alternative, { resource: "power", universal: true, amount: 1 });
      assert.deepEqual(ability.effect.appliesTo, { type: "spell", object: "self" });
      const source = snapshot("irelia", { location: HERE, might: 4, energy: 4, power: ["Chaos"] });
      // The declared anchor is not one the binder can resolve...
      expectBindingError(ability, source, /^Unsupported static appliesTo \{"type":"spell","object":"self"\}$/);
      // ...and with the "self" shorthand the kind itself has no layer mapping,
      // so nothing compiles it into CostPlanInput.discounts.
      expectBindingError(
        { ...ability, effect: { ...ability.effect, appliesTo: "self" } },
        source,
        /^Static ability kind continuous\.cost-modification has no layer mapping$/,
      );
      // The scenario really paid both Energy: the discount never happened.
      assert.equal(result.state.players.A.energy, 0);
      return result;
    },
  },
  {
    // 356.2 / 356.2.a / 414.1: the mandatory additional cost is never collected,
    // so the gear stays on the Board and the full printed 3 Energy is still paid.
    name: "Legion Quartermaster · the mandatory return-to-hand cost is never collected",
    canonicalCardId: IDS.legionQuartermaster,
    program: candidate(IDS.legionQuartermaster),
    scenario: {
      players: { A: { energy: 3 } },
      objects: [
        { id: "quartermaster", cardId: IDS.legionQuartermaster, types: ["unit"], zone: "hand", energy: 3, power: null, might: 4 },
        { id: "gear", program: orbOfRegret, cardId: orbOfRegret.canonicalCardId, types: ["gear"], zone: "board", location: HERE, energy: 1, power: null },
      ],
      operations: [{ type: "play", object: "quartermaster", player: "A" }],
      expect: {
        objects: {
          quartermaster: { zone: "board", location: { type: "base", player: "A" }, energy: 3, power: null, might: 4 },
          gear: { zone: "board", location: HERE },
        },
        players: { A: { energy: 0, handCount: 0 } },
        events: { includes: [{ timingPoint: "card-played" }] },
      },
    },
    verify(result) {
      const [ability] = published(IDS.legionQuartermaster).abilities;
      assert.equal(ability.effect.kind, "cost.additional");
      assert.equal(ability.effect.appliesTo, "self");
      // 356.2.b.1: no "may" on the printed sentence, so the cost is mandatory.
      assert.equal(ability.effect.optional, false);
      assert.equal(ability.effect.stage, "mandatory-additional");
      const [payment] = ability.effect.payments;
      // 355.10.c: a cost object is a non-target choice, never a TargetSpec, and
      // 414.1: the destination is the owner's hand.
      assert.equal(payment.kind, "return-to-hand");
      assert.deepEqual(payment.amount, { kind: "constant", value: 1 });
      assert.deepEqual(payment.choice.filter, { type: "gear", zone: "board", controller: "controller" });
      assert.equal(payment.choice.selection, "one");
      const source = snapshot("quartermaster", { location: { type: "base", player: "A" }, might: 4, energy: 3 });
      expectBindingError(ability, source, /^Static ability kind cost\.additional has no layer mapping$/);
      // The real Finalize paid the printed cost and never returned the gear.
      assert.equal(result.state.objects.find(object => object.ref.id === "gear").zone, "board");
      assert.equal(result.state.objects.find(object => object.ref.id === "quartermaster").zone, "board");
      assert.equal(result.state.players.A.energy, 0);
      return result;
    },
  },
];

const remainingRows = [
  {
    // 820.1.c / 356.4.f: the Repeat additional-cost discount cannot bind, and the
    // declared controller window has no consumer either.
    name: "Marai Spire · the Repeat discount fails closed on its anchor, its keyword filter and its kind",
    canonicalCardId: IDS.maraiSpire,
    program: candidate(IDS.maraiSpire),
    scenario: {
      objects: [
        { id: "spire", cardId: IDS.maraiSpire, ...BATTLEFIELD, zone: "board", location: HERE, controller: "A" },
        { id: "my-spell", owner: "A", types: ["spell"], zone: "hand", energy: 2, power: null },
        { id: "enemy-spell", owner: "B", types: ["spell"], zone: "hand", energy: 2, power: null },
      ],
      operations: [],
      expect: {
        objects: {
          spire: { zone: "board", location: HERE, energy: null, power: null, controller: "A" },
          "my-spell": { zone: "hand", energy: 2, power: null },
          "enemy-spell": { zone: "hand", energy: 2, power: null },
        },
        events: { exact: [] },
      },
    },
    verify(result) {
      const [ability] = published(IDS.maraiSpire).abilities;
      assert.equal(ability.effect.kind, "cost.modify");
      assert.deepEqual(ability.effect.value, { kind: "constant", value: { energy: -1 } });
      assert.equal(ability.effect.appliesTo, "repeat-additional-cost");
      // 190.6.a / 190.6.d: "while you control this battlefield" is written as a
      // real condition on the same ability.
      assert.equal(ability.condition.kind, "compare");
      assert.equal(ability.condition.left.kind, "count");
      const source = snapshot("spire", { types: ["battlefield"], location: HERE, controller: "A", energy: null, power: null });
      // Three independent rejections on the shipped declaration and its parts.
      expectBindingError(ability, source, /^Unsupported static appliesTo "repeat-additional-cost"$/);
      const { appliesTo: _appliesTo, ...withoutAnchor } = ability.effect;
      expectBindingError({ ...ability, effect: withoutAnchor }, source, /^Unsupported static filter field keyword$/);
      expectBindingError(
        { ...ability, effect: { ...ability.effect, appliesTo: "self", filter: { controller: "self", zone: "board" } } },
        source,
        /^Static ability kind cost\.modify has no layer mapping$/,
      );
      // Both hand spells keep their printed 2 Energy: no discount reached them.
      assert.equal(result.state.objects.find(object => object.ref.id === "my-spell").energy, 2);
      return result;
    },
  },
  {
    // 054.1 / 144.4.b: the IR declares both restriction spellings, so the rule
    // query really serves the prohibition -- but no production caller supplies
    // the movement rule context and effect.move never consults the query.
    name: "Minotaur Reckoner · the rule query serves the prohibition, yet the shipped Move path ignores it",
    canonicalCardId: IDS.minotaurReckoner,
    program: candidate(IDS.minotaurReckoner),
    scenario: {
      objects: [
        { id: "minotaur", cardId: IDS.minotaurReckoner, types: ["unit"], zone: "board", location: HERE, might: 5, energy: 5, power: null },
        { id: "ally", types: ["unit"], zone: "board", location: { ...HERE }, might: 2 },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: ENEMY_LOCATION, might: 3 },
        { id: "gear", types: ["gear"], zone: "board", location: { ...HERE } },
      ],
      operations: [],
      expect: {
        objects: {
          minotaur: { zone: "board", location: HERE, might: 5, energy: 5, power: null },
          ally: { zone: "board", location: HERE, might: 2 },
          enemy: { zone: "board", location: ENEMY_LOCATION, might: 3 },
          gear: { zone: "board", location: HERE },
        },
        events: { exact: [] },
      },
    },
    verify(result) {
      const [ability] = published(IDS.minotaurReckoner).abilities;
      assert.equal(ability.effect.kind, "continuous.movement");
      assert.equal(ability.effect.restriction, "move-to-base");
      assert.equal(ability.effect.addsPermission, false);
      // 053.2: the text names no host, so every board unit is covered.
      assert.deepEqual(ability.effect.filter, { type: "unit", zone: "board" });
      const source = snapshot("minotaur", { location: HERE, might: 5, energy: 5, power: null });
      const { engine, entry, effect } = expectRegistration(ability, source);
      assert.deepEqual(entry.effect.filter, { type: "unit", zone: "board" });
      // Both spellings survive the production registration...
      assert.equal(effect.restriction, "move-to-base");
      assert.deepEqual(effect.restrictions, ["move-to-base"]);
      const ally = snapshot("ally", { location: { ...HERE }, might: 2 });
      const gear = snapshot("gear", { types: ["gear"], location: { ...HERE } });
      engine.layers.setObjects([ally, gear]);
      // ...the layer snapshot folds the singular field for units only...
      assert.deepEqual(engine.layers.snapshot(ally.ref).movement.restrictions, ["move-to-base"]);
      assert.deepEqual(engine.layers.snapshot(gear.ref).movement.restrictions, []);
      // ...and the rule query, reading the plural, really serves the prohibition.
      assert.deepEqual(movement(engine.layers.registry, ally.ref, ally, "A").restrictions, ["move-to-base"]);
      // A real Standard Move is prohibited whenever the rule context is supplied.
      const allyObject = ally;
      const withRules = standardMoveProbe({ controller: "A", unit: "ally", destinationId: "base" });
      assert.throws(
        () => withRules.move({ registry: engine.layers.registry, refForUnit: () => allyObject.ref, objectForUnit: () => allyObject }),
        /prohibited from moving/,
      );
      // The shipped lifecycle supplies no context, so the same Move is allowed.
      const withoutRules = standardMoveProbe({ controller: "A", unit: "ally", destinationId: "base" });
      const moved = withoutRules.move(undefined);
      assert.equal(moved.board.units.find(unit => unit.objectId === "ally").locationId, withoutRules.destination, "measured: the shipped lifecycle moves the unit anyway");
      return result;
    },
  },
  {
    // 356.4 / 356.4.f: neither gear play received the first-play discount, and the
    // per-turn window has no expressible shape in the current model.
    name: "Ornn's Forge · the per-turn first-play discount fails closed before any cost plan",
    canonicalCardId: IDS.ornnsForge,
    program: candidate(IDS.ornnsForge),
    scenario: {
      players: { A: { energy: 3 } },
      objects: [
        { id: "forge", cardId: IDS.ornnsForge, ...BATTLEFIELD, zone: "board", location: HERE, controller: "A" },
        { id: "gear-1", program: orbOfRegret, cardId: orbOfRegret.canonicalCardId, types: ["gear"], zone: "hand", energy: 1, power: null },
        { id: "gear-2", program: orbOfRegret, cardId: orbOfRegret.canonicalCardId, types: ["gear"], zone: "hand", energy: 1, power: null },
      ],
      operations: [
        { type: "play", object: "gear-1", player: "A" },
        { type: "play", object: "gear-2", player: "A" },
      ],
      expect: {
        objects: {
          forge: { zone: "board", location: HERE, energy: null, power: null, controller: "A" },
          "gear-1": { zone: "board" },
          "gear-2": { zone: "board" },
        },
        // Both gears really paid their printed 1 Energy each: no discount.
        players: { A: { energy: 1 } },
        events: { includes: [{ timingPoint: "card-played" }] },
      },
    },
    verify(result) {
      const [ability] = published(IDS.ornnsForge).abilities;
      assert.equal(ability.effect.kind, "cost.modify");
      assert.deepEqual(ability.effect.value, { kind: "constant", value: { energy: -1 } });
      // The per-turn first-play window has no ContinuousEffect/condition shape.
      assert.equal(ability.effect.duration, "per-turn-first-play");
      assert.equal(ability.effect.appliesTo, "play-cost");
      assert.equal(ability.effect.filter.isToken, false);
      const source = snapshot("forge", { types: ["battlefield"], location: HERE, controller: "A", energy: null, power: null });
      // Three independent rejections on the shipped shape and its parts: the
      // authored anchor, then the printed token filter, then the kind itself.
      expectBindingError(ability, source, /^Unsupported static appliesTo "play-cost"$/);
      const { appliesTo: _anchor, ...withoutAnchor } = ability.effect;
      expectBindingError({ ...ability, effect: withoutAnchor }, source, /^Unsupported static filter field isToken$/);
      expectBindingError(
        { ...ability, effect: { ...ability.effect, appliesTo: undefined, filter: { type: "gear", controller: "controller" } } },
        source,
        /^Static ability kind cost\.modify has no layer mapping$/,
      );
      // Both gear plays cost their full printed cost.
      assert.equal(result.state.players.A.energy, 1);
      return result;
    },
  },
  {
    // 807.1.c / 718.3: the static binder really grants Assault to your Equipment
    // only, but a granted keyword never expands into the printed +1 Might.
    name: "Purifier · your Equipment really gains Assault, but the granted keyword never expands into Might",
    canonicalCardId: IDS.purifier,
    program: candidate(IDS.purifier),
    scenario: {
      objects: [
        { id: "purifier", cardId: IDS.purifier, ...LEGEND, zone: "board", location: HERE },
        { id: "my-equip", owner: "A", types: ["gear"], tags: ["Equipment"], zone: "board", location: HERE },
        // 818.1.a / 718.5.a: "Equipment" is a Gear tag; only tagged Gear qualifies.
        { id: "enemy-equip", owner: "B", types: ["gear"], tags: ["Equipment"], zone: "board", location: HERE },
        { id: "plain-gear", owner: "A", types: ["gear"], zone: "board", location: HERE },
        { id: "my-unit", owner: "A", types: ["unit"], zone: "board", location: HERE, might: 3, attachedTo: { id: "my-equip", zoneEntryId: 1 } },
      ],
      operations: [],
      expect: {
        objects: {
          purifier: { zone: "board", location: HERE, energy: null, power: null },
          "my-equip": { zone: "board", keywords: [{ id: "Assault" }] },
          "enemy-equip": { zone: "board", keywords: [] },
          "plain-gear": { zone: "board", keywords: [] },
          "my-unit": { zone: "board", keywords: [], might: 3, damage: 0 },
        },
        events: { exact: [] },
      },
    },
    verify(result) {
      const [ability] = published(IDS.purifier).abilities;
      assert.equal(ability.effect.kind, "continuous.grant-keyword");
      assert.equal(ability.effect.keyword, "Assault");
      // 807.1.b.3: the printed Assault has no value, so none is declared.
      assert.equal(ability.effect.keywordValue, undefined);
      assert.equal(ability.effect.value, undefined);
      assert.deepEqual(ability.effect.filter, { zone: "board", controller: "controller", tags: ["Equipment"] });
      const source = snapshot("purifier", { types: ["legend"], location: HERE, energy: null, power: null });
      const { engine, effect } = expectRegistration(ability, source);
      assert.equal(effect.kind, "continuous.grant-keyword");
      const equipment = snapshot("my-equip", { types: ["gear"], tags: ["Equipment"], location: HERE });
      engine.layers.setObjects([equipment]);
      // The granted Assault prints no value, so the recorded keyword carries none.
      const granted = engine.layers.snapshot(equipment.ref).keywords;
      assert.deepEqual(granted.map(keyword => keyword.id), ["Assault"]);
      assert.equal(granted[0].value, undefined);
      // Control: the merged keyword grant is scoped exactly like the card says,
      // and the layer really records the keyword on the qualifying object only.
      const plain = snapshot("plain-gear", { types: ["gear"], location: HERE });
      const enemy = snapshot("enemy-equip", { owner: "B", types: ["gear"], tags: ["Equipment"], location: HERE });
      engine.layers.setObjects([equipment, plain, enemy]);
      assert.deepEqual(engine.layers.snapshot(plain.ref).keywords, []);
      assert.deepEqual(engine.layers.snapshot(enemy.ref).keywords, []);
      // 807.1.c: the printed +1 Might still never happens: the granted Assault is
      // a characteristic here, not an expanded "while I am an attacker" effect.
      assert.equal(engine.layers.snapshot(equipment.ref).might, null, "a granted Assault adds no Might: the recorded gap");
      assert.equal(result.state.objects.find(object => object.ref.id === "my-unit").might, 3);
      return result;
    },
  },
];

rows.push(...moreRows, ...remainingRows);

const templateGapIds = new Set([
  IDS.voidGate,
  IDS.wujuBladesmanStarter,
  IDS.ireliaGraceful,
  IDS.legionQuartermaster,
  IDS.maraiSpire,
  IDS.ornnsForge,
]);

for (const [index, golden] of defineTemplateSuite("RIFT-667 static||", rows).entries()) {
  const row = rows[index];
  if (templateGapIds.has(row.canonicalCardId)) {
    const reason = row.canonicalCardId === IDS.voidGate
      ? 'Unsupported static appliesTo "deal-actions"; missing Deal-action bonus damage consumer'
      : row.canonicalCardId === IDS.wujuBladesmanStarter
        ? 'Unsupported static filter field defendsAlone; missing combat-role/defends-alone filter binding'
        : row.canonicalCardId === IDS.ireliaGraceful
          ? 'Unsupported static appliesTo {"type":"spell","object":"self"}; missing target-relative cost-modification consumer'
          : row.canonicalCardId === IDS.legionQuartermaster
            ? 'Static ability kind cost.additional has no layer mapping; missing additional-cost Finalize consumer'
            : row.canonicalCardId === IDS.maraiSpire
              ? 'Unsupported static appliesTo "repeat-additional-cost"; missing Repeat cost consumer'
              : 'Unsupported static appliesTo "play-cost"; missing play-cost discount consumer';
    test.todo(`${golden.name} — ${reason}`);
    continue;
  }
  test(golden.name, () => {
    // The published program is never promoted, and the candidate view is only a
    // metadata lift: the same abilities array is what the harness executes.
    const source = published(row.canonicalCardId);
    assert.equal(source.status, "judge-required", row.name + ": the shipped program stays judge-required");
    assert.ok(source.judgeReason && source.judgeReason.trim(), row.name + ": the shipped program keeps a concrete judgeReason");
    assert.equal(row.program.abilities, source.abilities);
    assert.equal(row.program.canonicalCardId, row.canonicalCardId);
    const result = golden.run();
    assert.ok(result.state.objects.some(object => object.cardId === row.canonicalCardId), row.name + ": the card's own object is on the board");
    if (row.verify) row.verify(result);
  });
}

// ---------------------------------------------------------------------------
// Boundary set (README 4.1: at least one per template): no legal target, a
// negated branch and an unmet condition. Each boundary is an independently named
// card row with its own scenario and its own expectation.
// ---------------------------------------------------------------------------
const boundaries = [
  {
    // 355.4.a / 448.3.b: Flash's "Move up to 2 friendly units" may choose zero,
    // and the only unit here is the opponent's. The prohibition bound by the
    // Lair must not invent a target, and nothing may move.
    name: "Vilemaw's Lair boundary · no legal Move target: Flash resolves with zero friendly units",
    canonicalCardId: IDS.vilemawsLair,
    program: candidate(IDS.vilemawsLair),
    scenario: {
      players: { A: { energy: 2 } },
      objects: [
        { id: "lair", cardId: IDS.vilemawsLair, ...BATTLEFIELD, zone: "board", location: HERE },
        { id: "enemy-here", owner: "B", types: ["unit"], zone: "board", location: { ...HERE }, might: 5 },
        { id: "flash", program: flash, cardId: flash.canonicalCardId, types: ["spell"], zone: "hand", energy: 2, power: null },
      ],
      operations: [
        { type: "play", object: "flash", player: "A" },
        { type: "pass", player: "A" }, { type: "pass", player: "B" },
      ],
      expect: {
        objects: {
          lair: { zone: "board", location: HERE, energy: null, power: null },
          // The only unit here is the opponent's and is not a legal choice.
          "enemy-here": { zone: "board", location: HERE, might: 5, damage: 0 },
          flash: { zone: "trash" },
        },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "card-played", object: { ref: "flash" } }] },
      },
    },
    verify(result) {
      // No Move was performed at all: the prohibition was never needed, and the
      // empty target set really produced zero action rather than a substitute.
      assert.deepEqual(result.events.filter(event => event.timingPoint === "object-moved"), []);
      const { engine } = expectRegistration(published(IDS.vilemawsLair).abilities[0], snapshot("lair", { types: ["battlefield"], location: HERE, energy: null, power: null }));
      assert.deepEqual(engine.layers.registry.list().map(entry => entry.effect.effect.restrictions), [["move-from-here-to-base"]]);
      return result;
    },
  },
  {
    // 355.4.a / 448.3.b: a Move needs a destination other than the current
    // Location. The chosen unit already sits in its own Base, so the targeted
    // Move performs no action at all -- not a substituted one.
    name: "Vilemaw's Lair boundary · negated Move: a unit already in its own base cannot be moved again",
    canonicalCardId: IDS.vilemawsLair,
    program: candidate(IDS.vilemawsLair),
    scenario: {
      players: { A: { energy: 2 } },
      objects: [
        { id: "lair", cardId: IDS.vilemawsLair, ...BATTLEFIELD, zone: "board", location: HERE },
        { id: "already-home", owner: "A", types: ["unit"], zone: "board", location: { type: "base", player: "A" }, might: 2 },
        { id: "flash", program: flash, cardId: flash.canonicalCardId, types: ["spell"], zone: "hand", energy: 2, power: null },
      ],
      answers: { "target:flash.friendly-units": ["already-home"] },
      operations: [
        { type: "play", object: "flash", player: "A" },
        { type: "pass", player: "A" }, { type: "pass", player: "B" },
      ],
      expect: {
        objects: {
          lair: { zone: "board", location: HERE, energy: null, power: null },
          // The unit keeps its Base, its Might and its ready status, and pays no
          // Move cost: the instruction was negated rather than re-targeted.
          "already-home": { zone: "board", location: { type: "base", player: "A" }, might: 2, exhausted: false, damage: 0 },
          flash: { zone: "trash" },
        },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "card-played", object: { ref: "flash" } }, { timingPoint: "became-target", object: { ref: "already-home" } }] },
      },
    },
    verify(result) {
      // No relocation happened, and no exhaustion was paid for the negated Move.
      assert.deepEqual(result.events.filter(event => event.timingPoint === "object-moved"), []);
      const unit = result.state.objects.find(object => object.ref.id === "already-home");
      assert.deepEqual(unit.location, { type: "base", player: "A" });
      assert.equal(unit.exhausted, false);
      return result;
    },
  },
  {
    // Condition unmet: the controller holds three runes, so the printed 8-rune
    // gate is false for every measured path and no Might may appear.
    name: "Master Yi, Meditative boundary · condition unmet: three runes and five hand cards grant no Might",
    canonicalCardId: IDS.masterYiMeditative,
    program: candidate(IDS.masterYiMeditative),
    scenario: {
      objects: [
        { id: "yi", cardId: IDS.masterYiMeditative, types: ["unit"], zone: "board", location: HERE, might: 4, energy: 5, power: ["Order"] },
        ...[0, 1, 2].map(index => ({ id: "rune-" + index, owner: "A", types: ["rune"], zone: "rune-zone" })),
        ...["spell-a", "spell-b", "spell-c", "spell-d", "spell-e"].map(id => ({ id, owner: "A", types: ["spell"], zone: "hand", energy: 0, power: null })),
      ],
      operations: [],
      expect: {
        objects: { yi: { zone: "board", location: HERE, might: 4, energy: 5, power: ["Order"] } },
        players: { A: { energy: 0, power: [], handCount: 5, runeDeckCount: 0 } },
        events: { exact: [] },
      },
    },
    verify(result) {
      assert.equal(result.state.players.A.runes.length, 3);
      assert.equal(result.state.players.A.handCount, 5);
      const [ability] = published(IDS.masterYiMeditative).abilities;
      const source = snapshot("yi", { types: ["unit"], location: HERE, might: 4, energy: 5, power: ["Order"] });
      const { engine, effect } = expectRegistration(ability, source);
      // The declared filter is type+zone scoped, so five hand cards can neither
      // satisfy nor inflate the rune count.
      assert.equal(effect.condition === undefined, false);
      assert.equal(ability.condition.left.filter.type, "rune");
      assert.equal(ability.condition.left.filter.zone, "rune-zone");
      assert.deepEqual(ability.condition.right, { kind: "constant", value: 8 });
      const runes = [...Array(3).keys()].map(index => snapshot("rune-" + index, { owner: "A", controller: "A", types: ["rune"], zone: "rune-zone", location: null }));
      const hand = ["spell-a", "spell-b", "spell-c", "spell-d", "spell-e"].map(id => snapshot(id, { owner: "A", controller: "A", types: ["spell"], zone: "hand", location: null }));
      engine.layers.setObjects([source, ...runes, ...hand]);
      assert.equal(engine.layers.snapshot(source.ref).might, 4, "below the printed threshold the +4 must not apply");
      return result;
    },
  },
];

for (const [index, golden] of defineTemplateSuite("RIFT-667 static|| boundary", boundaries).entries()) {
  const row = boundaries[index];
  test(golden.name, () => {
    assert.equal(published(row.canonicalCardId).status, "judge-required", row.name + ": the shipped program stays judge-required");
    const result = golden.run();
    assert.ok(result.state.objects.some(object => object.cardId === row.canonicalCardId));
    if (row.verify) row.verify(result);
  });
}

// ---------------------------------------------------------------------------
// Printed results that still need engine work. A todo is not execution
// evidence and must not be written as an assertion of the current wrong value;
// each title names the missing semantic and the measured gap behind it.
// ---------------------------------------------------------------------------
test.todo(
  "RIFT-667 Trifarian War Camp [" + IDS.trifarianWarCamp + "]: both controllers' units at this battlefield must gain the printed +1 " +
    "Might (CR 053.3 / 479.4) - the registered arithmetic filter carries the source LocationRef and layers/filter.ts compares structured " +
    "locations by reference, so cloned layer snapshots never match and the aura reaches no unit; the comparator needs battlefield-id / " +
    "base-player value equality",
);
test.todo(
  "RIFT-667 Vilemaw's Lair [" + IDS.vilemawsLair + "]: the printed prohibition must also stop an effect Move from here to base " +
    "(CR 054.1 / 358.3.a / 359.3.e.14.b) - the rule query really serves the restriction, but effect.move submits a move-location action " +
    "whose path never consults the query, and duel/standard-move-executor-v2.ts supplies no DuelMovementRuleContext",
);
test.todo(
  "RIFT-667 Void Gate [" + IDS.voidGate + "]: every Deal action affecting units here must get 1 Bonus Damage " +
    "(CR 418.4 / 713-715.4.a) - programs/statics.ts rejects appliesTo \"deal-actions\" and no consumer sums the granted bonus into " +
    "the bonus expression of effect.damage",
);
test.todo(
  "RIFT-667 Master Yi, Meditative [" + IDS.masterYiMeditative + "]: I must have +4 Might while my controller has 8+ runes " +
    "(CR 143.2 / 478.1.a / 133.5.a.1 / 431.1) - the static binder evaluates the declared condition, but its count query passes " +
    "filter.controller \"controller\" into layers/filter.ts literally, so the host controller's runes count as 0 and opponent runes are " +
    "not excluded (contract change request: relative-player binding in the static condition query)",
);
test.todo(
  "RIFT-667 Wuju Bladesman, Starter [" + IDS.wujuBladesmanStarter + "]: a friendly unit must get +2 Might exactly while it defends " +
    "alone (CR 363 / 364.3.a / 466.2.c.3 / 814.1.d / 740.2.a) - staticFilter rejects defendsAlone and the aura has no binding for the " +
    "recipient's combatRole or a same-location friendly-neighbour count, and the Legend Zone source (CR 107.4.c / 174.2.b) is absent " +
    "from effects/contract.ts ZoneId (contract change request)",
);
test.todo(
  "RIFT-667 Forgotten Monument [" + IDS.forgottenMonument + "]: no player may score here until their third turn (CR 470.1 / 471) - " +
    "the source-relative anchor now binds through the production static binder and reaches restrictions(\"score\"), but " +
    "scoring/scoring.ts never queries the restriction registry and continuous.restrict has no window slot for " +
    "\"their third turn\"",
);
test.todo(
  "RIFT-667 Irelia, Graceful [" + IDS.ireliaGraceful + "]: a spell that chooses me must cost 1 Energy or 1 Universal Power less " +
    "(CR 355.6 / 356.4.b / 163.2.b) - continuous.cost-modification has no layer mapping, no pipeline compiles the declaration into " +
    "CostPlanInput.discounts, and neither the per-target condition nor the Universal Power alternative is representable " +
    "(contract change request)",
);
test.todo(
  "RIFT-667 Legion Quartermaster [" + IDS.legionQuartermaster + "]: playing me must first return a friendly gear to its owner's hand " +
    "(CR 356.2 / 356.2.a / 414.1) - cost.additional has no layer mapping, no module binds the declared mandatory additional cost into " +
    "Finalize, and the merged nonstandard cost vocabulary has no return-to-hand component (RIFT-261)",
);
test.todo(
  "RIFT-667 Marai Spire [" + IDS.maraiSpire + "]: friendly [Repeat] costs must cost 1 Energy less while I control this battlefield " +
    "(CR 190.6.a / 190.6.d / 356.4.f / 820.1.c) - the binder rejects the appliesTo anchor and the printed keyword filter, cost.modify has " +
    "no layer mapping, and repeat.cost is never collected at Finalize",
);
test.todo(
  "RIFT-667 Minotaur Reckoner [" + IDS.minotaurReckoner + "]: units must not be able to move to base (CR 054.1 / 144.4.b / 451.1) - " +
    "the rule query really serves the prohibition now, but no production caller supplies a DuelMovementRuleContext to the Standard " +
    "Move and effect.move never consults the query at all",
);
test.todo(
  "RIFT-667 Ornn's Forge [" + IDS.ornnsForge + "]: the first friendly non-token gear played each turn must cost 1 Energy less " +
    "(CR 356.4 / 356.4.f) - cost.modify has no layer mapping, no CardProgram -> Finalize consumer exists, and the per-turn first-play " +
    "window (history-gated expiry after the first qualifying play) is not expressible in the current ContinuousEffect model",
);
test.todo(
  "RIFT-667 Purifier [" + IDS.purifier + "]: the granted Assault must give the equipped unit +1 Might while it is an attacker " +
    "(CR 807.1.c / 718.3) - layers/engine.ts only records the keyword characteristic; nothing expands a granted keyword through " +
    "effects/keywords/Assault.ts and there is no Attached-card propagation bridge",
);
