import type { CardProgram } from "../../ir/index.js";

/**
 * Forecaster (sfd-065-221) — Rumble SFD precon unit.
 *
 * Your Mechs have [Vision]. (When you play us, look at the top card of your
 * Main Deck. You may recycle it.)
 *
 * A static ability-layer grant: every friendly Mech gains the Vision keyword
 * (CR v1.5 817.1.b, "When this is played, [Predict]"). The
 * continuous.grant-keyword layer is owned by RIFT-91 (layers-continuous);
 * the Vision keyword expansion is owned by RIFT-83 (kw-ganking-vision).
 */
export default {
  canonicalCardId: "card.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Your Mechs have [Vision]」需要 continuous.grant-keyword 持续效果把 Vision 关键词授予所有友方 Mech；" +
    "该持续效果原语尚无已注册实现（continuous.keyword 缺口）。" +
    "依赖：RIFT-91（layers-continuous）、RIFT-83（kw-ganking-vision 关键词展开）。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.grant-keyword",
        keyword: "Vision",
        filter: {
          zone: "board",
          controller: "controller",
          tag: "Mech",
          type: "unit"
        }
      }
    }
  ],
  sourceText:
    "Your Mechs have [Vision]. (When you play us, look at the top card of your Main Deck. You may recycle it.)"
} satisfies CardProgram;
