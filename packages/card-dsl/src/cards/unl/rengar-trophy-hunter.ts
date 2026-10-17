import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Rengar, Trophy Hunter (unl-120-219) — Unit，能量 5，力量 1，Might 6，领域 Body，
 * 标签 Cat/Rengar/Ixtal/Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-120-219，逐字）:
 *   "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
 *   "I can be played to a battlefield where there are enemy units (even if you don't have units there)."
 *
 * 规则依据（CR v1.5）:
 * - [Ambush]：822.1.a-d 的被动能力关键词，822.1.b 给出功能等价文本（可打到你有单位的
 *   战场，且该次打出期间具有 [Reaction]），822.1.c 给 349 的打出流程增加合法位置，
 *   822.2 冗余。提醒文字是提醒文本（135.2.d.3）。
 * - 第二句是 822.1.d 明文点名的形态："Ambush can also appear as a verb on a card … the
 *   verb is taken to mean “play with the permissions of the Ambush keyword.”"，规则原文的
 *   例子正是本卡（"Example: Rengar, Trophy Hunter reads in part “I can [Ambush] to a
 *   battlefield where there are enemy units, even if you don't have units there.” This
 *   ability expands the normal permissions of the Ambush keyword to include battlefields
 *   where there are enemy units."）。它是打出位置许可（349、355.2.b；355.2.a 的默认位置
 *   只有控制者的 Base 与其控制的战场），不是触发能力，也不是替换。
 * - 契约 3.1 的 play 能力只有 restriction（限制）字段，没有许可字段，故按同类先例
 *   （sfd/rengar-pouncing 的 static + ContinuousEffect、ogn/sneaky-deckhand 的
 *   play-location-permission、sfd/dauntless-vanguard）表达。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。自本程序初写后合入的依赖：
 * Ambush 的 KeywordDef（RIFT-266，keywords/Ambush.ts 发布 play-location-permission 与
 * continuous.timing 两条声明）。
 *
 * 仍缺三处（不近似实现）：
 * 1. [Ambush] 的两条展开都没有消费方：play-location-permission / continuous.timing 的
 *    图层注册不改变 Finalize 的合法位置校验，chain.canAct() 也不读图层的时机授予。
 * 2. 本卡的 static play-location-permission 没有消费方：该 effect kind 在 engine-core 内
 *    只出现在卡数据与连续效果注册里，Finalize 的合法位置校验不读它。
 * 3. "where there are enemy units" 需要“该战场存在敌方单位”的谓词：已合入的 ObjectFilter
 *    锚点没有位置占用/敌我计数维度，本程序用 battlefield: { enemyUnits: true } 的占位键
 *    保留印刷作用域，不把它当成已可求值。
 * 本卡没有已合入的指令原语，因此没有执行类 golden 用例；golden 只做校验、身份与结构断言。
 *
 * 数据问题（不改数据，仅上报）：本卡的 alternate 印刷（unl-120a-219）与 ven-179-166 的
 * 原文是 "I can be played to a battlefield where there are enemy units."，主印刷
 * unl-120-219 多出 "(even if you don't have units there)"；RIFT-42 的复核
 * （docs/plans/survey/unclassified-unl.md 第 16 行）把该差异记为待统一的官方勘误项
 * （data-issue：官方勘误把第二句改成动词 Ambush 的新文本）。
 */
const abilities: Ability[] = [
  // 822：印刷的 [Ambush] 关键词声明（展开依赖未合入的 Ambush 关键词任务）。
  { kind: "keyword", keyword: "ambush" },
  {
    kind: "static",
    effect: {
      // 822.1.d：以动词形式扩展 Ambush 的默认许可——把“有敌方单位的战场”加入
      // 本单位的合法打出位置（即使那里没有己方单位）。
      kind: "play-location-permission",
      value: {
        kind: "constant",
        value: {
          zone: "battlefield",
          battlefield: { enemyUnits: true, requiresFriendlyUnits: false },
          appliesTo: "self"
        }
      },
      duration: "while-in-hand"
    }
  }
];

export default {
  canonicalCardId:
    "card.hash-7af45bc5485b4630b0159d3ebb543753b28e1c439f0bdccf266c500a9d157088",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) [Ambush] 的 KeywordDef 已合入（RIFT-266），但它发布的两条声明仍无消费方：" +
    "合法位置许可（822.1.b/822.1.c、355.2.b）不改变 Finalize 的合法位置校验，“被 Ambush 打出期间具有 [Reaction]”的 " +
    "continuous.timing 授予也不被 chain.canAct() 读取。" +
    "(2)「I can [Ambush] to a battlefield where there are enemy units」（822.1.d 的动词形态，规则原文的例子就是本卡）" +
    "是 static play-location-permission（349、355.2.b），但该 effect kind 在 engine-core 内只出现在卡数据里，" +
    "layers 引擎不处理打出位置许可，Finalize 的合法位置校验也不读它。" +
    "(3)「where there are enemy units」需要“该战场存在敌方单位”的谓词：已合入的 ObjectFilter 锚点没有位置占用/敌我计数维度，" +
    "本程序用占位键记录该条件，不求值。依赖：打出位置许可的 Finalize 接线与 continuous.timing 的时机消费方。",
  abilities,
  sourceText:
    "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
    "I can be played to a battlefield where there are enemy units (even if you don't have units there)."
} satisfies CardProgram;
