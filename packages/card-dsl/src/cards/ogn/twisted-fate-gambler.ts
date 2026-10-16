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
 *   所以必须按区域顺序取顶）。`effect.reveal` 已合入，但它读候选时用 `ctx.query`——
 *   reveal 的原语注释与 interpreter 契约都写明 `query` 不保证区域内顺序，严格“牌库顶”
 *   需要上游提供有序选择（RIFT-66 的 zoneSlice 只接进了 inspect/mill/order/recycle）。
 *   因此“顶 1 张”在 reveal 里目前只能由调用方按顺序给出候选，属于待接线部分。
 * - “then recycle it”：417.1.b（符文回收进符文牌库）、417.1.c（无论谁被指示执行，都回收
 *   到牌主自己的牌库）、417.6（未指名的集合形式）。本程序用 `effect.recycle` 的
 *   `objects` + 上一条 reveal 的链接值（契约 3.6 linked-value），已合入且可执行。
 * - “Do one of the following based on its domain”：388.1 / 388.1.b——这是**反身触发**
 *   （Reflexive Trigger，“Do one of the following”），不是普通的“选一个模式”指令：
 *   条件满足后按条件把对应的一个反身触发作为新的链项入链（389 / 389.1）。本程序按契约
 *   3.9 的可表达形状写成三个由 domain 条件守住的 `sequence` 分支（structure 完整、
 *   互斥、可被解释器逐条求值），但引擎里没有卡牌可用的反身触发构造原语（effects 下
 *   只有 chain/events 的 triggered 注册路径），所以整卡保持 judge-required。
 * - 三个分支的取值/动作：domain 用被展示符文的 `power`（Domain 列表）与常量域比较
 *   （`in`/`eq` 语义等价，程序用 `eq` 与单元素列表，避免把 “基于域” 写成模糊比较）；
 *   “here” 用 359.3.e.13 式的来源当前位置引用（`sameLocationAs: "self"`，本卡的攻击
 *   触发在 attacker 仍在场时求值）；“all other enemy units here” 用 `exclude` 排除被
 *   选中的那一个（355.14 的“other”语义）。
 *
 * status 判定（README 第 2 节）：judge-required。三处缺口：
 * 1. 反身触发（388）没有卡牌侧原语/接线——`choice.mode` 只按玩家选择，不能按 domain 条件
 *    自动入链，也不能把分支变成新的链项；
 * 2. “reveal the top rune … then recycle it” 的**顶张顺序**：reveal/inspect 侧的
 *    zoneSlice 接线未完成（RIFT-66 契约变更只落地在 mill/order/recycle）；
 * 3. `effect.stun` 的参数解码当前通过链式适配器会失败（见 golden 测试里记录的适配器缺口），
 *    证据在 /tmp/RIFT-154-m2-ogn-unit-10/。
 * 已合入且可执行的部分（reveal 的顺序无关形式、recycle 的链接值、两个伤害指令、draw、
 * stun 的 primitive 直接调用）都在 golden 测试里真实执行。
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
      filter: { event: "attack-declared", object: { objectId: "self" } }
    },
    optional: false,
    body: [
      {
        id: "twisted-fate-gambler.reveal-rune",
        op: "effect.reveal",
        args: {
          zone: { kind: "constant", value: "rune-deck" },
          count: { kind: "constant", value: 1 }
        }
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
    "三处缺口：(1) “Do one of the following based on its domain” 是反身触发（CR 388.1/388.1.b、389），" +
    "条件满足后要把对应的一个分支作为**新的链项**入链，而 effects/ 下没有卡牌可用的反身触发构造原语，" +
    "choice.mode 只按玩家选择、不按域条件自动入链；(2) “reveal the top rune of your rune deck” 的顶张顺序：" +
    "effect.reveal 用 query 取候选、不保证区域内顺序，RIFT-66 的 zoneSlice 只接进了 mill/order/recycle，" +
    "108.5.d 的符文顶张顺序尚未接线；(3) 经链式适配器解码 effect.stun 参数时接口不匹配" +
    "（证据见 /tmp/RIFT-154-m2-ogn-unit-10/）。依赖：反身触发原语 + RIFT-66 reveal 顶张接线 + effect.stun 适配器修复。" +
    "可执行部分（recycle 链接值、两条伤害、draw、recycle 顺序无关形式）已在 golden 测试中真实执行。",
  abilities,
  sourceText:
    "When I attack, reveal the top rune of your rune deck, then recycle it. Do one of the " +
    "following based on its domain:\n" +
    ":rb_rune_fury: — Deal 2 to an enemy unit here and 1 to all other enemy units here." +
    ":rb_rune_mind: — Draw 1." +
    ":rb_rune_order: — Stun an enemy unit."
} satisfies CardProgram;

export default program;
