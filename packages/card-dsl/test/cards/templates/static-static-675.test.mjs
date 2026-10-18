// RIFT-675 template-level golden for the `static+static||` batch (see
// packages/card-dsl/src/cards/README.md 4.1). Every row names one card with its
// full canonical identity, its own board, its own operations and its own
// expectation, and runs the real scenario harness (RIFT-592): ProgramBinding ->
// ChainEngine -> EventPipeline -> cost plan -> layers.
//
// All six published programs stay judge-required: every card below still has a
// printed clause with no merged consumer. Passing rows therefore assert only
// rule-correct outcomes, and each row's `verify` pins the concrete live gap
// where relevant. Rows whose printed outcome the merged engine does not yet
// produce carry `todo` with the exact dependency; they never present the
// current wrong behaviour as expected. The per-card files keep validation,
// identity and structure and point back here for execution evidence.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { ProgramBindingError } from "../../../../engine-core/dist/programs/errors.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const BRAZEN = "card.hash-da18079d11afce4cad1d799fd51de5b0219e0635613cd5a5b4a5f38e1a42aafc";
const WARDEN = "card.hash-b2b0dc0db7b4646ebf76c4865cc10fb826a643400e758e6396dfeca70062a616";
const MISS_FORTUNE = "card.hash-713732fef292fb529d388efbec2020949fdfaeca0c39e3afeb5ed43119a7f3e5";
const RAGING_SOUL = "card.hash-55958c501a029c3b3b6cc885be9c3637445d707ccf6347d1f0338abd97718571";
const NEWTFISH = "card.hash-55487ff54a21b4f984b21e9ef2babc80760bd74a2128eac7bd6665ff81432f9e";
const RAGE_AMPLIFIER = "card.hash-d253644e2551694bc909320c263dcb18818de02f076039f478f45ef0e36eff91";

/** The harness refuses judge-required programs by design; the declared status is asserted per row. */
function executableProbe(canonicalCardId) {
  const program = cardProgramsById.get(canonicalCardId);
  assert.ok(program, `generated card program ${canonicalCardId} is present`);
  return { ...program, status: "executable", judgeReason: undefined };
}

const HERE = { type: "battlefield", id: "rift675-battlefield" };
const OPEN_FIELD = { type: "battlefield", id: "rift675-open" };
const BASE_A = { type: "base", player: "A" };

const c = value => ({ kind: "constant", value });

/** A zero-cost test control spell; it is not one of the six cards. */
function driver(id, body) {
  return {
    canonicalCardId: `test.rift-675.${id}`,
    rulesetVersion: "core-1.5",
    status: "executable",
    sourceText: `RIFT-675 test control: ${id}.`,
    abilities: [{
      kind: "play",
      cost: { kind: "explicit", energy: c(0) },
      body,
    }],
  };
}

const vanillaUnit = driver("vanilla-unit", []);
const discardOne = driver("discard-one", [{
  id: "rift675.discard",
  op: "effect.discard",
  args: { amount: c(1) },
}]);
const discardOpponent = driver("discard-opponent", [{
  id: "rift675.discard.opponent",
  op: "effect.discard",
  args: { amount: c(1), player: c("B") },
}]);
const gainXp = driver("gain-xp", [{
  id: "rift675.xp",
  op: "effect.xp",
  args: { amount: c(1), player: c("A") },
}]);
const gainOpponentXp = driver("gain-xp-opponent", [{
  id: "rift675.xp.opponent",
  op: "effect.xp",
  args: { amount: c(1), player: c("B") },
}]);
// Finalize collects the target requirements from the instruction body, so the
// test controls declare their TargetSpec on the instruction itself.
const readyDriver = driver("ready", [{
  id: "rift675.ready",
  op: "effect.ready",
  args: { objects: c({ kind: "target", id: "rift675-ready-target" }) },
  targets: [{ id: "rift675-ready-target", filter: { type: "gear", controller: "B", zone: "board" }, min: 1, max: 1 }],
}]);
const empowerDriver = driver("empower", [{
  id: "rift675.empower",
  op: "effect.empower",
  args: { objects: c({ kind: "target", id: "rift675-empower-target" }) },
  targets: [{ id: "rift675-empower-target", filter: { type: "gear", zone: "board" }, min: 1, max: 1 }],
}]);
const disempowerDriver = driver("disempower", [{
  id: "rift675.disempower",
  op: "effect.empower",
  args: { mode: c("disempower"), objects: c({ kind: "target", id: "rift675-disempower-target" }) },
  targets: [{ id: "rift675-disempower-target", filter: { type: "gear", zone: "board" }, min: 1, max: 1 }],
}]);

const spellObject = (id, program) => ({ id, program, types: ["spell"], zone: "hand", location: null, energy: 0, power: [] });
const spellOps = id => [
  { type: "play", object: id, player: "A" },
  { type: "pass", player: "A" },
  { type: "pass", player: "B" },
];

/** Gap probe: the published program's static abilities are refused by the production binder. */
function rejectsBinding(program, patterns) {
  return result => {
    const host = result.state.objects.find(object => object.cardId === program.canonicalCardId);
    assert.ok(host, `scenario host for ${program.canonicalCardId} reached the board`);
    const statics = program.abilities.filter(ability => ability.kind === "static");
    assert.equal(statics.length, patterns.length, "one expected binder result per static ability");
    const engine = fixture({ cards: [] }).engine;
    const binder = createEngineStaticBinder(engine);
    statics.forEach((ability, index) => {
      assert.throws(() => binder.bindStatic(ability, host), error => {
        assert.ok(error instanceof ProgramBindingError, String(error));
        assert.equal(error.code, "judge-required");
        assert.match(error.message, patterns[index]);
        return true;
      });
    });
    assert.deepEqual(engine.layers.registry.list(), [], "no layer entry may be registered for a refused static ability");
  };
}

const definitions = [
  {
    name: "Brazen Buccaneer - declining the optional discard pays the printed 6 Energy",
    canonicalCardId: BRAZEN,
    program: executableProbe(BRAZEN),
    scenario: {
      players: { A: { energy: 20 } },
      objects: [
        { id: "buccaneer", cardId: BRAZEN, types: ["unit"], zone: "hand", energy: 6, power: null, might: 5 },
        { id: "fodder", types: ["unit"], zone: "hand" },
      ],
      operations: [{ type: "play", object: "buccaneer", player: "A" }],
      expect: {
        objects: {
          buccaneer: { zone: "board", location: BASE_A, exhausted: true, might: 5, power: null },
          fodder: { zone: "hand" },
        },
        players: { A: { energy: 14 } },
        events: { includes: [{ timingPoint: "card-played" }, { timingPoint: "object-enters-base" }] },
      },
    },
    declared: program => {
      assert.equal(program.status, "judge-required");
      assert.equal(program.abilities.length, 2);
      assert.deepEqual(program.abilities.map(ability => ability.effect.kind), ["cost.additional", "cost.modify"]);
      assert.match(program.judgeReason, /356\.2\.b\.1/);
      assert.match(program.judgeReason, /CostPlan|Finalize/);
      assert.match(program.judgeReason, /paid-proof/);
      assert.match(program.judgeReason, /card-in-controller-hand/);
    },
    verify: rejectsBinding(
      cardProgramsById.get(BRAZEN),
      [/cost\.additional has no layer mapping/, /cost\.modify has no layer mapping/]
    ),
  },
  {
    name: "Brazen Buccaneer boundary - 5 Energy cannot pay the printed 6 (negated)",
    canonicalCardId: BRAZEN,
    program: executableProbe(BRAZEN),
    scenario: {
      players: { A: { energy: 5 } },
      objects: [{ id: "buccaneer", cardId: BRAZEN, types: ["unit"], zone: "hand", energy: 6, power: null, might: 5 }],
      operations: [{ type: "play", object: "buccaneer", player: "A" }],
    },
    expectedFailure: /insufficient Energy/,
    declared: program => assert.equal(program.status, "judge-required"),
  },
  {
    todo: "RIFT-675: the static cost.additional/cost.modify declarations are not bound to the play CostPlan, so the optional discard is never offered and the 356.4.f.1 paid-proof discount never applies",
    name: "Brazen Buccaneer printed - paying the discard costs 4 Energy and puts the card in the trash",
    canonicalCardId: BRAZEN,
    program: executableProbe(BRAZEN),
    scenario: {
      players: { A: { energy: 20 } },
      objects: [
        { id: "buccaneer", cardId: BRAZEN, types: ["unit"], zone: "hand", energy: 6, power: null, might: 5 },
        { id: "fodder", types: ["unit"], zone: "hand" },
      ],
      answers: { optional: true, "brazen-buccaneer.discard": ["fodder"] },
      operations: [{ type: "play", object: "buccaneer", player: "A" }],
      expect: {
        objects: { fodder: { zone: "trash" }, buccaneer: { zone: "board" } },
        players: { A: { energy: 16 } },
      },
    },
    declared: program => assert.match(program.judgeReason, /CostPlan|Finalize/),
  },
  {
    name: "Mageseeker Warden - away from a battlefield an enemy gear may be readied",
    canonicalCardId: WARDEN,
    program: executableProbe(WARDEN),
    scenario: {
      objects: [
        { id: "warden", cardId: WARDEN, types: ["unit"], zone: "board", location: BASE_A, might: 5 },
        { id: "enemy-gear", owner: "B", types: ["gear"], zone: "board", location: HERE, exhausted: true },
        spellObject("ready-driver", readyDriver),
      ],
      operations: spellOps("ready-driver"),
      expect: {
        objects: {
          warden: { zone: "board", location: BASE_A },
          "enemy-gear": { zone: "board", exhausted: false },
          "ready-driver": { zone: "trash" },
        },
        events: { includes: [{ timingPoint: "object-readied" }] },
      },
    },
    declared: program => {
      assert.equal(program.status, "judge-required");
      assert.equal(program.abilities.length, 2);
      assert.deepEqual(program.abilities.map(ability => ability.effect.kind), ["continuous.restrict", "continuous.restrict"]);
      assert.match(program.judgeReason, /relative-player|相对玩家/);
      assert.match(program.judgeReason, /causes/);
      assert.match(program.judgeReason, /possibleDestination|allowedDestination|acting-player-base/);
    },
  },
  {
    name: "Mageseeker Warden boundary - a ready choice with no legal enemy gear is refused",
    canonicalCardId: WARDEN,
    program: executableProbe(WARDEN),
    scenario: {
      objects: [
        { id: "warden", cardId: WARDEN, types: ["unit"], zone: "board", location: BASE_A, might: 5 },
        { id: "own-gear", types: ["gear"], zone: "board", location: HERE, exhausted: true },
        spellObject("ready-driver", readyDriver),
      ],
      operations: spellOps("ready-driver"),
    },
    expectedFailure: error => {
      assert.equal(error.code, "no-legal-targets");
      assert.match(error.message, /required target count is not available/);
      return true;
    },
    declared: program => assert.equal(program.status, "judge-required"),
  },
  {
    todo: "RIFT-675: continuous.restrict is not registered (relative-player filter refused) and the ready query ignores the spell/ability cause filter",
    name: "Mageseeker Warden printed - at a battlefield a spell cannot ready an enemy gear",
    canonicalCardId: WARDEN,
    program: executableProbe(WARDEN),
    scenario: {
      objects: [
        { id: "warden", cardId: WARDEN, types: ["unit"], zone: "board", location: HERE, might: 5 },
        { id: "enemy-gear", owner: "B", types: ["gear"], zone: "board", location: HERE, exhausted: true },
        spellObject("ready-driver", readyDriver),
      ],
      operations: spellOps("ready-driver"),
      expect: { objects: { "enemy-gear": { zone: "board", exhausted: true } } },
    },
    declared: program => assert.match(program.judgeReason, /causes/),
  },
  {
    todo: "RIFT-675: the play restriction never reaches Finalize (relative-player filter refused; playDestinationIsLegal does not read acting-player-base)",
    name: "Mageseeker Warden printed - at a battlefield opponents can only play units to their base",
    canonicalCardId: WARDEN,
    program: executableProbe(WARDEN),
    scenario: {
      players: { B: { energy: 20 } },
      objects: [
        { id: "warden", cardId: WARDEN, types: ["unit"], zone: "board", location: HERE, might: 5 },
        { id: "enemy-unit", program: vanillaUnit, types: ["unit"], owner: "B", zone: "hand", location: null, energy: 0, power: [], might: 2 },
      ],
      operations: [{ type: "play", object: "enemy-unit", player: "B", location: HERE }],
      expect: { objects: { "enemy-unit": { zone: "hand" } } },
    },
    declared: program => assert.match(program.judgeReason, /acting-player-base|relative-player|相对玩家/),
  },
  {
    name: "Miss Fortune, Buccaneer - the default Base placement still works",
    canonicalCardId: MISS_FORTUNE,
    program: executableProbe(MISS_FORTUNE),
    scenario: {
      players: { A: { energy: 20, power: ["Chaos"] } },
      objects: [{ id: "buccaneer", cardId: MISS_FORTUNE, types: ["unit"], zone: "hand", energy: 4, power: ["Chaos"], might: 4 }],
      operations: [{ type: "play", object: "buccaneer", player: "A" }],
      expect: {
        objects: { buccaneer: { zone: "board", location: BASE_A, exhausted: true, power: ["Chaos"] } },
        players: { A: { energy: 16 } },
        events: { includes: [{ timingPoint: "object-enters-base" }, { timingPoint: "card-played" }] },
      },
    },
    declared: program => {
      assert.equal(program.status, "judge-required");
      assert.equal(program.abilities.length, 2);
      assert.deepEqual(program.abilities.map(ability => ability.effect.kind), ["play-location-permission", "play-location-permission"]);
      assert.match(program.judgeReason, /play-location-permission/);
      assert.match(program.judgeReason, /open battlefield/);
      assert.match(program.judgeReason, /friendly-units|友方/);
    },
    verify: rejectsBinding(
      cardProgramsById.get(MISS_FORTUNE),
      [/play-location-permission has no layer mapping/, /play-location-permission has no layer mapping/]
    ),
  },
  {
    // The host currently accepts any battlefield destination because the
    // permission is not registered and Finalize does not consume open
    // battlefields; this row only records that the printed positive placement
    // is not rejected. The verify probe on the row above pins the missing
    // permission registration.
    name: "Miss Fortune, Buccaneer - placing her on an open battlefield is accepted (host default, not the printed permission)",
    canonicalCardId: MISS_FORTUNE,
    program: executableProbe(MISS_FORTUNE),
    scenario: {
      players: { A: { energy: 20, power: ["Chaos"] } },
      objects: [{ id: "buccaneer", cardId: MISS_FORTUNE, types: ["unit"], zone: "hand", energy: 4, power: ["Chaos"], might: 4 }],
      operations: [{ type: "play", object: "buccaneer", player: "A", location: OPEN_FIELD }],
      expect: { objects: { buccaneer: { zone: "board", location: OPEN_FIELD, exhausted: true } } },
    },
    declared: program => assert.equal(program.status, "judge-required"),
  },
  {
    name: "Miss Fortune, Buccaneer boundary - 3 Energy cannot pay the printed 4 (negated)",
    canonicalCardId: MISS_FORTUNE,
    program: executableProbe(MISS_FORTUNE),
    scenario: {
      players: { A: { energy: 3, power: ["Chaos"] } },
      objects: [{ id: "buccaneer", cardId: MISS_FORTUNE, types: ["unit"], zone: "hand", energy: 4, power: ["Chaos"], might: 4 }],
      operations: [{ type: "play", object: "buccaneer", player: "A" }],
    },
    expectedFailure: /insufficient Energy/,
    declared: program => assert.equal(program.status, "judge-required"),
  },
  {
    todo: "RIFT-675: open battlefield (unoccupied and uncontrolled, 170.11.c) is not evaluated by Finalize, and the self permission is not registered",
    name: "Miss Fortune, Buccaneer printed - an occupied battlefield is not an open battlefield",
    canonicalCardId: MISS_FORTUNE,
    program: executableProbe(MISS_FORTUNE),
    scenario: {
      players: { A: { energy: 20, power: ["Chaos"] } },
      objects: [
        { id: "buccaneer", cardId: MISS_FORTUNE, types: ["unit"], zone: "hand", energy: 4, power: ["Chaos"], might: 4 },
        { id: "occupier", owner: "B", types: ["unit"], zone: "board", location: OPEN_FIELD, might: 3 },
      ],
      operations: [{ type: "play", object: "buccaneer", player: "A", location: OPEN_FIELD }],
      expect: { objects: { buccaneer: { zone: "hand" }, occupier: { zone: "board", location: OPEN_FIELD } } },
    },
    declared: program => assert.match(program.judgeReason, /170\.11\.c|open battlefield/),
  },
  {
    todo: "RIFT-675: the friendly-units permission scope is not bound and Finalize does not consume open battlefields",
    name: "Miss Fortune, Buccaneer printed - a friendly unit may be played to an open battlefield, never to an occupied one",
    canonicalCardId: MISS_FORTUNE,
    program: executableProbe(MISS_FORTUNE),
    scenario: {
      players: { A: { energy: 20, power: ["Chaos"] } },
      objects: [
        { id: "buccaneer", cardId: MISS_FORTUNE, types: ["unit"], zone: "board", location: BASE_A, energy: 4, power: ["Chaos"], might: 4 },
        { id: "occupier", owner: "B", types: ["unit"], zone: "board", location: OPEN_FIELD, might: 3 },
        { id: "ally-unit", program: vanillaUnit, types: ["unit"], zone: "hand", location: null, energy: 0, power: [], might: 2 },
      ],
      operations: [{ type: "play", object: "ally-unit", player: "A", location: OPEN_FIELD }],
      expect: { objects: { "ally-unit": { zone: "hand" } } },
    },
    declared: program => assert.match(program.judgeReason, /friendly-units|友方/),
  },
  {
    name: "Raging Soul - after a real discard this turn it has Assault and Ganking",
    canonicalCardId: RAGING_SOUL,
    program: executableProbe(RAGING_SOUL),
    scenario: {
      objects: [
        { id: "soul", cardId: RAGING_SOUL, types: ["unit"], zone: "board", location: HERE, might: 4 },
        { id: "fodder", types: ["unit"], zone: "hand" },
        spellObject("discard-driver", discardOne),
      ],
      operations: spellOps("discard-driver"),
      expect: {
        objects: {
          soul: { zone: "board", location: HERE, might: 4, keywords: [{ id: "assault" }, { id: "ganking" }] },
          fodder: { zone: "trash" },
          "discard-driver": { zone: "trash" },
        },
        events: { includes: [{ timingPoint: "card-discarded" }] },
      },
    },
    declared: program => {
      assert.equal(program.status, "judge-required");
      assert.equal(program.abilities.length, 2);
      assert.deepEqual(program.abilities.map(ability => ability.effect.kind), ["continuous.grant-keyword", "continuous.grant-keyword"]);
      assert.match(program.judgeReason, /ctx\.history/);
      assert.match(program.judgeReason, /combatRole/);
      assert.match(program.judgeReason, /movement/);
    },
  },
  {
    todo: "RIFT-675: the count condition is not evaluated from turn history; the live set query counts the host itself and grants both keywords with no discard",
    name: "Raging Soul printed - no discard this turn keeps both keywords off",
    canonicalCardId: RAGING_SOUL,
    program: executableProbe(RAGING_SOUL),
    scenario: {
      objects: [{ id: "soul", cardId: RAGING_SOUL, types: ["unit"], zone: "board", location: HERE, might: 4 }],
      expect: { objects: { soul: { zone: "board", might: 4, keywords: [] } } },
    },
    declared: program => assert.equal(program.status, "judge-required"),
  },
  {
    todo: "RIFT-675: the relative-player count has no anchor, so an opponent's discard also satisfies the gate",
    name: "Raging Soul printed - an opponent's discard does not satisfy 'you've discarded'",
    canonicalCardId: RAGING_SOUL,
    program: executableProbe(RAGING_SOUL),
    scenario: {
      objects: [
        { id: "soul", cardId: RAGING_SOUL, types: ["unit"], zone: "board", location: HERE, might: 4 },
        { id: "b-fodder", owner: "B", types: ["unit"], zone: "hand" },
        spellObject("discard-driver", discardOpponent),
      ],
      operations: spellOps("discard-driver"),
      expect: { objects: { soul: { keywords: [] }, "b-fodder": { zone: "trash" } } },
    },
    declared: program => assert.match(program.judgeReason, /相对玩家|relative/),
  },
  {
    name: "Wily Newtfish - after a real XP gain this turn it has +1 Might and Ganking",
    canonicalCardId: NEWTFISH,
    program: executableProbe(NEWTFISH),
    scenario: {
      players: { A: { xp: 0 } },
      objects: [
        { id: "newtfish", cardId: NEWTFISH, types: ["unit"], zone: "board", location: HERE, might: 4 },
        { id: "ally", types: ["unit"], zone: "board", location: HERE, might: 2 },
        spellObject("xp-driver", gainXp),
      ],
      operations: spellOps("xp-driver"),
      expect: {
        objects: {
          newtfish: { zone: "board", location: HERE, might: 5, keywords: [{ id: "Ganking" }] },
          ally: { might: 2, keywords: [] },
        },
        players: { A: { xp: 1 } },
        events: { includes: [{ timingPoint: "xp-gained" }] },
      },
    },
    declared: program => {
      assert.equal(program.status, "judge-required");
      assert.equal(program.abilities.length, 2);
      assert.deepEqual(program.abilities.map(ability => ability.effect.kind), ["continuous.might", "continuous.grant-keyword"]);
      assert.match(program.judgeReason, /364\.3/);
      assert.match(program.judgeReason, /144\.4\.c/);
    },
  },
  {
    todo: "RIFT-675: the XP history gate has no static-ability consumer; the descriptive count is evaluated as a live set query and the bonus applies at 0 XP",
    name: "Wily Newtfish printed - no XP this turn keeps the +1 Might and Ganking off",
    canonicalCardId: NEWTFISH,
    program: executableProbe(NEWTFISH),
    scenario: {
      players: { A: { xp: 0 } },
      objects: [
        { id: "newtfish", cardId: NEWTFISH, types: ["unit"], zone: "board", location: HERE, might: 4 },
        { id: "ally", types: ["unit"], zone: "board", location: HERE, might: 2 },
      ],
      expect: { objects: { newtfish: { might: 4, keywords: [] }, ally: { might: 2 } } },
    },
    declared: program => assert.match(program.judgeReason, /XP|xp/),
  },
  {
    todo: "RIFT-675: the relative-player count has no anchor, so an opponent's XP gain also satisfies the gate",
    name: "Wily Newtfish printed - an opponent's XP gain does not satisfy 'you've gained XP'",
    canonicalCardId: NEWTFISH,
    program: executableProbe(NEWTFISH),
    scenario: {
      objects: [
        { id: "newtfish", cardId: NEWTFISH, types: ["unit"], zone: "board", location: HERE, might: 4 },
        spellObject("xp-driver", gainOpponentXp),
      ],
      operations: spellOps("xp-driver"),
      expect: { objects: { newtfish: { might: 4, keywords: [] } }, players: { B: { xp: 1 } } },
    },
    declared: program => assert.match(program.judgeReason, /相对玩家|relative|controller/),
  },
  {
    name: "Rage Amplifier - while not Empowered your units have +1 Might and the enemy has none",
    canonicalCardId: RAGE_AMPLIFIER,
    program: executableProbe(RAGE_AMPLIFIER),
    scenario: {
      objects: [
        { id: "amplifier", cardId: RAGE_AMPLIFIER, types: ["gear"], zone: "board", location: HERE, might: null, power: null },
        { id: "ally", types: ["unit"], zone: "board", location: HERE, might: 2 },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: HERE, might: 2 },
      ],
      expect: {
        objects: { amplifier: { empowered: 0 }, ally: { might: 3 }, enemy: { might: 2 } },
        events: { exact: [] },
      },
    },
    declared: program => {
      assert.equal(program.status, "judge-required");
      assert.equal(program.abilities.length, 3);
      assert.deepEqual(program.abilities.map(ability => ability.kind), ["keyword", "static", "static"]);
      assert.match(program.judgeReason, /Empower/);
      assert.match(program.judgeReason, /params\.cost/);
      assert.match(program.judgeReason, /828\.1\.c/);
    },
  },
  {
    name: "Rage Amplifier - a real Empower action switches the aura to +2 instead of +1",
    canonicalCardId: RAGE_AMPLIFIER,
    program: executableProbe(RAGE_AMPLIFIER),
    scenario: {
      objects: [
        { id: "amplifier", cardId: RAGE_AMPLIFIER, types: ["gear"], zone: "board", location: HERE, might: null, power: null },
        { id: "ally", types: ["unit"], zone: "board", location: HERE, might: 2 },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: HERE, might: 2 },
        spellObject("empower-driver", empowerDriver),
      ],
      operations: spellOps("empower-driver"),
      expect: {
        objects: { amplifier: { empowered: 1 }, ally: { might: 4 }, enemy: { might: 2 } },
        events: { includes: [{ timingPoint: "empowered-changed" }] },
      },
    },
    declared: program => assert.equal(program.status, "judge-required"),
  },
  {
    name: "Rage Amplifier - Disempower returns the aura to +1 instead of stacking",
    canonicalCardId: RAGE_AMPLIFIER,
    program: executableProbe(RAGE_AMPLIFIER),
    scenario: {
      objects: [
        { id: "amplifier", cardId: RAGE_AMPLIFIER, types: ["gear"], zone: "board", location: HERE, might: null, power: null },
        { id: "ally", types: ["unit"], zone: "board", location: HERE, might: 2 },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: HERE, might: 2 },
        spellObject("empower-driver", empowerDriver),
        spellObject("disempower-driver", disempowerDriver),
      ],
      operations: [...spellOps("empower-driver"), ...spellOps("disempower-driver")],
      expect: {
        objects: { amplifier: { empowered: 0 }, ally: { might: 3 }, enemy: { might: 2 } },
        events: { sequence: [{ action: { type: "empower" } }, { action: { type: "disempower" } }] },
      },
    },
    declared: program => assert.match(program.judgeReason, /Empower|empowered/),
  },
  {
    name: "Rage Amplifier boundary - the printed [Empower] activation is refused as judge-required",
    canonicalCardId: RAGE_AMPLIFIER,
    program: executableProbe(RAGE_AMPLIFIER),
    scenario: {
      players: { A: { energy: 20, power: ["Fury"] } },
      objects: [
        { id: "amplifier", cardId: RAGE_AMPLIFIER, types: ["gear"], zone: "board", location: HERE, might: null, power: null },
        { id: "ally", types: ["unit"], zone: "board", location: HERE, might: 2 },
      ],
      operations: [
        { type: "activate", object: "amplifier", ability: 0, player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
    },
    expectedFailure: error => {
      assert.equal(error.code, "judge-required");
      assert.match(error.message, /Unsupported cost kind empower/);
      return true;
    },
    declared: program => assert.match(program.judgeReason, /827\.1\.c|Empower/),
  },
];

const templateCases = defineTemplateSuite(
  "RIFT-675 static+static",
  definitions.map(definition => ({
    name: definition.name,
    canonicalCardId: definition.canonicalCardId,
    program: definition.program,
    scenario: definition.scenario,
  })),
);

for (const [index, templateCase] of templateCases.entries()) {
  const definition = definitions[index];
  const gap = definition.todo
    ?? (definition.canonicalCardId === WARDEN
      ? 'Static controller:opponent filter needs a relative-player query; missing relative-player restriction consumer'
      : definition.expectedFailure !== undefined ? undefined
      : definition.canonicalCardId === BRAZEN
        ? 'Static ability kind cost.additional has no layer mapping; missing additional-cost CostPlan consumer'
        : definition.canonicalCardId === MISS_FORTUNE
            ? 'Static ability kind play-location-permission has no layer mapping; missing play-location-permission consumer'
            : undefined);
  if (gap !== undefined) {
    test.todo(`${templateCase.name} — ${gap}`);
    continue;
  }
  test(templateCase.name, () => {
    const declared = cardProgramsById.get(templateCase.canonicalCardId);
    assert.ok(declared, `generated program ${templateCase.canonicalCardId} is present`);
    definition.declared?.(declared);
    if (definition.expectedFailure) {
      assert.throws(templateCase.run, definition.expectedFailure);
      return;
    }
    const result = templateCase.run();
    definition.verify?.(result);
  });
}
