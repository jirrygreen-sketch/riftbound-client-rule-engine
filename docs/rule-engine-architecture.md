# 规则引擎架构

## 1. 设计原则

1. 卡牌文字优先于通用规则，但卡牌文字中的术语仍按规则定义解释。
2. 任何改变游戏状态的行为都必须经过统一的事件管线。
3. 目标、费用、选择、触发、替代效果和普通效果是不同的语义层。
4. 规则状态与客户端显示状态分离。
5. 服务器和本地模式共享同一确定性引擎。
6. 不能自动判断的语义必须显式进入 `judgeRequired`，而不是默默采取近似行为。

## 2. 状态模型

### 2.1 身份模型

| 标识 | 作用 |
| --- | --- |
| `PhysicalCardId` | 物理牌或数据快照的稳定身份 |
| `CardDefinitionId` | 卡牌定义，不代表某一张实体 |
| `GameObjectId` | 当前区域中的逻辑对象身份 |
| `AbilityId` | 能力实例身份 |
| `TokenId` | Token 的独立身份 |
| `CounterId` | Counter/状态标记作为对象的身份 |
| `zoneEntryId` | 每次进入区域的序号，用于判断旧引用是否失效 |
| `ownerId` | 带牌进入游戏或被创建时的所有者 |
| `controllerId` | 当前控制者 |
| `zone` | Board 或 Non-Board 的逻辑区域 |
| `location` | Base 或具体 Battlefield；不是所有 zone 都有 location |

卡牌从 Board 进入 Non-Board Zone，或反向进入时生成新的 `GameObjectId`。`PhysicalCardId` 可以保留，用于追踪同一物理牌。控制权改变不改变所有权。

### 2.2 Card、Token、Counter

- Card 和 Token 是不同的内在类别，Token 不能被当成卡牌补全。
- Token 只能存在于 Board 或 Chain；进入其他 Non-Board Zone 后立即消失。
- Counter 是 Game Object，不用一个普通整数覆盖，以便支持“移动、移除、替代、来源追踪”。
- `faceDown`、`hidden`、`ambush`、`revealed` 是不同状态，不能用一个布尔值代替。

### 2.3 存储状态和派生状态

```ts
type GameState = {
  ruleset: RulesetVersion;
  turn: TurnState;
  players: Record<PlayerId, PlayerState>;
  objects: Record<GameObjectId, StoredObject>;
  chain: ChainItem[];
  outstandingTasks: OutstandingTask[];
  replacementEffects: ReplacementEffect[];
  continuousEffects: ContinuousEffect[];
  eventSeq: number;
  rng: DeterministicRngState;
};

type DerivedState = {
  turnState: "neutral-open" | "neutral-closed" | "showdown-open" | "showdown-closed";
  legalActions: ActionId[];
  characteristics: ResolvedCharacteristics;
  applicableTriggers: TriggerCandidate[];
  legalTargets: Record<PromptId, TargetOption[]>;
};
```

`StoredObject` 只记录事件可重放所需的事实；攻击力、能否被选择、当前费用等由 Layer/continuous effect 和规则上下文求值生成。

## 3. HOT FEPR

引擎的主驱动遵循：

```text
Handle Outstanding Tasks
  -> Finalize
  -> Execute
  -> Pass
  -> Resolve
```

### 3.1 Handle Outstanding Tasks

处理阶段任务、Combat、Showdown、Cleanup 等必须在继续之前完成的工作。Cleanup 本身是阻塞式任务：

- Cleanup 期间不能 Finalize 或 Resolve。
- Cleanup 期间不能传递或授予 Priority/Focus。
- Cleanup 可以产生新的 Pending Item，但要等 Cleanup 完成后才继续 FEPR。
- Cleanup 中导致新状态变化时，立即排入下一轮 Cleanup，直到达到 fixed point。

### 3.2 Finalize

- 按加入 Chain 的先后处理最老的 Pending Item。
- Finalize 时完成打牌流程、合法性检查、费用支付、目标选择和模式选择。
- Finalize 不传递 Priority。
- Unit、Gear、Add Ability 在 Finalize 后按规则立即进入 Resolve。
- 如果可选触发从一开始就被拒绝，该触发不作为待结算能力保留。

### 3.3 Execute

拥有 Priority 的玩家只能执行当前状态允许的 Discretionary Action。Closed State 默认只允许 Reaction；Showdown State 还要检查 Action/Reaction 限制。

### 3.4 Pass

所有玩家按 Turn Order 连续 Pass 且没有加入新 Item，才进入 Resolve。中途有人加入 Item，重新回到 Finalize。

### 3.5 Resolve

Resolve 最新的 Finalized Chain Item，并完整执行其效果。Resolve 期间不能启动 Cleanup；需要 Cleanup 的改变会作为 Outstanding Task 留到 Resolve 后处理。

## 4. Turn State、Priority 和 Focus

| 状态 | Chain | Showdown/Combat | 主要权限 |
| --- | --- | --- | --- |
| Neutral Open | 无 | 无 | Turn Player 有 Priority |
| Neutral Closed | 有 | 无 | 只有合法 Reaction |
| Showdown Open | 无 | 有 | Focus 持有者可行动且必须有 Priority |
| Showdown Closed | 有 | 有 | 只有合法 Reaction |

Priority 是采取 Discretionary Action 的排他权限；Focus 是 Showdown Open 中取得适当行动资格的权限。Focus 持有者获得 Priority，但 Pass Priority 不会失去 Focus。链结束回到 Showdown Open 时是否传递 Focus，要按链的起因判断，不能统一做成“链结束自动传焦点”。

## 5. 费用、目标和选择

### 5.1 费用计划

```text
Base Cost
  -> Alternate Cost / Flow
  -> Optional Additional Cost / Repeat / Accelerate
  -> Mandatory Additional Cost
  -> Cost Increases
  -> Discounts
  -> Final Total
  -> Payment
```

打印或复制成本与实际支付成本分开保存。被 Counter 不返还已支付费用。费用动作被替代时，仍记录为已支付；如果费用动作本身不可能完成，整个 Finalize 失败。

### 5.2 TargetPlan

Finalize 时创建并锁定目标选择，Resolve 时重新检查：

```ts
type TargetPlan = {
  requirement: TargetRequirement;
  selected: ObjectRef[];
  lockedAt: "finalize";
  retestAtResolve: boolean;
  mode?: string;
  repeatIndex?: number;
};
```

必须区分：

- Target 与非目标选择。
- 固定引用与 Finalize/Resolve 时重新选择。
- `up to`、`any number` 与强制最小数量。
- Group Target 与每次 Repeat 的独立选择。
- `mistargeted`、`ignored`、`negated`、`replaced`、`impossible`、`partial`。

目标离开 Board 后，旧引用通过 `zoneEntryId` 失效；不要只按卡名重新匹配。

### 5.3 EffectIR 与 Outcome

```ts
type EffectIR =
  | { kind: "draw"; player: PlayerRef; amount: ValueExpr }
  | { kind: "dealDamage"; source: ObjectRef; targets: TargetRef[]; amount: ValueExpr }
  | { kind: "kill"; targets: TargetRef[] }
  | { kind: "move"; targets: TargetRef[]; destination: LocationExpr }
  | { kind: "createToken"; definition: TokenDefinitionId; count: ValueExpr }
  | { kind: "sequence"; steps: EffectIR[] }
  | { kind: "conditional"; condition: ConditionIR; then: EffectIR; otherwise?: EffectIR }
  | { kind: "repeat"; count: ValueExpr; body: EffectIR; chooseEachIteration?: boolean };

type ExecutionOutcome = {
  executed: boolean;
  partial: boolean;
  ignoredInstructions: string[];
  generatedEvents: Event[];
  linkedValues: Record<string, unknown>;
};
```

## 6. 事件、触发和替代效果

### 6.1 统一事件管线

所有行为使用：

```text
Intent
  -> Replacement candidates
  -> Choose/apply replacement order
  -> Prevention / modification
  -> Commit event
  -> Trigger scan
  -> Pending ability creation
  -> Cleanup request if required
```

Replacement、Prevention、Modification 不直接塞入普通 EffectIR；它们必须能观察被替代的原始事件和替代后的事件。

### 6.2 强制和可选触发

- 事件提交后扫描适用能力。
- 能力控制者、来源快照、触发时的地点和特征都写入 Trigger Snapshot。
- 只有一个无策略差异的强制选择时才自动执行。
- 可选触发、可选支付、多个合法目标、多个模式和顺序差异都产生 Prompt。
- 触发是否存在与其效果是否能做是两件事：所有目标失效时，“when you play a spell” 仍可触发，但 Resolve 中效果可以全部不发生。

### 6.3 例外

- Counter 不触发 `when played`。
- 完全被 Prevention 的伤害不触发 `take damage`。
- Cleanup 中 Deathknell 等能力要记录死亡前快照，再按规则加入 Pending Item。
- Control change 不回溯修改已经触发或已锁定的能力，除非具体规则/FAQ 规定。

## 7. 区域、对象和隐私

引擎内部维护完整状态，向客户端生成：

```ts
type PlayerProjection = {
  visibleObjects: ProjectedObject[];
  privateZones: PrivateZoneView[];
  legalActions: ActionDescriptor[];
  prompts: Prompt[];
  eventLog: PublicEvent[];
};
```

牌库顺序、对手手牌正面、Private facedown card 的正面和未公开选择不能出现在对手 Projection、网络消息或普通日志中。服务器审计视图与玩家视图必须使用不同的序列化器。

## 8. 关键回归案例

以下用例必须在规则引擎中固定为可执行 fixture：

1. Unit 进入 Board 前不能被普通响应。
2. `Hidden Blade` 目标离场后，linked draw 不执行。
3. `Repeat` 每次执行使用独立目标选择。
4. `Cruel Patron` 追加费用支付后最终状态非法，整次 Play 取消并撤销支付。
5. `Flow` 卡被 Counter 后进入 Banishment，而不是普通 Trash。
6. Cleanup 触发新能力并进入下一轮 FEPR。
7. 所有目标失效，但 `when you play a spell` 仍可触发。
8. Counter 不返还已经支付的费用。
9. 被禁止的动作通常在 Resolve 时跳过，不直接让整张卡无法 Finalize。
10. 牌面朝下不等于 Ambush。
11. Token 离开 Chain 进入 Non-Board Zone 后消失。
12. 物理卡从 Board 回到手牌后生成新的 `GameObjectId`。
13. 控制权改变不改变 Owner。
14. Counter 不触发 `when played`。
15. 伤害被完全 Prevention 时，不触发 `take damage`。

## 9. 错误处理

| 情况 | 引擎行为 |
| --- | --- |
| Command 在当前状态不合法 | 拒绝，不产生日志事件 |
| Finalize 费用不能支付 | Item 离开 Chain 或取消，按规则处理已完成的支付步骤 |
| Resolve 目标失效 | 标记 ignored/mistargeted，继续执行可执行部分 |
| 规则文本无法编译 | `judgeRequired`，阻止自动 Resolve |
| 网络重复 Command | 用 command id 幂等处理 |
| 回放状态哈希不一致 | 停止回放并报告第一个不一致事件 |
