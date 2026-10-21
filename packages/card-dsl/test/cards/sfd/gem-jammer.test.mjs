// Golden tests for Gem Jammer (sfd-007-221).
//
// The original CardProgram runs through ProgramBinding, ChainEngine and the
// production lifecycle. Its successful trigger, target lock and Standard Move
// are exercised below; the card remains judge-required because the lifecycle
// keeps the derived movement permission after the end-of-turn grant expires.
import test from "node:test";
import assert from "node:assert/strict";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/gem-jammer.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";
import { TargetSelectionError } from "../../../../engine-core/dist/target/target-plan.js";
import { duelWorld, mainTiming, readinessFor, moveDuelUnitsStandard } from "../../../../engine-core/test/rules/movement/support.mjs";
import { productionPlay } from "../../fixtures/production-play.mjs";

const CANONICAL = "card.hash-f0ac9d90de705764ec57a50fb7483a35117949080af9f6a959eb42a7b887c9e9";
const SOURCE_TEXT =
  "When you play me, give a unit [Ganking] this turn. (It can move from battlefield to battlefield.)";

const [ability] = program.abilities;
const [grant] = ability.body;

const gemInHand = {
  id: "gem",
  cardId: CANONICAL,
  owner: "A",
  controller: "A",
  types: ["unit"],
  zone: "hand",
  energy: 2,
  power: null,
  might: 2
};

// Admission-only view for the supported production fragment. Its identity,
// source text, trigger and body are the published program unchanged; the card
// itself remains judge-required because the derived permission survives
// turn-end, so this is not whole-card execution evidence.
const executableView = {
  ...program,
  status: "executable",
  judgeReason: undefined
};

test("sfd-007-221 Gem Jammer: program validates and is judge-required for stale keyword permission cleanup", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /programs\/statics\.ts:184/);
  assert.match(program.judgeReason, /turn-end/);
  assert.match(program.judgeReason, /permission/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-007-221 Gem Jammer: trigger fires when the card itself is played", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { event: "card-played", filter: { role: "self" } });
  assert.equal(ability.trigger.condition, undefined);
});

test("sfd-007-221 Gem Jammer: body grants Ganking to exactly one unit until end of turn", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(grant.id, "gem-jammer.grant-ganking");
  assert.equal(grant.op, "continuous.grant-keyword");
  assert.deepEqual(grant.args.keyword, { kind: "constant", value: "Ganking" });
  assert.deepEqual(grant.args.duration, { kind: "constant", value: "end-of-turn" });
  // Contract 3.6: the affected unit is the Finalize-locked TargetSpec, not the
  // source (the primitive's default selection).
  assert.deepEqual(grant.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "gem-jammer.unit" }
  });
  assert.equal(grant.targets.length, 1);
  // "a unit" (CR 355.9.a.1): any Board unit, friend or foe — no controller filter.
  assert.deepEqual(grant.targets[0], {
    id: "gem-jammer.unit",
    filter: { zone: "board", type: "unit" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("sfd-007-221 Gem Jammer production: an enemy Unit gains actionable Ganking and moves between battlefields", () => {
  const scene = duelWorld();
  const board = scene.place(scene.board, "target", "B", scene.bf1);
  const f = productionPlay({
    programs: [executableView],
    answers: { "target:gem-jammer.unit": ["target"] },
    build: w => w.player("A", { energy: 2, power: [] }).player("B", { energy: 0, power: [] })
      .object("gem", gemInHand)
      .unit("target", {
        owner: "B",
        controller: "B",
        types: ["unit"],
        might: 2,
        energy: null,
        power: null,
        location: { type: "battlefield", id: scene.bf1 }
      })
  });

  const draft = f.play("gem");
  assert.equal(draft.kind, "unit");
  assert.equal(f.kernel.player("A").energy, 0);
  assert.equal(f.kernel.getObject("gem").zone, "board");
  assert.deepEqual(f.targetRequests().map(request => [
    request.id,
    request.options.map(option => option.id)
  ]), [["target:gem-jammer.unit", ["gem", "target"]]]);

  const target = f.kernel.ref("target");
  const targetSnapshot = f.engine.layers.evaluate(target);
  assert.deepEqual(targetSnapshot.keywords.map(keyword => keyword.id), ["Ganking"]);
  assert.deepEqual(f.engine.layers.evaluate(f.kernel.ref("gem")).keywords, []);
  const registration = f.engine.layers.registry.list().find(entry =>
    entry.effect.effect.kind === "continuous.grant-keyword" && entry.effect.filter.objectId === "target");
  assert.ok(registration);
  assert.equal(registration.effect.layer, "ability");
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.equal(movement(f.engine.layers.registry, target, targetSnapshot, "B").canGank, true);

  const moved = moveDuelUnitsStandard(board, readinessFor(board), {
    actor: "B",
    unitUIDs: ["target"],
    destinationLocationId: scene.bf2,
    timing: mainTiming("B")
  }, {
    registry: f.engine.layers.registry,
    refForUnit: unit => f.kernel.ref(unit.objectId),
    objectForUnit: unit => f.engine.layers.evaluate(f.kernel.ref(unit.objectId))
  });
  assert.equal(moved.board.units.find(unit => unit.objectId === "target").locationId, scene.bf2);
  assert.equal(moved.group.exhaustedCount, 1);
});

test.todo(
  "sfd-007-221 Gem Jammer production: turn-end must revoke the derived battlefield-to-battlefield permission " +
  "(programs/statics.ts:184/194 currently leaves the generated permanent movement effect queryable)"
);

test("sfd-007-221 Gem Jammer production: with no other Board Unit, the played Unit may choose itself", () => {
  const f = productionPlay({
    programs: [executableView],
    build: w => w.player("A", { energy: 2, power: [] }).player("B", { energy: 0, power: [] })
      .object("gem", gemInHand)
  });

  f.play("gem");
  const gem = f.kernel.ref("gem");
  assert.deepEqual(f.engine.layers.evaluate(gem).keywords.map(keyword => keyword.id), ["Ganking"]);
  assert.deepEqual(f.engine.items, []);
});

test("sfd-007-221 Gem Jammer production: a non-Unit answer is rejected atomically at Finalize", () => {
  const f = productionPlay({
    programs: [executableView],
    answers: { "target:gem-jammer.unit": ["gear"] },
    build: w => w.player("A", { energy: 2, power: [] }).player("B", { energy: 0, power: [] })
      .object("gem", gemInHand)
      .object("gear", {
        owner: "B",
        controller: "B",
        types: ["gear"],
        zone: "board",
        location: { type: "base", player: "B" },
        might: null,
        energy: null,
        power: null
      })
  });
  const before = f.kernel.snapshot();
  assert.throws(
    () => f.play("gem"),
    error => error instanceof TargetSelectionError && error.code === "invalid-target-choice"
  );
  assert.deepEqual(f.kernel.snapshot(), before);
  assert.deepEqual(f.engine.items, []);
  assert.equal(f.kernel.getObject("gem").zone, "hand");
});
