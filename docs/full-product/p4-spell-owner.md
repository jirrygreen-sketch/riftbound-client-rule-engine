# P4 Spell Owner

本轮把 Draw Spell 的有限公开路径接入 `authoritative-runtime-p4.ts`，保持一个
服务端 canonical head。Spell 从当前真实 Unit command session 一次 admission；Core
产生的每个 successor 都通过同一 Unit lineage 回写。待付款时保留原始 Chain、source
epoch、task/receipt 和 command identity，支付重新 attestation 原绑定；未知 source
closure 继续 blocked。

支付完成后 owner 自动 finalize 原始 Chain item。两个 actor 通过公开
`pass-priority` 命令响应同一个非空 Chain；达到 Core 的 resolve 条件后由服务端调用
Core resolve，Draw effect 走受信随机 tape。`notifyCommitted` 只在真实 Chain→Trash
native path、committed proof 和 journal retirement 都确认后结束 Spell 分支，随后
才把 canonical head 交回 Unit/Turn。

公开 projection 仅暴露 viewer 自己可用的 Hand UID 和支付 ID/cost，Chain active、
priority、pending payment 和等待状态来自真实 Core head；对手/观众只看到 payment
active 和 Chain 摘要，不看到 source census、proof、private fingerprint 或他人手牌
UID。跨 actor command ID 可独立尝试；同 actor 同 ID 的不同 payload 冲突，pending
Spell retry 复用原 receipt，不重新消耗 identity、resource 或 IR。

## Verification

`authoritative-spell-p4.test.ts` 使用 genuine constructor/mulligan、真实轮次、真实
Hand Spell、Core payment、双 actor priority pass、Chain resolve 和 retirement。
`public-spell-p4.test.ts` 检查 payment/Hand/Chain 的 viewer 隐藏不变量。
`spell-command-journal-p4.test.ts` 检查 pending retry、cross-actor attempt、private
fingerprint 和 identity 不变。

本 slice 只覆盖受支持的单效果 Draw Spell fixture；官方完整卡库、未知效果、真实
双 GUI 整局、durable room restart 和其余 full-product gates 仍由主控统一验收。
