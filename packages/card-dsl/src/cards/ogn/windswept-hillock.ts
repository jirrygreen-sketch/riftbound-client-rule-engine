import type { CardProgram } from "../../ir/index.js";

/**
 * Windswept Hillock (ogn-297-298) — Battlefield, Colorless.
 *
 * sourceText:
 *   Units here have [Ganking]. (They can move from battlefield to battlefield.)
 *
 * CR v1.5 anchors:
 * - 810 / 810.1 / 810.1.c: Ganking is a Passive Ability keyword that adds the
 *   Battlefield→Battlefield option to a Unit's Standard Move (810.1.c.1 adds
 *   options without removing any; 810.1.c.2 has no cost; 810.1.c.3 grants no
 *   extra Move). 810.3: whether a unit has Ganking is a readable characteristic.
 * - 144.4.c / 144.4.c.1: units with Ganking may use their Standard Move from
 *   Battlefield to Battlefield.
 * - 479.3.b: "have [keyword]" is an ability-altering static effect ("have" is
 *   the identifying phrase).
 * - 053.3: "here" is this Battlefield.
 *
 * Status: judge-required (reviewed 2026-10-18).
 * The instruction path can grant Ganking to units here. KeywordGrantLayerEngine
 * also supports value-based LocationRef matching and expands granted Ganking
 * into a consumable movement permission; the golden exercises this card's
 * unchanged static ability with that adapter for both players and moving units.
 * Default ChainEngine still uses ordinary LayerEngine: its filter compares
 * LocationRef by object identity, and its lifecycle does not re-expand granted
 * keywords. These are default-path integration gaps, not missing primitives.
 * This symmetric passive ability makes no choices and contains no relative
 * player reference; CR 190.6 controller resolution is not a blocker for it.
 */
export default {
  canonicalCardId: "card.hash-ce3c166d72907a0d5807cb816eb9409a1ebc640347881bf29b083c9f4789e4de",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口（复核 2026-10-18）：默认 ChainEngine 使用普通 LayerEngine，未接入 " +
    "KeywordGrantLayerEngine。(1) static binder 把 053.3 的 sameLocationAs 折成 LocationRef 后，" +
    "默认 layers/filter.ts 仍按对象同一性比较位置，同值但不同对象的同址单位匹配失败。" +
    "(2) 默认 attachProgramLifecycle 不对运行时授予的 Ganking 二次展开，因而不能生成 " +
    "810.1.c / 144.4.c.1 的 movement 许可，无法在 hasGanking:false 时从本卡静态授予获得战场间移动权限。" +
    "依赖：默认生产链路集成关键词图层适配器及同址值比较。" +
    "不近似实现。",
  sourceText: "Units here have [Ganking]. (They can move from battlefield to battlefield.)",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.grant-keyword",
        keyword: "Ganking",
        // 479.3.b ability layer: grant the keyword to every unit (both
        // controllers) at this Battlefield; 053.3 "here" travels as
        // sameLocationAs, evaluated by the interpreter and keyword-layer adapter
        // (default layer matching still needs integration; see judgeReason).
        filter: {
          type: "unit",
          zone: "board",
          sameLocationAs: "self"
        }
      }
    }
  ]
} satisfies CardProgram;
