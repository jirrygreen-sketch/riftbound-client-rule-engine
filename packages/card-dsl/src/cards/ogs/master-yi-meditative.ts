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
 * 状态：judge-required。缺口有二（continuous.might 本体与卡牌程序绑定 RIFT-257
 * 均已合入）：
 * 1. count 条件里的过滤器仍带卡牌侧占位符：filter.controller 写的是 "controller"，
 *    静态能力接线后的 layers 查询环境（programs/statics.ts abilityEnvironment 的
 *    query → layers/filter.ts matchesObjectFilter）按字符串精确比较、不解析该
 *    占位符，"controller" 与任何具体玩家 id 都不相等，\"8+ runes\" 的 count 恒为 0，
 *    条件 fail-closed 为 false（evaluateCondition 求值为 false 时静态效果不生效）。
 * 2. 若改为带 condition 的事件触发求值，事件管线要求宿主提供 testTrigger 适配器
 *    （events/pipeline.ts 抛 "Trigger condition adapter required"，已合入 host 都
 *    不提供）。符文计数的 count 读取本身在参考内核可执行（见 golden，用具体玩家
 *    id 替换占位符）。
 */
export default {
  canonicalCardId: "card.hash-87c4e90c814243a78c356216704a1ec163c6f16ccaba9de6697847335b8f6601",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1) count 条件的过滤器带卡牌侧占位符：filter.controller 写 \"controller\"，" +
    "静态能力接线后的 layers 查询环境（programs/statics.ts abilityEnvironment 的 query → " +
    "layers/filter.ts matchesObjectFilter）按字符串精确比较、不解析该占位符，\"controller\" " +
    "与任何具体玩家 id 都不相等，\"8+ runes\" 的 count 恒为 0，条件 fail-closed 为 false；" +
    "(2) 若把该守卫改为带 condition 的事件触发求值，events/pipeline.ts 抛 \"Trigger condition adapter required\"（已合入 host 都不提供 testTrigger 适配器）。" +
    "已合入的部分：continuous.might（RIFT-258）与卡牌程序绑定（RIFT-257，attachProgramLifecycle/" +
    "bindStaticToLayers 会经 evaluateCondition 求静态条件）都已合入；golden 用参考内核真实执行 " +
    "channel-rune 计数（用具体玩家 id 替换占位符后 count/test 为真/假）与 arithmetic 层 +4。" +
    "依赖：过滤器相对玩家占位符解析（契约变更请求）与事件条件求值适配器。不近似实现。",
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
