# Targeting 规则 golden 测试（RIFT-275）

场景来源：`docs/rules/scenarios/targeting.yaml`（45 个场景）与 Core Rules v1.5。
文件名按规则条目号（契约第 5 节），测试标题含场景 id。

被测对象只使用新内核已合入的层：

- `src/effects/testing/`（RIFT-46 参考测试内核 `world` / `TestWorld`）
- `src/chain/interpreter-adapter.ts`（解释器 + 原语注册表）+ `src/effects/interpreter.ts`
- `src/chain/engine.ts`（Pending / Finalize / Resolve、HOT FEPR、触发扫描）
- `src/target/target-plan.ts`（`finalizeTargetPlan` / `resolveTargetPlan` / `reselectTargetPlan` / `queryTargetCandidates` / `pick`）

`harness.mjs` 只做局面构造与 `ChoiceRequest` 应答，不代任何规则结算；缺少答案时不猜选择，直接抛 `AwaitChoice`。

## 场景 id 对照

| 场景 id | 状态 | 文件 |
| --- | --- | --- |
| targeting-choose-locks-at-finalize | 已转测试 | `355.5-355.7-355.15-lock-at-finalize.test.mjs` |
| targeting-pick-is-not-target | 已转测试 | `355.7-pick-is-not-target.test.mjs` |
| targeting-trigger-fires-on-becoming-target | 已转测试 | `383.4.b-targeting-trigger.test.mjs` |
| targeting-each-player-picks-no-targets | todo | `355.10.e-each-player-picks-no-targets.test.mjs`（缺每名玩家各自选择的结算期选择原语，355.10.e / 412.1） |
| targeting-restriction-not-itself-target | 已转测试 | `355.10.b-restriction-not-itself-target.test.mjs` |
| targeting-mass-affect-targets-zone-only | todo | `355.10.d-mass-affect.test.mjs`（`effect.kill` 只有 target/picks/self，没有按特征选集合的非目标形式） |
| targeting-up-to-zero-targets-legal | 已转测试 | `355.13-up-to-zero.test.mjs` |
| targeting-up-to-partial-count | 已转测试 | `355.13-up-to-partial-count.test.mjs` |
| targeting-split-damage-multi-target | 已转测试 | `355.14-split-damage.test.mjs` |
| targeting-mandatory-must-resolves-not-target | 已转测试 | `355.10.f-mandatory-must.test.mjs` |
| targeting-group-requirement-legal-subset | todo | `355.11.b.1-group-requirement-legal-subset.test.mjs`（缺群体总约束求值器 355.11.b/.b.1） |
| targeting-still-played-when-all-ignored | 已转测试 | `359.3.e.10-still-played.test.mjs` |
| targeting-negated-linked-still-executes | 已转测试 | `359.3.e.14.b-negated-linked-still-executes.test.mjs` |
| targeting-replaced-linked-if-not-execute | 已转测试 | `359.3.e.14.b-replaced-linked-if-not-execute.test.mjs` |
| targeting-partial-prevent-linked-runs | todo | `359.3.e.14.c-partial-prevent-linked.test.mjs`（`effect.damage` 被部分防止时只返回 negated，无 partial 链接结果） |
| targeting-group-subset-after-move | 部分（子集执行已转测试；`355.11.b.1` 最大子集 todo） | `355.11.b-group-subset.test.mjs` |
| targeting-new-choices-remake-all | todo | `750-new-choices-remake-all.test.mjs`（缺 750-755「重做全部选择」指令） |
| targeting-new-choices-retrigger-targeting | 部分（目标层重触发已转测试；链上重做指令 todo） | `754-new-choices-retrigger-targeting.test.mjs` |
| targeting-untargetable-mistargets-later | 已转测试 | `758.1-untargetable-mistargets-later.test.mjs` |
| targeting-invalid-then-valid-again | 已转测试 | `359.3.e.3-invalid-then-valid.test.mjs` |
| targeting-conditional-clause-scopes-sentence | 已转测试 | `135.2.b.5.b-conditional-clause-scope.test.mjs` |
| targeting-finalize-action-check-any-actor | 部分（结算期读 Finalize 支付动作已转测试；控制权易手 todo） | `135.2.b.7-finalize-action-check-any-actor.test.mjs` |
| targeting-instruction-cost-checks-action | todo | `205-instruction-cost-checks-action.test.mjs`（缺 cost.pay 原语与支付可被替代的注入路径） |
| targeting-conditional-scope-false-blocks-sentence | 已转测试 | `135.2.b.5.b-conditional-scope-false-blocks-sentence.test.mjs` |
| targeting-required-target-missing-illegal | 已转测试 | `355.8-required-target-missing.test.mjs` |
| targeting-untargetable-not-legal | 已转测试 | `355.9.b-untargetable-not-legal.test.mjs` |
| targeting-pending-item-not-targetable | 已转测试 | `355.9.a.2-pending-not-targetable.test.mjs` |
| targeting-secret-zone-not-target | 已转测试 | `355.10.a-secret-zone-not-target.test.mjs` |
| targeting-split-over-cap-illegal | 已转测试 | `355.14.c-split-over-cap.test.mjs` |
| targeting-illegal-deterministic-choice | 已转测试 | `355.16-illegal-deterministic-choice.test.mjs` |
| targeting-new-choices-none-legal-negated | 部分（目标层拒绝重做已转测试；链上 negated todo） | `753.2-new-choices-none-legal.test.mjs` |
| targeting-nonboard-zone-breaks-identity | 已转测试 | `359.3.e.4-nonboard-zone-breaks-identity.test.mjs` |
| targeting-mistargeted-counts-for-target-count | todo | `359.3.e.9.a-mistargeted-counts-for-target-count.test.mjs`（缺链项目标计数引用 359.3.e.9.a） |
| targeting-counters-not-targeted | 已转测试 | `742.1-counters-not-targeted.test.mjs` |
| targeting-null-referent-ignores-linked | 已转测试 | `359.3.e.12-null-referent.test.mjs` |
| targeting-partial-target-loss-executes-rest | 已转测试 | `359.3.e.8-partial-target-loss.test.mjs` |
| targeting-lookback-after-zone-change | 部分（359.3.e.13 回望已转测试；832.1.d.1 Show Off 锁定 todo） | `359.3.e.13-lookback-after-zone-change.test.mjs` |
| targeting-untargetable-category-change | 已转测试 | `758.2-untargetable-category-change.test.mjs` |
| targeting-legend-you-control-not-target | 已转测试 | `355.10.g-legend-you-control-not-target.test.mjs` |
| targeting-resolve-legality-window | 已转测试 | `359.3.e.2-resolve-legality-window.test.mjs` |
| targeting-optional-action-still-targets | 已转测试 | `355.12-optional-action-still-targets.test.mjs` |
| targeting-group-requirement-at-finalize | 部分（群体锁定已转测试；总约束校验 todo） | `355.11.a-group-requirement-at-finalize.test.mjs` |
| targeting-cost-and-trigger-not-targets | 已转测试 | `355.10.c-cost-and-trigger-not-targets.test.mjs` |
| targeting-ignored-earlier-ignores-linked | 已转测试 | `359.3.e.14.a-linked-ignored.test.mjs` |
| targeting-restriction-violation-fails-finalize | 已转测试 | `355.17.b-restriction-violation-fails-finalize.test.mjs` |

额外文件 `355.9.c-self-not-target.test.mjs`：targeting.yaml 没有对应场景 id，按规则条目号补的自排除检查（属契约第 5 节的命名口径）。

## 运行

```
pnpm --filter @riftbound/engine-core build
node --test 'packages/engine-core/test/rules/targeting/*.test.mjs'
```
