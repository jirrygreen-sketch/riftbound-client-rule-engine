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
 * status 判定（cards/README.md 第 2 节）：judge-required。
 *
 * 2026-10-21 对当前 integration 的生产复测：
 * - static binder 把 Vision 只授予来源控制者的 board 上 Mech（CR 133.3.a/133.8）；
 * - production lifecycle 已把 817.1.b 展开体补上 zoneSlice，并把 inspect 玩家绑定到
 *   实际控制者；A/B 双方读取各自牌库顶，拒绝回收时牌序不变，接受时真实 recycle；
 * - 但同一份静态 grant 会被 lifecycle 注册成两个 Vision 实例。当前
 *   KeywordGrantLayerEngine.refresh 在 granted-only 模式已算出仅含 grant 的 `granted`，
 *   最终却在 keyword-grants.ts:568 把包含宿主有效关键词的 `expansions` 写入
 *   `this.expansions`，所以 `keywordEntries()` 同时返回宿主已有的授予实例与本次 grant，
 *   产生 `vision:printed-0` / `vision:printed-1`。这违反 CR 817.2：一个 Vision 实例必须
 *   只触发一次，多个实例才分别触发。测试把两个触发登记和两次真实 prompt 保留为当前
 *   blocker 的无手工结算复现；引擎修复后才可重新评估 executable。
 */
export default {
  canonicalCardId: "card.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前唯一阻塞是单个静态 Vision grant 在生产 lifecycle 中重复展开：" +
    "KeywordGrantLayerEngine.refresh 已计算 granted-only 的 `granted`，但 keyword-grants.ts:568 " +
    "把含宿主既有关键词的 `expansions` 写入 `this.expansions`；生产宿主已经带有本次授予的 Vision，" +
    "于是 keywordEntries() 对同一实例返回 vision:printed-0 与 vision:printed-1，真实链触发两次。" +
    "这违反 CR 817.2 的实例计数。生产路径的其余部分已实测可执行：static binder 按来源控制者与 Mech tag 授予；" +
    "lifecycle 为 817.1.b 绑定有序 zoneSlice 和实际控制者；A/B 各自读取自己的牌库顶，拒绝回收不移动牌，" +
    "接受回收真实执行。需先修复 granted-only lifecycle 的实例来源，才可按 executable 交付。",
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
