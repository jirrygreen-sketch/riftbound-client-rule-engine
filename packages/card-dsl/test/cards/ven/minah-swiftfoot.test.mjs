import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/minah-swiftfoot.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import discard from "../../../../engine-core/dist/effects/instructions/effect.discard.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-36cf830f15dc595f32cf4fbd561b4fda41ceeefd4c262f212067596def69e2cb";
const SOURCE_TEXT =
  "When I move to a battlefield, choose one —\n" +
  "Each player discards 1.Each player draws 1.";

const [ability] = program.abilities;
const [modeChoice] = ability.body;
const [discardMode, drawMode] = modeChoice.args.modes.value;
const [discardInstruction] = discardMode.body;
const [drawInstruction] = drawMode.body;

/** Replace the documented "each-player" placeholder with one concrete seat. */
const forSeat = (instruction, player) => ({
  ...instruction.args,
  player: { kind: "constant", value: player }
});

test("ven-111-166 Minah Swiftfoot: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-111-166 Minah Swiftfoot: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /each-player/);
  assert.match(program.judgeReason, /object-moved/);
});

test("ven-111-166 Minah Swiftfoot: the Move trigger names the source and its destination", () => {
  // 421.1 / 449.1 / 449.2 / 458：Move 的封闭时点；“to a battlefield” 的目的地过滤见 judgeReason 第 2 点。
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "object-moved");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-moved",
    toZone: "battlefield",
    filter: { source: "self" }
  });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.condition, undefined);
});

test("ven-111-166 Minah Swiftfoot: 'choose one —' is one choice.mode with the two printed modes (3.9)", () => {
  assert.equal(modeChoice.op, "choice.mode");
  assert.deepEqual(modeChoice.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(modeChoice.args.different, { kind: "constant", value: true });
  assert.equal(modeChoice.args.modes.kind, "constant");
  assert.deepEqual(modeChoice.args.modes.value.map(mode => mode.id), [
    "minah-swiftfoot.each-player-discards",
    "minah-swiftfoot.each-player-draws"
  ]);
});

test("ven-111-166 Minah Swiftfoot: both mode bodies carry the printed amount and a kickoff choice id", () => {
  assert.deepEqual(
    [discardInstruction, drawInstruction].map(instruction => [instruction.id, instruction.op]),
    [
      ["minah-swiftfoot.discard", "effect.discard"],
      ["minah-swiftfoot.draw", "effect.draw"]
    ]
  );
  // 423.1 / 414.1：各 1 张。
  assert.deepEqual(discardInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 1 });
  // Discard 的结算期选择需要稳定的重放 id。
  assert.deepEqual(discardInstruction.args.choiceId, {
    kind: "constant",
    value: "minah-swiftfoot.discard-choice"
  });
  // 「each player」是全体玩家集合的描述性占位（逐玩家扇出见 judgeReason 第 1 点）。
  for (const instruction of [discardInstruction, drawInstruction]) {
    assert.deepEqual(instruction.args.player, {
      kind: "constant",
      value: "each-player"
    });
  }
  assert.equal(discardInstruction.targets, undefined);
  assert.equal(drawInstruction.targets, undefined);
});

test("ven-111-166 golden: the discard mode really discards one card through the seat-substituted body", () => {
  const kernel = world().player("A").hand("hand-a").hand("hand-b").build();
  const run = runInstruction(discard, forSeat(discardInstruction, "A"), {
    world: kernel,
    answers: { "minah-swiftfoot.discard-choice": [kernel.ref("hand-a")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(kernel.objectsInZone("A", "trash").length, 1);
  assert.equal(run.linked.discarded.count, 1);
});

test("ven-111-166 golden: the draw mode really draws one card for the substituted seat", () => {
  const kernel = world().player("A").deck(["top-card", "next-card"]).build();
  const run = runInstruction(draw, forSeat(drawInstruction, "A"), { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.equal(run.linked.drawn, 1);
});

test("ven-111-166 golden: an empty hand makes the discard half negated, not silently skipped", () => {
  const kernel = world().player("A").build();
  const run = runInstruction(discard, forSeat(discardInstruction, "A"), { world: kernel });
  // 423.4：能丢多少丢多少；一张都没有时该指令被否定，而不是伪造一次弃牌。
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.linked.discarded.count, 0);
});


test("ven-111-166 golden: choosing a mode asks for exactly the two printed modes (contract 3.9)", async () => {
  const { runAbilityBody } = await import("../../../../engine-core/dist/effects/interpreter.js");
  const kernel = world().player("A").build();
  assert.throws(
    () => runAbilityBody([modeChoice], kernel),
    error => {
      assert.equal(error.name, "AwaitChoice");
      assert.equal(error.request.id, "minah-swiftfoot.choose-one/mode%3A0");
      assert.equal(error.request.type, "mode");
      assert.deepEqual(error.request.options, [
        "minah-swiftfoot.each-player-discards",
        "minah-swiftfoot.each-player-draws"
      ]);
      return true;
    }
  );
});

test.todo(
  "ven-111-166 Minah Swiftfoot: iterate 'each player' (355.10.d) — the merged IR runs one body under a single " +
    "ResolveContext, effect.discard/effect.draw accept one PlayerId, and the frozen opcode list has no player-set " +
    "enumeration or per-seat repetition"
);
test.todo(
  "ven-111-166 Minah Swiftfoot: decide 'When I move to a battlefield' — move-location object-moved events do not " +
    "fill toZone/toKind (timing-points payloadFields), so the destination predicate cannot be matched"
);
test.todo(
  "ven-111-166 Minah Swiftfoot: run the finalized choice.mode selection through the current Finalize/Resolve path"
);
