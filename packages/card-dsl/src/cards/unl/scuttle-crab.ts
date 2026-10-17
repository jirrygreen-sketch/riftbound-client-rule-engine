import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Scuttle Crab (unl-053-219) — Unit, 2 Energy、无印刷力量值，Might 0，Calm，
 * tag Bilgewater。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-053-219，逐字，含换行）：
 *   (Units with 0 :rb_might: can conquer and hold.)
 *   When you play me, draw 1.
 *   [Deathknell][>] Choose an opponent. They reveal their hand. You can look at
 *   their facedown cards this turn. Gain 1 XP. (When I die, get the effects.)
 *
 * 规则依据（CR v1.5）：
 * - 第一行是提醒文字（135.2.d.1/d.3）：0 Might 单位可以征服与固守是通则结果
 *   （470 的 Scoring 不要求 Might），不是本卡的独立能力，不写成指令。数据里 Might 为 0
 *   （不是 null、也不是省略），本程序不读取或改写该值。
 * - 383.4.a / 383.4.a.1："When you play me, draw 1." 是 Play Effect（时点 card-played，
 *   自身），body 是已合入的 effect.draw（414.1/414.3，抽牌者按 190.6.d 隐含为能力控制者）。
 * - 808 / 808.1.c："[Deathknell][>] …" 是触发式能力关键词，功能上等价于
 *   "When I die, [Effect]"；触发条件是载体被消灭并送入 Trash（429.1，时点 object-killed），
 *   括号内 "(When I die, get the effects.)" 是提醒文字。关键词展开归
 *   effects/keywords/Deathknell.ts，卡牌只声明 keyword 并显式写出印刷的 [Effect] 正文
 *   （ogn/watchful-sentry 同型）。
 * - 355.7 / 355.9.a："Choose an opponent" 指名一个 Player，属选目标；合并 IR 的
 *   TargetSpec.filter 是 ObjectFilter、ResolveContext.targets() 只返回 ObjectRef[]，
 *   没有玩家目标形态（ogn/mindsplitter、ogn/sabotage 记录同一缺口）。
 * - 425.1 / 425.2.a / 425.3.a："They reveal their hand" 是 Reveal 动作（未指明张数时
 *   展示该区域当时的全部牌），由已合入的 effect.reveal 执行；"their facedown cards"
 *   是同一玩家在 Facedown Zone 的牌（107.3.a/107.3.f、355.9.a.3），
 *   "You can look at" 是私下查看（128.4），由已合入的 effect.inspect 执行。
 * - 728 / 730.1："Gain 1 XP" 是玩家 XP 资源增加，由已合入的 effect.xp 执行
 *   （823.1.c.1 的 Hunt 同型写法）。
 *
 * status = judge-required：
 * 三处当前缺口：(1) Choose an opponent（CR 355.7/355.9.a）需要玩家目标/选择与后续 player 参数的链接绑定；
 * TargetSpec 与 ChoiceRequest 尚无玩家目标接口，target.player 仍是保留形状。(2) Facedown Zone（107.3.a/107.3.f）
 * 不在当前 ZoneId 中，effect.inspect 也不能表达 this turn 的持续查看权限（425.1.a.3）。
 * (3) Deathknell（808.1.c/808.1.d）展开仍引用 trigger.leave，且没有将卡牌正文接到该骨架的适配；
 * programs/filters.ts 未保留 cause / destination 的过滤语义。card-played 触发注册与 draw/reveal/xp 原语已合入。
 */

const abilities: Ability[] = [
  // 808.1：印刷的 [Deathknell] 声明；展开由 effects/keywords/Deathknell.ts 负责。
  { kind: "keyword", keyword: "deathknell" },
  {
    // 383.4.a："When you play me" 的 Play Effect。
    kind: "triggered",
    trigger: { at: "card-played", filter: { event: "card-played", filter: { source: "self" } } },
    optional: false,
    body: [
      {
        id: "scuttle-crab.draw-one",
        // 414.1/414.3："draw 1"，抽牌者缺省为能力控制者（190.6.d）。
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  },
  {
    // 808.1.c："When I die, [Effect]." 的印刷效果正文；触发条件是载体被消灭
    // （429.1，时点 object-killed；808.1.d.2/.d.3 的进链与最后已知信息归触发管线）。
    kind: "triggered",
    trigger: { at: "object-killed", filter: { self: true, cause: "kill", destination: "trash" } },
    optional: false,
    body: [
      {
        id: "scuttle-crab.choose-opponent",
        // 355.7 / 355.9.a："Choose an opponent" 是玩家目标；合并 IR 没有玩家目标形态
        // （见 judgeReason），此处按 ogn/mindsplitter 的 target.player 声明保留形状。
        op: "target.player",
        args: {
          selection: { kind: "constant", value: "one" },
          chooser: { kind: "constant", value: "controller" },
          linkKey: { kind: "constant", value: "chosenOpponent" }
        }
      },
      {
        id: "scuttle-crab.reveal-hand",
        // 425.3.a：未指明张数时展示该区域当时的全部牌；reveal 不改变区域（425.1.a.2）。
        op: "effect.reveal",
        linkedTo: "scuttle-crab.choose-opponent",
        args: {
          // "They" = 被选中的对手；玩家绑定本身是缺口（见 judgeReason），
          // 这里用同一条指令的链接值记录该占位，不写死座位。
          player: {
            kind: "linked-value",
            instructionId: "scuttle-crab.choose-opponent",
            key: "chosenOpponent"
          },
          zone: { kind: "constant", value: "hand" }
        }
      },
      {
        id: "scuttle-crab.look-facedown-cards",
        // 128.4 / 107.3.f："You can look at their facedown cards" 是私下查看该对手
        // 的面朝下牌。合并 ZoneId 没有 Facedown Zone（107.3.a），也没有 "this turn"
        // 的查看期限（425.1.a.3），故 zone 值只是待接线的描述性标记（见 judgeReason）。
        op: "effect.inspect",
        linkedTo: "scuttle-crab.choose-opponent",
        args: {
          player: { kind: "constant", value: "self" },
          zone: { kind: "constant", value: "facedown-zone" },
          scope: { kind: "constant", value: "zone" }
        }
      },
      {
        id: "scuttle-crab.gain-xp",
        // 730.1 / 733："Gain 1 XP"，获得者按 190.6.d 隐含为能力控制者；
        // XP 不是 Game Object（731），因此不写 target。
        op: "effect.xp",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-91762c9845d59867fb973e9ccacb4f75c8ba2a8d294513c8512d195dc2690d51",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处当前缺口：(1) Choose an opponent（CR 355.7/355.9.a）需要玩家目标/选择与后续 player 参数的链接绑定；" +
    "TargetSpec 与 ChoiceRequest 尚无玩家目标接口，target.player 仍是保留形状。(2) Facedown Zone（107.3.a/107.3.f）" +
    "不在当前 ZoneId 中，effect.inspect 也不能表达 this turn 的持续查看权限（425.1.a.3）。" +
    "(3) Deathknell（808.1.c/808.1.d）展开仍引用 trigger.leave，且没有将卡牌正文接到该骨架的适配；" +
    "programs/filters.ts 未保留 cause / destination 的过滤语义。card-played 触发注册与 draw/reveal/xp 原语已合入。",
  abilities,
  sourceText:
    "(Units with 0 :rb_might: can conquer and hold.)\n" +
    "When you play me, draw 1.\n" +
    "[Deathknell][>] Choose an opponent. They reveal their hand. You can look at their facedown cards this turn. " +
    "Gain 1 XP. (When I die, get the effects.)"
} satisfies CardProgram;
