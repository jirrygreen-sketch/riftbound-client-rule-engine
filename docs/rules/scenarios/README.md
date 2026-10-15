# 规则场景规格（v1.5）

每个文件是一个规则章节的场景集合，格式冻结如下（只有调度者能改本文件）。场景是**数据**：测试框架（P1 test-harness）就绪后，会把它们逐条转成规则 golden 用例；在那之前它们是可审阅的规格。

## 文件

`docs/rules/scenarios/<area>.yaml`，顶层：

```yaml
area: chain                 # 与文件名一致
rulesetVersion: core-1.5
sources:                    # 依据：规则条目号（v1.5；暂只能确认 v1.4 编号的写 "1.4:xxx"）、官方 patch notes / FAQ 链接
  - "1.5:303.2.a"
scenarios:
  - id: chain-simultaneous-triggers-turn-order   # 全局唯一，kebab-case，以 area 开头
    rule: ["1.5:303.2.a"]
    title: 同时触发时按回合顺序入链，各自决定自己项的顺序
    kind: positive          # positive | negative（非法动作被拒） | edge（边界）
    given:
      turn: { active: A, phase: main, state: neutral-open }   # state: neutral-open | neutral-closed | showdown-open | showdown-closed
      players:
        A:
          energy: 3
          runes: { ready: [fury, fury], exhausted: [] }
          hand: [ "@unit(cost:2,might:3)" ]
          base: []
          score: 0
        B: { ... }
      battlefields:
        - { id: bf1, controller: A, units: { A: ["@unit(might:2)#u1"], B: [] } }
        - { id: bf2, controller: null }
      chain: []
    commands:
      - { player: A, do: play, card: "hand[0]", to: base, pay: { energy: 2 } }
      - { player: B, do: pass }
    expect:
      events:                 # 按序；可只列关键子序列，ordered: subsequence
        ordered: subsequence
        list:
          - { timing: chain.item-pending, item: "A:hand[0]" }
          - { timing: chain.item-finalized }
          - { timing: zone.enter, object: "A:hand[0]", zone: base }
      state:                  # 结算完成后的断言
        - { path: "players.A.energy", equals: 1 }
      rejected: null          # negative 场景：{ command: 0, reason: "not-your-priority" }
    notes: 可选，说明为什么这样判、易错点
```

## 卡牌占位

- 优先用**合成卡** `@unit(...)`、`@spell(...)`、`@gear(...)`、`@legend(...)`、`@battlefield(...)`，参数：`cost`、`might`、`domain`、`speed: action|reaction`、`keywords: [assault:2, shield]`、`text: "<自然语言能力，供实现时编译>"`；`#u1` 给对象起名供后续引用。
- 需要真实卡才能说明的，用 `card: "<英文卡名>"`，并在 `notes` 写明依赖的能力文本。
- 时点名用契约 3.5 的时点（如 `chain.item-pending`、`zone.enter`、`combat.attack-declared`）；RIFT-21 冻结枚举后，调度者统一核对改名。

## 要求

- 每个章节至少 25 个场景，positive / negative / edge 都要有；v1.5 新增或改动的规则必须覆盖（见 `docs/plans/2026-10-15-p0-contract.md` 3.4 节与官方 Radiance patch notes）。
- 不抄规则原文；`title` 和 `notes` 用中文自己的话。
- 判定不确定的场景标 `kind: edge` 并在 `notes` 写 `UNCERTAIN: <原因>`，不要编造裁定。
