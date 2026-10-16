import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/rally-for-war.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-14ade9eb01b57e1602425dda41e17e436ad9e8e9e597748e0d5d0fd42ac1cb66";
const SOURCE_TEXT =
  "Choose an occupied enemy battlefield. Play three 1 :rb_might: Recruit unit tokens there.";

const [play] = program.abilities;
const [recruitInstruction] = play.body;
const [battlefieldSpec] = recruitInstruction.targets;

// Finalize locks targets; the reference kernel compares filter values literally
// (it has no battlefield-occupancy predicate), so the golden test supplies the
// already-finalized target exactly as the merged target pipeline would
// (target/target-plan.ts). The TargetSpec itself stays in the program and is
// asserted structurally.
const bodyWithLockedTargets = play.body.map(({ targets, ...rest }) => rest);

/** One enemy-occupied battlefield controlled by B, plus a friendly source. */
function fixture() {
  const kernel = world()
    .unit("enemy-bf-unit", { owner: "B", might: 2, location: { type: "battlefield", id: "bf1" } })
    .unit("source-gear", {
      types: ["gear"],
      energy: 3,
      power: null,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .build();
  return kernel.clone({ sourceSnapshot: kernel.getObject("source-gear") });
}

test("rad-007-167 Rally for War: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("rad-007-167 Rally for War: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("rad-007-167 Rally for War: one play ability creating three Recruits at the chosen battlefield", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 1);

  // 187.1: the Recruit is the frozen 1 Might domainless unit token with the
  // Recruit tag; 350.2 / 440.2.c / 185.2.a route the printed "Play" through the
  // Chain and let the play flow place it at the chosen Location.
  assert.equal(recruitInstruction.id, "rally-for-war.recruits");
  assert.equal(recruitInstruction.op, "effect.token");
  assert.deepEqual(recruitInstruction.args.token, { kind: "constant", value: "recruit" });
  assert.deepEqual(recruitInstruction.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(recruitInstruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(recruitInstruction.args.target, {
    kind: "constant",
    value: "rally-for-war.battlefield"
  });
  assert.deepEqual(recruitInstruction.args.linkKey, { kind: "constant", value: "recruitTokens" });
  assert.equal(recruitInstruction.linkedTo, undefined);
  assert.equal(recruitInstruction.picks, undefined);
});

test("rad-007-167 Rally for War: 'an occupied enemy battlefield' is one target with the printed restrictions", () => {
  assert.equal(recruitInstruction.targets.length, 1);
  // 170 / 199 / 199.1: a Battlefield is a Game Object, so it can be the chosen
  // object; 170.11.a defines "occupied" and 190.2.b makes "enemy" a controller
  // restriction. 355.10.b: those are targeting restrictions, not extra targets.
  assert.equal(battlefieldSpec.id, "rally-for-war.battlefield");
  assert.deepEqual(battlefieldSpec.filter, {
    type: "battlefield",
    controller: "opponent",
    occupied: true
  });
  assert.equal(battlefieldSpec.min, 1);
  assert.equal(battlefieldSpec.max, 1);
  assert.equal(battlefieldSpec.selection, "one");
});

test("rad-007-167 Rally for War golden: three 1 Might Recruit tokens are played at the chosen battlefield", () => {
  const kernel = fixture();
  kernel.setTargets("rally-for-war.battlefield", [kernel.ref("enemy-bf-unit")]);

  const outcome = resolveChainBody(bodyWithLockedTargets, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(result => [result.id, result.result.status]),
    [["rally-for-war.recruits", "executed"]]
  );

  // The reference kernel's matchesFilter does not read isToken, so filter explicitly.
  const tokens = kernel.objects.filter(object => object.isToken);
  assert.equal(tokens.length, 3);
  for (const token of tokens) {
    assert.equal(token.name, "Recruit");
    assert.equal(token.might, 1);
    assert.deepEqual(token.tags, ["Recruit"]);
    // "there" — the chosen battlefield's Location (198.2 / 199.1).
    assert.deepEqual(token.location, { type: "battlefield", id: "bf1" });
    assert.equal(token.owner, "A");
    // 185.3: tokens have no printed cost, and null is never turned into 0.
    assert.equal(token.energy, null);
    assert.equal(token.power, null);
  }

  // 440.2.c / 185.2.a: each printed token is created on the Chain and then
  // played, so the real action order is create-token / play three times.
  assert.deepEqual(
    outcome.events.map(event => event.action),
    ["create-token", "play", "create-token", "play", "create-token", "play"]
  );
});

test("rad-007-167 Rally for War: a stale battlefield target makes the instruction ignored (CR 359.3.e.2)", () => {
  const kernel = fixture();
  const stale = kernel.ref("enemy-bf-unit");
  // Move the occupant off the battlefield: the reference kernel drops the
  // reference identity, so the finalized target is no longer usable.
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  kernel.setTargets("rally-for-war.battlefield", [stale]);

  const outcome = resolveChainBody(bodyWithLockedTargets, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.objects.filter(object => object.isToken).length, 0);
  assert.deepEqual(outcome.events, []);
});

test.todo(
  "rad-007-167 Rally for War: Finalize must evaluate 'occupied' (170.11.a) and 'enemy' " +
    "(190.2.b) battlefield restrictions when locking the target; ObjectFilter has no " +
    "occupancy predicate in the merged query implementations (layers/filter.ts, " +
    "effects/testing/test-kernel.ts). Depends on the target/plan workstream (RIFT-90)."
);

test.todo(
  "rad-007-167 Rally for War: the CardProgram -> ChainDraft describePlay adapter that turns " +
    "this play ability into a real chain item (with its printed cost paid at Finalize) is the " +
    "RIFT-120 follow-up owned by the coordinating task."
);
