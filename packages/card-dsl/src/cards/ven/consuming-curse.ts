import type { CardProgram } from "../../ir/index.js";

/**
 * Consuming Curse（ven-010-166）— Spell，2 能量、无印刷力量，领域 Fury，标签 无。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，ven-010-166，逐字）：
 *   "[Action] (Play on your turn or in showdowns.)\nDeal 2 to a unit at a battlefield. This deals 1 Bonus Damage for each card with this name in your trash."
 *
 * 规则依据（Core Rules v1.5）：
 * - 「[Action]」是 806 的许可类关键词，卡文件只声明（展开归 keywords/Action.ts，契约 3.7）。
 * - 「Deal 2 to a unit at a battlefield」是 Deal 指令加目标限制（418.1、355.9.a.1、355.9.b、
 *   355.10.b：战场只是单位的限制，不成为目标）。来源缺省为法术本身（418.6.a）。
 * - 「This deals 1 Bonus Damage for each card with this name in your trash」是 418.4/418.5/713
 *   的 Bonus Damage 授予，数额按 132.1/132.3 的牌名计数：本卡在结算时按“控制者的 trash 中
 *   与本卡同名（Consuming Curse）的牌数 × 1”授予本次 Deal 动作（714 求和、715.1 单目标施加）。
 *   台账的 canonicalCardId 在本卡池里是 1:1（1080 个牌名 : 1080 个 canonical，无同名多 canonical），
 *   但 132.3 明确不同语言/印次视为同一牌名，所以语料级同名身份不能用 canonicalCardId 冒充。
 * - 已合入的 effect.damage 有 bonus 参数（714/715.2 的加总与施加），但按契约由“调用方传入的
 *   授予表达式”，原语自己不做授予（其文件头把这部分归持续效果/图层）。
 *
 * status = judge-required（缺口均不近似实现）：
 * 1. 计数谓词缺失：“与本卡同名”需要按牌名（CR 132）而不是 canonicalCardId / cardId 过滤，
 *    合并的过滤器词汇（layers/filter.ts 的 objectId/cardId/type/zone/location/controller/
 *    owner/states/tags/characteristics 与参考内核的 matchesFilter）没有 name 字段，也没有
 *    排除本卡自身的“同名且非本卡”语义；用 cardId 过滤会把 132.3 的跨印次/语言同名排除掉，
 *    属近似实现。
 * 2. 授予没有消费者：把该计数喂进本次 Deal 动作的 bonus 需要“对 Deal 动作授予 Bonus Damage”
 *    的持续效果/图层模型（同 ogn Void Gate / Annie, Fiery 的判定），当前没有已合入的注册路径。
 * 3. 卡牌程序 → 链的关键词/费用接线同其它批次（RIFT-120 注册通道已合入，卡牌侧接线仍缺）。
 * 已合入并真实执行：effect.damage 的 2 点基准伤害与 bonus 参数的 714/715.1 加总；golden 用
 * 解释器 + 参考内核演示 2 + N 的实际结算与 715.4（无伤害则不适用）边界。
 * 依赖：Bonus Damage 授予消费方（continuous 图层）与 name 谓词（见契约变更请求）。
 */
export default {
  canonicalCardId: "card.hash-eccd412b01dd63e0ce45a6b2789921b93b875f0321bcb6cea756edf8d23c9a71",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1)「for each card with this name in your trash」需要按 CR 132 的牌名计数" +
    "（132.3：不同印次/语言视为同一牌名），合并过滤词汇（layers/filter.ts 与参考内核）只有 objectId/cardId/type/zone/" +
    "location/controller/owner/states/tags/characteristics，没有 name 谓词与“同名且非本卡”的排除语义；" +
    "用 canonicalCardId 过滤会把 132.3 的同名跨印次排除掉。" +
    "(2) 把该计数喂进本次 Deal 动作需要“对 Deal 动作授予 Bonus Damage”的持续效果/图层消费方（418.4/418.5/713-715；" +
    "effect.damage 只对调用方传入的 bonus 表达式做加总），当前没有已合入注册路径（同 Void Gate / Annie, Fiery 判定）。" +
    "(3) 卡牌程序 → 链的关键词/费用接线（RIFT-120 注册通道已合入，卡牌侧接线仍缺）。" +
    "已合入并真实执行：「Deal 2 to a unit at a battlefield」的 effect.damage 与 bonus 的 714/715.1 加总、" +
    "715.4 的无伤害不适用，golden 用解释器 + 参考内核断言。依赖：Bonus Damage 授予消费方（continuous 图层）、" +
    "name 谓词（契约变更请求）。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      // 印刷基础费用：2 能量；catalog power 为 null（无印刷力量），不改写为 0。
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 }
      },
      body: [
        {
          // 「Deal 2 to a unit at a battlefield」：基准 2 点；Bonus Damage 的授予缺消费方（judgeReason 第 2 条）。
          id: "consuming-curse.deal-2",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 2 },
            target: { kind: "constant", value: "consuming-curse.battlefield-unit" }
          },
          targets: [
            {
              id: "consuming-curse.battlefield-unit",
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
    "Deal 2 to a unit at a battlefield. This deals 1 Bonus Damage for each card with this name in your trash."
} satisfies CardProgram;
