import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Ravenborn Tome (ogn-032-298) — Gear, 3 Energy, Fury.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-032-298):
 *   :rb_exhaust:: The next spell you play this turn deals 1 Bonus Damage.
 *   (Each instance of damage the spell deals is increased by 1.)
 *
 * 规则依据（CR v1.5）：
 * - “:rb_exhaust:: …” 是 Gear 的启动能力（151、151.2，Action 时机），费用是横置自身。
 * - 规则 392 的示例直接点名本卡：“Ravenborn Tome reads ‘The next spell you play this
 *   turn deals 1 Bonus Damage.’ This is a Delayed Passive Ability that passively adds
 *   1 Bonus Damage to just the next spell played.” 因此这是延迟被动能力（392/393）。
 * - 712–715 是 Bonus Damage 本体规则：713/715 把 Bonus Damage 授予该次 Deal 动作，
 *   714 累加多个实例，715.2 让每个目标分别获得加成，715.4 未造成伤害则不适用。
 *   effect.damage 已实现 bonus 参数（“多个 bonus 由传入表达式先行加总”），但
 *   「本回合你打出的下一个法术」这个窗口与授予路径归延迟被动能力 / 图层。
 *
 * status = judge-required（复核 2026-10-17）：
 * - 仍然没有已注册原语消费 `ctx.registerDelayedTrigger`（契约 3.6 有该方法，
 *   chain/engine.ts 也有内部注册路径，但生效 registry 里没有 trigger.delayed 或
 *   continuous.bonus-damage 的 op），也没有把“下一次打出的法术”与该次 Deal
 *   动作关联的延迟被动能力管线（392 的 Delayed Passive Ability）；
 * - 已合入的 effect.damage 只接受调用方传入的 bonus 表达式（698），自己不做授予，
 *   拿一个静态 1 点 bonus 直接写进 instruction 就会对所有伤害生效，属近似实现；
 * - 「本回合」的到期依赖延迟能力到期（393、392 的 specified time）——图层的 duration
 *   注册表本身已合入（layers/duration.ts 支持 end-of-turn），但把 1 点 Bonus Damage
 *   授予“本回合你打出的下一个法术”并把授予结果接到那次 Deal 的管线仍缺失，因此到期
 *   也无从谈起。
 * 费用半段（横置自身）用已合入的 cost.exhaust 费用计划，golden 测试真实执行。
 */
const abilities: Ability[] = [
  {
    kind: "activated",
    cost: { kind: "activated", payments: [{ kind: "exhaust" }] },
    timing: "action",
    body: [
      {
        id: "ravenborn-tome.grant-bonus-damage",
        // “The next spell you play this turn deals 1 Bonus Damage.” — 392 明示的
        // Delayed Passive Ability：把 1 点 Bonus Damage 授予本回合你打出的下一个法术
        // （713/714/715）。消费方是延迟被动能力/图层管线，目前没有已注册原语
        // （见 judgeReason）。
        op: "continuous.bonus-damage",
        args: {
          amount: { kind: "constant", value: 1 },
          appliesTo: { kind: "constant", value: "next-spell-you-play" },
          duration: { kind: "constant", value: "end-of-turn" },
          scope: { kind: "constant", value: "each-instance" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-fed7336f370509d9739c01e6813a264dc909243982f13ef7bff71824fb66ee08",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺延迟被动能力的登记与消费：CR v1.5 392 的示例直接点名本卡（Delayed Passive Ability that " +
    "passively adds 1 Bonus Damage to just the next spell played），但生效的指令注册表里没有" +
    "任何消费 ctx.registerDelayedTrigger 的原语（契约 3.6 有该方法、chain/engine.ts 有内部注册路径，" +
    "但没有 trigger.delayed 或 continuous.bonus-damage 的注册 op），也没有把「本回合你打出的下一个法术」" +
    "与那次 Deal 动作关联的管线；effect.damage 只接受调用方传入的 bonus 表达式（714 / 715.2），自己不做授予，" +
    "把静态 1 点 bonus 写进 instruction 会对所有伤害生效，属近似实现（712–715）。图层的 duration 注册表" +
    "（layers/duration.ts 的 end-of-turn）已合入，但授予与关联管线缺失使到期也无从落地。" +
    "依赖：trigger.delayed / continuous.bonus-damage 的注册 op 与「下一个法术」关联管线" +
    "（链/事件接线已合入，这里缺的是该 op 本身）。" +
    "费用半段（横置自身）已用已合入的 cost.exhaust 费用计划真实执行。",
  abilities,
  sourceText:
    ":rb_exhaust:: The next spell you play this turn deals 1 Bonus Damage. " +
    "(Each instance of damage the spell deals is increased by 1.)"
} satisfies CardProgram;

export default program;
