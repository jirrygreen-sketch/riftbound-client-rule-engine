import type { CardProgram } from "../../ir/index.js";

/**
 * Noxus Saboteur (ogn-018-298) — Unit, Fury, Trifarian/Noxus, energy 3, Might 3.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-018-298，逐字）:
 *   "Your opponents' [Hidden] cards can't be revealed here."
 *
 * 规则依据（Core Rules v1.5）:
 * - 811.5 / 811.5.a：Hidden（及是否拥有 Hidden）是卡牌特征，可被其他游戏效果检查；
 *   因此"对手的 [Hidden] 牌"是合法指称（非 hidden 状态的面朝下牌不算，811.5.a）。
 * - 425 / 425.1：Reveal 是受限动作（425.2.a / 491.8.f.1 只能在效果指示时执行）；
 *   本能力是对该动作的持续禁止。
 * - 364.1 / 364.3："can't be revealed" 是持续生效的被动能力（陈述句）；"here" 指本卡
 *   所在位置（421.1）。这类一般许可 / 禁止 / 数量限制由 continuous.restrict 表达。
 *
 * 结构说明: 单个 static 能力，effect.kind = "continuous.restrict"，禁止对象为对手
 * 拥有/控制的、位于本卡所在位置的 Hidden 牌执行 Reveal（operation: "reveal"、
 * forbidden: true、sameLocationAs: "self"、tag: "Hidden"）。按 811.1.a，Hidden 出现在
 * Spell / Unit / Gear 上，所以不按卡型收窄（面朝下时不再是 Hidden，811.5.a）。
 *
 * 未合入依赖（不近似实现）:
 * - continuous.restrict 与 static CardProgram 生命周期已经合入，但 static filter binder 仍不能
 *   将相对能力控制者的 `controller: "opponent"` 解析成生产层过滤器。
 * - rules/query.ts 能查询持续禁止，effect.reveal 的动作合法性路径仍没有消费该查询，因此限制
 *   不会阻止实际 Reveal。
 * - 仍需按 811.5.a 区分 facedown card 与带 Hidden 特征的牌，并接入 425.2.a 的 Reveal 合法性。
 */
const noxusSaboteur = {
  canonicalCardId: "card.hash-e5d5e81a865437ba16c7a9dd066d67dc5f437867e4ec858ae5245045cc548caf",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "『Your opponents' [Hidden] cards can't be revealed here』是持续禁止（CR 425.2.a 的 Reveal 受限动作 + 811.5/811.5.a 的 Hidden 特征）：" +
    "continuous.restrict 与 static CardProgram 生命周期已合入，但 static filter binder 不能解析相对控制者的 " +
    "controller: opponent 过滤；rules/query.ts 的限制查询也尚未接到 effect.reveal 的合法性路径，" +
    "因此实际 Reveal 仍不会被禁止。还需按 811.5.a 区分 facedown 与 Hidden，并落实 425.2.a 的限制消费。不近似实现。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.restrict",
        actions: ["reveal"],
        restriction: "opponent-hidden-cards-cannot-be-revealed-here",
        appliesTo: {
          tag: "Hidden",
          controller: "opponent",
          zone: "board",
          sameLocationAs: "self"
        }
      }
    }
  ],
  sourceText: "Your opponents' [Hidden] cards can't be revealed here."
} satisfies CardProgram;

export default noxusSaboteur;
