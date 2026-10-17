import type { CardProgram } from "../../ir/index.js";

/**
 * Kinkou Temple (ven-159-166) — Battlefield, Colorless.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-159-166，逐字）：
 *   "Units here with [Tank] have +1 :rb_might:."
 *
 * 规则依据（Core Rules v1.5）：
 * - 479.2.b / 479.3 / 479.3.b："have" 是 Ability-Altering 层的识别短语（"have," "has,"
 *   属于该层），本条把 +1 Might 授予本战场上有 [Tank] 的单位。
 * - 479.4 / 479.4.e.1 / 479.4.f："+X" 是 Arithmetic 层的增量，正增量先于减量应用；
 *   "+1 :rb_might:" 因此是 arithmetic 层的 +1，而不是 Buff 计数器（702 的 Buff 是
 *   计数器，本卡不放置任何计数器）。
 * - 815 / 815.1 / 815.1.b / 815.3：[Tank] 是单位上的被动关键词，815.1.b 的功能文本是
 *   战斗伤害指派顺序要求，815.3 让「是否拥有 Tank」成为可被其它效果检查的特征；
 *   本卡正是引用该特征的过滤器条件。
 * - 053.3："here" 指本战场；479.1 / 478.1：该效果在战场被控制期间持续生效；
 *   190.6.a / 190.6.d：战场能力的控制者为战场控制者。
 *
 * status = judge-required。已合入依赖与剩余生产接线已重新核对；
 * 当前真实缺口以 judgeReason 为准，子效果执行不证明整卡可执行。
 */
export default {
  canonicalCardId: "card.hash-0148fea511f023ebe4f6e9b7dd701d1290558c9cbf8bcd877bccd4cda78e5875",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺：(1) programs/statics.ts 的 staticFilter 不接受 keywords，layers/filter.ts 也不检查 ObjectSnapshot.keywords，无法限定 with [Tank]（815.3）；" +
    "(2) sameLocationAs: self 虽已翻译成来源位置，但 layers/filter.ts 对结构化 location 没有按 type/id 比较，无法保证只作用于同一战场（053.3）。",
  abilities: [
    {
      kind: "static",
      effect: {
        // 479.4 / 479.4.e.1 / 479.4.f：+1 Might 是 arithmetic 层的正增量。
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        amount: { kind: "constant", value: 1 },
        // 479.3.b 的 "have" + 815.3 的 Tank 特征谓词 + 053.3 的 here：
        // 「本战场上有 [Tank] 的单位」；keywords 谓词仍未实现（见 judgeReason）。
        filter: {
          type: "unit",
          zone: "board",
          keywords: ["Tank"],
          sameLocationAs: "self"
        }
      }
    }
  ],
  sourceText: "Units here with [Tank] have +1 :rb_might:."
} satisfies CardProgram;
