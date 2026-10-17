import type { CardProgram } from "../../ir/index.js";

/**
 * Command: Attack (rad-033-167) — Gear, 1 Energy + 1 Calm Power, no tags.
 *
 * Printed text (deck-catalog.json, rad-033-167, verbatim):
 *   Choose one —
 *   Move a friendly gear with [Deploy] to a battlefield.Look at the top 5 cards
 *   of your Main Deck. You may reveal a gear from among them and draw it.
 *   Recycle the rest.
 *
 * Data issue (not fixed here, reported in the task reply): the two modes of the
 * printed bulleted list run together — "battlefield.Look" has no separating
 * space or line break, unlike every other mode list in the catalog. The
 * sourceText below keeps the catalog bytes verbatim; the ability structure
 * follows the two modes the text plainly contains.
 *
 * Rules evidence (Core Rules v1.5):
 * - 355.3: a bulleted list of modes is chosen while the spell or ability is
 *   finalized; contract 3.9 freezes the shape as one `choice.mode` instruction
 *   with `modes[{id, body}]`, count 1, different true.
 * - 830.1.b.2: Gear with Deploy can be moved by appropriate effects. Mode 1's
 *   "Move a friendly gear with [Deploy]" is an effect Move (421 / 448-451, not
 *   the Standard Move of 144: no exhaust cost and no Main-Phase gate). The
 *   destination is "a battlefield" — an unrestricted Battlefield Location
 *   (355.4 / 355.4.a).
 * - 355.7 / 355.9.a.1 / 355.10: "a friendly gear" names one specific Board
 *   object chosen by the ability's controller, so it is a target. The
 *   "with [Deploy]" clause is a targeting restriction (355.9.b) on that Gear's
 *   Deploy characteristic (830.3: whether or not a card has Deploy is a
 *   checkable characteristic).
 * - 437.1 / 437.1.a: when more than one card is predicted, the predicting
 *   player looks at that many cards and recycles any number of them before
 *   putting the rest back on top in any order. The printed mode 2 is the
 *   "look at the top N, then choose" shape rather than a Predict:
 *   425 (reveal) governs "reveal a gear from among them", 414 (draw) the draw,
 *   and 417 (recycle) the rest.
 * - 425.1 / 425.2: "reveal ... and draw it" makes the chosen card public and
 *   puts it into the player's hand. 417.1 / 417.1.a: "recycle the rest" puts the
 *   remaining looked-at cards to the bottom of the owner's Main Deck.
 * - 135.2.b.5.b does not apply to mode 2's conditional: "You may reveal a gear
 *   from among them and draw it" is the resolution-time optional decision of
 *   383.3.a.3, so contract 3.9 wraps the chosen instructions in
 *   `choice.optional` (never a bare choice with a linkedTo follower). "Recycle
 *   the rest" is a following independent instruction of the same mode, not part
 *   of the may.
 * - 359.2.b: a Permanent executes all of its rules text from top to bottom, so
 *   the mode list is this Gear's play ability body.
 *
 * Status: judge-required (re-checked 2026-10-17 third re-sweep). Mode 2 is fully
 * expressible and executed by the golden test; mode 1's destination was rewritten
 * to the merged runtime Location selector when RIFT-357 (target/location/
 * selectors plus the interpreter's `Expr.kind: "location"` bridge) landed, and
 * is executed by the golden test. Two gaps remain:
 * - "with [Deploy]" has no filter predicate: ObjectFilter has no keyword field
 *   and the merged query implementations (layers/filter.ts,
 *   testing/test-kernel.ts) never read one, so the restriction cannot be
 *   evaluated without inventing semantics. The filter records the intended
 *   predicate name for the pending keyword vocabulary. (The Deploy KeywordDef
 *   itself is now merged in effects/keywords/Deploy.ts, but its expansion is a
 *   program-level layer registration and does not teach ObjectFilter a keyword
 *   predicate.)
 * - "Look at the top 5 cards of your Main Deck" is a private top-N look.
 *   effect.inspect documents that a non-zero top-N look requires an upstream
 *   ordered picks collection (query does not guarantee deck order; zoneSlice
 *   ordering is not wired into any look/reveal instruction), so the top-5
 *   instruction below carries the pending ordered-look shape rather than
 *   falling back to query. The single-card Predict shape (rakelstake /
 *   keywords/Vision) does have a merged path; the 5-card one does not.
 * Dependencies: RIFT-358 (ordered top-card picks and mode/target finalization)
 * and a keyword characteristic predicate for 830.3.
 */

/**
 * "a battlefield" is a runtime Location choice (355.4 / 355.4.a). Since
 * RIFT-357 merged, `Expr.kind: "location"` carries the symbolic selector and
 * the interpreter resolves it through target/location after socketting the
 * instruction's `locations` declaration; effect.move's own schema still only
 * accepts an already-resolved LocationRef, so the bridge is what makes this the
 * production path rather than a rejected marker.
 *
 * Candidate-source limitation (verified): target/location/candidates.ts's
 * allRefs() only derives Battlefield locations from objects that already sit in
 * one, plus the known players' Bases; no merged caller passes explicit
 * LocationState. A Battlefield with no Unit on it therefore never appears as a
 * choice — which is exactly the empty-Battlefield destination 355.4.a allows.
 * The golden test asserts this boundary so the ability is not claimed complete.
 */
const A_BATTLEFIELD = {
  kind: "choose",
  id: "command-attack.battlefield-destination",
  filter: { type: "battlefield" }
} as const;

const commandAttack = {
  canonicalCardId: "card.hash-322879459664911876c55f40be8e59ed07ad8e5c3f1a7cc3b296600b3a4b87a6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "模式 1 的目标地点已按 RIFT-357 改写为运行期 Location 选择（Expr kind \"location\" 的 choose 形状，" +
    "filter { type: battlefield }，355.4 / 355.4.a），golden 用真实解释器 + 参考内核执行并断言实际位移，" +
    "不再使用被拒绝的描述性标记。当前真实缺口两处，均不近似实现：" +
    "(0) 地点候选来源不完整：target/location/candidates.ts 的 allRefs() 只从「已有对象驻留的战场」与玩家 Base 派生候选，" +
    "没有任何已合入调用方传入显式 LocationState，因此没有单位驻留的战场（355.4.a 允许的合法目的地）不会出现在选项里；" +
    "golden 断言了该边界，不把候选不足当作整卡可执行。" +
    "(1)「with [Deploy]」没有可求值的过滤谓词：ObjectFilter 没有关键词字段，已合入查询也不读它（layers/filter.ts、" +
    "testing/test-kernel.ts），programs/filters.ts 的 translateObjectFilter 仍以 \"Unsupported filter field hasKeyword\" 拒绝该键，" +
    "因此目标限制无法求值（830.3；依赖 Deploy 特征过滤器契约）。" +
    "(2)「Look at the top 5 cards of your Main Deck」是私下 top-N 查看：effect.inspect 的 top 作用域要求上游按真实牌库顺序" +
    "提供有序 picksSpecId（query 不保证牌库顺序，zoneSlice 未接入查看指令），生产链的该提供方仍属 RIFT-358（进行中）。" +
    "模式 2 的 reveal/draw/recycle 与 choice 包装已按契约 3.9 写出并有执行证据。" +
    "依赖：RIFT-358（有序 picks 与模式/目标 Finalize）与 Deploy 特征过滤器契约。不近似实现。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          // 355.3 / 契约 3.9：二选一的模式列表，count 1、different true，
          // 被选中的模式体在原位执行（不写成 choice + linkedTo）。
          id: "command-attack.choose-mode",
          op: "choice.mode",
          args: {
            count: { kind: "constant", value: 1 },
            different: { kind: "constant", value: true },
            modes: {
              kind: "constant",
              value: [
                {
                  id: "command-attack.move-gear",
                  body: [
                    {
                      // 「Move a friendly gear with [Deploy] to a battlefield」：
                      // 效果移动（421 / 448-451），目的地是运行期 Location 选择
                      // （355.4 / 355.4.a，RIFT-357 的 Expr kind "location"）。
                      id: "command-attack.move",
                      op: "effect.move",
                      args: {
                        objects: { kind: "constant", value: { target: "command-attack.friendly-deploy-gear" } },
                        to: { kind: "location", value: A_BATTLEFIELD },
                        amount: { kind: "constant", value: 1 }
                      },
                      targets: [
                        {
                          id: "command-attack.friendly-deploy-gear",
                          // 「a friendly gear」：己方 Board 上的 Gear（355.9.a.1、
                          // 355.9.b 的过滤限制）；「with [Deploy]」是 830.3 的
                          // 特征限制，谓词名待关键词词汇接线（见 judgeReason 第 2 点）。
                          filter: {
                            type: "gear",
                            controller: "self",
                            zone: "board",
                            hasKeyword: "deploy"
                          },
                          min: 1,
                          max: 1,
                          selection: "one"
                        }
                      ]
                    }
                  ]
                },
                {
                  id: "command-attack.look-for-gear",
                  body: [
                    {
                      // 「your Main Deck」的 you = 本能力控制者（190.6.d）：用
                      // condition.value 绑定一次，再以 linked-value 读取
                      // （effect.inspect 的 player 参数要求 PlayerId 表达式，
                      // 符号选择器不是它接受的形状；同 sfd/called-shot 写法）。
                      id: "command-attack.bind-controller",
                      op: "condition.value",
                      args: {
                        value: { kind: "object-property", object: "source", property: "controller" },
                        key: { kind: "constant", value: "controller" }
                      }
                    },
                    {
                      // 「Look at the top 5 cards of your Main Deck」：私下 top-5 查看。
                      // 已合入的 effect.inspect 的 top 作用域要求上游按真实牌库顺序提供
                      // 有序 picksSpecId（契约 3.6 的 zoneSlice 才保序，query 不保序）；
                      // 本卡声明稳定的有序范围 id，由调用方按 zoneSlice 提供牌库顶 5 张。
                      // 该范围的生产生命周期（链的 Finalize 只锁定 instruction.targets）
                      // 仍未接线，见 judgeReason 第 4 点。
                      id: "command-attack.look-top-5",
                      op: "effect.inspect",
                      linkedTo: "command-attack.bind-controller",
                      args: {
                        player: {
                          kind: "linked-value",
                          instructionId: "command-attack.bind-controller",
                          key: "controller"
                        },
                        zone: { kind: "constant", value: "deck" },
                        scope: { kind: "constant", value: "top" },
                        amount: { kind: "constant", value: 5 },
                        picksSpecId: {
                          kind: "constant",
                          value: "command-attack.top-five"
                        },
                        // 「You may reveal a gear from among them and draw it」：
                        // 结算时的可选项（383.3.a.3），按契约 3.9 包进 choice.optional。
                        choose: { kind: "constant", value: false },
                        pickedKey: { kind: "constant", value: "command-attack-looked" }
                      },
                      picks: [
                        {
                          id: "command-attack.top-five",
                          // 牌库顶 5 张（保序）：由上游按 zoneSlice 顺序提供，不是静态列表。
                          options: ["dynamic:main-deck-top-five"],
                          min: 0,
                          max: 5,
                          selection: "up-to",
                          filter: { owner: "self", zone: "deck" }
                        }
                      ]
                    },
                    {
                      id: "command-attack.reveal-and-draw-opt",
                      op: "choice.optional",
                      args: {
                        prompt: { kind: "constant", value: "Reveal a gear from among them and draw it?" },
                        body: {
                          kind: "constant",
                          value: [
                            {
                              // 425.1 / 425.2：公开所选那张 Gear 并把它抽到手牌。
                              // 选择是非目标 pick（355.10 的 355.7 区分；
                              // 结果集来自上一条查看指令的链接值），数量 0..1。
                              id: "command-attack.reveal-gear",
                              op: "effect.reveal",
                              args: {
                                pick: { kind: "constant", value: "command-attack.revealed-gear" }
                              },
                              picks: [
                                {
                                  id: "command-attack.revealed-gear",
                                  options: [
                                    {
                                      kind: "linked-value",
                                      instructionId: "command-attack.look-top-5",
                                      key: "command-attack-looked"
                                    }
                                  ],
                                  min: 0,
                                  max: 1,
                                  selection: "up-to"
                                }
                              ]
                            },
                            {
                              // 414.3 / 414.1：「and draw it」把刚公开的那张牌从牌库
                              // 移入其拥有者手牌（已合入 effect.zone 的 to: "hand"，
                              // 同 sfd/ornn-blacksmith 的 "draw it" 写法），而不是再抽
                              // 牌库顶；对象来自 reveal 的链接结果（425.4.a）。
                              id: "command-attack.draw-gear",
                              op: "effect.zone",
                              linkedTo: "command-attack.reveal-gear",
                              args: {
                                pick: { kind: "constant", value: "command-attack.drawn-gear" },
                                to: { kind: "constant", value: "hand" },
                                amount: { kind: "constant", value: 1 }
                              },
                              picks: [
                                {
                                  id: "command-attack.drawn-gear",
                                  // 候选来自刚展示的那张（链接值）。
                                  options: [
                                    {
                                      kind: "linked-value",
                                      instructionId: "command-attack.reveal-gear",
                                      key: "revealed"
                                    }
                                  ],
                                  min: 1,
                                  max: 1,
                                  selection: "one"
                                }
                              ]
                            }
                          ]
                        }
                      },
                      linkedTo: "command-attack.look-top-5"
                    },
                    {
                      // 417.1 / 417.1.a：「Recycle the rest」把查看集合中未被选走的
                      // 部分放回拥有者主牌库底。已被移入手牌的那张引用失效而自动落选
                      // （124），正好是 "the rest"。
                      id: "command-attack.recycle-rest",
                      op: "effect.recycle",
                      args: {
                        objects: {
                          kind: "linked-value",
                          instructionId: "command-attack.look-top-5",
                          key: "command-attack-looked"
                        }
                      },
                      linkedTo: "command-attack.look-top-5"
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "Choose one —\n" +
    "Move a friendly gear with [Deploy] to a battlefield.Look at the top 5 cards of your Main Deck. " +
    "You may reveal a gear from among them and draw it. Recycle the rest."
} satisfies CardProgram;

export default commandAttack;
