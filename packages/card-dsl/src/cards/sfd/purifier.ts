import type { CardProgram } from "../../ir/index.js";

/**
 * Purifier (sfd-183-221 / sfd-241-221) — Legend, Fury/Body, tag Lucian.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-183-221, verbatim):
 *   "Your Equipment each give [Assault]. (+1 :rb_might: while equipped unit is an attacker.)"
 *
 * Rules evidence (Core Rules v1.5):
 * - 807.1 / 807.1.c / 807.1.b.3: Assault is a Passive Ability keyword that is
 *   functionally short for "While I am an attacker, I have +X [M]."; when X is
 *   omitted it is presumed to be 1.
 * - "Your Equipment each give [Assault]" attaches a keyword to a set of objects,
 *   so it is a continuous ability computed by the layers system (contract 3.4)
 *   and never a chain item. 435.1.c / 718.3 append an Attached card's Effect
 *   Text to its Top-Most card, which is what the printed reminder describes
 *   ("while equipped unit is an attacker"); this program does not rewrite the
 *   Assault expansion to say so.
 * - "each" selects by characteristics with no choice left to any player, so the
 *   group is a set filter and not a TargetSpec (355.10.d: an object selected
 *   programmatically rather than chosen by the controller is not a target).
 * - "Equipment" is the Gear characteristic tag (818.1.a: Equip appears on Gear
 *   with the Equipment tag; 718.5.a: an Attached card keeps all Types and Tags),
 *   and "your" is the ability's controller (190.6.d). The filter therefore names
 *   Equipment-tagged objects on the Board controlled by that controller — the
 *   declaration shape sibling "Your <group> have/give [keyword]" Legends use
 *   (sfd/mechanized-menace.ts, sfd/forecaster.ts).
 * - The granted Assault prints no value, so none is declared; 807.1.b.3 supplies
 *   1. energy: null / power: null on the catalog record mean "no printed value"
 *   and are never turned into 0 (no cost is declared on this program at all).
 *
 * status (cards/README.md section 2): judge-required. The printed +1 Might still
 * has no executable expansion, so the grant must not be claimed as running:
 * 1. The static-binder path exists (programs/statics.ts resolves the ability
 *    controller and registers the CardProgram filter into layers/LayerEngine;
 *    the golden exercises it in memory), but production card-program lifecycles
 *    are not wired end-to-end yet.
 * 2. No consumer expands a granted keyword into its KeywordDef. layers/engine.ts
 *    only records the keyword characteristic via `applyKeyword`; nothing reads a
 *    granted Assault and applies the arithmetic "while I am an attacker, +X [M]"
 *    effect that effects/keywords/Assault.ts defines. Declaring the keyword is
 *    not the same as applying it, so 807.1.c's +1 Might never happens.
 * 3. The Equipment propagation path (718.3: an Attached card's Effect Text is
 *    appended to its Top-Most card) has no executable bridge, so a granted
 *    Assault cannot reach the equipped unit through the attached Equipment.
 * Dependencies: the granted-keyword expansion consumer and the 718.3 Equipment
 * propagation bridge. Nothing is approximated: the grant is not inlined as a
 * per-card Might change, and no printed value is invented.
 */
export default {
  canonicalCardId: "card.hash-d6988e3c4bfaf3cd84e8451ade514abc99df9e47acaa479d8e17bd78b14d1db5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Your Equipment each give [Assault]」目前只被声明，尚无已合入路径让它生效，故不声称可执行：" +
    "(1) 没有调用方把 CardProgram 的 static 能力注册成 layers/LayerEngine 的 ContinuousEffectSpec" +
    "（registerContinuousEffect 无调用方，engine-core 从不读取 CardProgram.abilities；同 ogn/windswept-hillock、" +
    "ogn/trifarian-war-camp、rad/packed-amphitheater 记录的同一缺口，属 RIFT-91 后续接线）；" +
    "(2) 没有消费方把被授予的关键词展开成 KeywordDef——layers/engine.ts 的 applyKeyword 只写入关键词特征，" +
    "没有任何已合入路径读取被授予的 Assault 并产出 effects/keywords/Assault.ts 定义的「作为攻击者 +X [M]」" +
    "算术静态效果（807.1.c），所以印刷的 +1 Might 不会发生（RIFT-81 的展开消费）；" +
    "(3) 「you」占位符未绑定：layers/filter.ts 的选择符只认 self/opponent/any 与 playerId 对象，" +
    "`controller: \"controller\"` 当前匹配不到任何对象（fail-closed：不会错误授予对手的 Equipment，" +
    "但也不会到达控制者的 Equipment），绑定到能力控制者属于占位符绑定工作（chain/engine.ts 只归一化 self/opponent）。" +
    "依赖 RIFT-91 与 RIFT-81；不近似实现（不写成单卡专用结算，也不改成数值修正）。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.grant-keyword",
        // The registered KeywordId of effects/keywords/Assault.ts (contract 3.7).
        keyword: "Assault",
        filter: {
          zone: "board",
          // "Your" = the ability's controller (190.6.d); the placeholder
          // spelling follows the sibling static-grant programs.
          controller: "controller",
          // "Equipment" is the Gear tag (818.1.a / 718.5.a).
          tags: ["Equipment"]
        }
      }
    }
  ],
  sourceText:
    "Your Equipment each give [Assault]. (+1 :rb_might: while equipped unit is an attacker.)"
} satisfies CardProgram;
