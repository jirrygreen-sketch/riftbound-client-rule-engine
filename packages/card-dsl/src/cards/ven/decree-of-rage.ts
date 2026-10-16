import type { CardProgram } from "../../ir/index.js";

/**
 * Decree of Rage（ven-015-166）— Spell，1 能量 + 1 点 Fury 力量，领域 Fury，标签 无。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，ven-015-166，逐字）：
 *   "[Action] (Play on your turn or in showdowns.)\nThis can't be countered.\nDeal 4 to an enemy Calm (:rb_rune_calm:) unit."
 *
 * 规则依据（Core Rules v1.5）：
 * - 「[Action]」是 806 的许可类关键词，卡文件只声明（展开归 keywords/Action.ts，契约 3.7）。
 * - 「This can't be countered」是 054（“Can’t beats Can”）式的静态禁止，禁止对象是 426 的
 *   Counter 动作本身：426.2 规定 Counter 只在游戏效果指示时可用，因此本句是对“能否被 426
 *   指示的 Counter 动作选中/结算”的限制。它不是触发、不是替代、也不是结算期的指令，
 *   所以按静态持续效果（调研表第 27 项 continuous.restrict 家族）声明，作用对象是“本卡自身”。
 * - 「Deal 4 to an enemy Calm (:rb_rune_calm:) unit」是 Deal 指令（418.1）加两条目标限制
 *   （355.9.b）：控制者是能力控制者的对手（player selector 的 opponent 语义），且该单位的
 *   领域包含 Calm（134.1：卡牌属于一个或多个领域，领域是卡牌特征）。来源缺省为法术本身
 *   （418.6.a），伤害非战斗（418.1.c）。
 *
 * status = judge-required（两处缺口，均不近似实现）：
 * 1. “不能被反击”没有消费方：链的 Counter 路径（chain/engine.ts 对 {type:"counter"} 的处理
 *    与 effect.counter 原语）只检查目标是否仍在 Chain 上，不读取任何“不可被反击”声明；
 *    也没有注册的 continuous.restrict 指令原语（effects/instructions/ 只有 effect.* 文件），
 *    054.1 的“禁止优于许可”因此无法落地。若省略该句，本卡会被错误地允许被反击。
 * 2. “Calm 单位”的目标限制不可表达：合并的过滤器词汇（layers/filter.ts 的 objectId/cardId/
 *    type/zone/location/controller/owner/states/tags/characteristics 与参考内核的 matchesFilter）
 *    没有 domain / domains 谓词；ObjectSnapshot 只把 power 作为“力量费用域列表”暴露
 *    （契约 3.6），它不是 134 的卡牌领域，用 power 过滤会把 0 力量费用的 Calm 单位（catalog
 *    中 Calm 且 power: null 的单位有 52 个）全部漏掉，属近似实现，故只记录描述性谓词
 *    characteristics.domains（匹配器不识别 ⇒ fail-closed，不会伤害错误的单位）。
 * 已合入并真实执行：「Deal 4」的 effect.damage 本体与 355.9.b 的控制者限制方向；golden 用
 * 解释器 + 参考内核以锁定目标真实执行 4 点伤害与目标失效分支。
 * 依赖：RIFT-90/RIFT-91 之后的“不可被反击”限制消费方与领域谓词（见契约变更请求）。
 */
export default {
  canonicalCardId: "card.hash-04c50ac19d094543330b995ad389879feae4cb9a688c51fa00317e7c72c11ae0",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1)「This can't be countered」没有消费方——054 的禁止需要被链的 Counter 路径读取" +
    "（426.2 规定 Counter 只在游戏效果指示时可用，426 的结算在 chain/engine.ts 与 effect.counter 原语里只检查目标是否仍在 Chain 上），" +
    "而 effects/instructions 没有注册的 continuous.restrict 指令原语（只有 effect.* 文件），" +
    "也没有任何内核代码读取“不可被反击”声明；省略该句会让本卡违反 054.1 被允许反击。" +
    "(2)「an enemy Calm unit」的领域限制不可表达：合并过滤词汇（layers/filter.ts 与参考内核 matchesFilter）没有 domain/domains 谓词，" +
    "ObjectSnapshot 只把 power 暴露为“力量费用的域列表”（契约 3.6），它不是 134 的卡牌领域——用 power 过滤会漏掉 Calm 且 power:null 的单位" +
    "（本地 catalog 有 52 个），属近似实现；程序只记录描述性谓词 characteristics.domains，匹配器不识别该键，因此 fail-closed（不会伤害错误单位）。" +
    "已合入并真实执行：「Deal 4」的 effect.damage（418.1/418.6.a）与 opponent 控制者限制，golden 用解释器 + 参考内核执行并覆盖 359.3.e 的目标失效分支。" +
    "依赖：不可被反击的限制消费方与领域谓词（见契约变更请求）。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      // 「This can't be countered」：静态禁止（054.1），无已合入消费方（见 judgeReason 第 1 条）。
      kind: "static",
      effect: {
        kind: "continuous.restrict",
        restriction: "cannot-be-countered",
        appliesTo: "self"
      }
    },
    {
      kind: "play",
      // 印刷基础费用：1 能量 + 1 点 Fury 力量。
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 1 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          // 「Deal 4 to an enemy Calm unit」：4 点非战斗伤害（418.1.c），来源缺省为法术本身（418.6.a）。
          id: "decree-of-rage.deal-4",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 4 },
            target: { kind: "constant", value: "decree-of-rage.enemy-calm-unit" }
          },
          targets: [
            {
              id: "decree-of-rage.enemy-calm-unit",
              // controller: "opponent" 是已合入的玩家选择器；characteristics.domains 是待接线的
              // 领域谓词占位（见 judgeReason 第 2 条），合并匹配器不识别该键，故不会误伤。
              filter: {
                type: "unit",
                zone: "board",
                controller: "opponent",
                characteristics: { domains: ["Calm"] }
              },
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
    "This can't be countered.\n" +
    "Deal 4 to an enemy Calm (:rb_rune_calm:) unit."
} satisfies CardProgram;
