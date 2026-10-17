# Privacy 规则 golden（RIFT-628）

把 `docs/rules/scenarios/privacy.yaml` 中**新内核已能执行**的场景转成规则 golden。
被测对象只有新内核：`src/effects/testing/` 参考内核、`src/chain/`、`src/events/`、
`src/game/lifecycle.js`、`src/replacement/`、`src/target/`、`src/projection/v2/`。
`src/duel/` 与 `src/core/` 从不作为被测对象，也从不 import。

- `harness.mjs`：reference kernel → ChainEngine → EventPipeline 的真实接线，
  以及 `projectionState()`（把权威快照按区域交给投影）、`matchFixture()`（createMatch host）。
- 断言只读真实动作/投影结果；没有任何 fixture 手工结算、手改 zone/resource/health。
- 未合入的机制写 `test.todo`，标题写清缺哪个模块 / op / 时点。

## 场景对照（39/39 已登记：27 仅执行 / 9 仅 todo / 3 执行 + todo）

执行用例 32 个（其中 3 个场景同时保留执行部分与 todo），`test.todo` 12 条。

| 场景 id | 状态 | 文件 |
| --- | --- | --- |
| privacy-hand-faces-private-count-public | 执行 | `108.7.c-108.7.e-hand-private-count-public.test.mjs` |
| privacy-spectator-deck-runedeck-secret-order | 执行 | `108.4.d-108.4.e-108.5.d-deck-runedeck-secret.test.mjs` |
| privacy-public-zones-visible-all-views | 执行（Trash/Banishment/Base）+ todo（Champion/Legend Zone） | `108.2.d-108.3.e-108.6.e-107.1.d-public-zones-all-views.test.mjs` + `108.3.e-champion-legend-zone-public.test.mjs` |
| privacy-board-objects-state-public | 执行 | `109-109.2-board-objects-state-public.test.mjs` |
| privacy-facedown-slot-occupied-public-identity-private | 执行 | `107.3.f-128.4-facedown-slot-public-identity-private.test.mjs` |
| privacy-chain-items-public | 执行 | `108.1.b-chain-items-public.test.mjs` |
| privacy-hide-no-chain-preserves-privacy | todo：缺 Hide 自由动作与 Facedown Zone 目的地 | `422.1-811.1.c.2-hide-no-chain.test.mjs` |
| privacy-facedown-controller-not-owner-reads | 执行 | `107.3.f-128.4-facedown-slot-public-identity-private.test.mjs` |
| privacy-facedown-leaves-zone-revealed-to-all | 执行（换区与后续私密）+ todo（422.4 换区展示事件） | `422.4-facedown-leaves-zone.test.mjs` |
| privacy-facedown-removed-on-cleanup-still-hidden-then-revealed | todo：缺 Hidden 状态与 323.6.a 清理路径 | `323.6.a-facedown-cleanup-removal.test.mjs` |
| privacy-game-end-facedown-revealed-all | 执行 | `422.4-game-end-facedown-revealed-all.test.mjs` |
| privacy-facedown-not-referenceable-by-characteristics | todo：`src/layers/filter.ts` 对面朝下牌泄漏印刷关键字 | `811.5.a-107.3.f-facedown-not-referenceable.test.mjs` + `811.2-printed-hidden-query-undefined.test.mjs` |
| privacy-hidden-reaction-grant-not-public | todo：缺 811.6 次回合 Reaction 授权 | `811.6-811.6.a-hidden-reaction-grant-not-public.test.mjs` |
| privacy-play-from-facedown-reveals-at-pending | 执行 | `811.1.c.3-play-from-facedown-reveals-at-pending.test.mjs` |
| privacy-reveal-top-cards-all-views-then-secret-again | 执行 | `425.1-425.3-reveal-window-then-secret.test.mjs` |
| privacy-revealed-card-stays-in-zone | 执行 | `425.1.a.2-revealed-card-stays-in-zone.test.mjs` |
| privacy-predict-look-owner-only | 执行 | `437.1-437.3-predict-look-owner-only.test.mjs` |
| privacy-reveal-hand-snapshot-later-draws-private | 执行 | `425.3.a-108.7.c-reveal-hand-snapshot.test.mjs` |
| privacy-reveal-hand-includes-all-current-cards | 执行 | `425.3.a-108.7.c-reveal-hand-snapshot.test.mjs` |
| privacy-reveal-only-when-instructed | 执行（内核不自发展示）+ todo（命令准入） | `425.2-425.2.a-reveal-only-when-instructed.test.mjs` |
| privacy-voluntary-show-not-reveal-no-trigger | todo：缺指定受众的 show 动作与命令入口 | `425.2.b-voluntary-show-not-reveal.test.mjs` |
| privacy-show-off-hand-card-only-not-hand | todo：缺 cost.reveal Finalize 选择管线 | `832.1.c-show-off-hand-card-only.test.mjs` |
| privacy-show-off-declined-nothing-leaked | todo：同上（832.1.c.2 可选决定） | `832.1.c-show-off-hand-card-only.test.mjs` |
| privacy-discard-choice-private-until-trash | 执行 | `423.1.a-discard-choice-private-until-trash.test.mjs` |
| privacy-pick-from-private-zone-opponent-sees-result-only | 执行 | `355.10.a-108.7.c-pick-from-private-zone-result-only.test.mjs` |
| privacy-secret-quality-action-not-compelled | 执行 | `128.6-128.6.a-secret-quality-action.test.mjs` |
| privacy-secret-quality-action-accepted-reveals-minimum | 执行 | `128.6-128.6.a-secret-quality-action.test.mjs` |
| privacy-hand-not-targetable-pick-not-target | 执行 | `355.10.a-hand-not-targetable-pick-not-target.test.mjs` |
| privacy-negative-opponent-view-must-not-contain-hand-identity | 执行 | `108.7.c-108.7.e-hand-private-count-public.test.mjs` |
| privacy-negative-spectator-view-equals-non-owner | 执行 | `128.4-spectator-view-equals-non-owner.test.mjs` |
| privacy-negative-deck-top-never-in-projection | 执行 | `108.4.d-108.4.e-108.5.d-deck-runedeck-secret.test.mjs` |
| privacy-negative-error-message-must-not-leak-private-card | 执行（target 层错误通道） | `128.4-108.7.c-error-message-no-private-card.test.mjs` |
| privacy-negative-facedown-characteristics-not-in-events | 执行 | `811.5.a-128.4-facedown-characteristics-not-in-events.test.mjs` |
| privacy-negative-replay-view-matches-spectator | 执行 | `128.3-128.4-replay-view-matches-spectator.test.mjs` |
| privacy-draw-not-revealed-to-opponent | 执行（状态通道）+ todo（事件通道） | `108.4.e-108.7.c-draw-not-revealed.test.mjs` + `414.1-card-drawn-event-payload-private.test.mjs` |
| privacy-mulligan-set-aside-not-revealed | 执行 | `117.1-117.3-mulligan-set-aside-not-revealed.test.mjs` |
| privacy-runedeck-top-channel-reveals-on-board-only | 执行 | `108.5.d-107.1.d-runedeck-top-channel-reveals-on-board.test.mjs` |
| privacy-opponent-hand-count-across-moves | 执行 | `108.7.e-108.7.c-opponent-hand-count-across-moves.test.mjs` |
| privacy-base-runes-exhaustion-state-public | 执行 | `109-109.2-board-objects-state-public.test.mjs` |

## 与 CR v1.5 原文的差异

见本任务最终回复「风险、遗留问题、契约变更请求」一节；差异都记在对应测试文件的注释里。

