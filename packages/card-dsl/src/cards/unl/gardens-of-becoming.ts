import type { CardProgram } from "../../ir/index.js";

/**
 * Gardens of Becoming (unl-213-219) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-213-219, verbatim):
 *   "Units here have \":rb_exhaust:: Gain 1 XP.\""
 *
 * CR v1.5 anchors:
 * - 479.3 / 479.3.b: "have" is the identifying phrase of an Ability-Altering
 *   Effect (layer 3): the Battlefield grants every unit at this Battlefield a
 *   complete activated ability.
 * - 415.5 / 135.2.e.2: the printed :rb_exhaust: before the colon is the cost
 *   "Exhaust this"; 381.1 makes the granted ability's default timing the
 *   controller's Main Phase during an Open State, and 415.4 requires the cost
 *   to be payable.
 * - 728 / 730.1 / 733: "Gain 1 XP" adds 1 XP to the activated player's pool
 *   (effect.xp, the merged primitive), keyed to the controller of the source
 *   (190.6.d for the Battlefield-granted ability).
 * - 053.3: "here" is this Battlefield, so the grant reaches exactly the units
 *   at this location.
 *
 * 2026-10-18 复核：整卡仍为 judge-required；当前生产缺口见 judgeReason。
 * 已支持子效果的执行证据保留在对应 golden；不以原语存在替代整卡可执行性。
 */
export default {
  canonicalCardId:
    "card.hash-ea5887640ac2868198c368d889903ebf8fd5895f4ac0b6e2f8db54a5178aad74",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口：(1) continuous.grant-ability 尚无完整能力正文的图层消费者；programs/statics.ts 不接受 appliesTo:units-here，layerFor 也没有 grant-ability 映射（CR 479.3/479.3.b）。" +
    "(2) describeActivate 只读取卡牌自身 program 的 activated 能力，缺被授予能力的启动入口及其横置费用的生产绑定（381.1/415.4/415.5）。" +
    "(3) here 的 sameLocationAs 经默认 binder 转为绝对 location 后，layers/filter.ts 仍按引用同一性比较位置，缺按战场身份匹配（053.3）。" +
    "已有 continuous.grant-keyword、普通静态绑定、横置费用计划和 effect.xp；它们不能替代完整能力授予。",
  sourceText: 'Units here have ":rb_exhaust:: Gain 1 XP."',
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.grant-ability",
        appliesTo: "units-here",
        // 053.3 + 740.1.a: every unit (both controllers) at this Battlefield.
        // sameLocationAs carries the "here" referent; the binder resolves it
        // to an absolute location, but the layer filter still matches that
        // location by reference identity (see judgeReason).
        filter: {
          type: "unit",
          zone: "board",
          sameLocationAs: "self"
        },
        // The granted ability is the quoted text of the card: exhaust this to
        // gain 1 XP (479.3.b grants the ability; 415.5 makes [E] its cost).
        ability: {
          kind: "activated",
          timing: "action",
          cost: { payments: [{ kind: "exhaust", object: "self" }] },
          body: [
            {
              id: "gardens-of-becoming.granted-gain-xp",
              op: "effect.xp",
              args: { amount: { kind: "constant", value: 1 } }
            }
          ]
        }
      }
    }
  ]
} satisfies CardProgram;
