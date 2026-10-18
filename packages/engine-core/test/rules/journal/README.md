# journal 规则 golden（RIFT-629）

把 `docs/rules/scenarios/journal.yaml` 中**新内核已能执行**的场景转成规则 golden。
被测对象只有新层：`@riftbound/protocol` 的 journal v1 校验器、`src/game/lifecycle.ts`、
`src/turn/flow.ts`、`src/chain/engine.ts`、`src/events/action-adapter.ts`、
`src/projection/v2/project-for.ts`。`src/duel/` 与 `src/core/` 从不作为被测对象。

本章主题是**服务端基础设施**：命令幂等、乱序投递、断线重连、进程重启、回放一致性与
journal v1 结构。game-server 的 room/session/transport 与持久化按
`apps/game-server/src/engine-runtime/README.md` 仍未接入新 runtime，因此凡是
`commandId`/`payloadHash`/`resumeToken`/`connectionId`/`stateVersion` 游标/落盘顺序的行为
都登记为 `test.todo`，标题写明缺哪个模块；不伪造回执、游标或进程重启。

文件名用 `<条目号>-<slug>.test.mjs`：本章的条目号来自契约（`contract-4-...`、`contract-1.3-...`），
因为 journal.yaml 的 `rule` 字段引用的就是契约第 4 节（官方规则书不规定服务端日志行为）。
测试名包含场景 id，便于 grep 对照。

## 场景对照（37/37 已登记）

22 个测试文件、50 个执行用例、21 个 `test.todo`；每个场景至少登记一次，未执行的部分逐条写明
缺哪个模块（服务端 room/session/transport、storage、或 replay-core 的 engineMismatch 标记）。

| 场景 id | 状态 | 测试 |
| --- | --- | --- |
| journal-idempotent-duplicate-play-card-same-result | 执行 + todo（回执） | `contract-4-idempotency-command-identity.test.mjs` |
| journal-idempotent-duplicate-concurrent-retry | 执行 + todo（回执） | `contract-4-idempotency-command-identity.test.mjs` |
| journal-idempotent-conflict-same-commandid-different-payload | 执行 + todo（payloadHash） | `contract-4-idempotency-command-identity.test.mjs` |
| journal-idempotent-conflict-commandid-stolen-by-other-player | 执行 + todo（playerId 绑定） | `contract-4-idempotency-command-identity.test.mjs` |
| journal-idempotent-duplicate-after-restart | todo（processedCommands 重建） | `contract-4-idempotency-command-identity.test.mjs` |
| journal-out-of-order-stale-version-rejected | 执行 + todo（expectedVersion） | `contract-4-journal-entry-stale-version-not-written.test.mjs` |
| journal-out-of-order-new-connection-wins-old-rejected | 执行 + todo（连接维度版本） | `contract-4-journal-entry-stale-version-not-written.test.mjs` |
| journal-duplicate-delivery-same-connection | 执行 + todo（connectionId） | `contract-4-idempotency-command-identity.test.mjs` |
| journal-resume-backfill-from-cursor | 执行 + todo（线协议） | `contract-4-resume-cursor-handling.test.mjs` |
| journal-resume-cursor-behind-multiple-missed-commands | 执行 + todo（多步补全） | `contract-4-resume-cursor-handling.test.mjs` |
| journal-resume-cursor-ahead-of-authoritative | 执行 + todo（invalid-cursor） | `contract-4-resume-cursor-handling.test.mjs` |
| journal-resume-wrong-room-or-seat-token | todo（resumeToken 绑定） | `contract-4-resume-cursor-handling.test.mjs` |
| journal-resume-superseded-connection-cannot-act | todo（连接取代判定） | `contract-4-resume-cursor-handling.test.mjs` |
| journal-resume-private-events-not-leaked | 执行 | `contract-4-resume-private-events-not-leaked.test.mjs` |
| journal-restart-replay-restores-exact-state | 执行 | `contract-4-journal-format-restart-replay-restores-exact-state.test.mjs` |
| journal-restart-continue-match-after-reload | 执行 + todo（落盘追加） | `contract-4-recovery-torn-write.test.mjs` |
| journal-restart-empty-journal-returns-to-initial-state | 执行 | `contract-4-journal-format-restart-empty-journal-returns-to-initial-state.test.mjs` |
| journal-restart-replay-mid-chain-deterministic | 执行 | `contract-4-replay-restart-replay-mid-chain-deterministic.test.mjs` |
| journal-replay-final-state-matches-live | 执行 | `contract-4-replay-final-state-matches-live.test.mjs` |
| journal-replay-per-view-projection-matches | 执行 | `contract-4-replay-per-view-projection-matches.test.mjs` |
| journal-replay-engine-mismatch-flagged-but-playable | 执行 + todo（engineMismatch 标记） | `contract-4-engine-mismatch-flagged-but-playable.test.mjs` |
| journal-replay-engine-mismatch-mid-chain-consistent | 执行 + todo（engineMismatch 标记） | `contract-4-engine-mismatch-mid-chain-consistent.test.mjs` |
| journal-replay-legacy-schema-refused | 执行 | `contract-1.3-replay-legacy-schema-refused.test.mjs` |
| journal-invalid-command-not-written | 执行 + todo（invalid_command 回执） | `contract-4-journal-entry-invalid-command-not-written.test.mjs` |
| journal-stale-version-command-not-written | 执行 + todo（stateVersion 门） | `contract-4-journal-entry-stale-version-not-written.test.mjs` |
| journal-out-of-turn-command-not-written | 执行 + todo（合法动作列表） | `contract-4-journal-entry-stale-version-not-written.test.mjs` |
| journal-format-header-validates | 执行 | `contract-4-journal-format-header-validates.test.mjs` |
| journal-format-entry-field-set-rejected | 执行 | `contract-4-journal-format-entry-field-set-rejected.test.mjs` |
| journal-format-seq-must-be-contiguous-from-one | 执行 | `contract-4-journal-format-seq-must-be-contiguous-from-one.test.mjs` |
| journal-format-duplicate-commandid-in-log-rejected | 执行 | `contract-4-journal-format-duplicate-commandid-in-log-rejected.test.mjs` |
| journal-format-catalog-digest-mismatch | 执行（仅证明 digest 绑链）+ 契约变更请求 | `contract-4-journal-format-catalog-digest-mismatch.test.mjs` |
| journal-format-truncated-tail-line-rejected | 执行 | `contract-4-journal-format-truncated-tail-line-rejected.test.mjs` |
| journal-recovery-torn-write-crashed-before-append | 执行（仅证明“只结算一次”）+ todo（落盘顺序） | `contract-4-recovery-torn-write.test.mjs` |
| journal-idempotent-duplicate-concede-after-game-end | 执行 + todo（原回执复用） | `contract-4-idempotency-command-identity.test.mjs` |
| journal-resume-replay-consistent-after-reconnect | 执行 + todo（resume 交叉校验入口） | `contract-4-recovery-torn-write.test.mjs` |
| journal-format-empty-command-name-rejected | 执行 | `contract-4-journal-format-empty-command-name-rejected.test.mjs` |
| journal-format-seat-playerid-not-in-header-rejected | 执行 | `contract-4-journal-format-seat-playerid-not-in-header-rejected.test.mjs` |

## 与场景样本的差异（以 CR v1.5 / 冻结契约为准）

- journal.yaml 的 `header` 样本只给扩展前的最小字段集（format/formatVersion/engineVersion/
  rulesetVersion/catalogDigest/seed/createdAt）；契约第 4 节冻结的 v1 扩充还要求
  `matchId/roomId`、`rosterDigest/trustedDeckDigest`、`creation.entropy/deterministicSeed/
  uidSeed/creator`。`support.mjs` 的 `journalHeader()` 按冻结字段集构造，方案与
  `packages/protocol/test/journal-v1.test.mjs` 的夹具一致。
- 场景里的 `room.stateVersion` / `room.eventSeq` / `journal[].seq` 是服务端字段；
  engine-core 新内核没有这些计数器，本层用“同一 seed + 同一命令序列重建出的权威状态与
  提交事件序列”表达等价语义，不断言不存在的字段。

## 运行

```sh
node --test --import ./packages/engine-core/test/support/register.mjs packages/engine-core/test/rules/journal/*.test.mjs
```

或直接跑包全量：`pnpm --filter @riftbound/engine-core test`。
