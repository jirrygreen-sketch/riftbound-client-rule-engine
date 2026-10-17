import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/curator-of-the-sands.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import exhaust from "../../../../engine-core/dist/effects/instructions/effect.exhaust.js";
import { deriveAbilityActivatedEmission } from "../../../../engine-core/dist/events/producers/ability-activation.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";

const CANONICAL_ID =
  "card.hash-913749be19f87a0f632bd0690ad0490bb254a346584c09e1b8c3244137f609a7";
const SOURCE_TEXT =
  "When you play a unit, gear, or activated ability with Energy cost :rb_energy_7: or more, " +
  "you may exhaust me to ready up to 2 runes.";

const [ability] = program.abilities;
const [exhaustSelf, readyRunes] = ability.body;

/** 符文按契约 ZoneId 位于 rune-zone（CR 107.1.c 的 Base 读法见 judgeReason 第 4 条）。 */
const runeSnapshot = (id, exhausted) => ({
  ref: { id, zoneEntryId: 1 },
  cardId: "card:" + id,
  name: id,
  types: ["rune"],
  tags: [],
  keywords: [],
  owner: "A",
  controller: "A",
  zone: "rune-zone",
  location: null,
  might: null,
  energy: null,
  power: null,
  exhausted,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false
});

test("ven-145-166 Curator of the Sands: validateCardProgram passes and identity is verbatim", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /Energy cost/);
  assert.match(program.judgeReason, /ability-activated/);
  assert.match(program.judgeReason, /383\.3\.b/);
  assert.match(program.judgeReason, /LITERAL_FIELDS/);
});

test("ven-145-166: review evidence — ability-activated now has a producer (RIFT-270)", () => {
  // 旧 judgeReason 说“没有产者发出 ability-activated”；现在 Chain 的合法完成结果经
  // deriveAbilityActivatedEmission 发出该时点。
  const emission = deriveAbilityActivatedEmission({
    status: "committed",
    chainItemId: "item-1",
    playerId: "A",
    sourceId: "curator-of-the-sands",
    abilityId: "ability-0"
  });
  assert.equal(emission.timingPoint, "ability-activated");
  assert.equal(emission.player, "A");
  assert.equal(emission.details.abilityId, "ability-0");
  // cancelled / countered / invalid 不产生时点。
  assert.equal(deriveAbilityActivatedEmission({
    status: "countered",
    chainItemId: "item-1",
    playerId: "A",
    sourceId: "curator-of-the-sands",
    abilityId: "ability-0"
  }), null);
});

test("ven-145-166: the authored 'exhaust me' shape cannot run through the production chain adapter", () => {
  // 383.3.b 的“exhaust me”是触发能力的基础费用。程序里的 choose 是 Expr 包封，而
  // chain/interpreter-adapter 的 LITERAL_FIELDS 不解包 effect.exhaust 的 choose，
  // 所以生产链路上会以 argsSchema 失败（这是当前缺口的可复现证据，不是“功能不存在”的断言）。
  const [exhaustSelf] = ability.body;
  const kernel = world().unit("curator-of-the-sands", { types: ["legend"], zone: "board" }).build();
  kernel.setAnswers({ "curator-of-the-sands.exhaust-self": [kernel.ref("curator-of-the-sands")] });
  assert.throws(
    () => resolveChainBody([exhaustSelf], kernel),
    /effect\.exhaust choose requires a stable non-empty choice id/
  );

  // 把同一形状按适配器约定解包成字面值后，真实原语本身是可执行的（证明差的是适配器）。
  const unpacked = world().unit("curator-of-the-sands", { types: ["legend"], zone: "board" }).build();
  const run = runInstruction(exhaust, {
    choose: { id: "curator-of-the-sands.exhaust-self", filter: { objectId: "curator-of-the-sands" } }
  }, {
    world: unpacked,
    answers: { "curator-of-the-sands.exhaust-self": [unpacked.ref("curator-of-the-sands")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(unpacked.getObject("curator-of-the-sands").exhausted, true);
});

test("ven-145-166: 'When you play a unit, gear, or activated ability' trigger shape", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.a / 407：打出卡牌用 card-played 观察；原文同时列举启动能力（另一时点）。
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: {
      // “you play a unit, gear, or activated ability”：卡牌打出这一半的对象类型白名单；
      // object 是对象选择器锚点，不能承载嵌套 ObjectFilter，故以描述性键记录。
      playedCardTypes: ["unit", "gear"],
      controller: "self",
      player: "self",
      // 206 / 206.1：“with Energy cost :rb_energy_7: or more” 读印刷/base 费用；该门槛
      // 在合并 IR 里无法求值，仅以描述性键保留。
      energyCostAtLeast: 7
    }
  });
  // 383.3.a 的 “you may” 在本卡是效果开头的费用决定，不是可选指令：ability.optional
  // 与 choice.optional 都不使用（费用语义见 judgeReason 第 3 条）。
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);
});

test("ven-145-166: the descriptive trigger filter is rejected by the strict trigger validator", () => {
  const result = validateTriggerSpec(ability.trigger);
  assert.equal(result.ok, false);
  const codes = result.issues.map(issue => issue.code);
  // 描述性过滤键（playedCardTypes / energyCostAtLeast）不被严格 ObjectFilter 接受。
  assert.ok(codes.includes("unknown-field"), JSON.stringify(codes));
});

test("ven-145-166: body records 'exhaust me' then readies up to 2 runes without linkedTo", () => {
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "curator-of-the-sands.exhaust-self",
    "curator-of-the-sands.ready-runes"
  ]);
  // 355.10.c：费用里提到的对象不是目标；"exhaust me" 以非目标 choose 锚定来源自身。
  assert.equal(exhaustSelf.op, "effect.exhaust");
  assert.deepEqual(exhaustSelf.args, {
    choose: {
      kind: "constant",
      value: { id: "curator-of-the-sands.exhaust-self", filter: { object: "self" } }
    }
  });
  assert.equal(exhaustSelf.targets, undefined);
  assert.equal(exhaustSelf.picks, undefined);

  // “ready up to 2 runes”：355.12 / 355.13 的 up-to 选目标（可选任意数量，含 0）。
  assert.equal(readyRunes.op, "effect.ready");
  assert.deepEqual(readyRunes.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "curator-of-the-sands.runes" }
  });
  assert.deepEqual(readyRunes.args.amount, { kind: "constant", value: 2 });
  // 两条指令是「费用 → 效果」，不是链接依赖；本轮不写 linkedTo（exhaust 并不是被引用的结果）。
  assert.equal(readyRunes.linkedTo, undefined);
  assert.deepEqual(readyRunes.targets, [
    {
      id: "curator-of-the-sands.runes",
      filter: { type: "rune", zone: "rune-zone", controller: "self" },
      min: 0,
      max: 2,
      selection: "up-to"
    }
  ]);
});

// 执行说明：印刷的目标过滤器用 controller: "self"（能力控制者）占位，参考内核的
// ObjectFilter 不认识该占位（与其他卡 golden 同一限制），所以这里按 veiled-temple /
// piltover-enforcer 的做法用 runInstruction 驱动已合入的 effect.ready 原语，并把
// Finalize 锁定的目标直接交给内核（355.12）。目标解析属目标管线（RIFT-90），见 test.todo。
const runeKernel = () =>
  world().unit("curator-of-the-sands", { types: ["legend"], zone: "board" }).build();

test("ven-145-166 golden: 'ready up to 2 runes' readies the locked runes", () => {
  const kernel = runeKernel();
  kernel.addObject(runeSnapshot("r1", true), "rune-zone");
  kernel.addObject(runeSnapshot("r2", true), "rune-zone");
  kernel.addObject(runeSnapshot("r3", true), "rune-zone");

  const run = runInstruction(
    ready,
    { objects: readyRunes.args.objects, amount: readyRunes.args.amount },
    {
      world: kernel,
      targets: {
        "curator-of-the-sands.runes": [kernel.ref("r1"), kernel.ref("r2")]
      }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("r1").exhausted, false);
  assert.equal(kernel.getObject("r2").exhausted, false);
  // 未被选中的第三枚符文不受影响（up-to 的锁定量是上限）。
  assert.equal(kernel.getObject("r3").exhausted, true);
  assert.deepEqual(kernel.events.map(event => event.action), ["ready", "ready"]);
  assert.deepEqual(run.linked.readied, {
    count: 2,
    objects: [kernel.ref("r1"), kernel.ref("r2")]
  });
});

test("ven-145-166 golden: a rune that is already ready is not readied again (416.1.b)", () => {
  const kernel = runeKernel();
  kernel.addObject(runeSnapshot("r1", false), "rune-zone");
  kernel.addObject(runeSnapshot("r2", true), "rune-zone");

  const run = runInstruction(
    ready,
    { objects: readyRunes.args.objects, amount: readyRunes.args.amount },
    {
      world: kernel,
      targets: {
        "curator-of-the-sands.runes": [kernel.ref("r1"), kernel.ref("r2")]
      }
    }
  );

  assert.equal(run.result.status, "executed");
  // 只有真正从横置变成就绪的那一枚计入 count 与事件。
  assert.deepEqual(kernel.events.map(event => event.action), ["ready"]);
  assert.deepEqual(run.linked.readied, { count: 1, objects: [kernel.ref("r2")] });
});

test("ven-145-166 golden: a stale rune target is ignored (359.3.e.7)", () => {
  const kernel = runeKernel();
  kernel.addObject(runeSnapshot("r1", true), "rune-zone");
  const stale = kernel.ref("r1");
  kernel.perform({ type: "banish", object: stale });

  const run = runInstruction(
    ready,
    { objects: readyRunes.args.objects, amount: readyRunes.args.amount },
    { world: kernel, targets: { "curator-of-the-sands.runes": [stale] } }
  );

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(kernel.events.map(event => event.action), ["banish"]);
});

test.todo(
  "ven-145-166: trigger condition 'with Energy cost :rb_energy_7: or more' — CR 206/206.1 reads the " +
    "printed / base Energy cost, but no event payload or ResolveContext entry exposes it " +
    "(engine batch 4 / contract change request)"
);
test.todo(
  "ven-145-166: the 'unit, gear, or activated ability' disjunction crosses card-played and " +
    "ability-activated; the activation producer is merged (RIFT-270), but one TriggerSpec still " +
    "subscribes to a single timing point"
);
test.todo(
  "ven-145-166: pay the leading 'exhaust me' as the trigger's base cost at Finalize (CR 383.3.b / " +
    "404.1.b.1 / 415.4-415.5) — TriggeredAbility has no cost field, and the production chain " +
    "adapter does not unwrap effect.exhaust's choose argument"
);
test.todo(
  "ven-145-166: the 'up to 2 runes' target selection at Finalize (355.12/355.13, including " +
    "choosing zero) and the controller: \"self\" placeholder resolution belong to the target " +
    "pipeline (RIFT-90); the golden test supplies the locked target group directly"
);
test.todo(
  "ven-145-166: whether a Rune target's zone filter is rune-zone or its controller's Base " +
    "(CR 107.1.c) needs the target pipeline to settle the location semantics"
);
