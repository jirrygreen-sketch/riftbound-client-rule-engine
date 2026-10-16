# RIFT-120 链与事件核心

入口为 `ChainEngine`，注册与时点类型位于相邻 `events/`。这层尚未接入
game-server；旧 duel 导出、默认 runtime、profile 和回放格式均未改动。
共享包入口和服务端切换由协调任务负责。

## 接线

1. 状态拥有者实现 `PipelineHost`，或通过 `createActionPipelineHost(port)`
   接入现有原子动作执行器。`checkpoint/restore` 必须覆盖对象、资源、区域、
   随机数、历史、链接值和其他可变上下文；不得用接收回执代替动作执行。
2. 用 `engine.execute(draft)` 提交拥有 Priority 的自由动作；规则生成的能力通过
   `enqueue()`，效果中的 Play/Counter 通过 `engine.commit()`。
   `describePlay` 必须从真实卡牌程序构造 ChainDraft；缺少适配器时拒绝 Play。
3. `engine.commit(action)` 是原语 `perform` 的实现基础：替代候选 → 受影响者选序
   → 每个替代效果在同一事件及其后代最多一次 → 执行动作 → 提交事件 → 扫描触发。
   替代后的动作重新匹配候选；取消伤害不发伤害时点。原语不通知触发器。
4. `cleanup(engine)` 是实际规则任务适配器，改变状态只能调用 `engine.commit()`；
   返回是否发生状态变化。HOT 反复运行清理，直至不动点。阶段、战斗等外部任务
   使用 `requestTask/completeTask` 阻塞 FEPR；不能用空回调替代未实现的规则。
5. 收到 `AwaitChoice` 后保留请求，提交答案并重试同一操作。动作、Finalize、Resolve
   都有保存点；挂起时连同支付、触发、链项、Pass、图层注册一起回滚。

`pipeline` 的注册函数供可信内核使用。集成方须通过 `engine.commit/emit` 提交，
避免绕过包含链状态的外层事务。单独使用 `EventPipeline` 时，host 的事务还须
包含自定义触发接收器的状态。

## 已实现的语义

- 唯一 Pending/Finalized 模型；最旧 Pending 先 Finalize，最新 Finalized 先 Resolve。
- 清理阻塞 Finalize、Resolve、Priority 和 Focus；Resolve 期间积累清理任务，
  完整执行解释器后再清理。单位、装备、Add 在 Finalize 和必要清理后立即结算。
- 全员按回合顺序连续 Pass 才结算；新项加入后重置连续 Pass。
- Neutral/Showdown × Open/Closed 的 `canAct()`；有 Focus 仍须有 Priority。
  触发/Add 开启的链结束不传焦点，其他链结束传焦点；Finalize 不传优先权。
- 时点、ObjectFilter/EventPattern、条件、once 频率、来源区域筛选。
  同一物理事件的多个命名时点合并排序；不同玩家按当前回合顺序、本方多个能力
  通过 choose 排序。可从一开始拒绝的可选能力不入链；前置 may 可在 Finalize 拒绝。
- 来源、控制者、地点和特征快照；离场/死亡保留离场前信息，后续控制权变化
  不改已生成能力。临时授予文本可用 `boundToIncarnation` 限定原入区序号；
  延迟能力可用 `expiresAt` 明确到期。
- TargetPlan 在 Finalize 锁定、通知成为目标，Resolve 按对象入区序号重验；
  Pending 排除由链提供。TargetTaxAdapter 将税加入 CostPlan 后统一支付。
  前置触发费用失败时移除能力，不标记反击，不消耗 once。
- 已失效来源的前置“recycle me”费用绑定该牌当前 Trash 身份，效果仍用 LKI。
- 解释器执行现有注册原语。`interpreter-adapter.ts` 保留原语 v1 所需的 Expr，
  不改变卡牌数据和原语文件；持续效果注册和期限推进交给 layers。

依据：CR v1.5 303.2.a、307–313、319–340、347–348、370–373、383、386；
费用及目标语义沿用已合入的 cost/target 实现。

## 验收与范围边界

场景 ID 逐项对照及未覆盖原因见 [SCENARIO-COVERAGE.md](./SCENARIO-COVERAGE.md)。
表中的“覆盖”表示已用真实动作/解释器验证该场景的链或扫描不变量，
并非声明官方命名卡牌程序或完整回合/战斗编排已经接入。

`chain-play-effects-after-unit-boarded` 精确断言完整事件序列：单位 Pending →
清理 → Finalize → 清理 → 实际进场 → 触发 Pending → 单位 Resolve → 触发
Finalize → A/B Pass → 解释器执行 `effect.draw` → 触发 Resolve → 清理。

本层只消费战斗、征服、固守等规则模块发出的真实时点，不自行伪造这些业务动作。
Showdown 关闭后如何继续战斗/计分或下一阶段，由对应任务接收时点/任务信号。

## 契约变更请求

1. **缺少动作时点。** 现有枚举没有支付、获得 Energy/Power、治疗、脱离、
   对象控制权变化、计数器变更、洗牌/排序、复制、胜负动作对应时点。
   这些动作仍由状态执行器执行，保留其 ActionOutcome 回执；本适配器不把它们
   错标成其他时点，也不会据此扫描触发。因此“所有动作都有对应命名时点”尚未闭合。
   最小草案：增加 `action-committed`，payload 为
   `{ action: GameAction, before?: ObjectSnapshot, after?: ObjectSnapshot, result?: Value }`，
   对缺少专用语义时点的成功动作发出；同步扩展 EventPattern 的事件 discriminator。
   或由契约拥有者逐个增加专用时点，适配器再按枚举接线。

2. **解释器缺少目标/模式生命周期接口。** 当前解释器自己在重复结算中重选目标，
   无法让链为每轮执行 TargetPlan、目标税和“成为目标”通知；模式也由解释器在
   Resolve 时选择。现在遇到嵌套/重复目标或 `choice.mode`，在 Finalize 抛出
   `ChainContractBlockedError(status='blocked')`，不近似执行，也不标成 ignored。
   最小草案是在 `runAbilityBody` 增加可选的引擎内部生命周期参数：

   ```ts
   interface InterpreterLifecycle {
     targets(request: {
       instructionId: string; path: readonly string[]; repeatIndex?: number;
       phase: 'finalize' | 'resolve'; specs: readonly TargetSpec[];
     }): ReadonlyMap<string, readonly ObjectRef[]>;
     modes(request: {
       instructionId: string; path: readonly string[];
       phase: 'finalize' | 'resolve'; options: readonly string[];
     }): readonly string[];
   }
   ```

   回调由本层实际执行 TargetPlan/CostPlan 并保存选择；原语面向的 ResolveContext
   不增字段，符合契约 3.8。生命周期接口落地前，相关卡牌须保持 blocked/judge-required。

3. **延迟窗口和命名触发激活。** 原语接口仅有 `registerDelayedTrigger(at, body)`，
   没有“本回合/窗口已结束”等注册期限信息，也没有命名触发激活与真实事件的区别。
   内部注册已支持 `expiresAt/boundToIncarnation`，但不能从现有原语签名推断期限。
   最小草案：由解释器的内部适配器传递
   `{ windowId, expiresAt, windowClosed, sourceSnapshot }`，关闭窗口时拒绝注册；
   命名触发另传 `{ namedTriggerId, checkCondition: true, emitOriginalEvent: false }`。
   本轮不增加原语接口，也不合成未发生的攻防/征服等事件。

这些变更请求未修改冻结契约、timing-points.ts、trigger-spec.ts 或范围外实现。
