# Durable journal adapter

`createDurableDuelRuntime` / `openDurableDuelRuntime` 是唯一的持久化入口。
原来的两个持久化模块只保留导出别名。本层不选择 runtime profile，也不从
schema 反推 profile；命令记录继续使用批 B 的 recorder，不将它的兼容 archive 落盘。

私有数据严格为 `{ journal: Journal }`，采用 protocol journal v1。
保留命令、operation 证据、熵与摘要，不保存旧 archive 中的投影快照。
恢复校验 journal 摘要链、可信 header/catalog/roster、熵消费、命令回执、时钟、
各 viewer 的摘要及最终公开/私有摘要。引擎版本变化通过 `engineMismatch` 显示，
不改写原日志，也不要求不同引擎版本逐字节复现旧 observation。

发布顺序是：受保护 load → 重放出隔离 proposal → 通过 JournalWriter 追加到
最后确认的摘要链 → compareAndSwap → 发布 projection/ACK。源码只有一处 CAS
发布调用。CAS 前置条件始终使用该 store 实际返回的绑定 head 对象，不使用从
journal JSON 或命令包重建的对象。journal revision 必须与存储 revision 一致；
成功回执必须确认候选字节、将 revision 加一，并返回新的存储 nonce。
冲突时恢复获胜者的受保护 head。重复命令、拒绝命令、空 resume 不写入。

journal v1 的 `integrity.nonce` 和对应 `protectedHeadReference` 是被摘要覆盖的
逻辑 journal 引用。文件存储另有独立生成的 CAS nonce，原子写完成后才能获得。
`runtime.protectedHeadReference` 提供独立确认的实际存储 head。两类 nonce
不能混用或伪造。文件权限、receipt history、临时写、rename、fsync 均仍由原有
`private-journal-cas-store.ts` 负责；未修改该存储原语。

写入抛错时不发成功 ACK，保留最后确认的投影并冻结后续命令；重新打开时重新
读取受保护 head。rename 前失败恢复上一 head；ACK 丢失或 rename 后 fsync
失败，在重新确认文件持久性后恢复新 head，重试返回 duplicate。
`close()` 等待正在进行的写入结束后才关闭 store。

定向验证：

```sh
pnpm --filter @riftbound/game-server exec vitest run --config vitest.config.ts tests/duel/durable
```

历史 P3 测试继续保持 RIFT-49 已有的
`persistent P3 command runtime [legacy-replay-e2cbcdf]` skip（7 项）。
当前恢复语义由 `tests/duel/durable/` 覆盖，本轮不新增 skip。
仅含旧 archive 的数据会被拒绝；历史回放由 `legacy-replay-e2cbcdf` 代码负责。
