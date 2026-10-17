import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/lost-to-the-sands.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));
const { world } = await import(new URL("effects/testing/index.js", engineCore));

const CANONICAL = "card.hash-ebc16c621c62d012f80adc1a2faa4b87722a2ea924309743bafb7b413e043f1c";
const [keyword, play] = program.abilities;
const mode = play.body[0];
const [damageMode, killMode] = mode.args.modes.value;

// The reference kernel's matchesFilter (effects/testing/test-kernel.ts) only
// compares a filter's `location` by exact JSON equality, so the production
// spelling `location: "battlefield"` (understood by layers/filter.ts and
// events/trigger-spec.ts) matches nothing there. Golden execution substitutes
// that one key with the kernel's location object, exactly as the merged
// sfd-106-221 Show of Strength golden documents for its own uncaptured filter
// key. The program itself is unchanged.
const kernelBody = (body) => JSON.parse(JSON.stringify(body), (key, value) =>
  key === "location" && value === "battlefield"
    ? { type: "battlefield", id: "bf-1" }
    : value);

test("rad-013-167 Lost to the Sands: program passes validateCardProgram and keeps the catalog text verbatim", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  // The catalog text is missing the separator between the two bullets
  // ("battlefield.Kill"); sourceText must still be the local evidence, exactly.
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\nChoose one —\nDeal 4 to a unit at a battlefield.Kill a gear."
  );
});

test("rad-013-167 Lost to the Sands: judge-required naming the blocked Finalize mode adapter", () => {
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /choice\.mode/);
  assert.match(program.judgeReason, /assertFinalizationSurface/);
  assert.match(program.judgeReason, /355\.3/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /RIFT-257/);
});

test("rad-013-167 Lost to the Sands: [Action] plus one mode choice with damage and kill branches", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "action" });
  assert.equal(play.body.length, 1);
  assert.equal(mode.op, "choice.mode");
  assert.deepEqual(mode.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(mode.args.different, { kind: "constant", value: true });
  assert.equal(mode.args.modes.kind, "constant");
  assert.deepEqual(
    mode.args.modes.value.map((entry) => entry.id),
    ["lost-to-the-sands.damage-mode", "lost-to-the-sands.kill-mode"]
  );

  // Branch 1: "Deal 4 to a unit at a battlefield."
  assert.equal(damageMode.body.length, 1);
  const deal = damageMode.body[0];
  assert.equal(deal.op, "effect.damage");
  assert.deepEqual(deal.args.amount, { kind: "constant", value: 4 });
  assert.equal(deal.targets.length, 1);
  assert.deepEqual(deal.targets[0], {
    id: "lost-to-the-sands.unit",
    filter: { type: "unit", zone: "board", location: "battlefield" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(deal.picks, undefined);

  // Branch 2: "Kill a gear."
  assert.equal(killMode.body.length, 1);
  const kill = killMode.body[0];
  assert.equal(kill.op, "effect.kill");
  assert.equal(kill.targets.length, 1);
  assert.deepEqual(kill.targets[0], {
    id: "lost-to-the-sands.gear",
    filter: { type: "gear", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("rad-013-167 Lost to the Sands golden: the damage mode deals exactly 4 to the chosen unit", () => {
  const kernel = world()
    .unit("enemy-unit", { owner: "B", might: 6, location: { type: "battlefield", id: "bf-1" } })
    .build();
  kernel.setAnswers({ "lost-to-the-sands.choose-one/mode%3A0": "lost-to-the-sands.damage-mode" });
  kernel.setTargets("lost-to-the-sands.unit", [kernel.ref("enemy-unit")]);

  const outcome = resolveChainBody(kernelBody(play.body), kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [
      ["lost-to-the-sands.deal-4", "executed"],
      ["lost-to-the-sands.choose-one", "executed"]
    ]
  );
  assert.equal(kernel.getObject("enemy-unit").damage, 4);
  assert.deepEqual(outcome.linkedValues["lost-to-the-sands.choose-one.value"], ["lost-to-the-sands.damage-mode"]);
});

test("rad-013-167 Lost to the Sands golden: the kill mode kills the chosen gear", () => {
  const kernel = world()
    .unit("enemy-gear", { owner: "B", types: ["gear"] })
    .build();
  kernel.setAnswers({ "lost-to-the-sands.choose-one/mode%3A0": "lost-to-the-sands.kill-mode" });
  kernel.setTargets("lost-to-the-sands.gear", [kernel.ref("enemy-gear")]);

  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [
      ["lost-to-the-sands.kill-gear", "executed"],
      ["lost-to-the-sands.choose-one", "executed"]
    ]
  );
  // CR 429: the gear leaves the Board for its owner's trash.
  assert.equal(kernel.getObject("enemy-gear").zone, "trash");
});

test("rad-013-167 Lost to the Sands boundary: a gear that left the Board ignores its branch (359.3.e.7)", () => {
  const kernel = world()
    .unit("enemy-gear", { owner: "B", types: ["gear"] })
    .build();
  const stale = kernel.ref("enemy-gear");
  kernel.perform({ type: "kill", object: stale });
  kernel.setAnswers({ "lost-to-the-sands.choose-one/mode%3A0": "lost-to-the-sands.kill-mode" });
  kernel.setTargets("lost-to-the-sands.gear", [stale]);

  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status, result.result.reason]),
    [
      ["lost-to-the-sands.kill-gear", "ignored", "mistargeted"],
      ["lost-to-the-sands.choose-one", "ignored", "mistargeted"]
    ]
  );
});

test.todo(
  "rad-013-167 Lost to the Sands: CR 355.3 requires the 'Choose one' mode decision at " +
    "Finalize; ChainEngine.finalize throws ChainContractBlockedError for choice.mode until the " +
    "Finalize/Resolve choice-plan adapter lands"
);
test.todo(
  "rad-013-167 Lost to the Sands: full chain play (3 Energy + 1 Fury Power payment, [Action] " +
    "timing) needs the Finalize cost plan adapter (cost kinds and cost.pay / cost.modify: " +
    "RIFT-261; card-program binding: RIFT-257) and chain admission"
);
