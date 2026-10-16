import type { CardProgram } from "../../ir/index.js";

/**
 * Master Yi, Meditative (ogs-004-024) — Unit, 5 energy / 1 power (Calm), Might 4.
 *
 * sourceText (deck-catalog.json, ogs-004-024, verbatim):
 *   "While you have 8+ runes, I have +4 :rb_might:."
 *
 * 规则依据（CR v1.5）：
 * - 143.2：Might 是单位的战斗属性，可被卡牌与效果引用；本单位自身获得 +4 Might
 *   属算术图层（continuous.might）的持续效果，appliesTo: self。
 * - "While ..."：持续条件，满足期间生效；条件挂在 static 能力的 condition 上
 *   （契约 3.1 static 的 condition），不是指令级条件。
 * - "8+ runes"：符文被 channel 后留在棋盘上（133.5.a.1、161.1.a；431.1 说明
 *   Channel 把符文从符文牌库取出放到棋盘），因此按控制者当前在棋盘符文区
 *   （zone: "rune-zone"）的符文数量计数；等价地是"你控制 8 个或更多符文"。
 *
 * 状态：judge-required。缺口有二：
 * 1. 没有已合入的 continuous.might 静态效果消费方。layers/engine.ts 虽有算术
 *    图层代码，但没有"卡牌静态能力 → 已注册持续效果"的装配路径；keyword 侧
 *    Assault.ts / Shield.ts 也把 continuous.might 明确列为未合入依赖（RIFT-91）。
 * 2. 条件里的符文计数（condition.compare + count）要在引擎条件求值路径上执行；
 *    当前只有参考测试内核能求值，生产条件管线未接（RIFT-89/90 条件/目标批次）。
 */
export default {
  canonicalCardId: "card.hash-87c4e90c814243a78c356216704a1ec163c6f16ccaba9de6697847335b8f6601",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 continuous.might 静态图层消费方：拥有 8+ 符文时 +4 Might 是算术图层的持续 +4 Might" +
    "（CR 143.2），layers/ 尚无卡牌静态能力到已注册持续效果的装配/消费路径" +
    "（Assault.ts、Shield.ts 同样把 continuous.might 列为未合入依赖）；" +
    "条件 8+ runes 需要符文计数条件求值（CR 133.5.a.1、431.1 的棋盘符文区计数），" +
    "生产条件管线未接。依赖：RIFT-91（layers-continuous）、RIFT-89/90（条件与目标批次）。" +
    "不近似实现。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        appliesTo: { kind: "constant", value: "self" },
        amount: { kind: "constant", value: 4 }
      },
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "runes",
          filter: { type: "rune", controller: "controller", zone: "rune-zone" }
        },
        operator: "gte",
        right: { kind: "constant", value: 8 }
      }
    }
  ],
  sourceText: "While you have 8+ runes, I have +4 :rb_might:."
} satisfies CardProgram;
