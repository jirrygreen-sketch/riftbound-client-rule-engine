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
 * 状态：judge-required。缺口有二（continuous.might 本体已在 RIFT-258 合入）：
 * 1. 没有"卡牌静态能力 → 已注册持续效果"的生产装配路径：continuous.might 只能经
 *    指令原语调用 ctx.addContinuous，engine-core/src 不读取 CardProgram.abilities
 *    （卡牌程序绑定属 RIFT-257），layers/engine.ts 收到的注册表里不会出现这张卡的
 *    静态效果。
 * 2. 即使注册落地，守卫条件也求不了值：layers/engine.ts 的 conditionMatches 只识别
 *    always/never/type/has-tag/has-keyword，未识别的 compare 条件按 true 处理，
 *    "8+ runes" 会被静默丢弃、+4 Might 变成无条件（符文计数的 count 读取本身在
 *    参考内核可执行，见 golden）。
 */
export default {
  canonicalCardId: "card.hash-87c4e90c814243a78c356216704a1ec163c6f16ccaba9de6697847335b8f6601",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1) continuous.might 原语（RIFT-258）本身已合入，但没有已合入的生产方" +
    "把卡牌静态能力注册成持续效果——engine-core/src 不读取 CardProgram.abilities，" +
    "layers 注册表只收指令原语 ctx.addContinuous 的结果（卡牌程序绑定属 RIFT-257）；" +
    "(2) 即使注册落地，layers/engine.ts 的 conditionMatches 只识别 always/never/type/" +
    "has-tag/has-keyword，未识别的 compare 条件按 true 处理，\"8+ runes\" 的守卫会被静默" +
    "丢弃、+4 Might 变成无条件生效（符文计数条件本身在参考内核可执行，见 golden 的 " +
    "channel-rune 场景；生产条件求值属 RIFT-91 后续）。依赖：RIFT-257、RIFT-91。不近似实现。",
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
