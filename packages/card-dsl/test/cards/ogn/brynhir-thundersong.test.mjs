import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/brynhir-thundersong.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import restrict from "../../../../engine-core/dist/effects/instructions/continuous.restrict.js";
import { ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { restrictions } from "../../../../engine-core/dist/layers/rules/query.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";

const CARD_ID = "card.hash-c3d99cfdb7043f9a6d4f6898cda1e76169b34bfb8ba341d7b4189ff2c78fc63d";
const [triggered] = program.abilities;
const literal = (value) => ({ kind: "constant", value });

const registryOf = (kernel) => {
  const registry = new ContinuousEffectRegistry();
  for (const entry of kernel.continuousEffects) registry.register(entry.effect, entry.duration);
  return registry;
};

test("brynhir-thundersong: passes validateCardProgram and is indexed by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardProgramsById.get(CARD_ID), program);
});

test("brynhir-thundersong: identity, ruleset, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /canAct/);
  assert.match(program.judgeReason, /生产链|消费/);
  assert.match(program.judgeReason, /draft\.controller/);
  assert.match(program.judgeReason, /activated/);
  assert.equal(program.sourceText, "When you play me, opponents can't play cards this turn.");
});

test("brynhir-thundersong: 'When you play me' is a mandatory card-played trigger filtered to the source (420.4.a)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    filter: { source: "self", player: "controller" }
  });
  assert.equal(triggered.trigger.condition, undefined);
  assert.equal(triggered.optional, false);
});

test("brynhir-thundersong: the body declares a turn-long play prohibition for opponents", () => {
  assert.equal(triggered.body.length, 1);
  const [instruction] = triggered.body;
  assert.equal(instruction.id, "brynhir-thundersong.forbid-play");
  assert.equal(instruction.op, "continuous.restrict");
  assert.deepEqual(instruction.args, {
    mode: { kind: "constant", value: "prohibit" },
    action: { kind: "constant", value: "play-card" },
    appliesTo: { kind: "constant", value: { controller: "opponent" } },
    duration: { kind: "constant", value: "this-turn" }
  });
  // The card only declares the restriction; it never advances priority, and the
  // prohibition applies to the opponents, not to the controller.
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.condition, undefined);
});

test.todo(
  "brynhir-thundersong: anchor opponents to the trigger controller, block only card plays (allow activated abilities), " +
    "and recheck the prohibition in canAct/Finalize (CR 191.5.a/b, 400/402-407)"
);

test("Brynhir original trigger filter binds to self and its original body registers the turn-long prohibition", () => {
  const base = world().unit("brynhir", { owner: "A" }).unit("opponent", { owner: "B" }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("brynhir") });
  assert.deepEqual(translateTriggerFilter(triggered.trigger.filter, "brynhir", "card-played"), {
    event: "card-played", object: { objectId: "brynhir" }, player: "self"
  });
  const outcome = resolveChainBody(triggered.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(kernel.continuousEffects[0].effect.effect.actions, ["play-card"]);
  assert.deepEqual(kernel.continuousEffects[0].effect.filter, { controller: "opponent" });
  assert.deepEqual(kernel.continuousEffects[0].duration, { type: "end-of-turn" });
  const registry = registryOf(kernel);
  registry.expireAt({ id: "turn-end" }, () => null);
  assert.equal(registry.list().length, 0);
});

test("brynhir-thundersong golden: the printed prohibition registers for opponents and expires at end of turn", () => {
  const base = world()
    .unit("brynhir-thundersong", { owner: "A", types: ["unit"] })
    .unit("opponent", { owner: "B", controller: "B" })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("brynhir-thundersong") });
  const run = runInstruction(
    restrict,
    {
      mode: literal("prohibit"),
      action: literal("play-card"),
      appliesTo: literal({ controller: "opponent" }),
      duration: literal("this-turn")
    },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.continuousEffects[0].duration, { type: "end-of-turn" });
  const registry = registryOf(kernel);
  const opponent = kernel.getObject("opponent");
  // Relative to player A the B unit is an opponent; relative to B it is self.
  assert.equal(restrictions(registry, "play-card", opponent.ref, opponent, "A").length, 1);
  assert.equal(restrictions(registry, "play-card", opponent.ref, opponent, "B").length, 0);
  // 317.2.c: the prohibition is gone after the turn ends.
  registry.expireAt({ id: "turn-end" }, () => null);
  assert.equal(restrictions(registry, "play-card", opponent.ref, opponent, "A").length, 0);
});
