import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/viktor-innovator.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";

const [ability] = program.abilities;
const c = value => ({ kind: "constant", value });

test("Viktor, Innovator program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Viktor, Innovator identity and judge-required reason", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-27a69aef36a430f79f170618dfa72e36b2605b39fa8a3a67366ac01669844aa0"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /opponent's turn/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /continuous\.timing/);
  assert.equal(
    program.sourceText,
    "When you play a card on an opponent's turn, play a 1 :rb_might: Recruit unit token in your base."
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("structure: card-played trigger whose condition depends on the active player", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 420.4.a：打出动作完成后触发。
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    player: "controller"
  });
  // 「on an opponent's turn」必须在触发时比较回合玩家与控制者；冻结 IR 里只能保留
  // 原文含义的占位谓词（见 judgeReason 与文件末尾 TODO）。
  assert.deepEqual(ability.trigger.condition, {
    kind: "expression",
    value: c("active-player-is-opponent-of-controller")
  });
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.optional, false);
});

test("structure: the body creates the Recruit token on the chain, then plays it to your base", () => {
  assert.deepEqual(
    ability.body.map(instruction => instruction.id),
    ["viktor.play-recruit", "viktor.finish-recruit"]
  );

  const [create] = ability.body;
  assert.equal(create.op, "effect.token");
  // 187.1：1 Might Recruit 单位 token。
  assert.deepEqual(create.args.token, c("recruit"));
  assert.deepEqual(create.args.amount, c(1));
  // 440.2.c / 185.2.a："play a … token" 先在链上生成，再由 play 接手。
  assert.deepEqual(create.args.mode, c("play"));
  assert.deepEqual(create.args.location, c({ type: "base", player: "controller" }));
  assert.deepEqual(create.args.linkKey, c("recruitToken"));
  assert.equal(create.targets, undefined);

  const finish = ability.body[1];
  assert.equal(finish.op, "effect.play");
  assert.equal(finish.linkedTo, "viktor.play-recruit");
  assert.deepEqual(finish.args.object, {
    kind: "linked-value",
    instructionId: "viktor.play-recruit",
    key: "recruitToken.objects"
  });
  assert.deepEqual(finish.args.location, c({ type: "base", player: "controller" }));
});

test("golden: the Recruit token really enters the controller's base as a token", () => {
  // 已合入的 token 打出链路（create-token to chain + play）真实执行；这是本卡的局部
  // 执行证据，但不代表整卡可执行（触发条件未落地）。
  const kernel = world().build();
  const [create] = ability.body;
  const run = runInstruction(
    token,
    {
      token: create.args.token,
      amount: create.args.amount,
      mode: create.args.mode,
      // "in your base"：参考内核不接受 controller 占位符（生产选择管线才解析），
      // 因此像 assembly-rig 的 golden 一样替换为具体玩家基地后执行。
      location: c({ type: "base", player: "A" }),
      linkKey: create.args.linkKey
    },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  const created = kernel.query({ zone: "board", type: "unit" });
  assert.equal(created.length, 1);
  const [recruit] = created;
  assert.equal(recruit.name, "Recruit");
  assert.equal(recruit.might, 1);
  assert.deepEqual(recruit.location, { type: "base", player: "A" });
  assert.equal(recruit.isToken, true);
  // 185.3：token 没有 printed cost（null 不是 0）。
  assert.equal(recruit.energy, null);
  assert.equal(recruit.power, null);
  assert.deepEqual(run.linked["recruitToken.objects"], [recruit.ref]);
});

test.todo(
  "Viktor, Innovator: evaluating the opponent's-turn clause at trigger time (CR 383.2.a.1) needs a " +
    "turn-ownership predicate in TriggerSpec (continuous.timing only registers speed permissions today) — " +
    "the frozen ObjectFilter/EventPattern expose only controller/owner selectors and the event player"
);
test.todo(
  "Viktor, Innovator: the card-played trigger needs the CardProgram -> TriggerRegistration binding " +
    "(RIFT-257); events/pipeline.registerTrigger is only called by trusted kernel adapters. The authored " +
    "filter.player: \"controller\" is also not a legal engine selector (validateTriggerSpec accepts " +
    "self/opponent/any/playerId), so the card-program adapter must map it to the event player plus the " +
    "turn-ownership predicate."
);
