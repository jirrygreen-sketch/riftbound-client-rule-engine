import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * astral-heron — M2 源码复核（2026-10-18）。
 * 具体规则与剩余阻塞见 judgeReason；局部执行不代表整卡可执行。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { player: "self" } },
      // 383.3.e.1 / 383.5：Nth-Time 触发每回合只执行一次（383.1.b 的同时多次只触发一次）；
      // 383.1.b 的全回合首张牌条件仍需历史计数（见 judgeReason），once 不能代替它。
      once: "per-turn",
      // 383.2.a.1：紧跟触发条件的 "if I'm at a battlefield" 属于 Trigger Condition。
      // Location 谓词没有可求值形态（见 judgeReason），用描述性表达式保留印刷条件。
      condition: {
        kind: "expression",
        value: {
          kind: "object-property",
          object: "self",
          property: "at-battlefield"
        }
      }
    },
    optional: false,
    body: [
      {
        id: "astral-heron.reduce-next-card",
        // 356.4 的费用改写模板（仍缺 next-card 窗口与费用计划消费方）：
        // 对本回合打出的下一张牌减 2 Energy 与 2 点任意域 Power；window 是描述窗口的常量，
        // 不是对象引用。不写固定总价，也不自行改写印刷费用。
        op: "cost.modify",
        args: {
          resource: { kind: "constant", value: "energy" },
          amount: { kind: "constant", value: -2 },
          appliesTo: { kind: "constant", value: "next-card-played-this-turn" },
          duration: { kind: "constant", value: "this-turn" },
          // 135.2.e.5.a / 163.2.b：两枚 :rb_rune_rainbow: = 2 点任意域 Power；
          // 卡牌侧保留 rainbow 记号，费用计划以通用 Power 折扣消费它。
          power: { kind: "constant", value: ["rainbow", "rainbow"] }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-7efb1a981d4769615bfa3bd93ca6dffae7dd488b8cbea4e087b97882f0d2933c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口（2026-10-18 复核，均为实测）：(1) 356.4 的 next-card 一次性折扣尚无注册、消费及到期窗口；" +
    "cost.modify 只产生当前对象的费用计划，不接受本卡的 appliesTo/duration/resource/power 窗口参数，" +
    "无法给下一张牌减 2 Energy + 2 任意域 Power。(2) 383.2.a.1 的触发条件使用的 at-battlefield 不是 " +
    "ObjectSnapshot 特征，仍缺可绑定的来源 Location 类型谓词。(3) 383.1.b 的每回合第一张牌还缺" +
    "入场前/条件不满足时的 card-played 历史计数；once: \"per-turn\" 只限制本触发已消费次数，" +
    "不能代替全回合首次打牌条件。",
  abilities,
  sourceText:
    "When you play your first card each turn, if I'm at a battlefield, your next card costs :rb_energy_2::rb_rune_rainbow::rb_rune_rainbow: less."
} satisfies CardProgram;
