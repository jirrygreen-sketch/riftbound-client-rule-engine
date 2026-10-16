import type { CardProgram } from "../../ir/index.js";

/**
 * Thrill of the Hunt (unl-184-219) — Spell, 2 energy + 1 power, Fury/Body,
 * tags Rengar / Signature.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-184-219，逐字）：
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)\n"
 *   "Banish a friendly unit, then its owner plays it to any battlefield, ignoring its cost."
 *
 * 规则依据（CR v1.5）：
 * - [Reaction]（813.1 / 813.1.c）是许可类关键词，卡牌只声明，展开属关键词注册表
 *   （契约 3.7）与 chain 的 canAct（契约 3.5）。
 * - "Banish a friendly unit"：名字化的 Board 单位在公开区域（355.7 / 355.9.a.1、
 *   355.10.a），且必须是本能力控制者的单位（355.9.b），因此是目标；
 *   effect.banish（428.1）提交封关闭合集合里的 banish 动作。
 * - "then its owner plays it"："its" / "it" 指被放逐的那张牌（359.3.e.14 的链接指令），
 *   其 124/428.3 的新引用由 banish 回执给出（不允许复活旧引用）；打出者是该牌的拥有者
 *   （359.3.e.13 的回看允许读刚离区对象的最后已知信息）。
 * - "to any battlefield"：目的地由拥有者在 355.4 / 355.4.a 选择一个合法 Location
 *   （单位当前地点以外的战场），属运行期 Location 选择。
 * - "ignoring its cost"：356.1.b / 356.1.b.1 把该牌的基础 Energy 与基础 Power 费用
 *   置零（356.6 的 0 下限、356.1.b.3 保留后续附加费用）。
 *
 * status = judge-required（不近似实现，与 ogn/portal-rescue 同一缺口）：
 * 1. "ignoring its cost" 缺费用改写生产者：已合入的 effect.play 明确要求 cost 参数是
 *    费用系统产出、已 Finalize 的 FinalizedCostPlan，它不推导印刷费用、也不实现忽略
 *    费用规则，因此按印刷费用打出会错误（依赖 RIFT-89）。
 * 2. "to any battlefield" 缺运行期 Location 选择器：契约 3.6 的 ObjectSelector 只有
 *    self/source/target/pick/linked，effect.play 的 location 只接受 base/battlefield
 *    字面量，本卡保留描述性目的地标记，解释器会拒绝该形状（fail-closed）而不是落到
 *    错误地点（依赖 RIFT-90 / RIFT-91）。
 * 3. 打出者是"its owner"：程序用 banish 目标的最后已知 owner 表达（359.3.e.13），
 *    该表达式本身已可求值，但只有第 1、2 点解决后才能整卡执行。
 */

/** 描述性目的地标记，不是可执行 LocationRef（见 judgeReason 第 2 点）。 */
const ANY_BATTLEFIELD = {
  kind: "destination-selector",
  filter: { type: "battlefield" }
} as const;

export default {
  canonicalCardId: "card.hash-4b33571613158dd1d158236b2c187a229657ed9ca2de150f5954357de9230ddb",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1) “ignoring its cost” 缺费用改写生产者：CR 356.1.b / 356.1.b.1 把该牌的基础 Energy 与基础 Power 费用置零" +
    "（356.6 的 0 下限、356.1.b.3 保留后续附加费用），而冻结的 CostSpec 没有 ignore/替代费用字段，已合入的 effect.play 明确要求 cost 参数是" +
    "费用系统产出、已 Finalize 的 FinalizedCostPlan，它不推导印刷费用、也不实现忽略费用规则（依赖 RIFT-89）。" +
    "(2) “to any battlefield” 是运行期 Location 选择（355.4 / 355.4.a）：合并 IR 没有运行期 Location 选择器，effect.play 的 location 只接受 " +
    "base/battlefield 字面量，本卡只保留描述性目的地标记，解释器会拒绝这个形状而不是把单位放到错误地点（依赖 RIFT-90 / RIFT-91）。" +
    "banish 半段（effect.banish，428.1）与打出者 “its owner” 的最后已知读取（359.3.e.13）可用，golden 真实执行 banish 并断言 play 半段按 fail-closed 被否定。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          id: "thrill-of-the-hunt.banish-friendly-unit",
          op: "effect.banish",
          args: {
            objects: {
              kind: "constant",
              value: { target: "thrill-of-the-hunt.friendly-unit" }
            },
            amount: { kind: "constant", value: 1 },
            linkKey: { kind: "constant", value: "banished" }
          },
          targets: [
            {
              id: "thrill-of-the-hunt.friendly-unit",
              filter: { type: "unit", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // “then its owner plays it to any battlefield, ignoring its cost”
          // （420.3 / 420.3.a 的 Limited Action Play；359.3.e.14 的链接指令）。
          // 被放逐牌的新引用只从 banish 回执取（124 / 428.3），打出者读目标的
          // 最后已知 owner（359.3.e.13）。
          id: "thrill-of-the-hunt.play-to-battlefield",
          op: "effect.play",
          linkedTo: "thrill-of-the-hunt.banish-friendly-unit",
          args: {
            object: {
              kind: "linked-value",
              instructionId: "thrill-of-the-hunt.banish-friendly-unit",
              key: "banishedObject"
            },
            player: {
              kind: "object-property",
              object: { target: "thrill-of-the-hunt.friendly-unit" },
              property: "owner"
            },
            location: { kind: "constant", value: ANY_BATTLEFIELD },
            // “ignoring its cost”（356.1.b.1 / 356.6）：记录所需费用改写的
            // 描述性形状，尚未 producer 化（见 judgeReason 第 1 点）。
            cost: {
              kind: "constant",
              value: {
                kind: "cost.modify",
                base: "printed",
                ignore: ["energy", "power"],
                minimum: 0,
                finalized: false
              }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Banish a friendly unit, then its owner plays it to any battlefield, ignoring its cost."
} satisfies CardProgram;
