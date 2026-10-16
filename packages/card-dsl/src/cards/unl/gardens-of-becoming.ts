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
 * Status (packages/card-dsl/src/cards/README.md §2): judge-required — the
 * granted activated ability (exhaust cost + effect.xp) is fully expressible,
 * but nothing grants it:
 * - there is no merged `continuous.grant-ability` / `continuous.grant-keyword`
 *   primitive that attaches a complete activated ability to a set of objects
 *   while preserving source, payment, targets and duration (the layers engine
 *   consumes might / keyword / type / tag / timing / movement / text effects,
 *   not ability bodies), and no merged path turns a CardProgram's static
 *   ability into a ContinuousEffectSpec (registerContinuousEffect has no
 *   caller). Same gap sfd/forge-of-the-fluft and ogn/heimerdinger-inventor
 *   record;
 * - the activated ability's cost is an Exhaust cost (415.5): the cost plan
 *   exists in cost/ (payments: [{ kind: "exhaust" }]), but no merged primitive
 *   activates a granted ability, so the ability can never be started;
 * - layers/filter.ts implements no `sameLocationAs` "here" anchor and matches
 *   `controller` only by literal value, so a registered grant would either
 *   never match or leak to units at other Battlefields;
 * - 190.6's controller resolution for a Battlefield ability is missing.
 * The grant shape was kept reviewable (a `static` ability whose effect carries
 * the granted activated ability), and the golden test executes the granted
 * body's own primitive (effect.xp) plus the exhaust cost plan through the real
 * kernel — that is a layer check of the granted ability, not proof that the
 * grant is installed. Dependencies: RIFT-89 (cost.* activation) and RIFT-91
 * (layers-continuous ability grant), plus RIFT-9's continuous.grant-ability.
 */
export default {
  canonicalCardId:
    "card.hash-ea5887640ac2868198c368d889903ebf8fd5895f4ac0b6e2f8db54a5178aad74",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺「把一条完整启动能力授予一组对象」的持续效果：① effects/instructions/ 没有 continuous.grant-ability / continuous.grant-keyword " +
    "原语文件（RIFT-9 清单里的授予族；layers/engine.ts 只消费 might/keyword/type/tag/timing/movement/text 类效果，不消费能力正文），" +
    "也没有已合入路径把 CardProgram 的 static 能力注册成 layers/LayerEngine 的 ContinuousEffectSpec（registerContinuousEffect 无调用方；" +
    "同 sfd/forge-of-the-fluft、ogn/heimerdinger-inventor 的缺口）。" +
    "② 被授予能力的费用是 :rb_exhaust:（415.5；381.1 默认时机、415.4 费用必须可支付）：cost/ 的费用计划能表达 payments: [{ kind: \"exhaust\" }]，" +
    "但没有已合入原语「启动一条被授予的能力」，该能力无法被启动。" +
    "③ layers/filter.ts 不实现 053.3 的 sameLocationAs（here）锚点，且 controller 只做字面量比较，注册后会永不匹配或泄漏到其它战场的单位。" +
    "④ 190.6 的战场能力控制者解析缺失。" +
    "golden 用参考内核真实执行「授予能力本体（effect.xp）」与横置费用计划，验证的是被授予能力的形状/可执行性，不是授予已安装；不近似实现。" +
    "依赖：RIFT-89（费用激活）、RIFT-91（layers 能力授予）、RIFT-9 continuous.grant-ability。",
  sourceText: 'Units here have ":rb_exhaust:: Gain 1 XP."',
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.grant-ability",
        appliesTo: "units-here",
        // 053.3 + 740.1.a: every unit (both controllers) at this Battlefield.
        // sameLocationAs carries the "here" referent; the merged layers filter
        // does not implement that anchor yet (see judgeReason).
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
