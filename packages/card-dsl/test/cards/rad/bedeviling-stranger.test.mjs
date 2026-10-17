// Golden test for Bedeviling Stranger (rad-107-167).
// The [Hidden] keyword and the optional return half are encoded; the "4 or more
// units there" gate and the facedown play path remain judged gaps (see
// judgeReason and the test.todo entries below).
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/bedeviling-stranger.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import hidden from "../../../../engine-core/dist/effects/keywords/Hidden.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-4122e96a3266bd012c251c2b82b1406e2deb7ff40f367359244639e4e4538ae4";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "When you play me, choose a battlefield. If there are 4 or more units there, you may return an enemy unit there to its owner's hand.";

const [hiddenKeyword, playTrigger] = program.abilities;
const [chooseBattlefield, mayReturn] = playTrigger.body;
const [returnEnemy] = mayReturn.args.body.value;
const [enemySpec] = returnEnemy.targets;

test("rad-107-167 Bedeviling Stranger: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-107-167 Bedeviling Stranger: judgeReason names the gate and Hidden gaps", () => {
  assert.match(program.judgeReason, /4 or more/);
  assert.match(program.judgeReason, /cost\.hidden/);
  assert.match(program.judgeReason, /Hide 动作/);
  assert.match(program.judgeReason, /TargetSpec\.location/);
  assert.match(program.judgeReason, /LocationFilter/);
  assert.doesNotMatch(program.judgeReason, /RIFT-257|target\.location 一族未合入/);
});

test("rad-107-167 Bedeviling Stranger: [Hidden] stays one keyword declaration with a registered KeywordDef", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(hiddenKeyword, { kind: "keyword", keyword: "hidden" });
  assert.equal(keywordDefinitionsById.get("Hidden"), hidden);
  // Hidden only declares the hide cost effect today (811.1.b minus the play part).
  assert.deepEqual(hidden.expand({ host: { canonicalCardId: CANONICAL } }), [
    { kind: "static", effect: { kind: "cost.hidden" } }
  ]);
});

test("rad-107-167 Bedeviling Stranger: 'When you play me' is the self-scoped card-played trigger (383.4.a.1)", () => {
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, { self: true });
  assert.equal(playTrigger.optional, false);
});

test("rad-107-167 Bedeviling Stranger: 'you may return …' is choice.optional wrapping the zone move (contract 3.9)", () => {
  assert.equal(playTrigger.body.length, 2);
  assert.equal(chooseBattlefield.op, "condition.value");
  assert.deepEqual(chooseBattlefield.locations, [
    {
      id: "bedeviling-stranger.chosen-battlefield",
      type: "battlefield",
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.deepEqual(chooseBattlefield.args.value, {
    kind: "location",
    value: {
      kind: "target-location",
      target: "bedeviling-stranger.chosen-battlefield"
    }
  });
  assert.equal(mayReturn.id, "bedeviling-stranger.may-return");
  assert.equal(mayReturn.op, "choice.optional");
  assert.equal(mayReturn.linkedTo, undefined);
  assert.equal(mayReturn.locations, undefined);
  assert.equal(mayReturn.args.body.kind, "constant");
  assert.deepEqual(mayReturn.args.body.value.map(entry => entry.id), [
    "bedeviling-stranger.return-enemy"
  ]);
  assert.equal(returnEnemy.op, "effect.zone");
  assert.equal(returnEnemy.locations, undefined);
  assert.deepEqual(returnEnemy.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(returnEnemy.args.target, {
    kind: "constant",
    value: "bedeviling-stranger.enemy-unit-there"
  });
  assert.equal(returnEnemy.linkedTo, undefined);
});

test("rad-107-167 Bedeviling Stranger: the enemy unit is a target restricted to a battlefield (355.7, 355.9.b)", () => {
  assert.equal(returnEnemy.targets.length, 1);
  assert.equal(returnEnemy.picks, undefined);
  assert.deepEqual(enemySpec, {
    id: "bedeviling-stranger.enemy-unit-there",
    filter: {
      type: "unit",
      controller: "opponent",
      zone: "board",
      location: { type: "battlefield" }
    },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("rad-107-167 Bedeviling Stranger: accepting returns the enemy unit to its owner's hand", () => {
  const kernel = world()
    .unit("stranger", { location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy", { owner: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  // The locked target is supplied directly, like the merged sibling goldens
  // (ogn/zaunite-bouncer): the reference kernel's scalar filter comparison treats
  // the "at a battlefield" location object as an exact-value field, so it is the
  // production target system — not this kernel — that re-checks that filter.
  const run = runInstruction(
    zone,
    {
      target: "bedeviling-stranger.enemy-unit-there",
      to: returnEnemy.args.to,
      amount: { kind: "constant", value: 1 }
    },
    {
      world: kernel,
      targets: { "bedeviling-stranger.enemy-unit-there": [kernel.ref("enemy")] }
    }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.moved, 1);
  assert.deepEqual(run.linked.destination, "hand");
  assert.equal(kernel.getObject("enemy").zone, "hand");
  assert.equal(kernel.getObject("enemy").owner, "B");
  assert.deepEqual(run.events.map(event => event.action), ["return-to-hand"]);
});

test("rad-107-167 Bedeviling Stranger golden: the battlefield choice binds a runtime location", () => {
  const base = world()
    .unit("stranger", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-here", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  base.setAnswers({
    "bedeviling-stranger.choose-battlefield/location%3Abedeviling-stranger.chosen-battlefield": {
      type: "battlefield",
      id: "bf-1"
    }
  });
  const outcome = resolveChainBody([chooseBattlefield], base);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.linkedValues["bedeviling-stranger.choose-battlefield.chosen-battlefield"],
    { type: "battlefield", id: "bf-1" }
  );
  assert.deepEqual(base.getObject("enemy-here").location, { type: "battlefield", id: "bf-1" });
});

test("rad-107-167 Bedeviling Stranger: declining moves nothing", () => {
  const kernel = world()
    .unit("stranger", { location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy", { owner: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  kernel.setAnswers({
    "bedeviling-stranger.choose-battlefield/location%3Abedeviling-stranger.chosen-battlefield": {
      type: "battlefield",
      id: "bf-1"
    },
    "bedeviling-stranger.may-return/optional": false
  });
  const outcome = runAbilityBody(playTrigger.body, kernel);
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["bedeviling-stranger.choose-battlefield", "executed"],
      ["bedeviling-stranger.may-return", "negated"]
    ]
  );
  assert.equal(outcome.results[1].result.reason, "skipped");
  assert.deepEqual(outcome.events, []);
  assert.equal(kernel.getObject("enemy").zone, "board");
});

test("rad-107-167 Bedeviling Stranger: a stale target makes the return instruction ignored (359.3.e.7)", () => {
  const kernel = world()
    .unit("stranger", { location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy", { owner: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const stale = kernel.ref("enemy");
  kernel.perform({ type: "kill", object: stale });
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("stranger") });
  scoped.setTargets("bedeviling-stranger.enemy-unit-there", [stale]);
  scoped.setAnswers({ "bedeviling-stranger.may-return/optional": true });
  const run = runInstruction(
    zone,
    { target: "bedeviling-stranger.enemy-unit-there", to: returnEnemy.args.to, amount: { kind: "constant", value: 1 } },
    { world: scoped, targets: { "bedeviling-stranger.enemy-unit-there": [stale] } }
  );
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
});

test.todo(
  "rad-107-167 Bedeviling Stranger: consume the chosen battlefield binding for the '4 or more units there' " +
    "gate and bind the enemy target's location to that choice (CR 355.5/355.10.b); " +
    "the condition/count path cannot yet read a LocationTargetSpec binding and TargetSpec.location " +
    "still rejects target-location while sameLocationAs cannot name a location binding"
);
test.todo(
  "rad-107-167 Bedeviling Stranger: [Hidden] expansion — the KeywordDef is merged but the Hide " +
    "action, facedown zone and next-turn [Reaction] play ignoring the base cost " +
    "(CR 811.1.b/811.1.d, cost.hidden) have no consumer"
);

