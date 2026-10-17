import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Mask of Foresight (ogn-060-298) — Gear, 2 Energy, Calm.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-060-298):
 *   When a friendly unit attacks or defends alone, give it +1 :rb_might: this turn.
 *
 * 规则依据（CR v1.5）：
 * - “When a friendly unit attacks or defends alone …” 是触发能力（383.1），触发点是
 *   攻击宣告 / 防守宣告（时点 attack-declared / defense-declared，383.4.e/383.4.f），
 *   “alone” 按 740.2.a 定义：同位置没有其他友方单位。
 * - “give it +1 :rb_might: this turn” 是临时 Might 修正（143.2 的 Effective Might、
 *   708/709 的 Might 变化），按契约 3.4/3.5 属图层算术层的 continuous.might 持续效果
 *   （end-of-turn 到期）；effect.buff 文档明确临时 Might 变化“belong to continuous.might,
 *   never to this primitive”（Buff 是 702 的 counter，不是 Might 数值改变）。
 *
 * status = judge-required：
 * - continuous.might 指令、算术层注册和 end-of-turn 期限已合入，golden 已用它真实注册
 *   +1 Might；仍缺的是生产触发接线——attack-declared / defense-declared 的事件生产、
 *   触发载荷（“攻击/防守的那个单位”）到 body “it” 的绑定尚未接通；
 * - “alone” 谓词（740.2.a：同位置无其他友方单位）需要扫描同位置友方单位数的谓词，
 *   当前 merged 的 condition 只有 always/never/compare/all/any/not/expression，
 *   没有直接表达“同位置无其他友方单位”的谓词（可用 count + compare 组合，但需要
 *   触发载荷对象作为锚点，见上一条）。
 * 不近似实现：不给 Buff counter，也不写固定数额的 damage/might 近似。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "attack-declared",
      filter: {
        event: "attack-declared",
        // “a friendly unit attacks … alone”：己方单位成为攻击者（383.4.e，
        // controller: "self" 即能力控制者的单位，740.1.a），
        // “alone” 是 740.2.a 的同位置判定（触发条件的一部分，见 judgeReason）。
        object: { type: "unit", controller: "self" }
      }
    },
    optional: false,
    body: [
      {
        id: "mask-of-foresight.grant-might",
        // “give it +1 :rb_might: this turn” — 临时 Might 修正，属图层算术层
        // （continuous.might，end-of-turn 到期）；目前没有已注册的消费路径
        // （见 judgeReason）。目标用符号选择器引用触发对象。
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 1 },
          duration: { kind: "constant", value: "end-of-turn" },
          target: { kind: "constant", value: "mask-of-foresight.attacking-unit" }
        },
        targets: [
          {
            id: "mask-of-foresight.attacking-unit",
            // “it”：触发载荷指向的那个友方单位（740.1.a friendly）。
            filter: { type: "unit", controller: "controller", zone: "board" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  },
  {
    kind: "triggered",
    trigger: {
      at: "defense-declared",
      filter: {
        event: "defense-declared",
        // “or defends alone”：己方单位取得防守者身份（383.4.f）。
        object: { type: "unit", controller: "self" }
      }
    },
    optional: false,
    body: [
      {
        id: "mask-of-foresight.grant-might-defending",
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 1 },
          duration: { kind: "constant", value: "end-of-turn" },
          target: { kind: "constant", value: "mask-of-foresight.defending-unit" }
        },
        targets: [
          {
            id: "mask-of-foresight.defending-unit",
            filter: { type: "unit", controller: "controller", zone: "board" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-5f48a04a4f966d4526f18478a25c6240550688787ada0e43c59ba66df41a1ef5",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺两处支撑：① 触发载荷绑定——continuous.might 的算术层 + end-of-turn 期限已合入且 golden 已真实注册，" +
    "但 attack-declared / defense-declared 的事件生产与触发载荷（“攻击/防守的那个单位”）到 body “it” 的绑定仍未接通；" +
    "② “alone” 谓词（CR v1.5 740.2.a：同位置无其他友方单位）在当前 condition 词汇（always/never/" +
    "compare/all/any/not/expression）中没有直接表达，需要以触发载荷单位为锚点的同位置友方计数。" +
    "依赖：attack-declared / defense-declared 生产与载荷绑定，以及 740.2.a 谓词/combat 时点接线。不近似实现：不用 Buff counter，也不写固定加成。",
  abilities,
  sourceText: "When a friendly unit attacks or defends alone, give it +1 :rb_might: this turn."
} satisfies CardProgram;

export default program;
