# Spell 父级提交通知契约（待实施）

公开 P4 必须以真实原生证明退役已登记 Chain work。Core 现有 dispatcher.commitEffect 在证明签发前保存业务回执，不能据此冒充 Chain 已提交；DATA inspector 也不能恢复 proof capability。包级 Spell 导出已补，其余契约待资源收据续接修复后实施，不能提前开启公开命令。

父级需从当前真实、活跃 Spell session 取得只读 Chain 绑定：chainId、executorId、内部resolutionAuthority 的原生引用。新访问器必须拒绝 DATA clone/旧session，仅用于可信进程内 composition；禁止 wire/归档接纳。返回冻结外壳，不授予新的executor或restore入口。

新增可选 dispatcher 通知在真实 queryDuelChainCommittedProofV2 返回 proof、commitDuelChainResolutionV2 成功后调用，携带原生 ticket/proof、实际 commandSession/Chain 和绑定的原UID/cardId/controller/sourceEpoch。父级在通知中推进实际 native journal head，然后用 exact proof 退役相同Chain/executor/item work。现有内部组合可不提供通知；P4生产组合必须提供并验证。

通知失败须保留已提交Chain后继、原生proof、实际effect candidate/canonical head和未确认状态；重试仅通知与原command收据，不再扣费/Draw/Trash、不再consumeChain或分配ticket。父级通知必须幂等，写后丢ACK也可用原proof重试。通知确认前不能返回applied或允许其他动作越过。内部busy/poison门禁也适用于通知回调，不能让回调重入偷进动作。

只读私有快照须包含等待通知/已确认标志及 proof/ticket 的完整业务标签，不能序列化原生引用当restore。父级自己的dispatcher回执和native journal可变状态仍另纳入P4私有指纹；Core快照不代替它们。

必要测试：真实两控制者响应，通知只在commit后拿到exact admitted proof且绑定正确；通知先抛与写后丢ACK重试都只重通知一次业务提交；clone与旧session访问器拒绝；回调重入不改变候选；same-process fresh replay再建独立authority/proof但私有DATA/熵一致。父级已有journal register/retire检查保持，不能用空source/空Chain证明跳过。


主控检查点整合后追加确认边界：notifyCommitted只在同步返回undefined且未重入时确认；Promise/thenable及其他返回值保留同一closed proof和canonical candidate，等待合法同步重试。finish命令收据也不能以Promise/thenable返回当确认，then属性用descriptor检查、不执行getter。主控修前两项实效回归失败，修后Chain/Spell66通过；额外getter回归验证中。调用者应将异步持久化放到父级proposal/CAS流程或独立幂等确认状态，不得给该同步接口返回未完成Promise。
