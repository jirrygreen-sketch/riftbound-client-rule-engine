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
 * status (cards/README.md section 2): judge-required. Both abilities are declared
 * with merged cost and body primitives; the printed in-game steps are executed for
 * real by the golden test. One prerequisite outside this card is still missing:
 * 1. The Legend's own zone is a recorded contract gap: CR 107.4.c puts a Champion
 *    Legend in the Legend Zone and the frozen ZoneId union has no legend-zone, so
 *    "exhaust me" cannot cite the legend's real zone in production. The sibling
 *    Legends record the same gap; this program does not work around it.
 * (The card-program registration machinery — engine-core programs/activate.ts and
 * programs/registry.ts — is merged and wired through createProgramBinding, but it
 * gates on program status, so the activation stays unbound while this program is
 * judge-required. The golden test drives the abilities through the real ChainEngine
 * by supplying the draft, which proves the cost/action/body path.)
 * Everything the printed text asks for inside the game — paying 1 Energy and/or
 * exhausting the source, choosing a detached/attached Equipment, choosing a Unit
 * host, and performing the attach — is merged and is executed for real by the
 * golden test, including the re-attachment path (435.1.f) and the no-op path when
 * the Equipment is already on the chosen host (435.1.g).
 * Dependencies: the legend-zone contract gap. Nothing is approximated: the costs
 * are not moved into resolution, and no per-card attach logic is written.
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
    "两条启动能力都已用已合入的费用与正文原语声明；卡牌程序→链注册机制也已合入" +
    "（engine-core programs/activate.ts + programs/registry.ts，经 createProgramBinding 接线），" +
    "但它按程序 status 门禁，本卡保持 judge-required 时启动仍无法从真实局面发起。" +
    "当前真实缺口是 Champion Legend 自身的区域：107.4.c 规定传奇在 Legend Zone，而冻结的 ZoneId 联合没有 legend-zone，" +
    "所以「exhaust me」在生产线里无法指向传奇的真实区域（同批传奇卡记录同一缺口，本程序不绕过）。" +
    "印刷文本在游戏内的其余要求都已合入：1 Energy 与横置来源的费用（cost/plan-values.ts + cost/payment.ts 真实检查" +
    "「必须是自己控制的、Board 上、未横置的对象」）、选择 detached/attached 的 Equipment、选择一个 Unit 宿主、" +
    "以及执行 attach（435.1.f 的换绑、435.4 的位置跟随、435.1.g 的「已附着在同一宿主上什么也不发生」都由内核动作负责）。" +
    "依赖：Legend Zone 的契约缺口。不近似实现（不把费用挪进结算正文，不写单卡专用附着逻辑）。",
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
