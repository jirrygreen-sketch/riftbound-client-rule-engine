import type { Ability, CardProgram, Instruction } from "../../ir/index.js";

/**
 * rad-060-167 The Empyrean（能量 8、Power 无印刷值、Might 8、领域 Mind、标签 Dragon）。
 *
 * 原文（逐字）：
 *   [Show Off] a card. (As you play me, you may reveal a card from hand or pick
 *   another friendly one.)\nWhen you play me, if you showed off a card,
 *   [Predict] equal to its Power cost, then draw 2. (Look at that many cards
 *   from your Main Deck. Recycle any of them and put the rest back in any order.)
 *
 * 规则依据（CR v1.5）：
 * - 832.1 / 832.1.b / 832.1.c：Show Off 是 Passive Ability 关键词，功能上等于
 *   "As you play [me], you may reveal [Object] from your hand and/or pick [Object]
 *   from among friendly game objects on the board"；832.1.c.2 的决策发生在
 *   Finalize（355），不是结算期。
 * - 832.1.d / 832.1.d.1：被 Show Off 的信息在展示那一刻锁定，之后的特征变化不再考虑。
 * - 812/817 同族的"When you play me"是 Play Effect（383.4.a）：作为触发能力在
 *   永久物 Finalize 并进场后入链（383.4.a.2）。
 * - 437.1 / 437.1.a / 437.3 / 437.3.a：Predict X 是看 Main Deck 顶 X 张、
 *   可回收其中任意张、其余按任意顺序放回；X 省略时为 1，这里 X 等于被展示牌的
 *   Power cost（832.1.d.1 的锁定值）。
 * - 414.3："draw 2" 是 effect.draw。
 *
 * 状态：judge-required（2026-10-18 复核）。缺的是 Show Off / Predict 这条链路本身
 * （以已合入的 effects/keywords/ShowOff.ts 头部清单为准，并逐条实测）：
 * 1. 关键词 id 拼写不一致：注册表以 KeywordDef.keyword（"Show Off"）为键，
 *    programs/keywords.ts 的 definitionFor 只做大小写折叠（compile 用
 *    compare(keyword.toLowerCase())），因此 slug "show-off" 实测抛
 *    “Keyword show-off has no executable KeywordDef”；改用注册键拼写 "show off" 时
 *    展开能跑通，但 card-dsl 的 IR 校验要求小写 symbol（"Expected a lowercase
 *    keyword id"），卡牌写不出同时满足两边的拼写。属共享契约/生成器范围。
 * 2. cost.reveal / Finalize 展示与合法性管线未合入：Show Off 展开成 static
 *    cost.reveal（832.1.c.2 在 Finalize 决策），programs/statics.ts 的 layerFor 报
 *    “Static ability kind cost.reveal has no layer mapping”，instructions 注册表里
 *    也没有 cost.reveal，所以展示声明无处消费。832.1.c.3 还要求把「从手牌展示」与
 *    「从友方场上拾取」合成同一组展示对象，现有 PickSpec 只有固定 options，无法表达。
 * 3. objects-shown-off 时点已在 events/timing-points.ts 注册，但没有链上链接/快照
 *    消费方，832.1.d.1 要求读取展示那一刻锁定的 Power cost；effect.reveal 只链接
 *    refs/数量（实测 { revealed, revealedCount }），没有原语产出 shownPowerCost 锁定值。
 * 4. condition.result 的逐实例链接值没有消费方（832.2 的多个 Show Off 实例不得合并成
 *    一个布尔）；[Predict]（437.1 / 437.3）也没有 KeywordDef 统一编排看顶、可回收、任意顺序放回。
 * 因此只写出有依据的骨架（play 能力 + Predict 的 inspect/recycle/order 结构），
 * 不把 Show Off 近似成"随便展示一张"或把 Power cost 近似成固定张数。
 * 其中「展示快照 + 手牌/场上合成选项选择」与关键词 id 拼写是本任务最终回复的契约变更请求。
 */
/** "When you play me, if you showed off a card, [Predict] …, then draw 2." 的正文骨架。 */
const predictBody: readonly Instruction[] = [
  {
    // 437.1 / 437.1.a：查看牌库顶 X 张（X = 展示时锁定的 Power cost，832.1.d.1）。
    // 牌库顶顺序由上游按真实区域内顺序提供（RIFT-66 契约：只能用 zoneSlice，
    // 不能从 query 的返回顺序推断），因此范围走 picks；静态 IR 只能声明范围形状。
    id: "the-empyrean.predict-look",
    op: "effect.inspect",
    args: {
      // "your Main Deck" = 能力控制者的主牌库；EffectIR 没有控制者字面量，
      // 运行装配层在结算时绑定实际 PlayerId（同 rad/consult-the-heavens 的写法）。
      player: { kind: "constant", value: "controller" },
      zone: { kind: "constant", value: "deck" },
      scope: { kind: "constant", value: "picks" },
      picksSpecId: { kind: "constant", value: "the-empyrean.predict-range" },
      choose: { kind: "constant", value: true },
      chooseCount: { kind: "constant", value: { min: 0, max: null } },
      pickedKey: { kind: "constant", value: "the-empyrean.predicted" },
      choosePicksKey: { kind: "constant", value: "the-empyrean.recycle" }
    },
    picks: [
      {
        id: "the-empyrean.predict-range",
        // 张数由 Show Off 锁定的 Power cost 决定（832.1.d.1），选项集合由上游在
        // 结算期按牌库顶顺序提供；这里不写死张数、也不近似成固定数量。
        options: ["top-cards-of-controller-main-deck-in-zone-order"],
        min: 0,
        max: null,
        selection: "up-to"
      }
    ]
  },
  {
    // 437.1.a：回收被选中（选择回收）的那几张；未选择时链接值为空数组。
    id: "the-empyrean.recycle-chosen",
    op: "effect.recycle",
    linkedTo: "the-empyrean.predict-look",
    args: {
      objects: {
        kind: "linked-value",
        instructionId: "the-empyrean.predict-look",
        key: "the-empyrean.recycle"
      }
    }
  },
  {
    // 437.1.a：其余按任意顺序放回牌库顶（chooseOrder 让选择者定序）。
    id: "the-empyrean.replace-rest",
    op: "effect.order",
    linkedTo: "the-empyrean.predict-look",
    args: {
      destination: { kind: "constant", value: "top" },
      cardsPick: { kind: "constant", value: "the-empyrean.predicted" },
      chooseOrder: { kind: "constant", value: true }
    }
  }
];

const abilities: Ability[] = [
  // 832.1：Show Off 是 Passive Ability 关键词；决策在 Finalize 完成（832.1.c.2）。
  { kind: "keyword", keyword: "show-off", value: 1 },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        // 832.1.c："As you play me, you may reveal a card from hand or pick another
        // friendly one" —— 可选展示选择 + 特征锁定（832.1.d.1）。op 未注册，
        // 两个链接键是后续 Predict 指令要消费的契约（见 judgeReason）。
        id: "the-empyrean.show-off",
        op: "effect.show-off",
        args: {
          source: {
            kind: "constant",
            value: { from: ["hand", "board"], types: ["card"], controller: "you" }
          },
          optional: { kind: "constant", value: true },
          linkKey: { kind: "constant", value: "shown" },
          lockedProperty: { kind: "constant", value: "power" },
          lockedKey: { kind: "constant", value: "shownPowerCost" }
        }
      },
      {
        // "if you showed off a card"：未展示时整段 Predict + 抽牌不执行
        // （条件只作用于这一条 sequence，契约 3.4）。
        id: "the-empyrean.predict",
        op: "sequence",
        linkedTo: "the-empyrean.show-off",
        condition: {
          kind: "expression",
          value: {
            kind: "linked-value",
            instructionId: "the-empyrean.show-off",
            key: "shown"
          }
        },
        args: { body: { kind: "constant", value: [...predictBody, {
          id: "the-empyrean.draw-2",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 2 } }
        }] } }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-be9352fd69cba13e7974fff0bd5db390c242339f85ca41ea8f9289e4fd245d29",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四项当前真实缺口（2026-10-18 实测）：" +
    "(1) show off 的关键词拼写两边不一致：效果注册表以 KeywordDef.keyword（\"Show Off\"）为键，" +
    "programs/keywords.ts 的 definitionFor 只做大小写折叠，卡牌写的 slug \"show-off\" 实测抛 " +
    "“Keyword show-off has no executable KeywordDef”；改成注册键拼写能展开，但 card-dsl 的 IR 校验" +
    "要求小写 symbol，报 “Expected a lowercase keyword id”——卡牌侧无法写出同时满足两边的拼写。" +
    "(2) Show Off 展开为 static cost.reveal（832.1.c.2 在 Finalize 决策），但 programs/statics.ts 的 " +
    "layerFor 报 “Static ability kind cost.reveal has no layer mapping”，instructions 注册表里也没有 " +
    "cost.reveal；832.1.c.3 还要求把「从手牌展示」与「从友方场上拾取」合成同一组展示对象，现有 " +
    "PickSpec 只有固定 options，无法表达这种合成选项。" +
    "(3) objects-shown-off 时点已在 events/timing-points.ts 注册，但没有链上链接/快照消费方；" +
    "832.1.d.1 要求读取展示那一刻锁定的 Power cost，而 effect.reveal 只写 { revealed, revealedCount }，" +
    "没有原语产出 shownPowerCost 这类锁定值。" +
    "(4) condition.result 的逐实例链接值没有消费方（832.2 的多个 Show Off 实例不得合并成一个布尔）；" +
    "[Predict]（437.1 / 437.3）也没有 KeywordDef 统一编排看顶、可回收、任意顺序放回。" +
    "Predict 与抽牌的结构已按 437 写出，并有结构测试与 inspect/recycle/order 真实执行；" +
    "整卡依赖上述 Finalize/快照/链接契约、[Predict] KeywordDef 与关键词拼写（见最终回复的契约变更请求）。",
  abilities,
  sourceText:
    "[Show Off] a card. (As you play me, you may reveal a card from hand or pick another friendly one.)\n" +
    "When you play me, if you showed off a card, [Predict] equal to its Power cost, then draw 2. " +
    "(Look at that many cards from your Main Deck. Recycle any of them and put the rest back in any order.)"
} satisfies CardProgram;
