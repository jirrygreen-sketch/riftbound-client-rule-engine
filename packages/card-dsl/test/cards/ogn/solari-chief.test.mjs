import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/solari-chief.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { world } = await import(new URL("effects/testing/index.js", engineCore));
const { runAbilityBody } = await import(new URL("effects/interpreter.js", engineCore));

const KILL_ID = "solari-chief.kill-if-stunned";
const STUN_ID = "solari-chief.stun-otherwise";
const TARGET = "chosen-enemy";

/**
 * The interpreter evaluates each instruction's args and then hands the TargetSpec
 * id string to the primitive. That is the shape the production chain supplies
 * once Finalize has locked the targets; the golden tests below execute the
 * program's own body and only strip the TargetSpecs, which the reference kernel
 * provisions through setTargets (the same pattern as ogn/pit-rookie and
 * sfd/lucian-merciless).
 */
const bodyForExecution = () =>
  program.abilities[0].body.map(({ targets, ...rest }) => rest);

const kernelWith = ({ stunned }) => {
  const kernel = world()
    .unit("solari-chief", { might: 4, location: { type: "base", player: "A" } })
    .unit("enemy-unit", {
      owner: "B",
      might: 3,
      stunned,
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .build();
  Object.defineProperty(kernel, "source", { value: kernel.getObject("solari-chief") });
  kernel.setTargets(TARGET, [kernel.ref("enemy-unit")]);
  return kernel;
};

test("ogn-225-298 Solari Chief: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(
    program.canonicalCardId,
    "card.hash-be8b1014b9c44e6e9840a89206dc75baa41dd3cf997436c7e72b3f4395a7fdb0"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(
    program.sourceText,
    "When you play me, choose an enemy unit. If it is stunned, kill it. Otherwise, stun it. " +
      "(It doesn't deal combat damage this turn.)"
  );
});

test("ogn-225-298 Solari Chief: one card-played self trigger with one enemy TargetSpec and two mutually exclusive branches", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { event: "card-played", filter: { source: "self" } });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.trigger.condition, undefined);

  assert.equal(ability.body.length, 2);
  const [kill, stun] = ability.body;
  assert.equal(kill.id, KILL_ID);
  assert.equal(kill.op, "effect.kill");
  assert.equal(stun.id, STUN_ID);
  assert.equal(stun.op, "effect.stun");

  // Both branches name the same Finalize-locked target: "choose an enemy unit"
  // is made once (CR 355.5 / 355.8 / 355.15).
  for (const instruction of [kill, stun]) {
    assert.equal(instruction.targets.length, 1);
    const [target] = instruction.targets;
    assert.equal(target.id, TARGET);
    assert.deepEqual(target.filter, { type: "unit", controller: "opponent", zone: "board" });
    assert.equal(target.min, 1);
    assert.equal(target.max, 1);
    assert.equal(target.selection, "one");
    assert.deepEqual(instruction.args.target, { kind: "constant", value: TARGET });
    assert.equal(instruction.linkedTo, undefined);
  }

  // "If it is stunned, kill it. Otherwise, stun it.": the branches read the
  // chosen unit's current stunned state (CR 424.1.a) and are mutually exclusive.
  const stunnedBranch = (instruction) => instruction.condition;
  assert.deepEqual(stunnedBranch(kill), {
    kind: "compare",
    left: { kind: "object-property", object: { target: TARGET }, property: "stunned" },
    operator: "eq",
    right: { kind: "constant", value: true }
  });
  assert.deepEqual(stunnedBranch(stun), {
    kind: "compare",
    left: { kind: "object-property", object: { target: TARGET }, property: "stunned" },
    operator: "eq",
    right: { kind: "constant", value: false }
  });
});

test("ogn-225-298 Solari Chief golden: a stunned enemy unit is killed and not stunned again (CR 424.1.a.1, 429)", () => {
  const kernel = kernelWith({ stunned: true });
  const outcome = runAbilityBody(bodyForExecution(), kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason ?? null]),
    [
      [KILL_ID, "executed", null],
      [STUN_ID, "negated", "skipped"]
    ]
  );
  // 429.1: the killed permanent left the Board for its owner's Trash.
  assert.equal(kernel.getObject("enemy-unit").zone, "trash");
  assert.deepEqual(
    kernel.objectsInZone("B", "trash").map((ref) => ref.id),
    ["enemy-unit"]
  );
  assert.equal(kernel.ref("enemy-unit").zoneEntryId, 2);
});

test("ogn-225-298 Solari Chief golden: an unstunned enemy unit is stunned and not killed (CR 424.1)", () => {
  const kernel = kernelWith({ stunned: false });
  const outcome = runAbilityBody(bodyForExecution(), kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason ?? null]),
    [
      [KILL_ID, "negated", "skipped"],
      [STUN_ID, "executed", null]
    ]
  );
  assert.equal(kernel.getObject("enemy-unit").stunned, true);
  assert.equal(kernel.getObject("enemy-unit").zone, "board");
  // The reference kernel performs the stun game action (424.1).
  assert.equal(
    kernel.events.filter((event) => event.action === "stun").length,
    1
  );
});

test("ogn-225-298 Solari Chief: a target that left the Board makes the branch ignored, not skipped (CR 359.3.e.7)", () => {
  const kernel = kernelWith({ stunned: false });
  const stale = kernel.ref("enemy-unit");
  kernel.perform({ type: "kill", object: stale });
  // Re-lock the now-stale reference as the Finalize answer so the resolve-time
  // revalidation runs against an invalidated zone entry.
  kernel.setTargets(TARGET, [stale]);
  const outcome = runAbilityBody(bodyForExecution(), kernel);
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
});

test.todo(
  "ogn-225-298 Solari Chief: production chain execution of the stun branch — chain/interpreter-adapter.ts " +
    "未登记 effect.stun 的 literal target，适配器把已求值字符串再按 Expr 校验并抛 " +
    "\"effect.stun target must be a spec id string\"；golden 已通过参考解释器覆盖该语义，依赖引擎侧适配器补齐"
);
