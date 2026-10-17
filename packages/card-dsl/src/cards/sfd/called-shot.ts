import type { CardProgram } from "../../ir/index.js";

/**
 * Called Shot (sfd-122-221) — Spell, 0 energy + 1 Chaos power, Chaos.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-122-221, verbatim):
 *   "[Action] (Play on your turn or in showdowns.)
 *    [Repeat] :rb_rune_chaos: (You may pay the additional cost to repeat this
 *    spell's effect.)
 *    Look at the top 2 cards of your Main Deck. Draw one and recycle the other."
 *
 * Rules evidence (Core Rules v1.5):
 * - "[Action]" (806.1.b/806.1.c, 159.2.a) is declared only; the Showdown
 *   permission is expanded by effects/keywords/Action.ts (contract 3.7).
 * - "[Repeat] :rb_rune_chaos:" (820.1.c) is an Optional Additional Cost. The
 *   frozen KeywordAbility (contract 3.1) carries no printed cost, and the
 *   CardProgram consumer that would collect the paid instance count and drive
 *   an extra execution has not merged (RIFT-257), so this declaration is not
 *   executed here.
 * - "Look at the top 2 cards of your Main Deck" is a private look (128.3-128.4)
 *   over the deck's real order. Reading the deck top must use the zoneSlice
 *   contract (3.6), and the merged effect.inspect deliberately negates
 *   (negated/impossible) when the ordered upstream set is missing instead of
 *   guessing order from query(); the ordered PickSpec declares that upstream
 *   range. "your Main Deck" is the caster's deck (190.6.d), bound once with
 *   condition.value and read back as a linked value because effect.inspect's
 *   argument schema accepts an Expr but not a symbolic object selector.
 * - "Draw one and recycle the other": the chosen card moves from the Main Deck
 *   to the Hand (the draw action's own result, 414.1) and the other goes to the
 *   bottom of its owner's Main Deck (417.1, 417.1.a, 417.4). Neither card is
 *   targeted: the two candidates are in a Secret zone and are chosen by the
 *   looking player (355.10.a), so they are picks, never TargetSpecs.
 *   The moved card drops out of the looked list (stale reference; 124), which
 *   is exactly "the other".
 * - Both still-deck cards keep their identity: effect.inspect does not move
 *   them (432.1.c / 425-style look), the pick moves one, recycle moves the
 *   rest.
 *
 * Status (cards/README.md §2): judge-required — the look/draw/recycle body uses
 * only merged primitives and is executed by the golden test with a caller-
 * supplied ordered deck-top range, but no merged producer turns "the top 2
 * cards" into that range (the chain's Finalize surface locks instruction
 * targets only, and picks have no ordered-region lifecycle), and the [Repeat]
 * additional cost has no merged collection path. Neither gap is approximated.
 */
const calledShot = {
  canonicalCardId: "card.hash-80891ed8d25bcc7b7a458d0779163e739b738892493c56f163344772ecf1eea2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入：(1)「Look at the top 2 cards of your Main Deck」需要上游按真实牌库顺序提供的有序 picksSpecId：" +
    "effect.inspect 自行规定非零 top 查看必须有有序来源（缺来源时 negated/impossible，绝不截取 query() 的顺序，契约 3.6 的 zoneSlice 才保序），" +
    "而链的 Finalize（chain/engine.ts assertFinalizationSurface）只锁定 instruction.targets 的 TargetSpec，没有有序区域 pick 的生命周期；" +
    "本文件声明了稳定的有序范围 id，由调用方按 zoneSlice 提供牌库顶两张。" +
    "(2)「[Repeat] :rb_rune_chaos:」的可选追加费用没有收取/计数路径：冻结的 KeywordAbility（契约 3.1）不承载印刷费用，" +
    "也没有已合入的卡牌程序消费方把已付费实例数接到额外执行上（RIFT-257），故只声明形状，不写死第二次结算。" +
    "look → 入手 1 张（effect.zone，414.1/056.1）→ 回收其余（effect.recycle，417.1）三段只用已合入原语，golden 已借参考内核的有序 picks 真实执行。" +
    "依赖：有序区域 picks / Finalize 生命周期、RIFT-257（卡牌程序绑定）与 Repeat 费用管线。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        // 印刷基础费用（0 Energy + 1 Chaos Power）由卡牌身份在 Finalize 绑定
        // （356.1.c；chain/engine.ts 对 spell 默认取 kind: "printed"），因此这里只声明
        // [Repeat] :rb_rune_chaos:（820.1.c）的可选追加费用，与已合入 sfd/danger-zone 同形。
        // 该声明目前没有消费方（见 judgeReason）。
        kind: "additional-cost",
        keyword: "repeat",
        power: { kind: "literal", value: ["Chaos"] }
      },
      body: [
        {
          // "your Main Deck" 的 you = 本能力控制者（190.6.d）：用 condition.value
          // 绑定一次，再以 linked-value 读取（effect.inspect 的 player 参数要求 Expr）。
          id: "called-shot.bind-controller",
          op: "condition.value",
          args: {
            value: { kind: "object-property", object: "source", property: "controller" },
            key: { kind: "constant", value: "controller" }
          }
        },
        {
          id: "called-shot.look-top-two",
          op: "effect.inspect",
          linkedTo: "called-shot.bind-controller",
          args: {
            player: {
              kind: "linked-value",
              instructionId: "called-shot.bind-controller",
              key: "controller"
            },
            zone: { kind: "constant", value: "deck" },
            scope: { kind: "constant", value: "top" },
            amount: { kind: "constant", value: 2 },
            picksSpecId: { kind: "constant", value: "called-shot.top-two" },
            linkedKey: { kind: "constant", value: "lookedCount" },
            pickedKey: { kind: "constant", value: "looked" }
          },
          picks: [
            {
              id: "called-shot.top-two",
              // 主牌库顶两张（保序）：由上游 zoneSlice 顺序提供，不是静态列表。
              options: ["dynamic:main-deck-top-two"],
              min: 2,
              max: 2,
              selection: "all",
              filter: { owner: "self", zone: "deck" }
            }
          ]
        },
        {
          // "Draw one"：从看过的两张里选一张进入手牌（414.1 的抽牌结果；选择权在
          // 查看者手里，因此是非目标 pick，不触发成为目标，355.10.a）。
          id: "called-shot.draw-one",
          op: "effect.zone",
          linkedTo: "called-shot.look-top-two",
          args: {
            pick: { kind: "constant", value: "called-shot.drawn-card" },
            to: { kind: "constant", value: "hand" },
            amount: { kind: "constant", value: 1 }
          },
          picks: [
            {
              id: "called-shot.drawn-card",
              options: [
                {
                  kind: "linked-value",
                  instructionId: "called-shot.look-top-two",
                  key: "looked"
                }
              ],
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "and recycle the other"：同一份看过列表去掉已入手的那张（换区后旧引用失效，124），
          // 其余回收到拥有者主牌库底（417.1.a / 417.4）。
          id: "called-shot.recycle-the-other",
          op: "effect.recycle",
          linkedTo: "called-shot.look-top-two",
          args: {
            objects: {
              kind: "linked-value",
              instructionId: "called-shot.look-top-two",
              key: "looked"
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "[Repeat] :rb_rune_chaos: (You may pay the additional cost to repeat this spell's effect.)\n" +
    "Look at the top 2 cards of your Main Deck. Draw one and recycle the other."
} satisfies CardProgram;

export default calledShot;
