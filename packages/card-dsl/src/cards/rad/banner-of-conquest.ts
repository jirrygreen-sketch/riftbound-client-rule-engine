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
 * Status: judge-required (re-verified 2026-10-17). The Deploy KeywordDef
 * merged (RIFT-267, effects/keywords/Deploy.ts) and expands 830.1.b into a
 * continuous.location effect plus the opponent-Hold kill trigger, but three
 * consumers are still missing:
 * - the expanded effect is not the shape playLocations reads:
 *   layers/rules/query.ts playLocations only lifts `permission` / `restriction`
 *   strings out of the effect, while Deploy carries structured
 *   `play`/`create`/`destinationRestriction`/`movement`/`cleanup` fields
 *   (measured: playLocations returns empty permissions/restrictions), and
 *   programs/statics.ts rejects the effect with "Static ability kind
 *   continuous.location has no layer mapping";
 * - the expanded Hold trigger cannot be subscribed: `hold` is not in
 *   EVENT_PATTERN_TYPES (only `held` is, and events/pipeline-match.ts maps
 *   `held` to the `hold` timing point), while the expansion's filter also
 *   carries `here`, which is not an EventPattern field at all (programs/
 *   filters.ts rejects it). The `hold` emission in turn/flow.ts only carries
 *   details.battlefieldId.
 * - "Friendly units here have [Assault]" binds through the merged static
 *   binder (RIFT-349 createEngineStaticBinder → layers/engine.ts applyAbility),
 *   but the grant does not reach units at the source battlefield: staticFilter
 *   registers the source's location snapshot while layers/filter.ts compares
 *   `filter.location` by object identity, and every read hands back a fresh
 *   clone (measured: the registered grant matches no unit). Even with the
 *   anchor resolved, the granted Assault would still not produce Might:
 *   layers/engine.ts applyKeyword only records the keyword id, so the Assault
 *   expansion (an arithmetic modifier conditioned on the live Attacker
 *   designation, which the admitted board does not persist) has no consumer.
 * Not approximated: the grant is not collapsed into a +1 Might arithmetic
 * effect (807.1.c applies only while the unit is an attacker) and the Deploy
 * half is not dropped.
 */
const bannerOfConquest = {
  canonicalCardId: "card.hash-d0b3281a9fa74bb53091f97ba42c80b0e2e28e4604f24e8ea9af80e1316c03d9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) Deploy 展开的 continuous.location 效果没有消费者：layers/rules/query.ts 的 playLocations " +
    "只读取 permission/restriction 字符串，而 Deploy 带结构化 play/create/destinationRestriction/" +
    "movement/cleanup 字段（实测 permissions/restrictions 均为空），programs/statics.ts 也判 " +
    "Static ability kind continuous.location has no layer mapping。" +
    "(2) Deploy 展开的 Hold 触发无法订阅：hold 不在 EVENT_PATTERN_TYPES（只有 held，且 " +
    "events/pipeline-match.ts 才把 held 映射到 hold 时点），展开的 filter 还带 here，而 here 不是 " +
    "EventPattern 字段（programs/filters.ts 直接拒绝）；turn/flow.ts 的 hold 发射也只带 " +
    "details.battlefieldId。" +
    "(3)「Friendly units here have [Assault]」经静态绑定进入 ability 图层，但授予到不了" +
    "源战场上的单位：staticFilter 登记源位置快照，而 layers/filter.ts 按位置对象同一性比较，读取又返回新" +
    "克隆（实测登记的授予匹配不到任何单位）。即便锚点能解析，授予的 Assault 也不会产生 Might：layers/engine.ts " +
    "的 applyKeyword 只记录关键词 id，Assault 展开（以 Attacker designation 为条件的 arithmetic 修正，" +
    "而 admitted board 不持久化 designation）没有消费方。" +
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
