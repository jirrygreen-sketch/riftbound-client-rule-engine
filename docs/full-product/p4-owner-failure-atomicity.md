# P4 权威运行时的失败原子性

原生 Core successor 只有在 proposal journal 确认完整提交路径后才可成为公开 owner。观察失败后不能回填已经消耗的旧 capability，也不能返回普通错误或 pending 投影继续运行；外层 recorded/CAS/Room 必须丢弃失败 proposal，按独立保护的 archive 重建。

`authoritative-runtime-p4.ts` 在 fork 失败、权威引用变化后异常、native observe 或绑定上下文失败时关闭 owner。后续 project、dispatch、resume 和 private fingerprint 均拒绝访问，finally 清理 proposal、operationHead 和忙锁。普通 actor/version/不支持动作拒绝在未推进权威状态时保留原结果。

回合执行器会在内部捕获 `observeCheckpoint` 异常并返回 pending，因此只在 dispatch/resume 最外层 catch 标记失败不够。主控补充在 native journal 观察和 checkpoint 绑定处立即标记失败；sync 在赋值前核验 owner 可用，避免内部吞异常后重新公开旧引用。正常 owner 的 fingerprint DATA 保持原 profile，不插入新 failure 字段，保护历史 archive 摘要兼容。

测试包装真实 journal factory 及递归 fork，用真实构造、两次换牌、Main 符文产能和待续接回合注入单次 observe 异常；不手改 Main、资源、proof 或提交路径。待续接测试先暂缓真实 source reader，再恢复它，使 resume 产生实际 native successor。当前用例验证 raw owner 关闭、普通旧 version 拒绝仍可继续、真实 resume 内部捕获后仍关闭，以及 protected CAS 不写失败 proposal 且可重开原投影。

远程任务原三项故障测试及七文件共 33 项通过；主控新增 resume 用例后四项通过，整合后的七文件复验结果单独记录。主控另用真实双 GUI 房间 900bc504 的旧保护日志重放 50 命令，双方最后观察一致，原日志 SHA 不变；该证据只证明历史 archive 兼容，不能作为新增公开 Spell 验收。

这是内部受控故障测试，没有证明外部用户可主动制造 journal 异常。故障测试直接覆盖 raw 和 CAS；Room transaction 故障恢复仍需独立验收。
