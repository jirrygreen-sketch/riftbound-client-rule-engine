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
 *   frozen KeywordAbility (contract 3.1) carries no printed cost, and the merged
 *   play binding rejects additional-cost outright (programs/play.ts
 *   translateCost calls judgeRequired for additional-cost), Repeat.ts's
 *   repeat.cost static has no layer mapping, and no merged consumer ties the
 *   paid instance count to the interpreter's repeat node, so this declaration is
 *   not executed here.
 * - "Look at the top 2 cards of your Main Deck" is a private look (128.3-128.4)
 *   over the deck's real order. Merged RIFT-358 ordered picks give the
 *   instruction an explicit source binding: the PickSpec carries
 *   zoneSlice { zone: "deck", from: "top", count: 2 } and Finalize locks the
 *   ordered ObjectRef list before the look resolves (chain/picks/plan.ts reads
 *   zoneSlice as the sole ordering authority; query order is never used).
 *   "your Main Deck" is the caster's deck (190.6.d), bound once with
 *   condition.value and read back as a linked value because effect.inspect's
 *   argument schema accepts an Expr but not a symbolic object selector.
 * - "Draw one and recycle the other": the one-of-two decision is the
 *   instruction's own private subset choice (effect.inspect choose +
 *   chooseCount { min: 1, max: 1 }; contract 3.6 keeps subset choices in the
 *   resolving instruction). The chosen card then moves from the Main Deck to the
 *   Hand (414.1) through the linked ordered pick, and the other goes to the
 *   bottom of its owner's Main Deck (417.1, 417.1.a, 417.4) because the card
 *   already moved has a stale reference (124) and drops out of the looked list.
 *   Neither card is targeted: the candidates are in a Secret zone and are chosen
 *   by the looking player (355.10.a), so they are picks, never TargetSpecs.
 * - Both still-deck cards keep their identity: effect.inspect does not move
 *   them (432.1.c / 425-style look), the pick moves one, recycle moves the
 *   rest.
 *
 * Status (cards/README.md §2): judge-required — the look/draw/recycle body is
 * fully expressible on merged primitives and the merged ordered-pick lifecycle
 * (RIFT-358), and the golden drives it through the real ChainEngine (Finalize
 * locks the deck-top slice, Resolve makes the private one-of-two choice), but
 * the printed [Repeat] optional additional cost still has no executable
 * collection path. That gap is not approximated.
 */
const calledShot = {
  canonicalCardId: "card.hash-80891ed8d25bcc7b7a458d0779163e739b738892493c56f163344772ecf1eea2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "唯一剩余缺口是「[Repeat] :rb_rune_chaos:」的可选追加费用：play 绑定 programs/play.ts 的 translateCost 对 kind \"additional-cost\" 直接" +
    "judgeRequired（\"Additional costs are not bound for ...\"），effects/keywords/Repeat.ts 展开的静态 repeat.cost 也没有图层映射" +
    "（programs/statics.ts layerFor 抛 ProgramBindingError \"no layer mapping\"，lifecycle 仅捕获为绑定失败），" +
    "且没有把已付费实例数接到解释器内建 repeat 节点的消费方；820.1.c 的印刷费用在契约 3.1 的 KeywordAbility 上也无处承载。" +
    "look/draw/recycle 三段已用合并后的能力表达并真实执行：effect.inspect 的 top 作用域按 RIFT-358 的" +
    " PickSpec zoneSlice {zone:\"deck\",from:\"top\",count:2} 在 Finalize 锁定保序引用（chain/picks/plan.ts，query 顺序绝不被采用），" +
    "二选一由同一指令的私有子集选择（choose + chooseCount {min:1,max:1}）在结算期做出，入手的一张经 linked 有序 pick 走 effect.zone" +
    "（414.1），另一张因引用失效（124）留在列表里由 effect.recycle 回收（417.1/417.1.a；432.1.c 短牌库只看可看的张数）。" +
    "golden 用真实 ChainEngine（Finalize 锁定 + Resolve 选择）执行该 body；不写死第二次结算、不近似实现追加费用。",
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
            // 355.10.a / 契约 3.6：两张牌里选一张是查看者自己的私有子集选择，
            // 由本指令在结算期通过 choose 做出，不写进 PickSpec（有序来源自身
            // 只做「全部」绑定）。
            choose: { kind: "constant", value: true },
            chooseCount: { kind: "constant", value: { min: 1, max: 1 } },
            choiceId: { kind: "constant", value: "called-shot.draw-choice" },
            linkedKey: { kind: "constant", value: "lookedCount" },
            pickedKey: { kind: "constant", value: "looked" },
            choosePicksKey: { kind: "constant", value: "chosen" }
          },
          picks: [
            {
              id: "called-shot.top-two",
              // 契约 3.6 / RIFT-358：显式有序来源 = options: []、ordered: true、
              // selection: "all"，Finalize 按 zoneSlice 锁定真实牌库顶两张并保序；
              // 子集选择在结算期的 effect.inspect 里完成。
              options: [],
              ordered: true,
              selection: "all",
              zoneSlice: {
                zone: "deck",
                from: "top",
                count: { kind: "constant", value: 2 }
              }
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
              // 查看结果里被选中的那一张（有序实际结果，RIFT-358 linked 来源）。
              options: [],
              ordered: true,
              selection: "all",
              linked: {
                kind: "linked-value",
                instructionId: "called-shot.look-top-two",
                key: "chosen"
              }
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
