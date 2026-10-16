import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/kaisa-evolutionary.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import play from "../../../../engine-core/dist/effects/instructions/effect.play.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";

const [ganking, triggered] = program.abilities;
const c = value => ({ kind: "constant", value });

const trashSpell = (id, extra = {}) => ({
  ref: { id, zoneEntryId: 1 },
  cardId: `card:${id}`,
  name: id,
  types: ["spell"],
  tags: [],
  keywords: [],
  owner: "A",
  controller: "A",
  zone: "trash",
  location: null,
  might: null,
  energy: 2,
  power: ["Mind"],
  exhausted: false,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false,
  ...extra
});

test("Kai'Sa, Evolutionary program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Kai'Sa, Evolutionary identity and judge-required reason", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-697cf91efe23c8a9d145276f047432baac8d3218d9975045d3e27ad7573275ec"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /356\.1\.b\.2/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /points/);
  assert.equal(
    program.sourceText,
    "[Ganking] (I can move from battlefield to battlefield.)\n" +
      "When I conquer, you may play a spell from your trash with Energy cost less than your points without paying its Energy cost. Then recycle it. (You must still pay its Power cost.)"
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("structure: [Ganking] keyword plus the conquer trigger", () => {
  assert.deepEqual(ganking, { kind: "keyword", keyword: "ganking" });
  assert.equal(triggered.kind, "triggered");
  // 383.4.c.1："When I conquer" 是征服触发（471.1 / 473.2.a）。
  assert.equal(triggered.trigger.at, "conquer");
  assert.deepEqual(triggered.trigger.filter, {
    event: "conquer",
    filter: { role: "self" }
  });
  assert.equal(triggered.optional, false);
});

test("structure: choice.optional wraps the play + recycle, per contract 3.9", () => {
  assert.equal(triggered.body.length, 1);
  const [choice] = triggered.body;
  assert.equal(choice.id, "kaisa.opt-in");
  assert.equal(choice.op, "choice.optional");
  assert.equal(choice.linkedTo, undefined);

  const body = choice.args.body.value;
  assert.deepEqual(
    body.map(instruction => instruction.id),
    ["kaisa.play-spell", "kaisa.recycle-it"]
  );

  const playInstruction = body[0];
  assert.equal(playInstruction.op, "effect.play");
  // 355.10.a / 355.10.a.1：Trash 是公开区域 → 选目标（不是 pick）。
  assert.equal(playInstruction.picks, undefined);
  assert.deepEqual(playInstruction.args.target, c("kaisa.trash-spell"));
  assert.equal(playInstruction.targets.length, 1);
  const [target] = playInstruction.targets;
  assert.equal(target.id, "kaisa.trash-spell");
  assert.equal(target.selection, "one");
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.filter.zone, "trash");
  assert.equal(target.filter.type, "spell");
  assert.equal(target.filter.owner, "controller");
  // 动态条件（Energy cost < your points）保留占位形状，等待谓词落地。
  assert.equal(target.filter.energyLessThan, "controller-points");
  // 356.1.b.2：只忽略 Energy（base Energy cost = 0）；Power 由费用管线按被选牌的
  // 印刷费用收取，静态 IR 给不出该结论，因此这里是形状而非可执行计划。
  assert.deepEqual(playInstruction.args.cost, c({ finalized: true, energy: 0 }));

  // "Then recycle it" 链接到刚打出的那张牌。
  const recycle = body[1];
  assert.equal(recycle.op, "effect.recycle");
  assert.equal(recycle.linkedTo, "kaisa.play-spell");
  assert.deepEqual(recycle.args.objects, {
    kind: "linked-value",
    instructionId: "kaisa.play-spell",
    key: "playedObjects"
  });
});

test("golden: effect.play executes the trash spell with a zero-Energy finalized plan", () => {
  // 局部执行证据：已合入的 effect.play 在给定 finalized 零 Energy 计划与目标时能真实把
  // trash 里的法术牌打出（420.3 / 356.1.b.2 的“忽略 Energy 费用”部分形状）。整张卡仍
  // 因动态目标过滤与「Then recycle it」的引用绑定保持 judge-required。
  const kernel = world().build();
  kernel.addObject(trashSpell("trash-spell"), "trash");
  const instruction = triggered.body[0].args.body.value[0];

  const run = runInstruction(
    play,
    {
      // 原语口径：target / pick / linkKey 是字面 id（chain 适配器的 LITERAL_FIELDS 会拆
      // 掉 constant 包络）；runInstruction 直接调原语，所以这里给字面 id。
      target: "kaisa.trash-spell",
      cost: c({ finalized: true, energy: 0, power: ["Mind"] })
    },
    {
      world: kernel,
      targets: { "kaisa.trash-spell": [kernel.ref("trash-spell")] }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.played, 1);
  assert.equal(kernel.getObject("trash-spell").zone, "board");
  // effect.play 的链接值只有实际打出次数，没有对象引用 —— 正是 "Then recycle it" 缺的绑定。
  assert.equal(run.linked.playedObjects, undefined);
});

test("golden: declining the optional play skips the body entirely", () => {
  const kernel = world().build();
  kernel.addObject(trashSpell("trash-spell"), "trash");
  kernel.setAnswers({ "kaisa.opt-in/optional": false });
  const outcome = runAbilityBody(triggered.body, kernel);

  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(outcome.events, []);
  assert.equal(kernel.getObject("trash-spell").zone, "trash");
});

test.todo(
  "Kai'Sa, Evolutionary: the Finalize-time predicate comparing the candidate spell's printed Energy cost " +
    "with the controller's current points (CR 4138–4155) as a dynamic target filter (RIFT-8x/90)"
);

test.todo(
  "Kai'Sa, Evolutionary: 'without paying its Energy cost' as a finalized plan with base Energy 0 and the " +
    "printed Power still payable (CR 356.1.b.2; RIFT-89 cost.printed / cost.pay)"
);

test.todo(
  "Kai'Sa, Evolutionary: 'Then recycle it' binding the actually-played card's object reference out of the " +
    "play resolution (effect.play currently links only the success count)"
);

test.todo(
  "Kai'Sa, Evolutionary: [Ganking] expansion granting the battlefield-to-battlefield standard move " +
    "(RIFT-91 continuous.movement)"
);
