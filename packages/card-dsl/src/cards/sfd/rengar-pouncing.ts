import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Rengar, Pouncing (sfd-025-221) — Unit, Fury, Cat/Rengar/Ixtal/Champion.
 * energy 3, power 1 (Fury), Might 3.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-025-221，逐字，含换行）:
 *   "[Reaction] (Play any time, even before spells and abilities resolve, including to a battlefield you control.)\n"
 *   "[Assault 2] (+2 :rb_might: while I'm an attacker.)\n"
 *   "I can be played to a battlefield you're attacking."
 *
 * 规则依据（CR v1.5）:
 * - [Reaction]（813.1）：许可类关键词，只在卡文件里声明（契约 3.7）；其展开由
 *   effects/keywords/Reaction.ts 交给 continuous.timing 静态能力。
 * - [Assault 2]（807.1.b/807.1.c）：带数值的被动关键词，声明 `value: 2`；展开由
 *   effects/keywords/Assault.ts 负责，卡内不重写 +2 Might 逻辑。
 * - "I can be played to a battlefield you're attacking."：349/355.17.b 的打出位置
 *   许可——把「你正在攻击的战场」加入本单位的合法打出位置；同型已合入写法见
 *   sfd/dauntless-vanguard（"You may play me to an occupied enemy battlefield."），
 *   用 static + ContinuousEffect 表达（契约 3.1 的 play ability 只有 restriction，
 *   没有 permission 字段）。该静态效果的消费方（Finalize 的打出位置校验）尚未接线，
 *   且「你正在攻击的战场」需要攻击者与战场的关联谓词。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - [Reaction] 的展开（effects/keywords/Reaction.ts）只作为 continuous.timing 被图层
 *   记录，chain 的 canAct()（契约 3.5 的唯一时机许可查询）不读取图层许可；
 * - [Assault 2] 的 KeywordDef 已合入，但没有消费方把卡牌程序的 keyword 能力展开并
 *   注册进图层，图层也不读取 Attacker designation（ObjectSnapshot 无 combatRole/
 *   designation，契约 3.8 只冻结了字段设计）；
 * - 打出位置许可需要 static 消费方（Finalize 位置校验）与「正在攻击的战场」谓词。
 * 依赖：RIFT-81/85/91（关键词展开与图层消费）、链时机许可与 Finalize 位置校验接线、
 * 攻击者-战场谓词。不近似实现（不把许可写成 restriction，也不手改打出位置）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "reaction" },
  { kind: "keyword", keyword: "assault", value: 2 },
  {
    kind: "static",
    effect: {
      kind: "play-location-permission",
      value: {
        kind: "constant",
        value: {
          zone: "battlefield",
          battlefield: { attacking: true, controller: "controller" },
          appliesTo: "self"
        }
      },
      duration: "while-in-hand"
    }
  }
];

const program = {
  canonicalCardId: "card.hash-11c2deae61a7e5098515aef9a7b5595b0b6430fc0efebc22147404611ccebbc9",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "[Reaction]（813.1）与 [Assault 2]（807.1.b/.c）的关键词展开文件虽已合入（effects/keywords/Reaction.ts、Assault.ts），" +
    "但没有运行时消费方把卡牌程序的 keyword 能力展开并注册进图层：chain.canAct()（契约 3.5 的唯一时机许可查询）不读取 continuous.timing，" +
    "layers（RIFT-91）也不读取 Attacker designation（ObjectSnapshot 无 combatRole/designation，契约 3.8 只冻结了字段设计），" +
    "因此 [Assault 2] 的 +2 Might 与 [Reaction] 的任意时机打出都不可执行；" +
    "「I can be played to a battlefield you're attacking」是 static 打出位置许可（349、355.17.b），其 static 消费方" +
    "（Finalize 位置校验）尚未接线，且「你正在攻击的战场」需要攻击者-战场关联谓词。" +
    "依赖：RIFT-81（kw-assault-shield）、RIFT-85（kw-reaction 等时机关键词）、RIFT-91（layers-continuous）、" +
    "链时机许可与 Finalize 位置校验接线。不近似实现（不把手牌许可写成 restriction，也不手改打出位置）。",
  abilities,
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve, including to a battlefield you control.)\n" +
    "[Assault 2] (+2 :rb_might: while I'm an attacker.)\n" +
    "I can be played to a battlefield you're attacking."
} satisfies CardProgram;

export default program;
