import type { CardProgram } from "../../ir/index.js";

/**
 * Void Gate (ogn-296-298) — Battlefield, Colorless.
 *
 * sourceText:
 *   Spells and abilities affecting units here each deal 1 Bonus Damage. (Each
 *   instance of damage the spell deals is increased by 1.)
 *
 * CR v1.5 anchors:
 * - 418.4 / 418.5 / 713: Bonus Damage is an intrinsic property granted to a
 *   Deal action, not damage itself; 714 sums several instances and applies once
 *   per action; 715.2 increases the damage dealt to each target of a multi-target
 *   deal separately; 715.4 grants nothing when no damage is dealt.
 * - 715.4.a: the example uses this Battlefield with a prevent effect — the
 *   prevention includes the Bonus Damage when computing the total.
 * - 053.3: "here" is this Battlefield.
 *
 * Status: judge-required. effect.damage already accepts a bonus argument
 * (CR 714/715.2) and the golden test executes the bonus math through the
 * reference kernel, but the card cannot be executable:
 * - nothing computes this Battlefield's contribution and feeds it into a Deal
 *   action's bonus argument. The layers arithmetic/ability consumers do not
 *   model "grant Bonus Damage to Deal actions" (the cost/effect plan that would
 *   carry it does not exist), and effect.damage's own documentation places the
 *   grant with the continuous-effect/layers system;
 * - "affecting units here" is a scope over the Deal action's targets
 *   (053.3 + sameLocationAs), and the merged filter matcher implements no
 *   sameLocationAs anchor, so a naive filter would grant the bonus to every
 *   deal anywhere on the board;
 * - no merged producer registers a CardProgram's static ability as a
 *   ContinuousEffectSpec at all, and the battlefield-ability controller
 *   resolution of 190.6 is likewise missing.
 * The static ability below declares the Bonus Damage grant for whichever
 * consumer lands; it is not approximated into an instruction that would add
 * damage to every deal.
 */
export default {
  canonicalCardId: "card.hash-914c78ed19d1829c8172e4fcce5b399b51f05e15d1a02fb7eaaaf64e7132bc08",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Spells and abilities affecting units here each deal 1 Bonus Damage」是 418.4/713 的 Bonus Damage 授予（714 多实例求和、715.2 每个目标分别 +1、" +
    "715.4 无伤害则不适用；715.4.a 的官方例子正好用本战场）。effect.damage 已接受 bonus 参数并在 golden 中真实执行了加总，" +
    "但没有任何计算方把本战场的授予喂进 Deal 动作的 bonus：图层/费用效果计划没有“对 Deal 动作授予 Bonus Damage”的模型（effect.damage 文档把授予归持续效果/图层系统）；" +
    "「affecting units here」的作用域（053.3）需要 sameLocationAs 锚点而 layers/filter 未实现，简单过滤器会把加成发给全场所有伤害；" +
    "也没有已合入路径把 CardProgram 的 static 能力注册成 ContinuousEffectSpec，190.6 的战场能力控制者亦未解析。依赖：RIFT-91（layers-continuous）、RIFT-120（batch4-chain-events）" +
    "之后的 Bonus Damage 授予任务。不近似实现（不写成给每次伤害额外 +1 的指令）。",
  sourceText:
    "Spells and abilities affecting units here each deal 1 Bonus Damage. " +
    "(Each instance of damage the spell deals is increased by 1.)",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.bonus-damage",
        layer: "ability",
        amount: { kind: "constant", value: 1 },
        appliesTo: "deal-actions",
        // 053.3 + 715.1/715.2: the grant applies per Deal action whose targets
        // are units at this Battlefield; sameLocationAs carries that referent.
        filter: {
          type: "unit",
          zone: "board",
          sameLocationAs: "self"
        }
      }
    }
  ]
} satisfies CardProgram;
