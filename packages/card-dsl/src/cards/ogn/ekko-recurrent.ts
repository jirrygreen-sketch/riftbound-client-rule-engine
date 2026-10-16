import type { CardProgram } from "../../ir/index.js";

/**
 * Ekko, Recurrent (ogn-110-298) — Unit, 5 energy + 1 Mind power, Might 5。
 *
 * 原文：[Accelerate] (You may pay :rb_energy_1::rb_rune_mind: as an additional
 * cost to have me enter ready.)
 *      [Deathknell] — Recycle me to ready your runes. (When I die, get the effect.)
 *
 * 规则依据（CR v1.5）：
 * - [Accelerate]：805 的可选附加费用关键词。卡片只声明 keyword（契约 3.1 / 3.7）；
 *   展开（cost.additional + replacement.enter）由 effects/keywords/Accelerate.ts 负责。
 * - [Deathknell]：808.1.c 功能上等于 "When I die, [Effect]"；808.1.d / 429.1.a.1.b
 *   说明自身死亡触发在送入 Trash 前作为 Pending Item 进链（时点 object-killed）；
 *   808.1.d.1 由替代效果处理“未被送入 Trash 则不触发”。关键词展开由
 *   effects/keywords/Deathknell.ts 负责，本文件按 README 第 5 节的先例
 *   （unsung-hero / ferrous-forerunner）额外写出等价效果本体。
 * - 383.3.b："Recycle me to ready your runes" 是效果开头的 "cost within
 *   instructions"，"recycle me" 因此是该触发能力的基础费用，必须在 Finalize
 *   支付成功后该能力才进链。冻结 IR 的 triggered ability 没有 cost 字段
 *   （契约 3.1 只有 activated 有 cost）；chain/engine.ts 的 TriggerRegistration 预留
 *   了 "Parsed leading costs and choices, supplied by the card-program adapter" 通道，
 *   因此此处按“首条指令 = 前导费用”的先例写出，由未合入的 card-program adapter 解析。
 * - "ready your runes"：416.1 就绪动作；Rune 在基地的 rune-zone（107.1）。
 *   集合查询用 query（355.10.d 的 "ready all …" 型无选择集合），不是 targets。
 *
 * 状态：judge-required。Accelerate 与 Deathknell 的 KeywordDef 已合入；仍缺
 * Accelerate 的费用/入场替代消费与 Deathknell 的 trigger.leave/事件链消费。
 * 效果本体（recycle me → ready your runes）已用已合入的 effect.recycle /
 * effect.ready 与解释器执行（见 golden）。
 *
 * 依赖：RIFT-257（KeywordDef/CardProgram 绑定）、RIFT-261（附加费用支付）、
 * trigger.leave 的事件链消费与入场替代管线（Accelerate 805.2.b）。
 */
const ekkoRecurrent = {
  canonicalCardId: "card.hash-20b19f69eca1bec8914d6f44145077493010be44bbcce72961eaa633e8a62bd2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Accelerate 与 Deathknell 的 KeywordDef 已注册，但 [Accelerate] 仍缺 cost.additional/cost.pay 的 Finalize 消费（RIFT-261）" +
    "与 805.2.b 入场就绪替代接线；[Deathknell] 仍缺 trigger.leave 的 object-killed 事件订阅、死亡被替代时移出链" +
    "（808.1.d.1）与进链前记录 last-known（808.1.d.3）。" +
    "另外 383.3.b 把「Recycle me」定义为该触发能力的基础费用，冻结 IR 的 triggered ability 无 cost 字段，" +
    "只能按“首条指令 = 前导费用”写出，等待 card-program adapter 解析。" +
    "效果本体本身可执行：effect.recycle（me）+ effect.ready（your runes）。" +
    "依赖：RIFT-257、RIFT-261、trigger.leave 事件链消费与入场替代管线。",
  abilities: [
    { kind: "keyword", keyword: "accelerate" },
    { kind: "keyword", keyword: "deathknell" },
    {
      kind: "triggered",
      trigger: {
        at: "object-killed",
        filter: { event: "object-killed", filter: { role: "self" } }
      },
      optional: false,
      body: [
        {
          // 383.3.b 的基础费用「Recycle me」：来源离场后由 chain 把 self 重绑到
          // 当前（Trash 中）的那张牌；静态 IR 里用契约 3.6 的 "self" 选择器。
          id: "ekko.recycle-me",
          op: "effect.recycle",
          args: {
            objects: { kind: "object-property", object: "self", property: "ref" }
          }
        },
        {
          id: "ekko.ready-runes",
          op: "effect.ready",
          linkedTo: "ekko.recycle-me",
          args: {
            objects: {
              kind: "constant",
              value: {
                kind: "query",
                filter: { zone: "rune-zone", type: "rune", owner: "controller" }
              }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_mind: as an additional cost to have me enter ready.)\n" +
    "[Deathknell] — Recycle me to ready your runes. (When I die, get the effect.)"
} satisfies CardProgram;

export default ekkoRecurrent;
