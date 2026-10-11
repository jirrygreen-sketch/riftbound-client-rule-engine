# 卡牌 DSL 设计

## 1. 目标

卡牌 DSL 用来把卡牌文字转换成可校验、可执行、可回放的规则表示。它不是为了把所有中文或英文自然语言强行解析成代码，而是采用：

```text
Card Text / Structured Authoring
  -> DSL AST
  -> Semantic Validation
  -> Effect IR + Trigger IR + Cost/Target Plan
  -> Rules Engine
```

解析失败或语义不确定时，输出 `judgeRequired`，保留原始文本和上下文，禁止静默猜测。

## 2. Card Definition

建议的卡牌定义：

```yaml
schemaVersion: 1
cardDefinitionId: card.abandon
name: Abandon
cardTypes: [Spell]
domains: [Chaos]
printedCost:
  energy: 2
  power: 0
abilities:
  - id: abandon.reaction
    timing: reaction
    kind: spell
    text: Counter a spell. Return it to its owner's hand instead of putting it in their trash.
    source:
      ruleset: 1.5
      dataVersion: 2026-10-09-radiance
    effect:
      sequence:
        - counter:
            target: { type: spell, controller: any }
        - replace:
            event: counteredSpellDestination
            with: owner'sHand
```

字段约束：

- `cardDefinitionId` 稳定，不随本地化文本改变。
- `name` 是展示字段，不能用作运行时身份。
- `printedCost` 与 `effectiveCost` 分离。
- `abilities[].source` 必须锁定规则版本和数据版本。
- 每个能力有独立 `id`，便于触发、日志和裁判引用。

## 3. AST 层次

### 3.1 触发

```ts
type TriggerIR = {
  id: AbilityId;
  event: EventPattern;
  condition?: ConditionIR;
  controller: ControllerResolver;
  choicePlan?: ChoicePlan;
  effect: EffectIR;
  optional?: boolean;
  snapshot: SnapshotSpec;
};
```

`event` 只描述“什么事件发生”，`condition` 描述“是否满足”，`effect` 描述“发生后做什么”。不能把三者拼成一个无法重测的谓词。

### 3.2 目标和选择

```ts
type ChoicePlan = {
  mode?: ChoiceMode;
  targets?: TargetRequirement[];
  nonTargetChoices?: ChoiceRequirement[];
  repeatPolicy?: "same" | "independent";
  chooseAt: "finalize" | "resolve";
};
```

目标在 Finalize 锁定；Resolve 时只重新检查合法性，除非文本明确要求 Resolve 时选择。Repeat 默认使用独立选择，不能复用第一次目标。

### 3.3 效果

效果尽量使用有限、可组合的原语：

- `draw`
- `reveal`
- `look`
- `discard`
- `recycle`
- `banish`
- `returnToHand`
- `move`
- `play`
- `createToken`
- `ready`
- `exhaust`
- `stun`
- `dealDamage`
- `heal`
- `kill`
- `buff`
- `gainPoints`
- `addResource`
- `counter`
- `prevent`
- `replace`
- `sequence`
- `choose`
- `if`
- `forEach`
- `repeat`

原语必须返回 `ExecutionOutcome`，包含 ignored、partial、linked values 和生成事件。

## 4. 成本 DSL

```yaml
cost:
  base:
    energy: 3
    power: 1
  alternate:
    - id: flow
      source: trash
      payment:
        energy: 4
  additional:
    - id: repeat
      optional: true
      payment:
        energy: 1
    - id: sacrifice
      mandatory: true
      action:
        kill:
          target: { friendly: true, type: unit }
```

校验器必须区分：

- Base Cost。
- Alternate Cost，例如 Flow。
- Optional Additional Cost，例如 Repeat。
- Mandatory Additional Cost。
- Resolve 内部的支付。
- Applied Cost，不进入 Chain 的行动费用。

成本变更使用明确阶段，不能只把所有修正相加：

```text
base -> alternate -> additional -> increases -> discounts -> total -> payment
```

## 5. 目标 DSL

```yaml
target:
  id: target.unit
  selector:
    type: unit
    location: battlefield
    controller: opponent
  quantity:
    min: 1
    max: 1
  retestAtResolve: true
  ifIllegal: ignore
```

支持：

- 固定引用。
- Target。
- Non-target choice。
- `up to` 和 `any number`。
- Group target。
- 按 Repeat 每次独立选择。
- linked instruction 的来源绑定。

## 6. Replacement 和 Prevention

替代效果采用独立注册表：

```yaml
replacement:
  event: objectWouldDie
  condition:
    object: { controller: you, type: unit, buffed: true }
  chooser: affectedController
  replacement:
    kill: source
    heal: affectedObject
    recall:
      destination: controllerBase
```

事件系统需要保留：

1. 原始事件。
2. 当前待应用的替代效果集合。
3. 已应用的替代效果。
4. 替代后的新事件。
5. 是否还可以被其他替代效果观察。

同一事件有多个替代效果时，按规则把选择权交给正确的玩家，不按注册顺序偷偷决定。

## 7. 示例

### 7.1 自动触发但目标需要 Prompt

```yaml
ability:
  id: unit.whenConquer
  trigger:
    event: { kind: conquer, source: self }
  optional: true
  choices:
    - id: pay
      type: payment
      optional: true
      cost: { energy: 1 }
    - id: target
      type: target
      selector: { type: enemyUnit, location: base }
      quantity: { min: 0, max: 1 }
      chooseAt: resolve
  effect:
    if:
      condition: { choice: pay, equals: paid }
      then:
        dealDamage:
          target: { choice: target }
          amount: { sourceCharacteristic: might }
```

### 7.2 Hidden Blade 的 linked effect

```yaml
effect:
  sequence:
    - bind:
        key: victim
        target: chosenTarget
    - kill:
        target: { ref: victim }
    - linked:
        from: kill
        then:
          draw:
            player: { controllerOf: victim }
            amount: 2
        require:
          affectedObjectStillOnBoard: true
```

如果目标在 Resolve 前已非法，Kill 被忽略，linked draw 也忽略；如果 Kill 被替代但对象仍在 Board，则按 linked 规则重新判断。

### 7.3 Repeat

```yaml
repeat:
  cost: { energy: 1 }
  body:
    choose:
      target:
        selector: { type: unit }
      then:
        dealDamage: { target: choice.target, amount: 1 }
  selectionPolicy: independent-per-execution
  createsNewChainItem: false
```

Repeat 只支付一次追加费用，在同一 Resolve 中重复执行效果，不创建第二个 Chain Item。

## 8. 编译和校验

编译器输出：

```text
CardDefinition
  -> Syntax Diagnostics
  -> Semantic Diagnostics
  -> Compiled Ability
  -> Coverage Tags
```

必须拦截：

- 目标数量上下限矛盾。
- 引用了不存在的特征或 zone。
- 将 Token 当 Card 处理。
- 在 Cleanup 禁止的时间点声明普通响应。
- 用实际成本去判断只允许检查打印成本的效果。
- Repeat 错误生成第二个 Chain Item。
- linked effect 没有稳定来源引用。
- 隐私区域信息越权读取。

每张卡输出覆盖标签，例如：

```json
{
  "features": ["trigger", "target", "linked-effect"],
  "requiresPrompt": true,
  "judgeRequired": false,
  "rulesReferences": ["355.10", "359.3.e.14"]
}
```

## 9. 不支持时的降级

当卡牌文本包含未实现机制或资料冲突：

1. 仍允许将牌展示在手牌和牌组中。
2. 打牌时创建 `judgeRequired` Prompt。
3. 记录原始文本、版本、来源和解析诊断。
4. 阻止服务器自动生成不确定结果。
5. 裁判确认后将决定写入回放，不修改历史事件。
