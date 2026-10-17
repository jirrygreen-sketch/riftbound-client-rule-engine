import type { CardProgram } from "../../ir/index.js";

/**
 * Baited Hook (ogn-242-298) — OGN Gear, 3 energy, 0 Order power, no Might.
 *
 * Printed text:
 *   :rb_energy_1::rb_rune_order:, :rb_exhaust:: Kill a friendly unit. Look at
 *   the top 5 cards of your Main Deck. You may banish a unit from among them
 *   that has Might up to 1 more than the killed unit and play it, ignoring its
 *   cost. Then recycle the rest.
 *
 * Modelling notes (Core Rules v1.5):
 * - The printed cost is 1 energy + 1 Order power + the exhaust symbol (377.1:
 *   the colon separates cost from effect). All three components are declared in
 *   one CostSpec (415.4/415.5 for the exhaust symbol) and paid by the merged
 *   cost plan at Finalize (contract 3.5), never by a body instruction.
 * - "Kill a friendly unit" is a Choice, so it is Targeted (355.5.a / 355.7);
 *   the merged `effect.kill` primitive takes that TargetSpec and reports the
 *   killed references through its `killed` link (429.1 / 429.2.a).
 * - "Look at the top 5 cards of your Main Deck" reads a Main Deck top slice in
 *   real zone order: contract 3.6 requires `zoneSlice` for deck order, and the
 *   merged `effect.inspect` primitive takes an ordered picksSpecId plus an
 *   amount for exactly this shape (432.1.c: look never moves the cards).
 * - "You may banish …" is the optional-selection control structure of contract
 *   3.9: `choice.optional` wraps the chosen instructions in its `body`; refusing
 *   negates this instruction as skipped and the following instructions still
 *   resolve (359.3.e.11).
 * - "banish a unit from among them … and play it, ignoring its cost": banish is
 *   the merged `effect.banish` (428.1, 428.2.a) and the play is the merged
 *   `effect.play` Limited Play Effect of 420.3 (420.3.a/b: a game effect that
 *   plays a card treats Play as a Limited Action and may specify ignored costs).
 *   The banished reference is read from the banish instruction's linked result.
 * - "Then recycle the rest" is the merged `effect.recycle` (417.1, 417.4: recycle
 *   as many as possible, 417.6: the recycled cards are not targeted). The
 *   banished card has left its zone, so its old zone identity is invalid and is
 *   dropped from the recycled set by 124 / 359.3.e.4 — that is the merged
 *   mechanics performing "the rest", not an instruction written by this card.
 *
 * Status: judge-required — three remaining gaps:
 * - "a unit from among them that has Might up to 1 more than the killed unit"
 *   is a legality bound that compares each candidate's current Might against a
 *   value read from ANOTHER object (the killed unit's last-known Might, 359.3.e.13
 *   / contract 3.6 `lastKnown`). ObjectFilter/TargetSpec/PickSpec values are
 *   static data with no relational comparison against a linked or last-known
 *   value; `condition` clauses are per-instruction and cannot filter the members
 *   of a selection, so no merged spelling can exclude an over-Might candidate.
 *   The bound is recorded as descriptive data below and is NOT enforced — a
 *   plain `type: unit` selection would silently let the player banish a unit of
 *   any Might, which the near-implementation red line forbids.
 * - The look-up of the killed unit's Might itself is expressible (the interpreter
 *   reads it through the killed instruction's linked reference with look-back);
 *   only its use as a selection constraint is missing.
 * - CR 191.5.b keeps the ability controller unchanged when the source changes
 *   control. effect.inspect requires a player Expr, but no current scalar Expr
 *   reads context.controller. The source.controller binding below is only a
 *   draft: it is insufficient after a control change and is not executable
 *   evidence for that case. A regression with the correct expectation is TODO.
 * - The ordered top-5 picks production supply is also missing (RIFT-358):
 *   the chain/programs path does not read the
 *   real Main Deck zoneSlice into this stable picksSpecId yet, and query()
 *   cannot promise deck order, so the golden test supplies the locked picks.
 * The golden test executes the cost payment, the kill, the ordered look, the
 * optional wrapper, the banish and the cost-waived play with supplied picks and
 * unchanged source control. The play destination is chosen with LocationExpr
 * and linked into effect.play, without caller argument rewriting. These partial
 * tests do not establish full-card or production program executability.
 */
const baitedHook = {
  canonicalCardId: "card.hash-19b79a3d218afe3136508edfe7d9a7b84c7a83965281f09495785275ebd95ebd",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「a unit from among them that has Might up to 1 more than the killed unit」这条合法性限制没有已合入形态：" +
    "它要把每个候选单位当前的 Might 与被杀单位的 Might 相比（359.3.e.13 / 契约 3.6 的 lastKnown 回看），" +
    "而 ObjectFilter / TargetSpec / PickSpec 的取值是静态数据，没有“与另一对象或链接值做关系比较”的写法，" +
    "condition 从句只作用于整条指令、无法过滤选择集合的成员，因此没有任何已合入拼写能把 Might 超限的候选排除在外；" +
    "按 type: unit 直接选择会静默允许放逐任意 Might 的单位，违反不得近似实现的红线，故按描述性键写出但不作为已执行语义。" +
    "被杀单位 Might 的读取本身可表达（解释器经 killed 链接引用 + look-back 取值），缺的只是把它用作选择约束（RIFT-359）。" +
    "第二处缺口：CR 191.5.b 要求来源控制权变化不改变已入链能力的控制者；effect.inspect.player 必填，" +
    "当前 Expr 没有读取 ResolveContext.controller 玩家标量的形态。condition.value 读取 source.controller 只保留为草稿，" +
    "装备从 A 转交 B 时会错误地把查看者改成 B，不能当作能力控制者绑定或完整执行证据；正确查看 A 牌库的回归保留 TODO。" +
    "第三处缺口：effect.inspect 的 scope:top 只读取外部 picksSpecId，programs/ 与 chain/ 没有从真实牌库 zoneSlice " +
    "自动提供保序 top-5 picks 的路径（RIFT-358），query() 不保证牌库顺序，不能用无序查询近似。" +
    "LocationExpr 选择能力控制者的 Base 或所控制战场，再以 linked-value 传给 effect.play.location，已解决未解析的 controller 落点。" +
    "golden 与链草稿只验证来源控制权未变化、picks 由调用方按稳定 id 提供时的已支持步骤；不代表整卡或生产程序绑定已完成。",
  abilities: [
    {
      kind: "activated",
      cost: {
        kind: "activated",
        energy: { kind: "constant", value: 1 },
        power: { kind: "constant", value: ["Order"] },
        payments: [{ kind: "exhaust" }]
      },
      timing: "action",
      body: [
        {
          // Descriptive draft only: source.controller is not the controller of
          // an already-chained ability after a source control change (191.5.b).
          // No current scalar Expr reads context.controller for inspect.player;
          // this gap blocks the card and has a correct-expectation TODO test.
          id: "baited-hook.bind-viewer",
          op: "condition.value",
          args: {
            value: { kind: "object-property", object: "source", property: "controller" }
          }
        },
        {
          id: "baited-hook.kill-friendly-unit",
          op: "effect.kill",
          args: { target: { kind: "constant", value: "baited-hook.killed-unit" } },
          targets: [
            {
              id: "baited-hook.killed-unit",
              filter: { type: "unit", controller: "self", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "baited-hook.look-top-5",
          // "Look at the top 5 cards of your Main Deck." Deck order is read in
          // real zone order through zoneSlice, which effect.inspect requires for
          // a non-zero top scope (contract 3.6). The ordered references are
          // written to the `looked` link key for the following instructions.
          //
          // This instruction is deliberately NOT linked to the Kill: 359.3.e.13
          // uses Baited Hook as its worked example — when the friendly unit is
          // no longer a legal target it simply cannot be killed, its Might reads
          // null, and the controller still looks at the top 5 cards of their
          // Main Deck. Linking them would suppress the look under 3.4.
          op: "effect.inspect",
          args: {
            player: { kind: "linked-value", instructionId: "baited-hook.bind-viewer", key: "value" },
            zone: { kind: "constant", value: "deck" },
            scope: { kind: "constant", value: "top" },
            amount: { kind: "constant", value: 5 },
            picksSpecId: { kind: "constant", value: "baited-hook.looked-cards" },
            pickedKey: { kind: "constant", value: "looked" }
          },
          picks: [
            {
              id: "baited-hook.looked-cards",
              // Ordered Main Deck slice, supplied by the caller from
              // ctx.zoneSlice(player, "deck", "top", 5); the query vocabulary
              // cannot express deck order.
              options: ["dynamic:top-five-main-deck-cards"],
              filter: { type: "card" },
              selection: "all"
            }
          ]
        },
        {
          id: "baited-hook.may-banish-and-play",
          // "You may banish …" — contract 3.9: the chosen instructions are wrapped
          // in choice.optional's body; declining yields negated/skipped and the
          // "Then recycle the rest" instruction still resolves (359.3.e.11).
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Banish a unit among the looked cards and play it?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "baited-hook.banish-unit",
                  op: "effect.banish",
                  args: {
                    objects: { kind: "constant", value: { pick: "baited-hook.banished-unit" } },
                    linkKey: { kind: "constant", value: "banishedUnit" }
                  },
                  picks: [
                    {
                      id: "baited-hook.banished-unit",
                      options: ["dynamic:looked-units"],
                      // "Might up to 1 more than the killed unit": recorded as a
                      // descriptive marker (not an evaluable bound). The frozen
                      // filter shape has no relational comparison against a linked
                      // or last-known value, so this key is never treated as
                      // satisfied by accident (see judgeReason).
                      filter: { type: "unit", mightUpToLinked: "baited-hook.killed-unit" },
                      selection: "one",
                      min: 1,
                      max: 1
                    }
                  ]
                },
                {
                  // CR 355.2.a: choose the ability controller's Base or one of
                  // their controlled Battlefields. Evaluate the LocationExpr
                  // before handing a linked concrete LocationRef to effect.play,
                  // whose primitive schema does not accept LocationExpr itself.
                  id: "baited-hook.choose-play-location",
                  op: "condition.value",
                  linkedTo: "baited-hook.banish-unit",
                  condition: {
                    kind: "compare",
                    left: { kind: "linked-value", instructionId: "baited-hook.banish-unit", key: "banishedUnitCount" },
                    operator: "gt",
                    right: { kind: "constant", value: 0 }
                  },
                  args: {
                    value: {
                      kind: "location",
                      value: {
                        kind: "choose",
                        id: "baited-hook.play-location",
                        filter: { controller: "controller" }
                      }
                    }
                  }
                },
                {
                  id: "baited-hook.play-banished",
                  // "and play it, ignoring its cost": a Limited Play Effect
                  // (420.3.a). effect.play requires an already-finalized cost plan
                  // (this primitive never derives printed costs or implements the
                  // ignored-cost rule itself), so the ignored cost is submitted as
                  // a finalized zero plan for the 420.3.b.1 form. The destination
                  // is the preceding choice of a valid unit Location (355.2),
                  // already resolved relative to the ability's controller.
                  op: "effect.play",
                  linkedTo: "baited-hook.banish-unit",
                  args: {
                    object: {
                      kind: "linked-value",
                      instructionId: "baited-hook.banish-unit",
                      key: "banishedUnitObject"
                    },
                    location: {
                      kind: "linked-value",
                      instructionId: "baited-hook.choose-play-location",
                      key: "value"
                    },
                    cost: { kind: "constant", value: { finalized: true, energy: 0, power: [], xp: 0 } },
                    linkKey: { kind: "constant", value: "played" }
                  }
                }
              ]
            }
          }
        },
        {
          id: "baited-hook.recycle-rest",
          // "Then recycle the rest." — recycle the looked references; the banished
          // card's zone identity is invalid after it leaves the deck (124 /
          // 359.3.e.4), so it is dropped and only the remaining cards recycle.
          op: "effect.recycle",
          args: {
            objects: { kind: "linked-value", instructionId: "baited-hook.look-top-5", key: "looked" }
          }
        }
      ]
    }
  ],
  sourceText:
    ":rb_energy_1::rb_rune_order:, :rb_exhaust:: Kill a friendly unit. Look at the top 5 cards of your Main Deck. " +
    "You may banish a unit from among them that has Might up to 1 more than the killed unit and play it, " +
    "ignoring its cost. Then recycle the rest."
} satisfies CardProgram;

export default baitedHook;
