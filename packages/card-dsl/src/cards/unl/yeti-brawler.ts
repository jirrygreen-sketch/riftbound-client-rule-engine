import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Yeti Brawler (unl-018-219) — Unit, 6 Energy, Might 6, Fury, tag Noxus.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-018-219，逐字）：
 *   "When I conquer, if you assigned 3 or more excess damage, play two Gold gear
 *    tokens exhausted. (They have \"[Reaction][>] Kill this, :rb_exhaust:: [Add]
 *    :rb_rune_rainbow:.\")"
 *
 * 规则依据（CR v1.5）：
 * - 383.4.c / 383.4.c.1："When I conquer" 是 Conquer Effect，时点用封闭表的 conquer
 *   （scoring/ 发出，ruleRefs 468.5.d / 471.1 / 473.2.a）。
 * - 383.2.a.1：紧跟触发条件之后的 "if you assigned 3 or more excess damage" 属于触发条件
 *   本身，在触发时求值；467.2.c 规定战斗伤害按分配行动处理，467.2.c.2 定义 Lethal Damage、
 *   467.2.c.4 是"超出致命所需"的分配限制，因此该条件是本次战斗的伤害分配结果统计。
 * - "play two Gold gear tokens exhausted"：
 *   · 187.5 定义 Gold gear token：无域 gear token，带自身能力 "[Reaction][>] Kill this,
 *     [E]: [Add] [A]"（括号内的提醒文本即该 token 的能力，不是本卡的独立指令）；
 *   · 350.2 / 440.2.c / 185.2.a：被"打出"的新 token 先在链上创建、再由 play 接手；
 *   · 184.1 / 185.2.d："exhausted" 是入场状态改写（与 143.4 的默认横置进场相对），
 *     不是先创建再补一次横置。
 *
 * status = judge-required（2026-10-17 复核；缺口不近似实现）：
 * - conquer 订阅本身可用：封闭事件词汇 conquered + source: self，经 translateTriggerFilter +
 *   validateTriggerSpec 通过（实测 registerProgramTriggers 注册成功）。但 turn/flow.ts 的 conquer 波
 *   只携带玩家与 details.battlefieldId，没有 383.4.c.2.a 的在场单位绑定（同一 filter 对真实载荷不匹配）。
 * - “if you assigned 3 or more excess damage” 没有可求值路径：467.2.c.2/.c.4 的 excess damage 是
 *   本次战斗的伤害分配结果统计，Condition 只能读对象/链接/计数；实测保留的 count 形状会按无关对象
 *   数量过度满足（0 个对象 false、4 个对象 true），因此绝不能当作金额求值，也不能用它冒充条件。
 * - effect.token 表没有 Gold 定义（187.5），实测对 "gold" 执行得到 negated /
 *   blockedReason: token-definition-or-abilities-judge-required；184.1/185.2.d 的 exhausted 入场改写
 *   也不在原语参数表内（实测新增 exhausted 参数抛 Invalid effect.token argument）。
 *   目的地的控制者相对写法已改写为合入形状：先用 condition.value 求值 ability-controller-base，
 *   再把结果以 linked-value 传给 effect.token（原语要求具体 PlayerId，不接受 location 常量里的
 *   controller 符号；实测原写法被拒）。golden 用 A/B 两名控制者真实执行这段绑定。
 * 实测可执行的部分：conquer 订阅的翻译/校验/注册、控制者 Base 的求值与传递，以及事件匹配语义；
 * golden 覆盖事件匹配（含 383.4.c.2.a 的“别的单位征服不触发”）与 Gold 定义的 fail-closed 行为。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "conquer",
      filter: { event: "conquered", filter: { source: "self" }, player: "self" },
      // 383.2.a.1："if you assigned 3 or more excess damage" 是触发条件的一部分。
      // count 表达式保留条件形状；合并 IR 没有伤害分配金额维度，见 judgeReason。
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "excess-damage-assigned-this-combat",
          filter: { player: "controller" }
        },
        operator: "gte",
        right: { kind: "constant", value: 3 }
      }
    },
    optional: false,
    body: [
      {
        id: "yeti-brawler.base",
        // 440.4 / 107.1.c：token 的落点是能力控制者的 Base；用已合入的位置选择器求值，
        // 避免把相对玩家写进字面 LocationRef（原语只接受具体 PlayerId）。
        op: "condition.value",
        args: { value: { kind: "location", value: "ability-controller-base" } }
      },
      {
        id: "yeti-brawler.play-gold",
        op: "effect.token",
        linkedTo: "yeti-brawler.base",
        args: {
          token: { kind: "constant", value: "gold" },
          // "two Gold gear tokens"：印刷数额 2（187.5 的 token 定义）。
          amount: { kind: "constant", value: 2 },
          // "play …"：440.2.c / 185.2.a 要求先在链上创建再交给打出流程。
          mode: { kind: "constant", value: "play" },
          location: {
            kind: "linked-value",
            instructionId: "yeti-brawler.base",
            key: "value"
          },
          linkKey: { kind: "constant", value: "goldTokens" }
          // "exhausted" 的入场状态改写（184.1 / 185.2.d）：create-token 尚不支持，
          // 不新增 IR 参数键、也不先创建再补一次横置（见 judgeReason）。
        }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-372a2d2a0b9116fc9b30d8a6f4899848963d12a45cf804935f7f8f9d355c80be",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺（均实测，不近似实现）：(1) 383.4.c.2.a 的本单位在征服战场上参与征服的事件绑定——turn/flow.ts 的 conquer 波" +
    "只有玩家与 details.battlefieldId，同一 filter 对真实载荷不匹配；以及「if you assigned 3 or more excess damage」" +
    "所需的本次战斗伤害分配金额（467.2.c.1–c.4），Condition/HistoryQuery 都读不到分配金额，保留的 count 形状" +
    "实测按无关对象数量过度满足（0 个对象 false、4 个对象 true）。(2) effect.token 尚需 Gold gear 的 187.5 定义及其自身能力，" +
    "实测对 \"gold\" 执行得到 negated / blockedReason: token-definition-or-abilities-judge-required；184.1/185.2.d 的 " +
    "exhausted 入场改写在原语参数表外（实测新增该键抛 Invalid effect.token argument），不能用事后再横置冒充。" +
    "(3) 「play … exhausted」的入场状态改写（184.1/185.2.d）仍缺（见上）。" +
    "目的地已改写为合入形状：condition.value 求值 ability-controller-base 后以 linked-value 传给 effect.token，golden 用 A/B 控制者真实执行。" +
    "已合入并可执行的部分：conquer 订阅的翻译/校验/注册（registerProgramTriggers 实测注册成功）、控制者 Base 求值传递与事件匹配语义。",
  abilities,
  sourceText:
    "When I conquer, if you assigned 3 or more excess damage, play two Gold gear tokens exhausted. " +
    '(They have "[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.")'
} satisfies CardProgram;
