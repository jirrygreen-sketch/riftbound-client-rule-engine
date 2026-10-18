import type { Ability, CardProgram, Condition, Instruction } from "../../ir/index.js";

/**
 * Twisted Fate, Gambler (ogn-200-298) — Unit, 4 energy, 4 Might.
 *
 * Printed text (local deck-catalog, ogn-200-298):
 *   When I attack, reveal the top rune of your rune deck, then recycle it. Do
 *   one of the following based on its domain:
 *   :rb_rune_fury: — Deal 2 to an enemy unit here and 1 to all other enemy units
 *   here.:rb_rune_mind: — Draw 1.:rb_rune_order: — Stun an enemy unit.
 *
 * 规则依据（CR v1.5）：
 * - “When I attack” 是攻击触发（383.4.e），时点 attack-declared（combat/ 发出，
 *   已列入 timing-points.ts）。
 * - “reveal the top rune of your rune deck”：425.1（展示公开给所有玩家）、425.3.a
 *   （未指明张数时是该区域当前全部牌；这里指明 1 张）、108.5.d（符文牌库顺序是秘密信息，
 *   所以必须按区域顺序取顶）。`effect.reveal` 的 `pick` 形状与链 Finalize 的 ordered-pick
 *   plan 已合入；本程序用 `zoneSlice` 锁定符文牌库顶 1 张，再交给 reveal，避免用无序
 *   `query` 猜牌库顺序。
 * - “then recycle it”：417.1.b（符文回收进符文牌库）、417.1.c（无论谁被指示执行，都回收
 *   到牌主自己的牌库）、417.6（未指名的集合形式）。本程序用 `effect.recycle` 的
 *   `objects` + 上一条 reveal 的链接值（契约 3.6 linked-value），已合入且可执行。
 * - “Do one of the following based on its domain”：388.1 / 388.1.b——这是**反身触发**
 *   （Reflexive Trigger，“Do one of the following”），不是普通的“选一个模式”指令：
 *   条件满足后按条件把对应的一个反身触发作为新的链项入链（389 / 389.1）。本程序按契约
 *   3.9 的可表达形状写成三个由 domain 条件守住的 `sequence` 分支（structure 完整、
 *   互斥、可被解释器逐条求值），但引擎里没有卡牌可用的反身触发构造原语；并且
 *   chain/engine.ts 的 assertFinalizationSurface 直接拒绝 choice.mode
 *   （“Mode choices require a Finalize/Resolve choice-plan adapter”），反身触发的
 *   链项构造也没有落线，所以整卡保持 judge-required。
 * - 三个分支的取值/动作：domain 用被展示符文的 `power`（Domain 列表）与常量域比较
 *   （`in`/`eq` 语义等价，程序用 `eq` 与单元素列表，避免把 “基于域” 写成模糊比较）；
 *   “here” 用 359.3.e.13 式的来源当前位置引用（`sameLocationAs: "self"`，本卡的攻击
 *   触发在 attacker 仍在场时求值）；“all other enemy units here” 用 `exclude` 排除被
 *   选中的那一个（355.14 的“other”语义）。
 *
 * status：judge-required。首次攻击过滤已使用可绑定的 source:self 与 per-combat。
 * 揭示/回收前缀通过真实触发链执行；其余子效果保持原有执行测试。
 * 仍缺反身触发的新链项、Fury 相对目标与嵌套目标生命周期、Order stun 解码，
 * 以及首次攻击身份的生产事务。同步 sequence 分支不构成反身触发证据。
 */

/** 分支条件：被展示符文的域列表等于给定的单域列表（`eq` 与 `in` 等价，取更严格者）。 */
function domainIs(domain: string): Condition {
  return {
    kind: "compare",
    left: {
      kind: "object-property",
      object: { linked: "twisted-fate-gambler.reveal-rune" },
      property: "power"
    },
    operator: "eq",
    right: { kind: "constant", value: [domain] }
  };
}

const furyBranch: Instruction = {
  id: "twisted-fate-gambler.fury",
  op: "sequence",
  condition: domainIs("Fury"),
  args: {
    body: {
      kind: "constant",
      value: [
        {
          id: "twisted-fate-gambler.deal-2",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 2 },
            target: { kind: "constant", value: "enemy-unit-here" }
          },
          targets: [
            {
              id: "enemy-unit-here",
              filter: { type: "unit", controller: "opponent", sameLocationAs: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "twisted-fate-gambler.deal-1-to-others",
          op: "effect.damage",
          linkedTo: "twisted-fate-gambler.deal-2",
          args: {
            amount: { kind: "constant", value: 1 },
            target: { kind: "constant", value: "other-enemy-units-here" }
          },
          targets: [
            {
              id: "other-enemy-units-here",
              filter: {
                type: "unit",
                controller: "opponent",
                sameLocationAs: "self",
                exclude: { target: "enemy-unit-here" }
              },
              min: 0,
              selection: "all"
            }
          ]
        }
      ]
    }
  }
};

const mindBranch: Instruction = {
  id: "twisted-fate-gambler.mind",
  op: "sequence",
  condition: domainIs("Mind"),
  args: {
    body: {
      kind: "constant",
      value: [
        {
          id: "twisted-fate-gambler.draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  }
};

const orderBranch: Instruction = {
  id: "twisted-fate-gambler.order",
  op: "sequence",
  condition: domainIs("Order"),
  args: {
    body: {
      kind: "constant",
      value: [
        {
          id: "twisted-fate-gambler.stun-1",
          op: "effect.stun",
          args: { target: { kind: "constant", value: "enemy-unit" } },
          targets: [
            {
              id: "enemy-unit",
              filter: { type: "unit", controller: "opponent" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  }
};

const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "attack-declared",
      filter: { event: "attack-declared", source: "self" },
      once: "per-combat"
    },
    optional: false,
    body: [
      {
        id: "twisted-fate-gambler.reveal-rune",
        op: "effect.reveal",
        args: {
          pick: { kind: "constant", value: "twisted-fate-gambler.top-rune" }
        },
        picks: [
          {
            id: "twisted-fate-gambler.top-rune",
            options: [],
            ordered: true,
            selection: "all",
            zoneSlice: { zone: "rune-deck", from: "top", count: { kind: "constant", value: 1 } }
          }
        ]
      },
      {
        id: "twisted-fate-gambler.recycle-rune",
        op: "effect.recycle",
        linkedTo: "twisted-fate-gambler.reveal-rune",
        args: {
          objects: {
            kind: "linked-value",
            instructionId: "twisted-fate-gambler.reveal-rune",
            key: "revealed"
          },
          linkKey: { kind: "constant", value: "recycled" }
        }
      },
      furyBranch,
      mindBranch,
      orderBranch
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-6d4a83a454e91140b5cccaf25cef83d38b553d0863d8f7c80b8719fe33d8475e",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺按展示符文域创建反身触发的新 Pending 链项（CR 388.1/388.1.b、389.1），" +
    "sequence 同步分支不能代替该链项；choice.mode 的玩家选择也不能代替按域决定，" +
    "chain/engine.ts 的 assertFinalizationSurface 仍缺 choice-plan adapter。" +
    "Fury 的 sameLocationAs / exclude 目标锚点被 programs/filters.ts 拒绝，" +
    "且反身分支内嵌套目标缺 Finalize/Resolve 生命周期；" +
    "Order 的 effect.stun target 尚未接入 chain/interpreter-adapter.ts 的 LITERAL_FIELDS 解码。" +
    "combat/flow.ts 还缺首次 Attacker designation 的原子事务与 attack-declared 生产发射（383.4.e）。",
  abilities,
  sourceText:
    "When I attack, reveal the top rune of your rune deck, then recycle it. Do one of the " +
    "following based on its domain:\n" +
    ":rb_rune_fury: — Deal 2 to an enemy unit here and 1 to all other enemy units here." +
    ":rb_rune_mind: — Draw 1." +
    ":rb_rune_order: — Stun an enemy unit."
} satisfies CardProgram;

export default program;
