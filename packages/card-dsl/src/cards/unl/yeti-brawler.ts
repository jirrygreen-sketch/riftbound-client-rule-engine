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
 * status = judge-required（2026-10-17 复核）：
 * - conquer 订阅使用封闭事件词汇 conquered，并以 source: self 绑定本单位；卡牌侧可修正
 *   旧的事件拼写。但 turn/flow.ts 的 conquer 波只携带玩家与 battlefieldId，尚需 383.4.c.2.a
 *   的在场单位绑定，以及本次战斗 assigned excess damage 金额。count 只数对象，不能作为
 *   伤害分配金额求值（RIFT-359）；保留下列声明，不把它当作执行证据。
 * - effect.token 的 Gold 定义及其 187.5 能力、exhausted 入场改写仍需接入；链侧 effect play
 *   还要求 token 具有可描述的程序。另需把 controller Base 编译为含具体 PlayerId 的 LocationRef；
 *   effect.token 不会解析下面 location 常量内的 controller 符号。
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
        id: "yeti-brawler.play-gold",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "gold" },
          // "two Gold gear tokens"：印刷数额 2（187.5 的 token 定义）。
          amount: { kind: "constant", value: 2 },
          // "play …"：440.2.c / 185.2.a 要求先在链上创建再交给打出流程。
          mode: { kind: "constant", value: "play" },
          location: { kind: "constant", value: { type: "base", player: "controller" } },
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
    "仍缺：(1) 383.4.c.2.a 的本单位在征服战场上参与征服的事件绑定，以及「if you assigned 3 or more excess damage」" +
    "所需的本次战斗伤害分配金额；turn/flow.ts 的 conquer 波只有玩家与 battlefieldId，" +
    "count/history 不能读取 assigned excess damage 金额（467.2.c.1–c.4；条件读取依赖 RIFT-359）。" +
    "(2) effect.token 尚需 Gold gear 的 187.5 定义及其自身能力、184.1/185.2.d 的 exhausted 入场改写；" +
    "Chain 的 effect Play 还需 token 程序交接，目前 describePlay 要求可注册的 cardId。" +
    "(3) token 的 controller Base 目的地仍需控制者相对 LocationRef 求值：effect.token 需要具体 PlayerId，" +
    "不会解析 location 常量里的 controller 符号。",
  abilities,
  sourceText:
    "When I conquer, if you assigned 3 or more excess damage, play two Gold gear tokens exhausted. " +
    '(They have "[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.")'
} satisfies CardProgram;
