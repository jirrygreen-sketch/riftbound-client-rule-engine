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
 *   所在位置（421.1）。按 RIFT-9 原语清单，这类一般许可 / 禁止 / 数量限制归
 *   continuous.restrict（依赖 condition.predicate）。
 *
 * 结构说明: 单个 static 能力，effect.kind = "continuous.restrict"，禁止对象为对手
 * 拥有/控制的、位于本卡所在位置的 Hidden 牌执行 Reveal（operation: "reveal"、
 * forbidden: true、sameLocationAs: "self"、tag: "Hidden"）。按 811.1.a，Hidden 出现在
 * Spell / Unit / Gear 上，所以不按卡型收窄（面朝下时不再是 Hidden，811.5.a）。
 *
 * 未合入依赖（不近似实现）:
 * - 没有 continuous.restrict 原语（RIFT-9 清单第 27 项，依赖 condition.predicate）：
 *   effects/instructions/ 只有 effect.* 文件；"禁止优先级"（禁止压过许可）没有实现。
 * - 反向接线缺失：effect.reveal 只经 ctx.perform 提交 reveal 动作，内核没有读取持续
 *   禁止集合判断 reveal 合法性的消费方（layers（RIFT-91）只算特征）。
 * - 机制上还需要"facedown ≠ Hidden"的判定（811.5.a）与 Reveal 的受限动作合法性检查
 *   （425.2.a），两者都不属于本卡任务。
 * 依赖：RIFT-9（continuous.restrict）、RIFT-84（Hidden 关键词）、RIFT-91。
 */
const noxusSaboteur = {
  canonicalCardId: "card.hash-e5d5e81a865437ba16c7a9dd066d67dc5f437867e4ec858ae5245045cc548caf",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "『Your opponents' [Hidden] cards can't be revealed here』是持续禁止（CR 425.2.a 的 Reveal 受限动作 + 811.5/811.5.a 的 Hidden 特征）：" +
    "缺 continuous.restrict 原语（RIFT-9 清单第 27 项，依赖 condition.predicate，effects/instructions/ 只有 effect.* 文件），也缺读取持续禁止、" +
    "判断 reveal 合法性的内核消费方；还需 facedown ≠ Hidden 的判定（811.5.a）。依赖：RIFT-9（continuous.restrict）、RIFT-84（kw-deflect-hidden）、RIFT-91。不近似实现。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.restrict",
        operation: "reveal",
        forbidden: true,
        filter: {
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
