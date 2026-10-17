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
 * status = judge-required：Hunt 的展开与触发翻译已合入，但仍有四类缺口：
 * - Hunt 展开产生 event: conquer/hold，而 EventPattern 的校验枚举只收 conquered/held；
 *   虽然 matcher 有别名映射，registerTrigger 仍先拒绝该过滤器，不能真实注册。
 * - turn/flow.ts 的 Score 波只携带 player + details.battlefieldId，没有单位对象；
 *   Hunt 的翻译过滤器绑定 objectId，因此还缺把 Hold/Conquer 归属到在场单位的事件匹配
 *   （383.4.c.2.a / 383.4.d.2.a、823.1.c.1）。golden 分别验证翻译和 XP 原语，不能证明端到端 Hunt。
 * - play-location-permission 没有 static layer mapping，也未被 Finalize 的合法打出位置查询消费。
 * - occupied/enemyUnitAlone 仍是描述性条件，未接入 170.11.a / 740.2.a 的位置占用谓词。
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
    "四处当前缺口：(1) Hunt 的 KeywordDef 与触发翻译已合入，但展开过滤器的 event: conquer/hold" +
    "不在 EventPattern 校验枚举中（只收 conquered/held）；matcher 的别名映射发生在注册校验之后，registerTrigger 仍拒收。" +
    "(2) turn/flow.ts 的 Score 波" +
    "只携带 player + details.battlefieldId，没有单位 object；Hunt 翻译过滤器则是该单位的 objectId。" +
    "仍缺 383.4.c.2.a/383.4.d.2.a、823.1.c.1 要求的在场单位 Conquer/Hold 事件归属。" +
    "(3) play-location-permission 没有 static layer mapping，Finalize 的 playLocations 查询也没有消费这两条 355.2.b 许可。" +
    "(4) occupied/enemyUnitAlone 条件没有 170.11.a/740.2.a 的位置占用与同位置友方单位计数求值。" +
    "依赖：Hunt 事件过滤器枚举对齐、单位 Conquer/Hold 事件匹配、play-location-permission 绑定/消费（位置选择 RIFT-357），" +
    "以及 occupied/alone 谓词（RIFT-359）。",
  abilities,
  sourceText:
    "[Hunt 2] (When I conquer or hold, gain 2 XP.)\n" +
    "I can be played to an occupied battlefield if an enemy unit is alone there.\n" +
    "Friendly units can be played to an occupied battlefield if an enemy unit is alone there."
} satisfies CardProgram;
