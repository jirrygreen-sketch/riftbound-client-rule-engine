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
 * has no complete executable path:
 * 1. The static-binder path exists (programs/statics.ts resolves the ability
 *    controller and registers the CardProgram filter into layers/LayerEngine;
 *    the golden exercises it in memory). KeywordGrantLayerEngine can now
 *    re-expand a runtime Assault into its attacker-conditioned Might effect,
 *    but production card-program lifecycles still use the ordinary layer path
 *    and do not feed granted keywords into that re-expander.
 * 2. The Equipment propagation path (718.3: an Attached card's Effect Text is
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
    "「Your Equipment each give [Assault]」的本体（按能力控制者过滤 board 上的 Equipment 并授予 Assault）" +
    "已能经 engine-core programs/statics 的绑定执行：golden 经 createProgramBinding + attachLifecycle 实证" +
    "己方 Equipment 得到 Assault、对手 Equipment 与无 Equipment 标签的 Gear 不受，detach 后消失；" +
    "仍判 judge-required 的当前缺口：" +
    "(1) KeywordGrantLayerEngine 已能把被授予的 Assault 展开成 effects/keywords/Assault.ts 定义的" +
    "「作为攻击者 +X [M]」算术静态效果（807.1.c），但 production card-program lifecycle 仍使用普通 layer path，" +
    "没有把授予关键词喂给该 re-expander；(2) 718.3 的 Attached 卡 Effect Text 追加到 Top-Most 卡的传播没有可执行桥接，" +
    "被授予的 Assault 因此到不了该 Equipment 所装备的单位。" +
    "复核实测：授予记录为 { id: \"Assault\", value: undefined }（807.1.b.3 无印刷数值）；" +
    "普通 layer path 仍只保留该特征，不能据此宣称生产端已产出 Might。不近似实现（不写成单卡专用结算，也不改成数值修正）。",
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
