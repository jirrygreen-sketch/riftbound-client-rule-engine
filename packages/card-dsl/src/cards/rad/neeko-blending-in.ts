import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Neeko, Blending In (rad-167-167) — Unit, 6 energy + 1 Colorless power, 4 Might。
 *
 * 原文（本地 deck-catalog，逐字）：
 *   "(Neutral cards can go in decks of any Domain.)\n" +
 *   "If Neeko is in your deck, choose 3 different legends in addition to your starting legend. " +
 *   "(Different means none match names.)\n" +
 *   "When you play me, choose one of those legends and add it to your Legend Zone while I'm on the board."
 *
 * 规则依据（CR v1.5）：
 * - 第一行 "(Neutral cards can go in decks of any Domain.)" 是 103.2.b.5 的提示文字：
 *   Colorless 卡没有 Domain，可进入任何 Domain Identity 的牌组；它不是能力，也不产生
 *   关键词，因此不写进 abilities。
 * - 第二行是 103.1 明确点名的构筑期决定（规则原文的示例就是本卡）："If [Name] is in
 *   your deck, choose 3 different legends in addition to your starting legend." → 用
 *   契约 3.1 的 `deckbuilding` 数据字段表达；"Different means none match names" 是
 *   同名排除约束。
 * - 第三行是 Play Effect（383.4.a：单位 Finalize 并进入 Board 后作为 Pending Item 入链），
 *   时点 card-played，事件过滤指向本源；"choose one of those legends" 指回上面的构筑期
 *   决定，"add it to your Legend Zone" 是 Create 动作（107.4.d.1 允许效果把传奇加入
 *   Legend Zone；440.2.b.4 Legends will be Created in the Legend Zone），"while I'm on
 *   the board" 是来源在场期间的持续期限（107.4.d.2：非 Champion 传奇只能存在于 Legend
 *   Zone 或 Banishment）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。三处依赖未合入：
 * 1. ZoneId 没有 legend-zone 成员（见 effect.empower / effect.exhaust / effect.stun 的
 *    同款契约缺口注释），也没有已注册的 "effect.create-legend" 原语把传奇 Create 到
 *    Legend Zone（440.2.b.4 / 107.4.d.1）；
 * 2. 运行期读不到构筑期决定的"those legends"：CardProgram.deckbuilding 有 IR 与校验，但
 *    engine-core/src/deck/index.ts 只有占位 export，没有消费方把决定变成运行期名单；
 * 3. "while I'm on the board" 需要来源离场时移除该传奇（107.4.d.2）；契约 Duration 已有
 *    { type: "while-source-in-zone" }，但没有卡牌侧原语/消费方接线。
 * 因此 deckbuilding 决定与触发结构按现有契约原样保留，整卡不标 executable，也不近似实现。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self", player: "controller" } }
    },
    optional: false,
    body: [
      {
        id: "neeko-blending-in.add-chosen-legend",
        // 待接线原语：把"那些传奇"之一 Create 到 Legend Zone（440.2.b.4 / 107.4.d.1）。
        // 注册表中没有该 op（见 judgeReason 与 golden 测试的 registry 断言）。
        op: "effect.create-legend",
        args: {
          // 103.1 决定的 3 张额外传奇（deckbuilding 字段）；"choose one of those legends"。
          from: { kind: "constant", value: "deckbuilding:additional-legends" },
          count: { kind: "constant", value: 1 },
          to: { kind: "constant", value: "legend-zone" },
          // "while I'm on the board"：来源在场期间有效，离场时移除（107.4.d.2）。
          duration: { kind: "constant", value: "while-source-in-zone" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-8beb5aeeb976500ce49a3d84121eaee83cbcc32357ee206dfdb2aefdcb2439f7",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处缺口：(1) 把传奇加入 Legend Zone 是 Create 动作（CR 440.2.b.4），107.4.d.1 明确这类" +
    "传奇不是 Champion Legend；契约 ZoneId 没有 legend-zone 成员（effect.empower/effect.exhaust/" +
    "effect.stun 已记录同一契约缺口），也没有已注册的 effect.create-legend 原语；" +
    "(2) 「choose one of those legends」要在运行期读取 103.1 的构筑期决定（CardProgram.deckbuilding），" +
    "但 engine-core/src/deck 只有占位 export，没有把 3 张额外传奇变成运行期名单的消费方；" +
    "(3) 「while I'm on the board」需要来源离场时移除该传奇（107.4.d.2）：契约 Duration 有 " +
    "while-source-in-zone，但没有卡牌侧原语/消费方。依赖：ZoneId 契约变更请求 + 新增 create-legend/" +
    "deckbuilding 消费任务（均未分配）。不近似实现（不用 move-zone 把传奇兜进普通区域，也不省略期限）。",
  abilities,
  // 103.1：构筑期额外选择 3 张互不同名（none match names）的传奇，作为 Legend Zone 备选。
  deckbuilding: [
    {
      kind: "choose-additional-legends",
      count: 3,
      different: "names",
      inAdditionToStartingLegend: true
    }
  ],
  sourceText:
    "(Neutral cards can go in decks of any Domain.)\n" +
    "If Neeko is in your deck, choose 3 different legends in addition to your starting legend. " +
    "(Different means none match names.)\n" +
    "When you play me, choose one of those legends and add it to your Legend Zone while I'm on the board."
} satisfies CardProgram;

export default program;
