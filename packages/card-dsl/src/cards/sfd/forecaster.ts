import type { CardProgram } from "../../ir/index.js";

/**
 * Forecaster (sfd-065-221) — Rumble SFD precon unit, tags Mech.
 *
 * "Your Mechs have [Vision]. (When you play us, look at the top card of your
 * Main Deck. You may recycle it.)"
 *
 * 规则依据（CR v1.5）：478/478.1.a 的 ability 图层承载关键词获得；817.1.b 把
 * Vision 展开为进场触发 + Predict（effect.inspect → 可选回收）。
 *
 * The production path grants this controller's Mechanical permanents one Vision
 * instance each. Lifecycle then binds that instance to the real controller and
 * ordered deck-top Predict (817.1.b/c); separate instances retain separate
 * trigger and recycle choices (817.2).
 */
export default {
  canonicalCardId: "card.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40",
  rulesetVersion: "core-1.5",
  status: "executable",
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
        }
      }
    }
  ],
  sourceText:
    "Your Mechs have [Vision]. (When you play us, look at the top card of your Main Deck. You may recycle it.)"
} satisfies CardProgram;
