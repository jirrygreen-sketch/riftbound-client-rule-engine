import type { CardProgram } from "../../ir/index.js";

/**
 * Durand Memorial (rad-161-167) — Battlefield (domainless, RAD).
 *
 * Printed text:
 *   When you defend here, choose a unit you control here. Give it [Tank] this
 *   combat. (It must be assigned combat damage first.)
 *
 * Rules evidence (Core Rules v1.5):
 * - 383.1: "When you defend here" is a Triggered Ability; the merged
 *   "defense-declared" timing point (refs 323.2 / 383.4.f / 466.2.c) is the
 *   subscription point.
 * - 355.5 / 355.7 / 355.10: "choose a unit you control here" is a Choice of a
 *   specific Game Object made during Finalize. It is not part of a cost, a
 *   trigger condition or a replacement effect, so the chosen unit is a
 *   TARGET (355.10's exemptions do not apply); it is modelled with a
 *   TargetSpec, not a pick.
 * - 815.1.b: Tank is functionally "I must be assigned lethal damage before any
 *   other unit with the same controller as me that does not have [Tank]";
 *   815.2: multiple instances of Tank are redundant ("single" stacking);
 *   815.3: having Tank is a characteristic other effects may check.
 * - "this combat" is a duration that ends with the current Combat, i.e. the
 *   end-of-combat duration of the layers/continuous system.
 *
 * Status: judge-required (re-checked 2026-10-16). Current gaps, none approximated:
 * - "give it [Tank] this combat" is expressible: the merged
 *   continuous.grant-keyword primitive (RIFT-258) registers the ability-layer
 *   keyword with an end-of-combat duration. The golden test executes it and
 *   reads the granted Tank back through the layers engine. What is missing is
 *   the card-program binding that registers the card's own ability
 *   (RIFT-257) plus an emitted defense-declared timing point.
 * - Even with the grant available, combat damage assignment does not implement
 *   the Tank requirement: base-combat-allocation.ts states "No
 *   Tank/Backline/other assignment-priority requirement is bound here".
 * The trigger and target shape stay recorded for review.
 */
export default {
  canonicalCardId: "card.hash-97d6652832570169cee7f8ada60deed43c5e7d3c133950eed2de4fe1f0818f76",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处当前缺口：(1) 没有已合入路径把 CardProgram 的 triggered ability 注册成 TriggerRegistration（RIFT-257 卡牌程序绑定），" +
    "本卡的 defense-declared 触发无法从卡牌数据侧进链；(2) defense-declared 时点尚无生产者——combat/flow.ts 的角色事务" +
    "明确抛 combat-start-transaction（docs/rules/timing-point-producers.md 标为待后续，466.2.c）；" +
    "(3) 即便关键词授予落地，战斗伤害指派也未实现 Tank 要求——base-combat-allocation.ts 明确无 Tank/Backline 指派优先要求绑定" +
    "（815.1.c.1 / 815.1.c.2）。" +
    "已合入部分：「Give it [Tank] this combat」用 continuous.grant-keyword（RIFT-258）建立 ability 层注册、" +
    "duration end-of-combat（815.1.b、815.2、815.3），golden 经真实解释器执行并回读图层关键词；" +
    "目标选择（355.5 / 355.7 / 355.10：choose a unit you control here 属 Finalize 的目标选择）已按 TargetSpec 保留；不近似实现。",
  sourceText:
    "When you defend here, choose a unit you control here. Give it [Tank] this combat. (It must be assigned combat damage first.)",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "defense-declared",
        // "When you defend here": "self" is the merged PlayerSelector spelling
        // for the ability's controller; "here" is a descriptive placeholder
        // for the source-battlefield anchor the merged EventPattern lacks.
        filter: { event: "defense-declared", here: true, player: "self" }
      },
      optional: false,
      body: [
        {
          // "Give it [Tank] this combat" — the target below is the chosen
          // unit; keyword/duration name the intended grant (815.1.b, "this
          // combat" = end-of-combat duration). No merged primitive registers
          // a continuous effect, so the op is the pending
          // continuous.grant-keyword shape (see judgeReason).
          id: "durand-memorial.grant-tank",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Tank" },
            duration: { kind: "constant", value: "end-of-combat" }
          },
          targets: [
            {
              id: "durand-memorial.chosen-unit",
              filter: {
                // "a unit you control here": the controller's own unit ("self"
                // is the spelling the merged query normalizer binds to the
                // ability controller). "here" is a descriptive placeholder:
                // anchoring the target to the source Battlefield's location
                // (the sameLocationAs selector) still depends on the pending
                // source-battlefield location binding.
                type: "unit",
                controller: "self",
                here: true
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;
