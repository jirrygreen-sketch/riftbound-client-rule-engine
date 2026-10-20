
/**
 * Long Sword (sfd-022-221) — Rumble SFD Gear (Equipment, printed Might
 * Bonus +2, play cost 2 Energy + 1 Fury Power).
 *
 * Printed text: "[Quick-Draw] (This has [Reaction]. When you play it, attach
 * it to a unit you control.) / [Equip] :rb_rune_fury: (:rb_rune_fury::
 * Attach this to a unit you control.)"
 *
 * Both abilities are keyword references (contract 3.1 / 3.7). Quick-Draw
 * (CR 819) expands to a Reaction timing grant for this Gear plus a mandatory
 * card-played trigger that attaches it to a Unit you control. Equip (CR 818)
 * expands to an action-speed activated attach; its printed cost is one Fury
 * Power and no Energy, passed to the expansion through params.cost (contract
 * 3.8.3). `value` / `costDomain` remain the descriptive record of the symbol.
 *
 * status = judge-required. Verified through the real ProgramBinding /
 * ChainEngine path (test/cards/sfd/long-sword.test.mjs): a Main-Phase play
 * pays 2 Energy + 1 Fury and the Quick-Draw trigger attaches it to the only
 * friendly Unit; the Equip activation pays exactly one Fury Power and is
 * rejected atomically without one. Not yet executable: the production
 * describePlay does not consume Quick-Draw's continuous.timing Reaction grant
 * (draft.speed is "normal"), so the Gear cannot be played into a Closed Chain
 * while holding Priority (CR 819.1.b, 819.1.c); RIFT-884. The Equipment Might Bonus
 * (CR 137.3 / 435.1.d) is a rules-engine characteristic tracked by RIFT-883.
 */
export default {
  canonicalCardId: "card.hash-cab923a670e4baa826aa3de381c8b992bf33987fcb0d65feb75ca538a8681010",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Quick-Draw] 的 Reaction 出牌速度（CR 819.1.b/819.1.c）在默认生产路径未生效：programs/play.ts 的 abilitySpeed 不消费 Quick-Draw 展开的 " +
    "continuous.timing（value reaction，permissions play/attach），实测 binding.describePlay 得到 draft.speed \"normal\"，" +
    "持 Priority 的封闭链中 ChainEngine.execute 抛 \"Action is not legally timed\"；依赖 RIFT-884，不近似实现。" +
    "已真实执行：主阶段打出（2 Energy + 1 Fury）后 card-played 触发把本装备附着到唯一友方单位；[Equip] 经 params.cost 恰好支付 1 Fury Power 并附着，" +
    "无 Fury 时原子拒绝。装备 Might Bonus（CR 137.3/435.1.d）属规则引擎，由 RIFT-883 负责。",
  abilities: [
    { kind: "keyword", keyword: "quick-draw" },
    {
      kind: "keyword",
      keyword: "equip",
      value: 1,
      costDomain: "Fury",
      params: {
        cost: {
          kind: "activated",
          payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Fury"] }]
        }
      }
    }
  ],
  sourceText:
    "[Quick-Draw] (This has [Reaction]. When you play it, attach it to a unit you control.)\n[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)"
} as const;
