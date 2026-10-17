import type { CardProgram } from "../../ir/index.js";

/**
 * Wizened Elder (ogn-065-298) — Unit, 4 energy, 1 Calm power, Might 4, Ionia.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-065-298):
 *   While I'm buffed, I have an additional +1 :rb_might:.
 *
 * Rules evidence (Core Rules v1.5):
 * - The text is a Conditional Passive Ability recognized by "while" (364.3,
 *   364.3.a); passive abilities of permanents are active while on the Board
 *   (365.1).
 * - "buffed" is defined by 702.2.a: a unit is Buffed for as long as the buff
 *   remains on it, and each Buff contributes +1 Might individually (703). The
 *   printed ability adds one further, separate +1 Might on top of that.
 * - 702.3 / 702.3.a: at most one Buff per unit, so ObjectFilter.characteristics
 *   { buffs: 1 } is the exact "buffed" predicate.
 *
 * Status: judge-required. The additional +1 Might is an arithmetic-layer
 * continuous Might modification; the merged continuous.might instruction
 * (RIFT-258) registers exactly that, and the golden test executes the +1
 * through the interpreter plus the layer engine on a buffed unit (4 -> 5).
 * The "while I'm buffed" predicate is carried as ObjectFilter.characteristics
 * { buffs: 1 }, the spelling layers/filter.ts characteristicsMatch evaluates;
 * the golden shows the layer gate is live (it closes once the Buff is spent
 * through the real effect.buff primitive). The card itself is still not
 * executable:
 * - no merged consumer turns a CardProgram's static ability into a registered
 *   ContinuousEffectSpec (card-program binding, RIFT-257, in progress), so the
 *   aura never registers in production;
 * - the layers condition vocabulary (conditionMatches: always/never/type/
 *   has-tag/has-keyword) cannot evaluate the buffed predicate; the evaluable
 *   spelling is the filter characteristics key, which the (unmerged) binding
 *   layer must merge with the host identity filter (the instruction's own
 *   per-object registration path drops selector predicates);
 * - "while" is a live condition: gaining or spending a Buff during the turn
 *   must open and close the +1 (702.2.a), which requires the registered
 *   filter to re-evaluate on every layer pass.
 * Not approximated: the +1 is never modelled as a second Buff counter (702.3
 * forbids a second Buff, and a Buff counter is not a Might modification).
 */
export default {
  canonicalCardId: "card.hash-16335e499c8dc3283d678e27bfe613e02ef16a6babfe209f953b1959c52fd375",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「While I'm buffed, I have an additional +1 [M]」的 Might 修正已可执行：continuous.might 指令（RIFT-258）注册 arithmetic 图层效果，" +
    "golden 用解释器真实执行 +1（Might 4 → 5），并用图层引擎验证 702.2.a 的 buffed 谓词以 ObjectFilter.characteristics { buffs: 1 } 求值" +
    "（702.3 限定一名单位同时只有一个 Buff；Buff 被真实 effect.buff spend 消耗后门槛关闭）。整卡仍不可执行：" +
    "① 没有已合入的消费方把 CardProgram 的 static ability 注册成 ContinuousEffectSpec（卡牌程序绑定 RIFT-257 进行中），光环在正式对局中从不注册；" +
    "② 图层引擎的条件词表（conditionMatches：always/never/type/has-tag/has-keyword）无法求值 buffed 谓词，可执行的拼写只有 filter.characteristics，" +
    "需要（未合入的）绑定层把它与宿主身份 filter 合并；continuous.might 指令自身的逐对象注册会丢弃选择谓词；" +
    "③ 「while」是随 Buff 获得/消耗开关的实时条件（702.2.a），注册 filter 必须在每次图层求值时重算。" +
    "不近似实现：绝不写成第二个 Buff 计数器（702.3 禁止，且 Buff 计数不是 Might 修改）。依赖：RIFT-257（static 能力绑定）与谓词/身份 filter 合并。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        amount: { kind: "constant", value: 1 },
        // "While I'm buffed" (702.2.a; 702.3 caps at one Buff): the merged
        // evaluable predicate spelling. layers/filter.ts characteristicsMatch
        // reads it on every evaluation, so the gate follows Buff gain/spend.
        filter: { type: "unit", zone: "board", characteristics: { buffs: 1 } },
        // "I": the ability host. The binding layer (RIFT-257) resolves it to a
        // per-object identity filter, the same form the merged continuous.might
        // registration builds for appliesTo "self".
        appliesTo: "self"
      }
    }
  ],
  sourceText: "While I'm buffed, I have an additional +1 :rb_might:."
} satisfies CardProgram;
