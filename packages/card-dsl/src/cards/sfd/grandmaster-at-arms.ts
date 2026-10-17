import type { Ability, CardProgram, ObjectFilter } from "../../ir/index.js";

/**
 * Grandmaster at Arms (sfd-193-221 / sfd-245-221) — Legend, Calm/Body, tag Jax.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-193-221, verbatim):
 *   ":rb_energy_1:, :rb_exhaust:: Attach a detached Equipment you control to a unit
 *    you control.\n:rb_exhaust:: Attach an attached Equipment you control to a unit
 *    you control."
 *
 * Rules evidence (Core Rules v1.5):
 * - 404.1.a / 415.5: everything before each printed ":" is that activated
 *   ability's base cost. Ability 1 costs 1 Energy plus the exhaust symbol;
 *   ability 2 costs only the exhaust symbol. Both are declared in the CostSpec
 *   and charged by the chain at Finalize (contract 3.5) — never as body
 *   instructions. Neither printing carries [Action] or [Reaction], so both are
 *   ordinary action-speed activations (381.1).
 * - 435.4 / 435.4.a: attaching a card moves it to the new Top-Most card's
 *   location, which is what the printed second line accomplishes for the
 *   intended "re-attach to a second unit". 435.1.f: attaching a card to a new
 *   Top-Most card detaches it from the old one; 435.1.g / 435.1.i: attaching it
 *   to the card it is already on has no effect. effect.attach submits one
 *   `attach` game action, so both rules are the kernel's, not this program's.
 * - "a detached Equipment you control": detached is the complement of the
 *   Attached status (718.1 / 718.6 keeps only non-Units in that state), which
 *   ObjectFilter spells as `states: "attached"`; the negation is expressed with
 *   the anchor that can read the runtime field: `characteristics: { attachedTo: null }`
 *   compares the object's `attachedTo` characteristic to null (layers/filter.ts
 *   characteristicsMatch; TestWorld's ObjectSnapshot has `attachedTo: ObjectRef | null`).
 * - "an attached Equipment you control": the Attached status itself, i.e.
 *   `states: "attached"`.
 * - "Equipment" is the Gear characteristic tag (818.1.a / 718.5.a), and each
 *   "you control" is the ability's controller (190.6.d), so the Equipment group
 *   filters on `type: "gear"`, `tags: ["Equipment"]`, `controller: "self"`.
 * - "to a unit you control": the host choice is a target (355.10 / 355.9.a.1),
 *   and the host must be a Unit because 435.1.h.1 / 718.6 make attaching to a
 *   non-Unit do nothing; effect.attach additionally requires exactly one Unit
 *   host.
 * - The chosen Equipment is also targeted (355.9.a.1: an object chosen by the
 *   spell or ability's controller is a target), so both selections are TargetSpecs
 *   rather than picks (355.7).
 *
 * Current status: judge-required. Both cost/attach paths and the production
 * createProgramBinding machinery are merged (describeActivate produces both
 * drafts with their locked target specs). Legend Zone (107.4.a–d) still has no
 * ZoneId, and cost/payment.ts only accepts an exhaust payment on a ready
 * controlled Board or Rune-Zone object (415.4/415.5), so the printed
 * ":rb_exhaust:" cannot be paid from the Legend's real zone. The Board/Base
 * fixture verifies only the supported subpaths, not activation from the
 * Legend's actual zone.
 */

/** Shared TargetSpec ids; each ability declares its own group because targets are ability-local. */
function attachAbility(id: string, equipmentId: string, hostId: string, equipmentFilter: ObjectFilter, energy: number | null): Ability {
  return {
    kind: "activated",
    timing: "action",
    cost: {
      kind: "activated",
      ...(energy === null ? {} : { energy: { kind: "constant", value: energy } }),
      payments: [{ kind: "exhaust", object: "self" }]
    },
    body: [
      {
        id,
        // 435.1.f / 435.4: one attach action re-attaches the chosen Equipment to
        // the chosen host and moves it to that host's location. No separate
        // detach/move/control action is written.
        op: "effect.attach",
        args: {
          objects: { kind: "constant", value: { kind: "target", id: equipmentId } },
          host: { kind: "constant", value: { kind: "target", id: hostId } }
        },
        targets: [
          {
            id: equipmentId,
            filter: equipmentFilter,
            min: 1,
            max: 1,
            selection: "one"
          },
          {
            id: hostId,
            // 355.9.a.1 / 435.1.h: "a unit you control" is a target and must be
            // a Unit for the attach to do anything.
            filter: { type: "unit", controller: "self", zone: "board" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  };
}

const grandmasterAtArms = {
  canonicalCardId: "card.hash-9ce83a420f4ca5ab0a7f43d95f5f4a698cd4c4b8ca2b7453cfdad2c9ae9f38ef",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两条能力的 Finalize 费用、Equipment/Unit 目标与 effect.attach 均已合入；createProgramBinding " +
    "已接入 programs/activate.ts，无需再等待启动注册机制。当前缺口是 Legend Zone（107.4.a–d，含 107.4.c）：" +
    "ZoneId 没有该区域，且 cost/payment.ts 只接受 board/rune-zone 上的横置对象（415.4/415.5），" +
    "传奇无法在真实区域支付 :rb_exhaust:，也没有对应的来源活动区域绑定。golden 的 board/Base 来源仅验证费用和附着子路径，" +
    "不能作为传奇在真实区域可启动的证据。",
  abilities: [
    attachAbility(
      "grandmaster-at-arms.attach-detached",
      "grandmaster-at-arms.detached-equipment",
      "grandmaster-at-arms.unit-a",
      {
        type: "gear",
        tags: ["Equipment"],
        controller: "self",
        zone: "board",
        // "a detached Equipment": not currently Attached (718.1).
        characteristics: { attachedTo: null }
      },
      1
    ),
    attachAbility(
      "grandmaster-at-arms.reattach-attached",
      "grandmaster-at-arms.attached-equipment",
      "grandmaster-at-arms.unit-b",
      {
        type: "gear",
        tags: ["Equipment"],
        controller: "self",
        zone: "board",
        // "an attached Equipment": currently Attached (718.1).
        states: "attached"
      },
      null
    )
  ],
  sourceText:
    ":rb_energy_1:, :rb_exhaust:: Attach a detached Equipment you control to a unit you control.\n" +
    ":rb_exhaust:: Attach an attached Equipment you control to a unit you control."
} satisfies CardProgram;

export default grandmasterAtArms;
