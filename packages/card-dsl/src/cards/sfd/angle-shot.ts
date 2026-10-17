import type { CardProgram, TargetSpec } from "../../ir/index.js";

/**
 * Angle Shot (sfd-011-221) — Spell, 2 Energy, no printed Power, Fury.
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Choose a unit and an Equipment with the same controller. Attach that
 *   Equipment to that unit or detach that Equipment from that unit. Draw 1.
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json, sfd-011-221):
 * cardType Spell, domains ["Fury"], energy 2, power null, might null, tags [].
 * power null means no printed Power and is never rewritten as 0.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is a Permissive keyword declared on the card; 159.2.b
 *   grants the Closed-State permission through the keyword registry and the
 *   chain's timing query (contract 3.5/3.7).
 * - "Choose a unit and an Equipment" picks specific Game Objects in a Public
 *   zone (355.10.a.1), so both are Targeted (355.5, 355.7); "Unit" and "gear"
 *   refer to Board objects unless stated otherwise (355.9.a.1), and the
 *   Equipment is a Gear carrying the Equipment tag (818.1.a). Both choices are
 *   declared as TargetSpecs and locked while the spell is finalized (355.8).
 *   The two sentences' "that Equipment"/"that unit" refer back to those same
 *   chosen objects, so the mode bodies read them with `{ target: … }` selectors
 *   rather than choosing again.
 * - "with the same controller" makes this a 355.11 group requirement: the two
 *   chosen objects must collectively satisfy a restriction (355.11.a), and the
 *   controller must re-pick a legal subset at resolution if the group stops
 *   qualifying (355.11.b). The merged target system carries the group shape
 *   (`TargetRequirement.kind` / `group`) but evaluates no group-level relation,
 *   and no filter anchor expresses "same controller as the other chosen
 *   object" (the anchors in contract 3.6 cover object identity, location,
 *   attachment and exclusion, not controller equality). Both TargetSpecs
 *   therefore keep a group marker plus the descriptive `sameControllerAs`
 *   relation so the restriction is reviewable instead of silently dropped.
 * - "Attach that Equipment to that unit or detach that Equipment from that
 *   unit" is a two-mode choice (355.3 / 355.11): each mode is written as
 *   `choice.mode` with its own instruction body (contract 3.9), the merged
 *   `effect.attach` (435.1/435.4, host and objects named by their TargetSpecs)
 *   and `effect.detach` (436.1/436.3, the chosen object consumed through a
 *   non-target selection) respectively.
 * - "Draw 1." is a separate sentence: it is not a reference to the attach or
 *   detach action, so it is not linked and resolves even when the chosen mode
 *   does nothing (359.3.e.14, 359.3.e.11).
 *
 * Status: judge-required. The 355.11 "same controller" group requirement has no
 * evaluable form: neither `finalizeTargetPlan` nor the merged query anchors
 * compare two chosen objects' controllers, and the 355.11.b subset re-choice
 * has no implementation. Nothing is approximated — the group marker records the
 * restriction instead of dropping it, and the mode bodies use only merged
 * primitives so the attach/detach/draw behaviour is executable once the group
 * constraint exists.
 */
const targets: TargetSpec[] = [
  {
    id: "angle-shot.unit",
    // 355.9.a.1: "unit" means a Board object unless stated otherwise.
    filter: { type: "unit", zone: "board" },
    // 355.11 / 355.11.a: the two choices must collectively satisfy "with the
    // same controller"; the group marker and the descriptive relation carry the
    // restriction (no merged consumer, see judgeReason).
    kind: "group",
    group: true,
    sameController: true,
    min: 1,
    max: 1,
    selection: "one"
  },
  {
    id: "angle-shot.equipment",
    // 818.1.a: Equip appears on Gear with the Equipment tag; the Equipment is
    // still a Board object (152.1 gives Gear a Location).
    filter: { type: "gear", tags: "Equipment", zone: "board" },
    kind: "group",
    group: true,
    sameController: true,
    min: 1,
    max: 1,
    selection: "one"
  }
];

export default {
  canonicalCardId: "card.hash-0aa655446cb6202a49e06ffc288e4168bfbedf9b8c922547654f678c148c63d4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 355.11 的分组目标约束求值：「Choose a unit and an Equipment with the same controller」要求两个选择整体满足" +
    "「同一控制者」（355.11.a），并在结算时按 355.11.b 重选合法子集；合并的目标系统只有 TargetRequirement.kind/group 的形状，" +
    "没有任何分组级关系求值，contract 3.6 的过滤器锚点也没有「与另一被选对象同一控制者」的可用键。" +
    "本卡不丢约束（两个 TargetSpec 上保留 kind: group / group: true / sameController 描述性标记），也不近似成无约束的两个独立选择。" +
    "模式分支本身用已合入原语书写：choice.mode（355.3/355.11）的两个模式分别是 effect.attach（435.1/435.4，host 与 objects 由" +
    "TargetSpec 指称）与 effect.detach（436.1/436.3，被选装备经非目标选择消费）；「Draw 1.」是独立语句、不链接，" +
    "按 359.3.e.11/359.3.e.14 在任一模式被忽略时仍结算，故整卡的 draw 部分有真实执行测试。" +
    "依赖：355.11 分组目标关系求值与 355.11.b 结算时子集重选（target-plan 目前只做单成员合法性与 min/max）。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      // Printed cost (2 Energy, no Power) comes from the catalog; the Finalize
      // cost plan is its consumer.
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 }
      },
      body: [
        {
          // "Attach that Equipment to that unit or detach that Equipment from
          // that unit" — one mandatory mode choice (355.3), one body per mode
          // (contract 3.9). The two TargetSpecs are declared on the choice node
          // so both objects are locked with the spell (355.8).
          id: "angle-shot.mode",
          op: "choice.mode",
          args: {
            count: { kind: "constant", value: 1 },
            different: { kind: "constant", value: true },
            prompt: {
              kind: "constant",
              value: "Attach that Equipment to that unit, or detach it?"
            },
            modes: {
              kind: "constant",
              value: [
                {
                  id: "angle-shot.attach-mode",
                  body: [
                    {
                      id: "angle-shot.attach",
                      op: "effect.attach",
                      args: {
                        // 435.1/435.4: the chosen Equipment becomes Attached to
                        // the chosen unit; the attach GameAction owns the
                        // re-attachment and the co-location rules.
                        objects: {
                          kind: "constant",
                          value: { kind: "target", id: "angle-shot.equipment" }
                        },
                        host: {
                          kind: "constant",
                          value: { kind: "target", id: "angle-shot.unit" }
                        }
                      }
                    }
                  ]
                },
                {
                  id: "angle-shot.detach-mode",
                  body: [
                    {
                      id: "angle-shot.detach",
                      op: "effect.detach",
                      args: {
                        // 436.3: Detach does not inherently choose or target, so
                        // the already-chosen Equipment is consumed as the
                        // non-target selection naming that same object.
                        pick: { kind: "constant", value: "angle-shot.chosen-equipment" }
                      },
                      picks: [
                        {
                          id: "angle-shot.chosen-equipment",
                          // The options are the object already selected by the
                          // group target above; no second choice is made.
                          options: [
                            { kind: "target", id: "angle-shot.equipment" }
                          ],
                          filter: { type: "gear", tags: "Equipment" },
                          min: 1,
                          max: 1,
                          selection: "one"
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          },
          targets
        },
        {
          // "Draw 1." — an independent sentence: it references neither the
          // attach nor the detach action, so it is not linked (359.3.e.14) and
          // still resolves when a mode is ignored (359.3.e.11).
          id: "angle-shot.draw",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Choose a unit and an Equipment with the same controller. Attach that Equipment to that unit " +
    "or detach that Equipment from that unit. Draw 1."
} satisfies CardProgram;
