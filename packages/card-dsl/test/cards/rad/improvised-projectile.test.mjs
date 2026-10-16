import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/improvised-projectile.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-415c30a2e32abfc05fc5c11072550f7685facb794af8fa368be192daa3dfd580";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Choose a friendly gear. Deal damage equal to its Energy cost to a unit at a battlefield.";

const [speed, play] = program.abilities;
const [damageInstruction] = play.body;
const [gearSpec, unitSpec] = damageInstruction.targets;

// Finalize locks targets; the card layer declares selectors, and the merged
// target pipeline (target/target-plan.ts) resolves the filter vocabulary. The
// golden test supplies the locked targets directly, as the sibling merged
// goldens do, and asserts the TargetSpecs structurally.
const bodyWithLockedTargets = play.body.map(({ targets, ...rest }) => rest);

function fixture(gearEnergy = 2) {
  const kernel = world()
    .unit("friendly-gear", {
      types: ["gear"],
      energy: gearEnergy,
      power: null,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("enemy-unit", {
      owner: "B",
      might: 5,
      damage: 0,
      location: { type: "battlefield", id: "bf1" }
    })
    .unit("base-unit", { owner: "B", might: 5, location: { type: "base", player: "B" } })
    .unit("source-gear", {
      types: ["gear"],
      energy: 3,
      power: null,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("source-gear") });
  scoped.setTargets("improvised-projectile.friendly-gear", [kernel.ref("friendly-gear")]);
  scoped.setTargets("improvised-projectile.unit-at-battlefield", [kernel.ref("enemy-unit")]);
  return scoped;
}

test("rad-056-167 Improvised Projectile: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("rad-056-167 Improvised Projectile: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("rad-056-167 Improvised Projectile: [Action] keyword plus one play ability", () => {
  assert.equal(program.abilities.length, 2);
  // 806.1 / 806.1.d: on a Card the keyword is printed "[Action]" and grants the
  // Showdown play permission; its expansion belongs to the keyword registry.
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 1);
});

test("rad-056-167 Improvised Projectile: damage amount reads the chosen Gear's Energy cost", () => {
  assert.equal(damageInstruction.id, "improvised-projectile.deal-energy");
  assert.equal(damageInstruction.op, "effect.damage");
  // 206: the amount is the chosen Gear's printed Energy cost, read at
  // resolution through the frozen object-property expression (contract 3.6).
  assert.deepEqual(damageInstruction.args.amount, {
    kind: "object-property",
    object: { target: "improvised-projectile.friendly-gear" },
    property: "energy"
  });
  assert.deepEqual(damageInstruction.args.target, {
    kind: "constant",
    value: "improvised-projectile.unit-at-battlefield"
  });
  // 418.6.a: no source is named, so the carrying Gear is the damage source.
  assert.equal(damageInstruction.args.source, undefined);
  assert.equal(damageInstruction.linkedTo, undefined);
  assert.equal(damageInstruction.picks, undefined);
});

test("rad-056-167 Improvised Projectile: two targets, a friendly gear and a unit at a battlefield", () => {
  assert.equal(damageInstruction.targets.length, 2);

  // 355.7 / 355.9.a.1 / 355.9.b: both chosen objects are on the Board and are
  // picked by the ability's controller, so both are targets.
  assert.equal(gearSpec.id, "improvised-projectile.friendly-gear");
  assert.deepEqual(gearSpec.filter, { type: "gear", controller: "self", zone: "board" });
  assert.equal(gearSpec.min, 1);
  assert.equal(gearSpec.max, 1);
  assert.equal(gearSpec.selection, "one");

  // "a unit at a battlefield" (355.10.b): the location clause is a targeting
  // restriction, spelled with the frozen location-type vocabulary.
  assert.equal(unitSpec.id, "improvised-projectile.unit-at-battlefield");
  assert.deepEqual(unitSpec.filter, { type: "unit", location: "battlefield" });
  assert.equal(unitSpec.min, 1);
  assert.equal(unitSpec.max, 1);
  assert.equal(unitSpec.selection, "one");
});

test("rad-056-167 Improvised Projectile golden: deals damage equal to the chosen Gear's Energy cost", () => {
  const kernel = fixture(2);

  const outcome = resolveChainBody(bodyWithLockedTargets, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(result => [result.id, result.result.status]),
    [["improvised-projectile.deal-energy", "executed"]]
  );
  assert.equal(kernel.getObject("enemy-unit").damage, 2);
  // The unit in a base was not a legal target: the damage is a single Deal
  // action against the chosen battlefield unit only (418.1.c).
  assert.equal(kernel.getObject("base-unit").damage, 0);
  assert.deepEqual(outcome.events.map(event => event.action), ["damage"]);
});

test("rad-056-167 Improvised Projectile golden: the amount follows the Gear it reads (CR 206)", () => {
  const kernel = fixture(4);
  const outcome = resolveChainBody(bodyWithLockedTargets, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("enemy-unit").damage, 4);
});

test("rad-056-167 Improvised Projectile: a stale gear target leaves the instruction ignored (CR 359.3.e.2)", () => {
  const kernel = fixture(2);
  const stale = kernel.ref("friendly-gear");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets("improvised-projectile.friendly-gear", [stale]);

  const outcome = resolveChainBody(bodyWithLockedTargets, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("enemy-unit").damage, 0);
  assert.deepEqual(outcome.events, []);
});

test.todo(
  "rad-056-167 Improvised Projectile: finalizing 'a friendly gear' and 'a unit at a battlefield' " +
    "while the item goes on the chain (355.8/355.9.b) needs the merged target pipeline to resolve " +
    "the card's TargetSpec filters; the reference kernel compares filter values literally " +
    "(effects/testing/test-kernel.ts). Depends on RIFT-90 (target/plan) and the RIFT-120 " +
    "CardProgram -> ChainDraft describePlay adapter."
);

test.todo(
  "rad-056-167 Improvised Projectile: [Action]'s Showdown play permission is expanded by the " +
    "keyword registry into a continuous.timing static effect; no merged layer consumer grants it " +
    "yet (effects/keywords/Action.ts documents the gap, RIFT-91 layers / chain canAct)."
);
