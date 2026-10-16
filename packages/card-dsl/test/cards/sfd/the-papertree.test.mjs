import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/the-papertree.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
// effect.channel declares Expr-typed arguments, so the body runs through the
// production chain adapter (engine-core/src/chain/interpreter-adapter.ts).
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import channel from "../../../../engine-core/dist/effects/instructions/effect.channel.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { assertTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";

const CANONICAL =
  "card.hash-4d3a916ba4eb2379af2f90b22c56765b66af29ff69411c03a17ac2e8789cf6c0";
const SOURCE_TEXT = "When you hold here, each player channels 1 rune exhausted.";

const [ability] = program.abilities;
const [channelInstruction] = ability.body;

test("sfd-219-221 The Papertree: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("sfd-219-221 The Papertree: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // Build-time codegen over src/cards/**; the golden proves the identity is
  // actually registered (one identity, one file).
  assert.equal(cardProgramsById.get(CANONICAL), program);
  // Both named dependencies: the unemitted hold timing point and the missing
  // per-player iteration (see judgeReason).
  assert.match(program.judgeReason, /hold/);
  assert.match(program.judgeReason, /RIFT-31/);
  assert.match(program.judgeReason, /RIFT-33/);
  assert.match(program.judgeReason, /effect\.channel/);
  assert.match(program.judgeReason, /each player/);
});

test("sfd-219-221: hold trigger that channels 1 exhausted rune (431.1/431.2)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "hold");
  // 053.3 "here" + 190.6.d "you"; sibling battlefield programs keep this
  // placeholder spelling while the hold pipeline is unmerged.
  assert.deepEqual(ability.trigger.filter, {
    event: "hold",
    here: true,
    player: "controller"
  });
  assert.equal(ability.optional, false);

  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "the-papertree.channel-1-rune"
  ]);
  assert.equal(channelInstruction.op, "effect.channel");
  assert.equal(channelInstruction.linkedTo, undefined);
  assert.equal(channelInstruction.targets, undefined);
  // 431.1/431.2: exactly one rune, with the printed exhausted entry
  // stipulation (the default would be readied, 431.2.a).
  assert.deepEqual(channelInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(channelInstruction.args.exhausted, { kind: "constant", value: true });
  // "each player" is a printed set the frozen IR cannot name; the constant is
  // a documented placeholder for the missing per-seat iteration, not a
  // fabricated seat.
  assert.deepEqual(channelInstruction.args.player, {
    kind: "constant",
    value: "each-player"
  });
});

test("sfd-219-221: the printed body cannot run as written (placeholder recipient)", () => {
  // The merged effect.channel reads one PlayerId; "each-player" resolves to no
  // seat, so the instruction is negated as impossible and no rune moves. The
  // card does not silently channel for the ability controller only.
  const kernel = world().rune(["rune-a"], { owner: "A" }).rune(["rune-b"], { owner: "B" }).build();

  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "impossible");
  // The attempt is recorded as an impossible channel-rune action (no rune
  // moved); the primitive reports negated/impossible because "each-player" is
  // not a resolvable seat.
  assert.deepEqual(
    kernel.events.map(event => [event.action, event.outcome]),
    [["channel-rune", "impossible"]]
  );
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.player("B").runeDeckSize, 1);
  assert.deepEqual(kernel.zone("A", "rune-zone"), []);
  assert.deepEqual(kernel.zone("B", "rune-zone"), []);
});

test("sfd-219-221: the merged channel primitive runs the printed amount and exhausted stipulation", () => {
  // Supplying only the missing binding the judgeReason names (one concrete
  // seat), so the merged primitive really executes the printed amount and the
  // printed entry stipulation through the production adapter.
  const kernel = world().rune(["rune-a1", "rune-a2"], { owner: "A" }).rune(["rune-b1"], { owner: "B" }).build();
  const substituted = [
    {
      ...channelInstruction,
      args: { ...channelInstruction.args, player: { kind: "constant", value: "A" } }
    }
  ];

  const outcome = resolveChainBody(substituted, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.events.map(event => event.action), ["channel-rune"]);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.player("A").runePool.length, 1);
  assert.equal(kernel.getObject("rune-a1").zone, "rune-zone");
  assert.equal(kernel.getObject("rune-a2").zone, "rune-deck");
  assert.equal(kernel.player("B").runeDeckSize, 1);
  assert.equal(kernel.player("B").runePool.length, 0);
});

test("sfd-219-221: the exhausted stipulation reaches the submitted channel-rune action (431.2)", () => {
  // The reference kernel's channel-rune handler does not model entry state, so
  // the submitted GameAction is captured to prove the printed stipulation is
  // carried; the hook observes the action and applies no replacement.
  const kernel = world().rune(["rune-a1"], { owner: "A" }).build();
  const submitted = [];
  kernel.addReplacement(action => {
    submitted.push(action);
    return null;
  });

  const run = runInstruction(
    channel,
    { player: "A", amount: { kind: "constant", value: 1 }, exhausted: { kind: "constant", value: true } },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 1);
  assert.deepEqual(submitted.at(-1), {
    type: "channel-rune",
    player: "A",
    amount: 1,
    exhausted: true
  });
  assert.equal(kernel.player("A").runeDeckSize, 0);
  assert.equal(kernel.player("A").runePool.length, 1);
});

test("sfd-219-221: a short Rune Deck channels as many as possible without negating (431.3)", () => {
  const kernel = world().build();
  const run = runInstruction(
    channel,
    { player: "A", amount: { kind: "constant", value: 1 }, exhausted: { kind: "constant", value: true } },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 0);
  assert.equal(kernel.player("A").runeDeckSize, 0);
  assert.deepEqual(kernel.zone("A", "rune-zone"), []);
});

test("sfd-219-221: the trigger filter still carries the unreplaced here placeholder", () => {
  assert.throws(() => assertTriggerSpec(ability.trigger), /EventPattern 不允许此字段/);
});

test.todo(
  "sfd-219-221: hold 由 scoring/ 发出并进链，Battlefield 能力按控制者注册触发（RIFT-31/RIFT-33）"
);
test.todo(
  "sfd-219-221: 「each player channels」的逐玩家迭代/逐席位选择原语（RIFT-9 target.player）落地后，" +
    "每名玩家各按 431.1 为自身 channel 1 个符文"
);
test.todo(
  "sfd-219-221: 431.2 的 exhausted 入场状态由内核实现——参考测试内核的 channel-rune 不记录符文入场状态"
);
