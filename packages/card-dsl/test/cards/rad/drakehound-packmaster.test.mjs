import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/drakehound-packmaster.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import banish from "../../../../engine-core/dist/effects/instructions/effect.banish.js";
import recycle from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
import reveal from "../../../../engine-core/dist/effects/instructions/effect.reveal.js";

const REVEAL_ID = "drakehound-packmaster.reveal";
const BANISH_ID = "drakehound-packmaster.banish";
const PLAY_ID = "drakehound-packmaster.play";
const RECYCLE_ID = "drakehound-packmaster.recycle";

test("rad-018-167 Drakehound Packmaster: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.canonicalCardId,
    "card.hash-13c973685ac41041e9a4132ebb47d2bd5e03e92ecad00fcf6d08ce9e0b8750f4"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "When you play me, reveal the top card of each opponent's Main Deck. Choose one and banish it, then play it, ignoring its cost. Recycle the rest."
  );
  assert.match(program.judgeReason, /effect\.reveal/);
  assert.match(program.judgeReason, /RIFT-358/);
  assert.match(program.judgeReason, /356\.1\.b\.1/);
  assert.match(program.judgeReason, /each opponent/);
  // The reason now pins the merged cost-modify shape: plan actions act on the
  // source domain and the source spelling stays Weaponmaster-only.
  assert.match(program.judgeReason, /Weaponmaster/);
});

test("rad-018-167: reveal, choose-banish, ignore-cost play, recycle-the-rest structure", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { self: true });
  assert.equal(ability.optional, false);
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    REVEAL_ID,
    BANISH_ID,
    PLAY_ID,
    RECYCLE_ID
  ]);

  const [reveal, banishInstruction, play, recycleInstruction] = ability.body;
  assert.equal(reveal.op, "effect.reveal");
  assert.deepEqual(reveal.args.pick, { kind: "constant", value: "drakehound-packmaster.revealed" });
  assert.equal(reveal.picks.length, 1);
  assert.equal(reveal.picks[0].id, "drakehound-packmaster.revealed");
  assert.deepEqual(reveal.picks[0].filter, { zone: "deck", controller: "opponent" });

  assert.equal(banishInstruction.op, "effect.banish");
  assert.equal(banishInstruction.linkedTo, REVEAL_ID);
  // “Choose one”：结算期非目标选择（355.10.c）。
  assert.deepEqual(banishInstruction.args.objects, {
    kind: "constant",
    value: { pick: "drakehound-packmaster.chosen" }
  });
  assert.equal(banishInstruction.picks.length, 1);
  assert.deepEqual(banishInstruction.picks[0].options, [
    { kind: "linked-value", instructionId: REVEAL_ID, key: "revealed" }
  ]);

  assert.equal(play.op, "effect.play");
  assert.equal(play.linkedTo, BANISH_ID);
  assert.deepEqual(play.args.object, {
    kind: "linked-value",
    instructionId: BANISH_ID,
    key: "drakehoundBanishedObject"
  });
  // “ignoring its cost” = 356.1.b.1 的零基础费用 Finalize 计划（不可用卡牌侧近似）。
  assert.deepEqual(play.args.cost, {
    kind: "constant",
    value: { finalized: true, energy: 0, power: [], xp: 0 }
  });

  assert.equal(recycleInstruction.op, "effect.recycle");
  assert.equal(recycleInstruction.linkedTo, REVEAL_ID);
  // “Recycle the rest”：消费 reveal 的 revealed 链接值；被选牌已换区、旧引用失效（359.3.e.7-.8），
  // 剩下的就是余牌（非目标集合，355.10.d）。
  assert.deepEqual(recycleInstruction.args.objects, {
    kind: "linked-value",
    instructionId: REVEAL_ID,
    key: "revealed"
  });
  assert.equal(recycleInstruction.picks, undefined);
});

test("rad-018-167: banishing the chosen card moves it to Banishment and links the real ref", () => {
  const kernel = world()
    .deck(["b-top", "b-second"], { owner: "B" })
    .player("B")
    .build();
  const instruction = program.abilities[0].body[1];
  const run = runInstruction(
    banish,
    {
      objects: instruction.args.objects,
      amount: instruction.args.amount,
      linkKey: instruction.args.linkKey
    },
    {
      world: kernel,
      picks: { "drakehound-packmaster.chosen": [kernel.ref("b-top")] }
    }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("b-top").zone, "banishment");
  assert.equal(kernel.getObject("b-second").zone, "deck");
  assert.equal(run.linked.drakehoundBanished.count, 1);
  assert.equal(run.linked.drakehoundBanishedObject.id, "b-top");
});

test("rad-018-167: recycling the rest returns the other deck cards to the bottom", () => {
  // 两张展示牌：一张被选走（换区后旧引用失效），另一张按“余牌”回收。
  const kernel = world().deck(["b-top", "b-second"], { owner: "B" }).player("B").build();
  const [revealInstruction, banishInstruction, , recycleInstruction] = program.abilities[0].body;

  const revealed = runInstruction(
    reveal,
    { pick: "drakehound-packmaster.revealed" },
    {
      world: kernel,
      picks: {
        "drakehound-packmaster.revealed": [kernel.ref("b-top"), kernel.ref("b-second")]
      }
    }
  );
  assert.equal(revealed.result.status, "executed");
  assert.deepEqual(revealed.linked.revealed, [
    { id: "b-top", zoneEntryId: 1 },
    { id: "b-second", zoneEntryId: 1 }
  ]);

  const banished = runInstruction(
    banish,
    {
      objects: banishInstruction.args.objects,
      amount: banishInstruction.args.amount,
      linkKey: banishInstruction.args.linkKey
    },
    {
      world: kernel,
      picks: { "drakehound-packmaster.chosen": [kernel.ref("b-top")] }
    }
  );
  assert.equal(banished.result.status, "executed");
  assert.equal(kernel.getObject("b-top").zone, "banishment");

  const recycled = runInstruction(
    recycle,
    { objects: recycleInstruction.args.objects },
    { world: kernel, linked: { [REVEAL_ID]: { revealed: revealed.linked.revealed } } }
  );
  assert.equal(recycled.result.status, "executed");
  assert.equal(kernel.getObject("b-second").zone, "deck");
  assert.equal(kernel.zone("B", "deck").length, 1);
});

test.todo('Drakehound Packmaster: ordered top card from each opponent and dynamic choice from the revealed set (RIFT-358)');
test.todo('Drakehound Packmaster: Finalize the selected banished card with ignored base costs through effect.play (CR 356.1.b.1)');
