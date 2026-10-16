import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/runeblade-anvil.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";

const PLAY_BANISH = "runeblade-anvil.banish-top";
const PLAY_PERMISSION = "runeblade-anvil.grant-play";
const LEAVE_BANISH = "runeblade-anvil.leave-banish-top";
const LEAVE_PERMISSION = "runeblade-anvil.leave-grant-play";
const KILL_SELF = "runeblade-anvil.kill-self";

test("rad-012-167 Runeblade Anvil: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.canonicalCardId,
    "card.hash-3602253c44e8a91cf5da9a5cba735f571ffaf1b9e057b42a094f99611b53f5e4"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "When you play this or when this leaves the board, banish the top card of your Main Deck. Until your next Ending Phase, you may play that card. (You still pay its costs.)\n" +
      ":rb_energy_2::rb_rune_chaos:, :rb_exhaust:: Kill this."
  );
  assert.match(program.judgeReason, /play/);
  assert.match(program.judgeReason, /Banishment/);
});

test("rad-012-167: play trigger, leave-board trigger and the activated Kill-this ability", () => {
  assert.equal(program.abilities.length, 3);
  const [playTrigger, leaveTrigger, activated] = program.abilities;

  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, { self: true });
  assert.equal(playTrigger.optional, false);
  assert.deepEqual(playTrigger.body.map(instruction => instruction.id), [PLAY_BANISH, PLAY_PERMISSION]);
  const [playBanish, playPermission] = playTrigger.body;
  assert.equal(playBanish.op, "effect.banish");
  assert.deepEqual(playBanish.args.objects, { kind: "constant", value: { zone: "deck", from: "top" } });
  assert.deepEqual(playBanish.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(playBanish.args.linkKey, { kind: "constant", value: "runebladeAnvilBanish" });
  assert.equal(playPermission.linkedTo, PLAY_BANISH);
  assert.equal(playPermission.op, "effect.play-permission");
  assert.deepEqual(playPermission.args.objects, {
    kind: "linked-value",
    instructionId: PLAY_BANISH,
    key: "runebladeAnvilBanish.objects"
  });
  assert.deepEqual(playPermission.args.payCosts, { kind: "constant", value: true });
  assert.deepEqual(playPermission.args.until, { kind: "constant", value: "your-next-ending-phase" });

  assert.equal(leaveTrigger.kind, "triggered");
  assert.equal(leaveTrigger.trigger.at, "object-leaves-board");
  assert.deepEqual(leaveTrigger.trigger.filter, { self: true });
  assert.deepEqual(leaveTrigger.body.map(instruction => instruction.id), [LEAVE_BANISH, LEAVE_PERMISSION]);
  assert.equal(leaveTrigger.body[1].linkedTo, LEAVE_BANISH);

  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  assert.deepEqual(activated.cost.energy, { kind: "constant", value: 2 });
  assert.deepEqual(activated.cost.power, { kind: "constant", value: ["Chaos"] });
  assert.deepEqual(activated.cost.payments, [{ kind: "exhaust" }]);
  assert.equal(activated.body.length, 1);
  assert.equal(activated.body[0].id, KILL_SELF);
  assert.equal(activated.body[0].op, "effect.kill");
  assert.deepEqual(activated.body[0].args.self, { kind: "constant", value: true });
});

test("rad-012-167: banishing the deck top uses zone order and links real refs", () => {
  const kernel = world().deck(["top", "second"], { owner: "A" }).build();
  const instruction = program.abilities[0].body[0];

  const outcome = resolveChainBody([instruction], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  // 牌库顶是 zone order 的第一张（zoneSlice top），不是 query 任意顺序。
  assert.equal(kernel.getObject("top").zone, "banishment");
  assert.equal(kernel.getObject("second").zone, "deck");
  assert.equal(outcome.linkedValues[`${PLAY_BANISH}.runebladeAnvilBanishCount`], 1);
  assert.equal(
    outcome.linkedValues[`${PLAY_BANISH}.runebladeAnvilBanishObject`].id,
    "top"
  );
});

test("rad-012-167: the activated ability kills the source (429.1.a.1)", () => {
  const kernel = world().unit("anvil", { types: ["unit"] }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("anvil") });
  const instruction = program.abilities[2].body[0];

  const outcome = resolveChainBody([instruction], scoped);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(scoped.getObject("anvil").zone, "trash");
  assert.deepEqual(outcome.linkedValues[`${KILL_SELF}.killed`], [{ id: "anvil", zoneEntryId: 1 }]);
});

test("rad-012-167: the play-permission instruction is not a registered primitive", () => {
  // 缺口是“带期限的打出许可”：注册表里没有对应 opcode，也没有任何近似原语可替代。
  assert.equal(instructionDefinitionsById.has("effect.play-permission"), false);
  assert.equal(instructionDefinitionsById.has("effect.grant-play-permission"), false);

  // 真实执行两段 body 时，前一条把牌库顶放入 Banishment，后一条因无法解析“许可”输入而
  // ignored——不会打出任何牌、也不会产生许可；这正是当前引擎的真实行为。
  const kernel = world().deck(["top"], { owner: "A" }).build();
  const [banish, permission] = program.abilities[0].body;
  const outcome = resolveChainBody([banish, permission], kernel);
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[1].result.status, "ignored");
  assert.equal(kernel.getObject("top").zone, "banishment");
  assert.deepEqual(
    kernel.events.filter(event => event.action === "play"),
    []
  );
});

test.todo(
  "rad-012-167 Runeblade Anvil: “Until your next Ending Phase, you may play that card. (You still " +
    "pay its costs.)” 需要 duration 化的 from-Banishment 打出许可原语（effect.play 只消费已 " +
    "Finalize 的费用计划；Duration 无 “your next Ending Phase” 具名期限）——依赖 RIFT-89~91"
);
test.todo(
  "rad-012-167 Runeblade Anvil: 离场触发（object-leaves-board，383.2.c.3.b 的最后已知信息与" +
    "离场前收集）依赖 RIFT-21/31"
);
