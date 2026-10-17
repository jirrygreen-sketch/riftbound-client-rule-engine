import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Blood Rose (unl-109-219) — Gear, Body。
 * energy 1、power null（无印刷 Power）、might null（无印刷 Might）、tags []。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-109-219，逐字）：
 *   When you play a unit, you may pay :rb_energy_1: to gain 1 XP.
 *   Spend 3 XP, :rb_exhaust:: Ready a unit.
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a.4：When you play a unit 不是 Play Effect，而是「另一对象被打出」的触发能力；
 *   时点取封闭表的 card-played，事件对象是刚打出的单位（you play 由能力控制者判定，
 *   同批 unl/pridestalker 的既有写法）。
 * - 383.3.a / 383.3.b / 383.3.b.1：you may pay :rb_energy_1: to gain 1 XP 的 you may 出现在
 *   效果首位，紧跟其后的费用（1 Energy）因此被视为该触发能力的基础费用：只有支付后才会把该
 *   触发能力 Finalize 到链上。契约 3.1 的 TriggeredAbility 没有 cost 槽位，Finalize 的收费
 *   管线也未接通（同 sfd/hall-of-legends 记录）。契约 3.9 要求 may 写成 choice.optional 把被选
 *   指令包在 body 里，这里按该形状保留「接受 → 支付 → 获得 XP」的完整顺序，不加第二道门控。
 * - 204.3.a / 205：效果内的费用在结算时支付，由已合入的 cost.pay 表达；但本句的费用紧跟
 *   触发效果开头的 may，按 383.3.b 仍必须作为触发能力基础费用在 Finalize 支付。
 * - 728-733：XP 是玩家资源；gain 1 XP = effect.xp（730.1）。
 * - 730.2 / 415.5 / 415.4 / 357.2：Spend 3 XP, :rb_exhaust: 是启动能力的费用
 *   （cost.xp 加「横置自身」）；横置费用必须能完成。
 * - 151 / 151.2：Gear 启动能力默认 Action 时机。
 * - 355.10.g 的例外只覆盖 legend；Ready a unit 指名一个由控制者选择的 Board 单位，
 *   因此是目标（355.9.b），不是 pick。
 * - 416.1 / 416.1.b / 416.1.c：Ready 是 416.1 的动作；已就绪的对象再次 Ready 不再发生任何事
 *   （golden 覆盖该边界）。
 *
 * status = judge-required（README 第 2 节，2026-10-17 复核）：第一条触发能力仍缺 383.3.b 的触发式能力
 * 基础费用接线：TriggerRegistration.cost/mayAtFinalize 已存在且 chain/engine 在 Finalize 消费它们，
 * 但 programs/triggers.ts 只搬运 body/optional/spec，不把 choice.optional 里的 cost.pay 提取成
 * TriggerRegistration.cost（实测该触发的 registration.cost === null、mayAtFinalize === null），
 * 契约 3.1 的 TriggeredAbility 也没有 cost 字段；Finalize 无法在把能力放上链前收取 1 Energy。
 * cost.pay 本体已合入，但不能用结算期指令替代该基础费用语义，整卡不能标记 executable。
 * 第二条启动能力的费用（3 XP + 横置）与 effect.ready 本体都已合入，golden 真实执行该半段
 * （费用计划可支付 + 真实 Ready 动作），并按 README 4.4 把缺依赖写成 TODO。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      // you play a unit：事件对象是刚打出的单位，且由能力控制者控制
      // （190.6.d 的隐含 you；同批 unl/pridestalker 的写法）。
      filter: { event: "card-played", object: { type: "unit", controller: "self" } }
    },
    // 383.3.a 的是否执行该触发能力与 383.3.b 的基础费用在契约 3.1 的 TriggeredAbility 里都
    // 没有可执行槽位（见 judgeReason），这里不额外加第二道 optional 门控，保持契约 3.9 要求的
    // 单一 may 决策点。
    optional: false,
    body: [
      {
        id: "blood-rose.may-pay-for-xp",
        op: "choice.optional",
        args: {
          prompt: { kind: "constant", value: "Pay 1 energy to gain 1 XP?" },
          body: {
            kind: "constant",
            value: [
              {
                id: "blood-rose.pay",
                op: "cost.pay",
                args: {
                  // The primitive accepts a finalized scalar payment plan. The
                  // TriggeredAbility base-cost slot is still missing, so this
                  // remains a descriptive body step until that contract exists.
                  payments: { kind: "constant", value: { energy: 1 } }
                }
              },
              {
                id: "blood-rose.gain-xp",
                op: "effect.xp",
                // pay ... to gain 1 XP：支付是获得 XP 的前提，跟随支付指令
                // （同 sfd/sunken-temple、sfd/hall-of-legends 的合并写法）。
                linkedTo: "blood-rose.pay",
                args: { amount: { kind: "constant", value: 1 } }
              }
            ]
          }
        }
      }
    ]
  },
  {
    kind: "activated",
    timing: "action",
    cost: {
      kind: "activated",
      payments: [
        // 730.2：Spend 3 XP 是玩家资源费用（cost/plan-values.ts 的 xp 分量）。
        { kind: "xp", amount: { kind: "constant", value: 3 } },
        // 415.5：:rb_exhaust: 代表 Exhaust this。
        { kind: "exhaust" }
      ]
    },
    body: [
      {
        id: "blood-rose.ready-unit",
        op: "effect.ready",
        args: {
          objects: {
            kind: "constant",
            value: { kind: "target", id: "blood-rose.unit" }
          }
        },
        targets: [
          {
            id: "blood-rose.unit",
            filter: { zone: "board", type: "unit" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-ba305afc626a1b8699b28237b162d74c5c553675696baec7c3488296aa55cdf6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "第一条触发能力仍有一个当前缺口，且不近似实现：383.3.b / 383.3.b.1 规定" +
    "「When you play a unit, you may pay :rb_energy_1: to gain 1 XP.」里紧跟 you may 的费用是该触发能力的基础费用" +
    "（只有支付后才会 Finalize 到链上）；TriggerRegistration.cost/mayAtFinalize 已合入且 chain/engine 在 Finalize 消费它们，" +
    "但 programs/triggers.ts 只搬运 body/optional/spec，不把 body 内嵌的 cost.pay 提取成 TriggerRegistration.cost" +
    "（实测该触发的 registration.cost === null、mayAtFinalize === null），契约 3.1 的 TriggeredAbility 也没有 cost 槽位。" +
    "cost.pay 指令本体与 CardProgram 的 triggered 注册已经合入，但不能替代触发能力的基础费用接线。" +
    "第二条启动能力已可用：3 XP 加横置的费用由合并费用管线支付，effect.ready 提交 416.1 的 Ready 动作；" +
    "golden 真实执行该半段。",
  abilities,
  sourceText:
    "When you play a unit, you may pay :rb_energy_1: to gain 1 XP.\n" +
    "Spend 3 XP, :rb_exhaust:: Ready a unit."
} satisfies CardProgram;
