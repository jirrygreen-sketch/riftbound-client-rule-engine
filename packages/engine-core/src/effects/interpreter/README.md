# Ability body interpreter

`runAbilityBody(body, context, registry?)` executes an `Instruction[]` synchronously.
The registry is a `ReadonlyMap<string, InstructionDef<unknown>>`, defaulting to
`instructions/registry.generated.ts`. An empty generated registry is supported;
unregistered primitive opcodes throw. Primitive schemas parse **evaluated** arguments.
The shared structural node and expression types live in `@riftbound/card-dsl`.

## 符号对象选择器（契约 3.6）

静态 IR 的对象位置使用 `ObjectSelector`，不能写运行时 `{id, zoneEntryId}`。
校验器检查选择器形状、当前能力的 TargetSpec / PickSpec 声明，以及链接是否指向
当前或外层可见作用域中的前序指令。普通常量仍是数据，不会隐式执行表达式。

| 选择器 | 运行时绑定 |
| --- | --- |
| `"self"` | `runAbilityBody(body, context, registry, {host})` 提供的宿主当前引用；宿主与来源相同时可省略 `host`，默认 `context.source.ref` |
| `"source"` | `context.source.ref`；引用失效时读取调用者提供的来源最后已知快照，不绑定同 id 的新入区对象 |
| `{target: id}` | 当前指令的 `context.targets(id)`，包含重复执行重新选择后的目标，并排除失效或不再匹配过滤器的成员 |
| `{pick: id}` | `context.picks(id)` 中的对象引用，保留顺序；玩家或模式字符串不参与对象特征读取，不触发成为目标行为 |
| `{linked: id}` | 前序指令产生的对象引用或引用列表；命名结果记录中的对象绑定按写入顺序展开，重复引用只保留一次 |

`object-property` / `object-attribute` 是标量读取，取选择器结果中的**第一个对象**。
空结果或第一个对象不可用时指令被 ignored；不自动寻找下一项，也不把缺失或
`energy:null` / `power:null` 转成 0。已验证的目标组会先排除无效成员，再读取首个
合法目标；已经失效的无关 target / pick 没有隐式回看权限。

`count` 与原语通过解释器上下文发起的集合查询使用**全部对象**。
ObjectFilter 的 `object/source/target/host` 锚点匹配任意选中身份，`attachedTo`
匹配附着宿主，`sameLocationAs` 匹配位置，`exclude` 排除全部选中身份；结果中
同一对象只计一次。普通筛选条件仍交给底层 `context.query`。静态 IR 的过滤器
锚点也接受同一选择器格式。来源回看与本体执行造成离区的回看规则保持一致。

调用者必须在每次能力执行开始时提供宿主的当前 zone-bound 引用。解释器不会
按对象 id 搜索并重绑失效引用；`self` 与 `source` 可以分别指向不同对象。

An outcome contains `status: "executed" | "partial"`, `results` (instruction
completion order, including containers), `events` (each primitive event once), and
`linkedValues`. Each result retains the original `id`, `op`, execution `path`, and
`InstructionResult`. Any ignored/negated instruction or lost target makes the
outcome partial. A container with at least one executed child is executed; an
entirely ignored container is ignored, so its successors also ignore it.

`linkedTo` refers to a preceding instruction in the current or an enclosing scope.
Ignored propagates; negated allows an attempt. An explicit condition is evaluated
once before that instruction, and is never inherited by the next instruction.
Individual mistargeted members also stay suppressed through linked instructions,
including target groups and characteristic reads across sequence boundaries.
Sequence children share the surrounding link scope. Repeat iterations and mode
executions have independent scopes, with access to their enclosing links.

## Structural instructions and native expressions

`SequenceInstruction`, `RepeatInstruction`, and their argument types preserve
the existing `op` / `args` encoding. Bodies, modes, conditions, history queries, and operand
expression lists are encoded as `constant` expressions; scalar arguments can be
any existing `Expr`. Constants are always literal data: a constant containing an
expression-shaped object is not implicitly executed.

| Opcode | Evaluated arguments | Result bindings |
| --- | --- | --- |
| `sequence` | `body: Instruction[]` | Child results remain visible |
| `repeat` | `count: nonnegative integer`, `body: Instruction[]`, `reselectTargets: boolean = true` | `count` |
| `choice.optional` | `body: Instruction[]` | `value: true` when accepted; refusal is negated/skipped |
| `choice.mode` | `modes: {id, body}[]`, `count = 1`, `different = true` | `value: selected mode ids` |
| `choice.order` | `objects: ObjectRef[]` | `value: chosen permutation` |
| `condition.predicate` | `condition: Condition` | `value: boolean` |
| `condition.history` | `query: HistoryQuery`, optional `operator`, `right` | `count`, `value` (count or comparison) |
| `condition.value` | `value`, optional comparison `operator`, `right`, `key` | `value` and the named key, e.g. `X` |
| `condition.value` | arithmetic `operator`, `operands: Expr[]`, optional `key` | Calculated `value` and named key |

Native `ArithmeticExpr` uses `{ kind: "arithmetic", operator, operands: Expr[] }`
and can be nested directly in arguments, conditions, and repeat counts. Operators
are `add`, `sub` / `subtract`, `mul` / `multiply`, `div` / `divide`, `min`, `max`,
and unary `neg`. Subtraction and division require two operands; `neg` requires
one, and all other operators require at least one. Missing information and arithmetic
on null characteristics ignore the instruction; unsupported operations, invalid
answers, non-finite numbers, and malformed inputs throw. No null is converted to
zero. Arithmetic can be composed by reading a prior `condition.value` through a
`linked-value` expression. Both forms use the same arithmetic evaluator.

Mode selection uses one `mode` request per selected slot; distinct selection
removes prior answers from subsequent options. Selected modes execute in their
declaration order. An explicitly permitted duplicate mode has an independent
execution scope for each copy. `choice.order` only selects an object order; an
ordinary primitive consumes that linked order to perform the game action.

All three choice opcodes accept optional `chooser`, `visibility`, and `prompt`.
Choice request ids are the URI-encoded execution path followed by the local
request id, joined by `/`. Examples: `may/optional`, `mode/mode%3A0`, and
`repeat/1/damage/target%3Aunit`. Primitive requests receive the same path scoping.

## Replay, targets, and authority

`AwaitChoice` escapes to the transaction owner. The owner must roll back and
replay the **whole body**, retaining answers by stable request id. The interpreter
has no state snapshot capability in `ResolveContext` and retains no completed
results between attempts. Tests execute the entire body through the real
`runInstruction` kernel transaction, so actions, events, history, linked writes,
continuous registrations, and delayed triggers roll back together.

Ordinary instructions consume Finalize-locked targets from `context.targets`,
recheck reference identity and the declared filter, and keep legal members of a
partially mistargeted group. Picks use `context.picks` and are never treated as
targets. A repeated body issues independently scoped `select-objects` requests
for each declared target specification on each iteration by default, allowing the same or
different legal objects. Previously finalized answers are revalidated: lost
members are ignored and the remaining legal members still execute. Choices nested in the body are also independently
scoped. An explicit `reselectTargets: constant(false)` keeps the locked targets
and revalidates them on every iteration. `effect.repeat` remains an ordinary registered primitive: it declares
the finalized repetition count in a linked result. A following `repeat` control
instruction reads that count and performs the loop. Neither operation replays
the card or pays an additional cost by itself.

The production caller owns the Make Relevant Choices/Finalize timing (CR v1.5
355.3, 355.15, 820.2), target-trigger events (754), and exclusion of Pending chain
items from target candidates. `ResolveContext` exposes neither chain-item status
nor a target-choice game action. These cannot be synthesized by this interpreter;
the caller must provision finalized answers and trigger observations before
committing resolution. The reference kernel does not model turn/combat changes:
history scope correctness across boundaries remains with `context.history`;
interpreter tests verify exact scope forwarding and counts of actual actions.

Current object characteristics are read at execution time. Look-back is enabled
for an object whose reference is invalidated by an action in this body, including
a replaced action that actually changes its zone, and for the source snapshot
supplied by the context (359.3.e.13). An already unavailable unrelated target does
not acquire look-back permission (359.3.e.12). Captured linked values are JSON
copies and remain fixed when objects subsequently change.

## Contract follow-up for the coordinator

Agree on the exported `ExecutionOutcome`/package entry point and add an authority
boundary for finalized per-iteration targets and target-trigger
notifications before integrating the repeat selector into production. The
implementation and its tests only modify the interpreter's assigned files.
