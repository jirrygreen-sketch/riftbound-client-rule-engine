import type { CardProgram } from "../../ir/index.js";

/**
 * Dune Surfer (ven-004-166) — Unit, Fury, tag Shurima.
 * energy 3, power: none printed, Might 3.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-004-166，逐字）：
 *   You ignore [Tank] while assigning combat damage here.
 *
 * 规则依据（Core Rules v1.5）：
 * - 764 / 765 / 766：Ignoring Effects 是指令玩家在执行某个游戏动作或流程时把某些能力
 *   视为无效；766 的官方例子之一正是「A unit reads "You ignore Backline while assigning
 *   combat damage here."」（/root/swarm-rift/shared/rules/CR-v1.5.txt:4929-4934）。
 * - 767：被忽略的能力只在被描述的那一次游戏动作/流程中、且只对能力指定的玩家无效
 *   （官方第二个例子：别的玩家在同一地点分配战斗伤害时不能忽略 Backline）。
 *   因此本卡的 "you" 是控制器，作用域是「在此地点分配战斗伤害」这一流程。
 * - 053.3 的 "here" 指来源当前所在的地点（CR 764 的单位例子即此用法）；具体位置在
 *   结算/流程执行时读取来源的当前 location。
 * - 815.1 / 815.1.b / 815.1.c.1 / 815.1.c.2 / 815.2 / 815.3：[Tank] 是要求「先给带
 *   [Tank] 的单位分配致命伤害」的被动关键词；本卡忽略的正是它的分配优先级要求。
 *
 * status = judge-required（三处依赖都不近似实现）：
 * 1. 没有 ignore-abilities 的执行路径：effects/instructions/ 下没有任何原语能注册
 *    「某流程内把某关键词实例视为无效」的持续效果，combat/ 的战斗伤害分配也不查询忽略集合
 *    （combat/base-combat-allocation.ts 明确记录 "No Tank/Backline/other assignment-priority
 *    requirement is bound here"，keywordPriority: "proven-none"），因此 766/767 的语义
 *    无消费方。
 * 2. [Tank] 自身的分配优先级也未实现（effects/keywords/Tank.ts 文件头记录
 *    continuous.combat 的消费方与致命优先顺序尚未合入），即使忽略落地也没有可忽略对象。
 * 3. 卡程序 static 效果没有注册进图层的入口（RIFT-91 只合入 layers 引擎本身）。
 * 依赖：ignore-abilities（CR 764–767）的原语与战斗分配消费方、Tank/Backline 的
 * continuous.combat 消费方（RIFT-9 / combat 工作流）、RIFT-91 的卡牌侧注册入口。
 * 本程序只按 764–767 声明持续忽略形状（作用域 + 地点 + 被指示的玩家），不改写战斗流程，
 * 也不把 [Tank] 当成数值修正。
 */
export default {
  canonicalCardId: "card.hash-572dcb865d6640670e3cbdd7514ab6e44f7696e56a23583ebf73ce45d2a69cb0",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处依赖未合入：(1) 没有 ignore-abilities 的执行路径——effects/instructions/ 下没有原语能注册「某流程内把某关键词实例" +
    "视为无效」的持续效果，combat/ 的伤害分配也不查询忽略集合（base-combat-allocation.ts 明确 " +
    "\"No Tank/Backline/other assignment-priority requirement is bound here\"、keywordPriority: \"proven-none\"），" +
    "766/767 的语义无消费方；(2)[Tank] 的 815.1.b 分配优先级本身也未实现（effects/keywords/Tank.ts 文件头记录 " +
    "continuous.combat 消费方未合入），即使忽略落地也没有可忽略的对象；(3) 卡程序 static 效果没有注册进图层的入口" +
    "（RIFT-91 只合入 layers 引擎）。依赖 ignore-abilities 原语与战斗分配消费方（RIFT-9 / combat 工作流）、RIFT-91 注册入口。" +
    "本程序只按 CR 764–767（官方单位 Backline 例子）声明作用域、地点与受限玩家，不近似实现分配流程。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.ignore-ability",
        // 766/767：只在「分配战斗伤害」这一流程内视为无效。
        operation: "combat-damage-assignment",
        // 815.1.b：被忽略的是 [Tank] 实例的分配优先级要求。
        ignores: ["Tank"],
        // 767：只对能力指定的玩家（本卡控制者）生效。
        players: "controller",
        // 053.3 / 766 的单位例子："here" 是来源当前所在地点。
        filter: {
          type: "unit",
          controller: "opponent",
          zone: "board",
          sameLocationAs: "self"
        }
      }
    }
  ],
  sourceText: "You ignore [Tank] while assigning combat damage here."
} satisfies CardProgram;
