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
 * Status: judge-required. Two merged gaps, neither approximated:
 * - No merged primitive registers a continuous keyword grant: no instruction
 *   in effects/instructions/ calls ResolveContext.addContinuous (the closest
 *   merged writes are the effect.buff counters and the keyword registry
 *   declarations), so "give it [Tank] this combat" cannot be expressed by any
 *   executable opcode. The body instruction is authored as the
 *   continuous.grant-keyword shape the keyword/layers tasks describe.
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
    "「Give it [Tank] this combat」两处已合入缺口：" +
    "（1）没有任何已合入原语注册持续效果（effects/instructions/ 下无 addContinuous 调用），" +
    "「本战斗内赋予 [Tank]」缺 continuous.grant-keyword 形状的原语/图层消费者（815.1.b、815.2、815.3；依赖 RIFT-91 layers-continuous 与关键词展开任务）；" +
    "（2）即便授予落地，战斗伤害指派也未实现 Tank 要求——base-combat-allocation.ts 明确无 Tank/Backline 指派优先要求绑定（815.1.c.1 / 815.1.c.2）。" +
    "目标选择（355.5 / 355.7 / 355.10：choose a unit you control here 属 Finalize 的目标选择）与 defense-declared 触发形状已保留供审查；不近似实现。",
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
