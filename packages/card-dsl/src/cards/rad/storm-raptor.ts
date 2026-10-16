import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Storm Raptor (rad-036-167) — Unit, 6 energy, no printed Power, 6 Might, Calm.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-036-167）：
 *   [Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)
 *   When a stunned enemy unit dies here, draw 1.
 *
 * 规则依据（CR v1.5）：
 * - [Deflect]（809.1 / 809.1.b.3 省略数值按 1 / 809.1.c 的功能文本“对手用咒语或能力选择我时
 *   额外支付 1 点任意域力量”）：声明由 effects/keywords/Deflect.ts 展开（已合入），卡文件只声明。
 * - “When a stunned enemy unit dies here, draw 1.”：死亡触发（时点 object-killed；429.1
 *   定义消灭）。
 *   - “a stunned enemy unit”：被消灭者是敌方单位且处于 Stunned 状态（424.1.a 的二元状态）；
 *     该状态对死亡事件可读：链层在 object-killed 时取的是换区前的快照（chain/engine.ts 的
 *     snapshot(event.object, true)），matchesTriggerObject 也实现 states 的 stunned 谓词；
 *   - “here”：053.3 明确 Battlefields 才说 “here”，本卡是单位，因此按 421.1 的位置指称
 *     读作“本单位当前所在的位置”（同一战场）；时点载荷需携带被消灭对象的位置；
 *   - “draw 1.”：414.3，抽牌者是触发能力控制者（190.6.d 的隐含 "you"）。
 *
 * status = judge-required（见 judgeReason）：“here” 要求把被消灭对象的位置与本单位位置比较，
 * 而 sameLocationAs 锚点只在解释器的集合查询里实现（interpreter/selectors.ts），触发匹配器
 * 不实现该锚点、且对未识别的过滤器键静默放行——直接接线会让任意位置死亡的敌方受禁单位都命中，
 * 属近似实现。golden 真实执行可执行半段：effect.draw 的 Draw 1。
 * 依赖：RIFT-120 之后的触发载荷/过滤扩展（stunned 谓词、事件对象位置锚点）、RIFT-84（Deflect 展开
 * 已合入，但卡牌 keyword → 展开 → 目标税管线的生产接线仍缺）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "deflect" },
  {
    kind: "triggered",
    trigger: {
      at: "object-killed",
      // “a stunned enemy unit dies here” — 被消灭对象是敌方单位、处于 Stunned 状态、
      // 且与本单位同处一个位置（见 judgeReason 的两项缺口）。
      filter: {
        event: "object-killed",
        filter: {
          type: "unit",
          controller: "opponent",
          states: "stunned",
          sameLocationAs: "source"
        }
      }
    },
    optional: false,
    body: [
      {
        // “draw 1.” — 414.3；触发能力的控制者抽牌（190.6.d）。
        id: "storm-raptor.draw-1",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-f595b4941f399b2ac63a4066a8805f35b600f3bf7ad4bf6a5b2c66ac8e4d9a21",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「dies here」的位置条件无法如实判定，不近似实现：053.3 说明 “here” 是 Battlefields 的自我指称，" +
    "本卡是单位，按 421.1 读作“本单位当前所在的位置”；该条件需要把被消灭对象的位置与来源单位的位置比较，" +
    "而 ObjectFilter 的 sameLocationAs 锚点只在解释器的集合查询里实现（interpreter/selectors.ts 的 queryObjects），" +
    "触发匹配器（events/pipeline-match.ts 的 matchesTriggerObject）不实现该锚点、并对未识别的过滤器键静默放行" +
    "（实测 sameLocationAs 命中所有对象），因此直接接线会把任意位置死亡的敌方单位都算成 “dies here”。" +
    "「a stunned enemy unit」部分本身是可读的（424.1.a 的二元状态；链层在 object-killed 取换区前快照，" +
    "matchesTriggerObject 实现 states 的 stunned 谓词），不构成阻塞项。" +
    "另：[Deflect] 的 KeywordDef 展开已合入（RIFT-84），但卡牌 keyword 能力 → 展开 → 目标税管线的生产接线仍缺（RIFT-91），" +
    "且卡牌程序 → TriggerRegistration 的接线尚未合入（RIFT-120 之后的协调工作）。" +
    "可执行半段：effect.draw 的 Draw 1（414.3），golden 真实执行；不据此宣称整卡可执行。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "When a stunned enemy unit dies here, draw 1."
} satisfies CardProgram;

export default program;
