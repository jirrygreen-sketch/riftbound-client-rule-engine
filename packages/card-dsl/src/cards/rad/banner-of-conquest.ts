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
 * Status: judge-required. Two merged gaps, neither approximated:
 * - The keyword registry has no Deploy KeywordDef (effects/keywords/ has no
 *   Deploy file), so 830.1.b's four rewrites — including “When an opponent
 *   holds here, kill this.” — cannot be expanded.
 * - A keyword grant in the ability layer has no registration path: no merged
 *   instruction calls ResolveContext.addContinuous (the closest merged writes
 *   are effect.buff's counters and the keyword declarations themselves), and
 *   the CardProgram -> layer registration adapter does not exist. The static
 *   ability below is the contract 3.1 shape the layers system consumes
 *   (layers/engine.ts applyAbility recognises `keyword`), retained for review.
 * Dependencies: kw-deploy (830) and the continuous grant/registration path
 * (RIFT-91 layers-continuous consumer + the card-program adapter). Not
 * approximated: the grant is not collapsed into a +1 Might arithmetic effect
 * (807.1.c applies only while the unit is an attacker) and the Deploy half is
 * not dropped.
 */
const bannerOfConquest = {
  canonicalCardId: "card.hash-d0b3281a9fa74bb53091f97ba42c80b0e2e28e4604f24e8ea9af80e1316c03d9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) 关键词注册表没有 Deploy 的 KeywordDef（effects/keywords/ 无 Deploy 文件），" +
    "CR 830.1.b 的四项改写（可/只可打到战场、非单位 Gear 不被清理召回、对手在此固守时消灭此牌）都没有展开。" +
    "(2) 「Friendly units here have [Assault]」是 ability 图层的关键词授予（契约 3.4 图层顺序），" +
    "但没有任何已合入指令调用 ResolveContext.addContinuous（effects/instructions/ 下无该调用），" +
    "也没有 CardProgram → 图层注册的适配器（契约 3.5 / RIFT-120 后续）。" +
    "依赖：kw-deploy（830）与持续授予注册路径（RIFT-91 layers-continuous 消费者 + 卡牌程序接线）。" +
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
