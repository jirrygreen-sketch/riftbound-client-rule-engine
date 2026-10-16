import type { CardProgram } from "../../ir/index.js";

/**
 * Detonation Amplifier (rad-017-167) — Gear, 4 Energy + 1 Chaos Power, tag Device.
 *
 * Printed text (deck-catalog.json, rad-017-167, verbatim):
 *   [Deploy] (Play this only to a battlefield. When an opponent holds here, kill
 *   this.)
 *   When you play this, you may kill another friendly unit or gear to draw 1.
 *   Friendly [Deathknell] effects here trigger an additional time.
 *
 * Rules evidence (Core Rules v1.5):
 * - 830.1 / 830.1.a / 830.1.b: Deploy is a Passive and Triggered Ability keyword
 *   on Gear (only to a battlefield, not recalled in cleanups, killed when an
 *   opponent holds there). Declared here; expansion belongs to the keyword
 *   registry (contract 3.7).
 * - 383.4.a / 383.4.a.1 / 383.4.a.2: "When you play this" is a Gear Play
 *   Effect — a Triggered Ability whose Condition includes the permanent being
 *   played to the board; it is put on the chain after the Gear is finalized and
 *   enters the board. The merged card-played timing point carries that event.
 * - 355.10.c.1 / 355.10.c: "you may kill another friendly unit or gear to draw
 *   1" is a cost within instructions (the "[do X] to [do Y]" form); the CR's own
 *   example uses exactly this sentence and says it "does not target anything".
 *   The killed permanent is therefore NOT a target — it is a non-target choice,
 *   modelled with a PickSpec, never a TargetSpec. 204.3 / 204.3.a: the cost is
 *   paid during resolution to get the effect.
 * - 383.3.a.3: "you may" is decided on resolution here, so contract 3.9 wraps
 *   the chosen instructions in choice.optional (never a bare choice with a
 *   linkedTo follower).
 * - 429 / 429.6: killing the chosen permanent is the Kill instruction;
 *   429.5.b makes this Gear the responsible source. 414.3: the draw is the
 *   linked effect of the cost.
 * - 808.1 / 808.1.c: Deathknell is a Triggered Ability keyword, functionally
 *   "When I die, [Effect]" (the keyword registry expands it, RIFT-82).
 *   383.4.g.1 / 383.4.g.2 and the CR's own Red Brambleback example: making a
 *   named triggered ability "trigger an additional time" modifies trigger
 *   collection, and an effect that merely "activates" the trigger does not get
 *   the extra one.
 *
 * Status: judge-required. Three merged gaps, none approximated:
 * - Deploy has no KeywordDef (effects/keywords/ has no Deploy file), so
 *   830.1.b's rewrites are unexpanded (shared with the RAD Device cohort).
 * - "trigger an additional time" has no engine model: the six Ability shapes
 *   have no trigger multiplier; ContinuousEffect.kind is an open string with no
 *   consumer for multiplicity; the Deathknell expansion still references the
 *   unmerged trigger.leave op; and the trigger-collection stage (events/) has no
 *   multiplicity hook. The static declaration below names the pending shape
 *   (Karthus, Eternal's precedent) rather than using repeat, which would wrongly
 *   re-execute at resolution instead of adding a trigger.
 * - The play trigger has no registration path (no CardProgram ->
 *   TriggerRegistration adapter, RIFT-120 follow-up), so even the expressible
 *   kill-then-draw half cannot enter the chain from card data. Its body is still
 *   executed by the golden test through the merged interpreter.
 * Dependencies: kw-deploy (830), the trigger-multiplicity interface (events/,
 * RIFT-82 cohort), and RIFT-120 trigger registration.
 */
const detonationAmplifier = {
  canonicalCardId: "card.hash-5781b7f1661449d933821ba1a1c0653a6180580f9335eaee79a838078eb62552",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) Deploy 没有 KeywordDef（CR 830.1.b 的四项改写未展开，与 RAD Device 同批卡同缺口）。" +
    "(2)「Friendly [Deathknell] effects here trigger an additional time」没有引擎模型：Ability 六种形状没有触发倍率，" +
    "ContinuousEffect.kind 无倍率消费者，keywords/Deathknell.ts 的展开体仍引用未合入的 trigger.leave，" +
    "触发收集阶段（events/）也没有倍率接口；程序只保留待接线的 static 声明（同 Karthus, Eternal 先例），" +
    "不用结算期的 repeat 近似（383.4.g.1/383.4.g.2）。" +
    "(3) Play Effect 触发没有注册路径（缺 CardProgram → TriggerRegistration 适配器，RIFT-120 后续），" +
    "kill-then-draw 半段本身已合入（cost within instructions 用 PickSpec 表达，见 355.10.c.1 的原文示例），" +
    "golden 通过解释器真实执行该半段。" +
    "依赖：kw-deploy（830）、触发倍率接口（events/，RIFT-82 cohort）、RIFT-120 触发注册。",
  abilities: [
    // 830.1：印刷的 [Deploy] 声明（展开依赖 kw-deploy）。
    { kind: "keyword", keyword: "deploy" },
    {
      // 383.4.a.1："When you play this" → card-played（自身打出）。
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { source: "self", player: "self" } }
      },
      optional: false,
      body: [
        {
          id: "detonation-amplifier.may-kill-opt",
          op: "choice.optional",
          args: {
            prompt: {
              kind: "constant",
              value: "Kill another friendly unit or gear to draw 1?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  // 355.10.c.1："[do X] to [do Y]" 的 X 是指令内费用，不产生目标，
                  // 因此用 picks（非目标选择）而不是 targets。
                  id: "detonation-amplifier.kill-cost",
                  op: "effect.kill",
                  args: { picks: { kind: "constant", value: "detonation-amplifier.sacrificed" } },
                  picks: [
                    {
                      id: "detonation-amplifier.sacrificed",
                      // 429.6：Kill 的正式格式；another 排除来源自身，friendly 限定为
                      // 能力控制者（740.1.a），unit or gear 是两种永久的并集
                      // （133.4.a.2）。
                      options: ["another-friendly-unit-or-gear"],
                      filter: {
                        type: ["unit", "gear"],
                        controller: "self",
                        zone: "board",
                        other: true
                      },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                },
                {
                  // 414.3 / 204.3.a：费用付清后的效果；link 到 kill 上，
                  // 使被否定的费用不带来抽牌（359.3.e.14）。
                  id: "detonation-amplifier.draw-1",
                  op: "effect.draw",
                  linkedTo: "detonation-amplifier.kill-cost",
                  args: { amount: { kind: "constant", value: 1 } }
                }
              ]
            }
          }
        }
      ]
    },
    {
      // 383.4.g.1："Friendly [Deathknell] effects here trigger an additional time"
      // 是触发收集阶段的倍率改写。当前没有消费者，只保留待接线声明。
      kind: "static",
      effect: {
        kind: "continuous.trigger-multiplicity",
        mode: "additional",
        amount: { kind: "constant", value: 1 },
        appliesTo: {
          keyword: "deathknell",
          controller: "self",
          zone: "board",
          // here：来源战场锚点（053.3），同战场占位词汇。
          here: true
        }
      }
    }
  ],
  sourceText:
    "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
    "When you play this, you may kill another friendly unit or gear to draw 1.\n" +
    "Friendly [Deathknell] effects here trigger an additional time."
} satisfies CardProgram;

export default detonationAmplifier;
