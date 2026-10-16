# RIFT-341：P4 Spell service parity

本任务把 `apps/game-server/src/duel/p4-spell-services.ts` 的旧服务行为，与
`packages/engine-core/src/programs` 的 EffectIR 程序绑定和 Chain 内核做逐场景对照。
测试入口是
`apps/game-server/tests/parity/spell/p4-spell-parity.test.ts`；它使用参考
`ResolveContext` 和 `ChainEngine` 提交真实 `play`、费用支付、目标选择、效果和退场动作，
没有手改 frame、zone、resource 或 health。

## 旧服务覆盖面

| 旧服务分支 | 旧测试/命令序列 | 旧服务可观察结果 | 新内核对照 |
| --- | --- | --- | --- |
| `createP4SpellServices` Hand-first Draw | `play-card` → 支付 → 双方 pass → resolve | 法术进入 Chain；按程序抽牌；`card-played` 后法术进入 owner Trash；费用按印刷值 | Draw 4：通过；Reaction Draw 3：通过 |
| `createP4KillSpellServicesV1` 单目标 Kill | `play-card` → 支付 → 双方 pass → resolve | 目标必须是仍在 Board 的 Unit；Kill 产生 `object-killed`，随后目标进 Trash；法术也进 Trash | Vengeance（“Kill a unit.”）：通过 |
| `createP4KillSpellServicesV1` 全体 Kill | `play-card` → 支付 → 双方 pass → resolve | 旧语义标签承认 `kill-units`，但现有服务测试只证明费用/准入，未执行全体结算 | The Ruination（“Kill all units.”）：`test.todo`；卡牌程序仍 `judge-required` |
| `createP4PointDamageSpellServicesV1` Chain-first Point | `play-card`（Chain entry）→ 支付/Deflect 费用 → priority pass → damage/cleanup → Chain exit | 固定点数、目标位置限制、费用和法术退场由 native Chain proof 绑定 | Incinerate 2、Falling Comet 6、Final Spark 8：通过普通 `effect.damage` + 卡牌程序；Hextech Ray 3 保留 `test.todo`（目标位置字段缺少具体 battlefield id） |

旧测试还明确拒绝 `each-player-kills-unit` 和一般 damage/compound 语义进入
`createP4KillSpellServicesV1` 的受控 Kill slice。它们不属于该服务已经承诺的可观察行为；
待统一 runtime 的 admission 规则补齐前，保留单独 `test.todo`，不把拒绝路径误报成 parity
通过。

对照来源是 `apps/game-server/tests/duel/p4-spell-services.test.ts`、
`p4-kill-spell-services-v1.test.ts` 和 `point-spell-production-services-v1.test.ts`。
对应的官方卡牌是 Progress Day (`ogn-114-298`, Draw 4)、Premonition (`sfd-087-221`,
Reaction Draw 3)、Vengeance (`ogn-229-298`)、The Ruination (`unl-180-219`)、
Incinerate (`ogs-003-024`)、Hextech Ray (`ogn-009-298`)、Falling Comet
(`ogn-085-298`) 和 Final Spark, Lux (`ogs-022-024`)。

## 规则依据与差异处理

- CR v1.5 §159.2.a：没有 Reaction 的 Spell 默认按 Action 处理；Reaction Draw 3
  仍保持 Reaction permission。
- CR v1.5 §355.7、§355.9：`Kill a unit` 选择的是具体 Unit，因此是目标；目标在
  Resolve 时必须仍满足合法性。
- CR v1.5 §359.3.e：目标在 Resolve 前离开合法区域时，指令忽略，但整张 Spell 仍继续
  Resolve 并进入 Trash。
- CR v1.5 §418.1.b、§418.1.c：伤害标记在每个 Unit 上；四张 Point Spell 的金额和
  battlefield/base 限制来自已审核卡牌程序。三张目前可由统一内核执行；Hextech Ray 的
  “at a battlefield” 仍被目标计划的完整 `LocationRef` 要求阻塞。
- CR v1.5 §429.1、§429.2、§429.5：Kill 是从 Board 直接进 owner Trash，并归因于包含
  Kill instruction 的 Spell；新内核事件顺序因此要求先进入 Chain，再产生 Kill，最后完成
  Trash 退场。
- The Ruination 的 `Kill all units` 不是把每个 Unit 做成玩家逐个选择的 Target。卡牌
  程序已记录 §355.10.d 的无目标特征集合语义，但现有 `effect.kill` 尚不能消费该集合；
  把它改写成 TargetSpec 会错误地产生 became-target/选择步骤，所以保持
  `judge-required`/`test.todo`。
- Hextech Ray 的程序把 `TargetSpec.location` 写成 `{ type: "battlefield" }`，但当前
  `target-plan` 只接受带具体 `id` 的 `LocationRef` 并按同一 battlefield 比较。不能把
  任意 battlefield 近似成某个固定 id，因此测试保留 `todo`，等待程序/TargetSpec 契约
  统一为“位置类型限制”表达。

## 删除旧服务的前置条件

1. Draw 4、Reaction Draw 3、单目标 Kill 和四张固定 Point Spell 的 parity 测试在统一
   runtime 中全部稳定通过；当前 Hextech Ray 的 TODO 必须先被真实目标位置语义替换，
   且事件顺序、目标区域、费用计划和法术退场都由同一套
   `programs` + 原语 + Chain 事件管线产生。
2. 统一 runtime 的费用系统能保留印刷 `energy`/`power`（包括 `null` 无印刷费），并把
   Point Spell 的 Chain-first source/target proof、Deflect 附加 Power 费用和 cleanup
   proof 接到通用目标/费用原语；不能以 no-op closure 或手工资源变更替代。
3. `effect.kill` 增加符合 §355.10.d 的无目标 each/all 集合选择后，The Ruination 的
   `test.todo` 被真实 Chain 测试替换；集合不能退化为逐个 TargetSpec。
4. `each-player-kills-unit`、compound damage 及其它旧服务曾拒绝的语义，都有明确的
   卡牌程序状态和统一 runtime admission 测试；未知或未裁定文本仍保持
   `judge-required`/`blocked`。
5. 服务端命令、投影、journal/replay 和恢复路径都从统一 runtime 产生同样的 pending
   payment、priority、Chain entry/exit、通知幂等和隐藏信息结果；现有 P4 记录回放回归
   通过后，才能删除 `p4-spell-services.ts` 及其生产装配。

契约变更请求：`TargetSpec` 需要明确区分“具体 LocationRef”与“location type restriction”。
Hextech Ray 的“任意 battlefield”不能编码为不完整的 `{ type: "battlefield" }` 后再交给
当前 `sameLocation`；应由卡牌 DSL/TargetSpec 与 target-plan 共同提供位置类型过滤。
