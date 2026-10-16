import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Arachnoid Horror (unl-117-219) — Unit，能量 6，力量 1，Might 6，领域 Body，
 * 标签 Shadow Isles/Spider。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-117-219，逐字）:
 *   "[Hunt 2] (When I conquer or hold, gain 2 XP.)\n" +
 *   "I can be played to an occupied battlefield if an enemy unit is alone there.\n" +
 *   "Friendly units can be played to an occupied battlefield if an enemy unit is alone there."
 *
 * 规则依据（CR v1.5）:
 * - [Hunt 2]：823.1（触发式能力关键词，单位上的 Conquer 与 Hold 效果）、823.1.c.1
 *   （功能等价于 "When I Conquer or Hold, my controller gains X XP."）、823.1.c.3（Hunt
 *   Value）、823.2（多个 Hunt 数值相加）、823.3（可引用特征）。卡文件只声明数值 2
 *   （契约 3.1/3.7、README 第 5 节），展开归关键词注册表。
 * - 后两句是打出位置许可（349、355.2）：355.2.a 规定默认合法位置只有控制者的 Base 与
 *   其控制的战场；355.2.b 规定游戏效果可以把默认之外的位置变为合法。170.11.a 定义
 *   "occupied"（该战场有单位）；740.2.a 定义 "a unit is alone"（同一位置没有其他友方单位），
 *   所以 "an enemy unit is alone there" = 该战场有一个敌方单位且它是该敌方唯一的单位。
 *   契约 3.1 的 play 能力只有 restriction（限制）字段，没有许可字段，故按同类先例
 *   （sfd/dauntless-vanguard、ogn/sneaky-deckhand 的 play-location-permission 静态效果）
 *   表达：第一句只给本卡自己增加合法位置（while-in-hand），第二句是本卡在场期间给
 *   控制者的所有友方单位增加许可（while-on-board）。
 * - 提醒文字 "(When I conquer or hold, gain 2 XP.)" 是提醒文本（135.2.d.3），不另写能力。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。三处缺口，均不近似实现：
 * 1. [Hunt 2]（823）没有已合入的 KeywordDef："When I Conquer or Hold, my controller
 *    gains 2 XP" 需要 conquer / hold 时点（383.4.c/383.4.d，scoring/ 未接入唯一事件管线）
 *    与关键词展开接线（同 ogn/kaisa-survivor 的 conquer 触发缺口）。
 * 2. 两条 play-location-permission 没有任何消费方：engine-core 内只有卡数据声明该
 *    effect kind，layers 引擎不处理打出位置许可，Finalize 的合法位置校验也不读它
 *    （同 sfd/dauntless-vanguard、ogn/miss-fortune-buccaneer）。
 * 3. "an enemy unit is alone there" 的谓词没有求值路径：ObjectFilter 的锚点没有
 *    位置占用/孤立单位维度（740.2.a 需要“同位置没有其他友方单位”的计数），本程序
 *    用占位键记在许可的 effect value 里，不把它当成已可求值。
 * 本卡没有已合入的指令原语，因此没有执行类 golden 用例；golden 只做校验、身份与结构断言。
 */
const abilities: Ability[] = [
  // 823.1.c：Hunt 带数值（Hunt 2），展开由关键词注册表负责。
  { kind: "keyword", keyword: "hunt", value: 2 },
  {
    kind: "static",
    effect: {
      // 355.2.b：给本卡自己增加一个合法打出位置。
      kind: "play-location-permission",
      value: {
        kind: "constant",
        value: {
          zone: "battlefield",
          battlefield: { occupied: true, enemyUnitAlone: true },
          appliesTo: "self"
        }
      },
      duration: "while-in-hand"
    }
  },
  {
    kind: "static",
    effect: {
      // 355.2.b：本卡在场期间，控制者的友方单位都可以打到这样的战场。
      kind: "play-location-permission",
      value: {
        kind: "constant",
        value: {
          zone: "battlefield",
          battlefield: { occupied: true, enemyUnitAlone: true },
          appliesTo: "friendly-units"
        }
      },
      duration: "while-on-board"
    }
  }
];

export default {
  canonicalCardId:
    "card.hash-158f0c8fe09a511b90b88574669f5f31fbfc1742ef2b6dea8f7b903e7a448423",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1) [Hunt 2]（823）没有已合入的 KeywordDef：" +
    "「When I Conquer or Hold, my controller gains 2 XP」（823.1.c.1）需要 conquer/hold 时点（383.4.c/383.4.d）" +
    "与关键词展开接线，而 scoring/ 未接入唯一事件管线（RIFT-33/RIFT-120；同 ogn/kaisa-survivor）。" +
    "(2) 两条打出位置许可（349、355.2.b）没有任何消费方：play-location-permission 只出现在卡数据里，" +
    "layers 引擎不处理它，Finalize 的合法位置校验也不读它（同 sfd/dauntless-vanguard、ogn/miss-fortune-buccaneer）。" +
    "(3)「if an enemy unit is alone there」需要位置占用与孤立单位谓词（170.11.a 的 occupied；740.2.a 的 alone = 同位置无其他友方单位），" +
    "已合入的 ObjectFilter 锚点没有位置占用/同位置计数维度，本程序只用占位键记录该条件，不求值。" +
    "依赖：823 的 kw-hunt 展开、RIFT-33/RIFT-120 的 conquer/hold 发射、打出位置许可消费方。不近似实现。",
  abilities,
  sourceText:
    "[Hunt 2] (When I conquer or hold, gain 2 XP.)\n" +
    "I can be played to an occupied battlefield if an enemy unit is alone there.\n" +
    "Friendly units can be played to an occupied battlefield if an enemy unit is alone there."
} satisfies CardProgram;
