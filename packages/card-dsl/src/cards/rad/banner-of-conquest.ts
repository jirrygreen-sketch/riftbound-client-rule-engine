import type { CardProgram } from "../../ir/index.js";

/**
 * Banner of Conquest (rad-002-167) — Gear, 1 Energy + 1 Fury Power, tag Device.
 *
 * Printed text (deck-catalog.json, rad-002-167, verbatim):
 *   [Deploy] (Play this only to a battlefield. When an opponent holds here, kill
 *   this.)
 *   Friendly units here have [Assault]. (+1 :rb_might: while they're attackers.)
 *
 * Rules evidence (Core Rules v1.5):
 * - 830.1 / 830.1.a / 830.1.b: Deploy is a Passive and Triggered Ability
 *   keyword present on Gear, functionally short for “This may be played or
 *   created to any battlefield”, “Play or create this only to a battlefield”,
 *   “If this is not a unit, it is not recalled in cleanups” and “When an
 *   opponent holds here, kill this.” The card only declares the keyword; the
 *   expansion belongs to the keyword registry (contract 3.7).
 * - 807.1 / 807.1.b / 807.1.b.3 / 807.1.c: Assault is a Passive keyword on
 *   Units, functionally short for “While I am an attacker, I have +X [M]”;
 *   with X omitted it is 1. The printed grant carries no value, so the granted
 *   instance is Assault 1 (the reminder text states exactly that).
 * - 364.2 / 364.3: “Friendly units here have [Assault]” is a statement of fact
 *   — a Passive Ability — whose scope is the source Gear's Battlefield. 053.3
 *   makes “here” refer to that location; 716-style continuous grants are
 *   evaluated in the ability layer (contract 3.4 order copy → trait → ability
 *   → arithmetic).
 * - 135.2.d.3: both parenthesised reminders summarise rules already stated by
 *   the keywords; they author no extra instructions.
 *
 * Status: judge-required. The Deploy KeywordDef merged (RIFT-267,
 * effects/keywords/Deploy.ts) and expands 830.1.b into a
 * continuous.location permission plus the opponent-Hold kill trigger, but
 * two consumers are still missing:
 * - the location permission is only recorded: the layers rules query exposes
 *   it (layers/rules/query.ts playLocations) while the Finalize placement
 *   validator and cleanup's non-Unit recall exemption do not read it;
 * - "Friendly units here have [Assault]" is a static ability-layer grant, but
 *   no card-program adapter binds static abilities to the layer registry
 *   (RIFT-257); the merged continuous.grant-keyword primitive has no caller
 *   for a card static ability. The static ability below is the contract 3.1
 *   shape the layers system consumes, retained for review.
 * Not approximated: the grant is not collapsed into a +1 Might arithmetic
 * effect (807.1.c applies only while the unit is an attacker) and the Deploy
 * half is not dropped.
 */
const bannerOfConquest = {
  canonicalCardId: "card.hash-d0b3281a9fa74bb53091f97ba42c80b0e2e28e4604f24e8ea9af80e1316c03d9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) Deploy KeywordDef 已合入（RIFT-267，effects/keywords/Deploy.ts），把 830.1.b 展开为 " +
    "continuous.location 许可 + opponent-Hold 消灭触发；但许可只被记录：layers/rules/query.ts 的 " +
    "playLocations 暴露它，Finalize 的合法位置校验与清理的非单位 Gear 免召回都还不读取。" +
    "(2)「Friendly units here have [Assault]」是 ability 图层的关键词授予（契约 3.4 图层顺序），" +
    "已合入的 continuous.grant-keyword 原语没有卡牌静态能力的调用方，也没有 CardProgram → 图层注册的" +
    "适配器（RIFT-257）。依赖：位置许可消费者、静态授予注册路径（RIFT-257）。" +
    "不近似实现：不把授予折算成 +1 Might 的 arithmetic 效果（807.1.c 只在作为攻击者时生效），也不丢掉 Deploy 半段。",
  abilities: [
    // 830.1：印刷的 [Deploy] 声明；展开由关键词注册表负责（当前没有 Deploy 定义）。
    { kind: "keyword", keyword: "deploy" },
    {
      // 「Friendly units here have [Assault]」——ability 图层的关键词授予。
      // “here” 用 sameLocationAs: "self" 锚定来源战场（契约 3.6 / 053.3）；
      // 未带数值 ⇒ Assault 1（807.1.b.3）。
      kind: "static",
      effect: {
        kind: "continuous.grant-keyword",
        keyword: "Assault",
        value: { kind: "constant", value: 1 },
        filter: {
          zone: "board",
          type: "unit",
          controller: "self",
          sameLocationAs: "self"
        }
      }
    }
  ],
  sourceText:
    "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
    "Friendly units here have [Assault]. (+1 :rb_might: while they're attackers.)"
} satisfies CardProgram;

export default bannerOfConquest;
