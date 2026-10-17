import type { CardProgram } from "../../ir/index.js";

/**
 * Ruthless Strike（ven-008-166）— Spell，3 能量、无印刷力量，领域 Fury，标签 无。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，ven-008-166，逐字）：
 *   "[Action] (Play on your turn or in showdowns.)\nAs an additional cost to play this, you may discard 1.\nDeal 3 to a unit at a battlefield. If you paid the additional cost, deal 5 to it instead."
 *
 * 规则依据（Core Rules v1.5）：
 * - 「[Action]」是 806 的许可类关键词，展开为 continuous.timing 的 Showdown 许可由
 *   keywords/Action.ts 负责（806.1.b/806.1.c），卡文件只声明（契约 3.7）。
 * - 「As an additional cost to play this, you may discard 1.」是可选附加费用（356.2.b /
 *   356.2.b.1，在 355.1.a 于打出流程中决定并支付）；被弃的牌由该玩家从手牌选择，按
 *   355.10.a（手牌不是 Public）不指向目标，故用非目标 PickSpec 记录（355.10.c 同旨）。
 * - 「Deal 3 to a unit at a battlefield」是 Deal 指令（418.1）加目标限制：355.9.a.1 的
 *   “unit” 指 Board 上的单位，“at a battlefield” 只是该目标的合法性限制（355.9.b/355.10.b
 *   明确限制不会让战场本身成为目标）。来源缺省即描述该效果的法术（418.6.a），伤害非战斗
 *   （418.1.c）。「a unit」由玩家在 Finalize 选择（355.5.a 的同类示例），所以是 TargetSpec。
 * - 「If you paid the additional cost, deal 5 to it instead」：356.4.f.1 规定可选附加费用以
 *   “玩家做出了支付决定”为已支付凭证；本句同时是同一 Deal 动作的替代数额（CR 158.2 的
 *   指令级替代，原文 "instead"），因此不存在“先 3 后 5”的两次伤害。数额 3 与 5 是同一指令
 *   的互斥取值，本程序只写 3 的基准形状，不用两条 effect.damage 冒充。
 *
 * status = judge-required（三处缺口，均不近似实现）：
 * 1. 可选附加费用没有卡牌侧接线：cost.modify 原语已合入——optionalAdditional 通道真实执行，
 *    付费时产生 selectedAdditional 与真实 discard 动作、拒绝时写 declinedAdditional（RIFT-89
 *    batch3-cost-plan，golden 有执行证据）；但 programs/play.ts translateCost 仍把卡牌程序
 *    cost 里的 additional/additional-cost 字段判为 judge-required，费用决定无法在 Finalize
 *    落地，附加费也接不进被施放法术的合并费用计划。
 * 2. 没有费用结果绑定：“If you paid the additional cost” 需要 356.4.f.1 的支付凭证（调研记为
 *    condition.result，46 个身份），冻结 IR 的 Condition 只有 always/never/compare/all/any/
 *    not/expression，没有 paid / 费用结果谓词，也没有把费用收据写进链接值的原语。
 * 3. 同一 Deal 动作的“3 改为 5”是指令级替代（158.2），没有已合入的替代原语可以改写同一指令的
 *    数额；写成两条互斥的 effect.damage 会是两次不同的 Deal 动作（418.1.c 分别标记伤害），
 *    属于近似实现，故不写。
 * 已合入并真实执行的部分：effect.damage 的 3 点基准伤害与 [Action] 之外的目标形状；golden 用
 * 解释器 + 参考内核执行「a unit at a battlefield」的锁定目标伤害与目标失效分支。
 * 依赖：RIFT-89（可选附加费用与凭证）、契约级 condition.result 与指令级替代（RIFT-9 家族）。
 */
export default {
  canonicalCardId: "card.hash-40879a4051400736fda23ede8e39ad9da54a90ec93c7462a8297c7dbf55dee93",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) 可选附加费用没有卡牌侧接线：cost.modify 原语已合入，" +
    "optionalAdditional 通道真实执行——选中时写 selectedAdditional 并提交真实 discard 动作、拒绝时写 " +
    "declinedAdditional（RIFT-89 batch3-cost-plan，golden 有执行证据）；但 programs/play.ts translateCost " +
    "仍把卡牌程序 cost 里的 additional/additional-cost 字段判为 judge-required，356.2.b/356.2.b.1 的决定 " +
    "无法在 Finalize 落地，附加费也没有接进被施放法术的合并费用计划。" +
    "(2) 没有费用结果绑定：356.4.f.1 的「If you paid the additional cost」凭证在冻结 IR 没有对应谓词" +
    "（Condition 只有 always/never/compare/all/any/not/expression；调研记为 condition.result），" +
    "也没有把费用收据写入链接值的原语。" +
    "(3) 「deal 5 to it instead」是同一 Deal 动作的指令级替代（CR 158.2），没有已合入的替代原语改写同一指令数额；" +
    "两条互斥 effect.damage 是两次不同 Deal 动作，属近似实现，故不写。" +
    "已合入并真实执行：effect.damage 的 3 点基准伤害与「a unit at a battlefield」的目标/限制形状（355.9.a.1、355.9.b、355.10.b），" +
    "golden 用解释器 + 参考内核以锁定目标执行。依赖：RIFT-89（费用计划与凭证）、condition.result 与指令级替代（RIFT-9 家族）。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      // 印刷基础费用：3 能量；catalog power 为 null（无印刷力量），绝不改写为 0。
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 3 }
      },
      body: [
        {
          // 「Deal 3 to a unit at a battlefield」：基准数额（见 judgeReason 第 3 条，5 的替代不近似实现）。
          id: "ruthless-strike.deal-3",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 3 },
            target: { kind: "constant", value: "ruthless-strike.battlefield-unit" }
          },
          targets: [
            {
              id: "ruthless-strike.battlefield-unit",
              filter: { type: "unit", location: "battlefield", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "As an additional cost to play this, you may discard 1.\n" +
    "Deal 3 to a unit at a battlefield. If you paid the additional cost, deal 5 to it instead."
} satisfies CardProgram;
