# 通用卡牌场景测试台

`runCardScenario(program, scenario)` 把一张可执行 `CardProgram` 和一小段声明式场景接到真实的 `ProgramBinding`、`ChainEngine` 与 `EventPipeline`。卡牌进链、费用支付、目标锁定、触发器、静态层、替代效果和原语动作都通过现有内核执行；测试数据只描述初始对象、选择答案、操作和期望。

## API

```js
import { runCardScenario } from "../../dist/effects/testing/scenario/index.js";

const result = runCardScenario(program, {
  players: { A: { energy: 5, power: ["Fury"] } },
  objects: [
    { id: "spell", cardId: program.canonicalCardId, program, types: ["spell"], zone: "hand", energy: 1, power: ["Fury"] },
    { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 4 },
  ],
  answers: { "target:my-target": ["enemy"] },
  operations: [
    { type: "play", object: "spell", player: "A" },
    { type: "pass", player: "A" },
    { type: "pass", player: "B" },
  ],
  expect: {
    objects: { spell: { zone: "trash" }, enemy: { damage: 3 } },
    events: { includes: [{ timingPoint: "damage-dealt" }] },
  },
});
result.asserts();
```

返回值包含：

- `events`：场景操作产生的 `PipelineEvent[]`，包括时点、事件对象和原始 `action`。
- `state`：当前对象（含区域、Might、伤害、横置、指示物和派生层）、玩家资源/手牌数、优先权和链。
- `links`：效果解释器写入的链接值。
- `asserts()`：按 `expect` 执行断言。`defineTemplateSuite` 生成的每个测试会自动调用它。

## 场景格式

`players` 可设置 `energy`、`power`、`xp`、`score`，并用 `zones` 给牌库和手牌提供顺序。`objects` 是物理对象列表：`id` 是场景引用，`owner`/`controller`、`zone`、`location`、`combatRole`、`types`、`tags`、`might`、`energy`、`power`、`exhausted` 等字段对应 `ObjectSnapshot`。对象可以通过 `cardId` 绑定程序，也可以在 JS 场景里直接写 `program`；后者会自动加入本次运行的程序注册表，只有省略 `cardId` 时才会以程序的 canonical ID 填充它。显式 `cardId: null` 保持无卡牌身份。`might: null` 表示无 Might，`energy: null` 和 `power: null` 表示没有印刷费用，均原样保留；省略时仍默认 `might: 1`、`energy: 0`、`power: []`。测试台通过 `TestWorld` 的初始状态接口保留无 Might 特征，发生在链创建与任何操作之前。

程序校验、生命周期绑定（包括初始棋盘对象和后来打出的对象）及执行错误会直接抛出原始错误，保留原因与错误码；不会返回成功的场景结果。缺少选择答案时才会挂起等待 `choose`，场景结束仍未回答则失败。合法的 `ignored` / `negated` 指令结果继续遵循解释器语义。

`phase`、`turnOrder`、`turnPlayer` 和 `priority` 描述初始链环境。主阶段空链时优先权必须属于当前回合玩家；省略 `priority` 时由 `turnPlayer` 推导。

操作只有五类：

- `play`：通过程序的 Play 绑定打出对象；单位/装备的进入和法术的弃置由链引擎完成。
- `activate`：按 `ability` 索引调用程序的启动能力，默认第一个能力。
- `pass`：把当前优先权交给另一位玩家；单位和装备在结算时可能自动完成进入流程，法术/能力通常需要两次 pass。
- `trigger`：发出一个真实管线时点，例如 `{ type: "trigger", timingPoint: "card-played", object: "unit", player: "A" }`。省略 `source` 时用 `object` 作为事件来源。
- `choose`：预先回答一个选择。目标一般是 `target:<TargetSpec.id>`；有序 pick 或 `effect.inspect` 的选择使用程序给出的 `choiceId`。`value` 中的对象可以直接写场景对象 id，测试台会转换成当前 `ObjectRef`。可选、模式、排序和选择对象都走同一个重放式 `choose` 入口；`optional`、`mode`、`order` 也支持短别名。

期望中的 `events` 可以写数组（按顺序的子序列），也可以写 `{ sequence, includes, exact }`。事件模式是部分匹配，例如 `{ timingPoint: "card-drawn" }` 或 `{ action: { type: "damage", target: "enemy" } }`。`objects` 按场景 id 检查对象状态，`players` 检查玩家快照，`links` 检查链接值。

## 模板级参数化

`defineTemplateSuite(templateName, rows)` 返回独立测试用例。每行必须有 `canonicalCardId`、`program`、`scenario`，可选 `name` 或单独的 `expect`。生成的名称同时包含卡名（或行名）和 canonical identity 前缀，适合一张卡一个测试：

```js
for (const row of defineTemplateSuite("draw cards", [
  { canonicalCardId, program, name: "Cloud Drake", scenario },
])) test(row.name, row.run);
```

## 完整例子

仓库中的 `test/effects/testing/scenario/scenario-harness.test.mjs` 覆盖八个已合入的 executable 程序：

1. Hextech Ray：指定战场单位并通过真实伤害事件结算。
2. Cloud Drake：进场后的 `card-played` 触发抽牌。
3. Heart of Dark Ice：支付横置费用并启动 Might 效果。
4. Your units have +2 Might：静态算术层影响来源和友方单位。
5. I enter ready：进链注册替代效果，单位进入战场时保持 ready。
6. Eclipse：一个目标、一个有序牌库 pick 和选择性 recycle。
7. Salvage：可选分支回答和嵌套目标。
8. Premonition：Reaction 法术支付费用后抽三张。

`packages/card-dsl/test/cards/templates/_example.test.mjs` 是从 card-dsl 测试导入构建后 engine dist 的最小模板示例。测试台不提供 fixture 结算捷径，也不直接修改 frame、zone、resource 或 health；需要的状态变化必须由链、事件和动作管线产生。
