import type { CardProgram } from "../../ir/index.js";


/**
 * Danger Zone (sfd-182-221) — Spell, 1 energy + 1 rainbow power, Rumble
 * signature (Fury/Mind).
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   [Repeat] :rb_energy_1::rb_rune_rainbow: (You may pay the additional cost
 *   to repeat this spell's effect.)
 *   Give your Mechs +1 :rb_might: this turn.
 *
 * Status: judge-required — Repeat is selected and planned in Finalize, but its
 * printed Universal Power cannot yet be represented by the production resource
 * contract:
 * - 135.2.e.5.a makes [A] payable with Power of any Domain. plan-values.ts
 *   currently accepts the exact `["rainbow"]` spelling into the locked plan,
 *   but rejects every Universal Power requirement because it lacks a
 *   domainless resource contract. The same-as-printed cost therefore stays
 *   declared instead of being rewritten as a named Domain or as zero.
 * - The surrounding Repeat pipeline is merged: programs/play.ts normalizes the
 *   optional component, Finalize records a paid instance, and
 *   chain/interpreter-adapter.ts schedules one additional whole-body execution.
 *   This does not make Danger Zone executable while the actual rainbow payment
 *   cannot be finalized (820.1.c.1 / 820.1.d.1).
 * - The team buff is executable: continuous.might registers one arithmetic-layer
 *   modification over the programmatic "your Mechs" set for this turn, which
 *   expires at cleanup under 317.2.c. A declined Repeat pays the base cost and
 *   executes that body once through the real production chain; a paid Repeat
 *   fails closed when Finalize evaluates the Universal Power component. There is
 *   also a separate production base-cost bridge gap: a multi-Domain [C] must be
 *   one hybrid requirement (135.2.e.6.c), while bindProgramCost currently feeds
 *   the snapshot Domain list to the cost planner as per-Domain amounts. The
 *   production regression supplies one named legal [C] branch as its own base
 *   resource, so it does not exercise or approve the multi-Domain bridge bug.
 *
 * "Your Mechs" is an each-set, not a target (v1.5 355.7: "each" is not
 * targeted), so the body instruction carries no TargetSpec.
 */
const dangerZone = {
  canonicalCardId: "card.hash-3c1c01b405853556e3e1c12bbd758e94d73f5ed474a5643bb068eaa7cb549c6e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Repeat] 的可选费用选择、锁定计划与已付实例到二次结算的通用管线已经接通，但 Danger Zone 的印刷 [A]（彩虹 Power）仍无可支付生产路径（820.1.c.1 / 820.1.d.1）：" +
    "engine-core/src/cost/plan-values.ts:62-65 与 :70-73 将 rainbow 识别为 Universal Power 后直接 judge-required；" +
    "engine-core/src/cost/payment.ts:118-133 又只能从六域 PlayerSnapshot 构造资源池，无法表示 domainless Power。" +
    "生产 Finalize 实测在付款选择后以 invalid-cost-plan/Expected unique cost domains 失败，故全卡保持 judge-required。" +
    "另有独立的基础 [C] 桥接缺口：135.2.e.6.c 要求多域卡的一条 any-of-Domains Power，但 engine-core/src/programs/cost-adapters/index.ts:359-367 把快照域列表作为每个域各 1 Power 交给计划器；真实 room 的 apps/game-server/src/room.ts:280 会填该列表。" +
    "「Give your Mechs +1 :rb_might: this turn」本体已可执行：continuous.might 对 355.10.d 的程序化集合注册 arithmetic 层修正并在 317.2.c 到期；" +
    "拒绝 Repeat 的真实生产路径只付基础费用并执行一次，付费路径因上述 [A] 缺口逆反应而不产生正文副作用。",
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "[Repeat] :rb_energy_1::rb_rune_rainbow: (You may pay the additional cost to repeat this spell's effect.)\n" +
    "Give your Mechs +1 :rb_might: this turn.",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    // Keep the printed keyword identity. The play CostSpec below carries its
    // parameter because KeywordAbility has no second, cost-bearing syntax.
    { kind: "keyword", keyword: "repeat" },
    {
      kind: "play",
    // [Repeat] 1 energy + 1 rainbow rune: the production binder produces this
    // optional component, but Finalize cannot yet represent/pay its [A] value.
      cost: {
        kind: "additional-cost",
        keyword: "repeat",
        optional: true,
        energy: { kind: "literal", value: 1 },
        power: { kind: "literal", value: ["rainbow"] }
      },
      body: [
        {
          // "Give your Mechs +1 Might this turn" — each-set (no TargetSpec);
          // a duration-bounded Might modification over the programmatic set of
          // the controller's Mech units, registered by the merged
          // continuous.might primitive and expiring at cleanup.
          id: "buff-mechs",
          op: "continuous.might",
          args: {
            objects: {
              kind: "literal",
              value: {
                kind: "query",
                filter: { type: "unit", tags: ["Mech"], controller: "self", zone: "board" }
              }
            },
            amount: { kind: "literal", value: 1 },
            duration: { kind: "literal", value: "this-turn" }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default dangerZone;
