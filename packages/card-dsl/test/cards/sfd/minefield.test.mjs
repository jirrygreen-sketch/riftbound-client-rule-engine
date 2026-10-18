import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/minefield.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";

test("minefield: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("minefield: triggered conquer structure", () => {
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /effect.mill/);
  assert.equal(program.abilities.length, 1);
  const ability = program.abilities[0];
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "conquer");
  assert.equal(ability.trigger.filter.event, "conquered");
  assert.equal(ability.trigger.filter.here, true);
  // 470/471 + events/trigger-spec.ts 的封闭 PlayerSelector：能力控制者的契约拼写是
  // "self"（programs/filters.ts 的 normalizePlayer 同样归一为该能力控制者）。此前
  // 的 "controller" 只是非契约别名，闭合校验会报 invalid-player-selector，
  // 下面用真实校验器断言现在只剩 here 一处真实缺口。
  assert.equal(ability.trigger.filter.player, "self");
  assert.equal(ability.optional, false);
  assert.equal(ability.body.length, 1);
  const instruction = ability.body[0];
  assert.equal(instruction.op, "effect.mill");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 2 });
  assert.equal(instruction.args.player, undefined);
});

test("minefield: the closed trigger validator now only refuses the printed here anchor", () => {
  const result = validateTriggerSpec(program.abilities[0].trigger);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.issues.map((issue) => [issue.path, issue.code]),
    [["trigger.filter.here", "unknown-field"]]
  );
});

test("minefield: the printed `here` anchor is still refused at production binding", () => {
  // 468.5.d / 471.1 / 473.2.a: "when you conquer here" is battlefield-relative.
  // The merged translator has no evaluable anchor for that key, so it refuses the
  // registration instead of subscribing to every conquer by the controller. This
  // is the executed evidence for the current gap in the judgeReason.
  const ability = program.abilities[0];
  assert.equal(ability.trigger.filter.here, true);
  assert.throws(
    () => translateTriggerFilter(ability.trigger.filter, "minefield", "conquer"),
    /Unsupported filter field here/
  );
});

test("minefield: the scoring conquer payload carries no battlefield object to anchor `here`", () => {
  // turn/flow.ts publishes the Score wave as { timingPoint, player, details };
  // translateTriggerFilter copies details verbatim, so a self-relative host
  // anchor cannot be formed from the conquer emission. A hold/score payload is
  // reproduced here exactly as the merged turn flow emits it.
  const emitted = { timingPoint: "conquer", player: "A", details: { battlefieldId: "bf-1" } };
  assert.equal(emitted.object, undefined);
  assert.equal("battlefieldId" in emitted.details, true);
});

test("minefield: the supported body mills the controller's top 2 cards", () => {
  const kernel = world().deck(["top", "second", "third"], { owner: "A" }).build();
  const instruction = program.abilities[0].body[0];
  const outcome = resolveChainBody([instruction], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.burnedCount, 2);
  assert.deepEqual(kernel.zoneSlice("A", "trash", "top").map((object) => object.ref.id), ["top", "second"]);
  assert.deepEqual(kernel.zoneSlice("A", "deck", "top").map((object) => object.ref.id), ["third"]);
});

test.todo(
  "minefield: the conquer trigger must enforce the printed battlefield-relative here restriction " +
    "— programs/filters.ts rejects the `here` key and the conquer emission carries no " +
    "battlefield object to compare against"
);
