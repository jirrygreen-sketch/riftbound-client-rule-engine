import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Consult the Heavens (rad-025-167) — Unit, 1 energy, no printed Power, no printed
 * Might, domain Calm.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-025-167）：
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Give a unit [Shield 2] this turn. (+2 :rb_might: while it's a defender.)
 *   [Predict]. (Look at the top card of your Main Deck. You may recycle it.)
 *
 * ⚠ 数据问题（不改数据，仅报告）：卡面名称/能力文本是法术式措辞（[Reaction] / [Predict]），
 * 但本地 deck-catalog 把 rad-025-167 记作 `cardType: "Unit"`，且 energy 1 / power null /
 * might null（与同批其余 Realms-of-Adventure 法术、例如 rad-034-167 Hunker Down 的
 * `cardType: "Spell"` 不一致）。本程序按任务给定的 sourceText 逐字编写，不擅自改写类型或费用。
 *
 * 规则依据（CR v1.5）：
 * - [Reaction]（813.1 / 813.1.c）：许可类关键词，可随时在 Closed State 打出；声明由关键词
 *   注册表展开。
 * - “Give a unit [Shield 2] this turn”：815 的 Shield 是被动关键词（814 的规则条目为
 *   “Shield”）：814.1.c 的“while I am a defender, I have +2 [M]”。把关键词授予一个单位需要
 *   持续效果/图层授予（调研表把授予归 continuous.keyword，`docs/plans/survey/ability-templates.md`
 *   第 3 节记录该族 0/0 已实现），且授予带“this turn”期限（317.2.c 的到期时点）。
 * - [Predict]（437.1 / 437.3.a / 437.4）：看牌库顶一张并选择是否回收它；数值省略时按 1 张。
 *   Predict 的查看 + 选择由 effect.inspect，回收由 effect.recycle，二者均已合入。
 *
 * status = judge-required（见 judgeReason）：[Shield 2] 的授予没有消费方（没有任何已合入
 * 原语/图层能授予关键词并带本回合期限；814 的展开把 +2 绑定在 defender designation 上，
 * 该 designation 也还不是 ObjectSnapshot 特征）；[Predict] 半段可用 effect.inspect +
 * effect.recycle 真实执行，见 golden。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "reaction" },
  {
    kind: "play",
    body: [
      {
        // “Give a unit [Shield 2] this turn.” — 814.1.c 的关键词授予（+2 while defender，
        // 814.1.d.1 的 designation 时效），消费方是图层/持续效果授予（见 judgeReason）。
        // 选择单位按 355.7/355.10.b 是目标。
        id: "consult-the-heavens.grant-shield",
        op: "continuous.grant-keyword",
        args: {
          keyword: { kind: "constant", value: "shield" },
          value: { kind: "constant", value: 2 },
          duration: { kind: "constant", value: "end-of-turn" },
          target: { kind: "constant", value: "consult-the-heavens.unit" }
        },
        targets: [
          {
            id: "consult-the-heavens.unit",
            filter: { type: "unit", zone: "board" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      },
      {
        // “[Predict].” — 437.1 的查看 + 选择是否回收；437.3.a 省略数值按 1 张；
        // 437.4 少牌时尽可能看。437.4.a 明确不因此 Burn Out。
        id: "consult-the-heavens.predict-look",
        op: "effect.inspect",
        args: {
          player: { kind: "constant", value: "controller" },
          zone: { kind: "constant", value: "deck" },
          scope: { kind: "constant", value: "picks" },
          picksSpecId: { kind: "constant", value: "consult-the-heavens.predicted" },
          choose: { kind: "constant", value: true },
          chooseCount: { kind: "constant", value: { min: 0, max: 1 } },
          choiceId: { kind: "constant", value: "consult-the-heavens.predict" },
          pickedKey: { kind: "constant", value: "consult-the-heavens.predicted" },
          choosePicksKey: { kind: "constant", value: "consult-the-heavens.recycle" }
        },
        picks: [
          {
            id: "consult-the-heavens.predicted",
            options: ["top-card-of-controller-main-deck"],
            min: 0,
            max: 1,
            selection: "up-to",
            // 牌库顶是隐藏信息：选项集合由 Predict 的上游（牌库顶读取）在结算期提供；
            // 静态 IR 写不出精确引用，故用描述性选项标记（同 effect.inspect 文档要求的
            // “上游有序 picks”）。
            filter: { zone: "deck", owner: "controller" }
          }
        ]
      },
      {
        // “You may recycle it.” — 417.1.c：回收的牌放到其拥有者主牌库底部；未选择时
        // 链接值为空数组，effect.recycle 对空候选执行零次回收（055）。
        id: "consult-the-heavens.predict-recycle",
        op: "effect.recycle",
        linkedTo: "consult-the-heavens.predict-look",
        args: {
          objects: {
            kind: "linked",
            instructionId: "consult-the-heavens.predict-look",
            key: "consult-the-heavens.recycle"
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-9ce83ec71d8426d676f633ef7afbd7cd6b50566fd1e1404050adaf4c506e0faf",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「Give a unit [Shield 2] this turn」没有消费方：Shield 的 KeywordDef 展开已合入（814.1.c 的 “while I am a defender, +2 [M]”），" +
    "但把关键词授予另一个单位并带“this turn”期限需要 continuous.keyword / 图层授予原语（effects/instructions 无该 op，layers/ 无授予消费方；" +
    "调研表 ability-templates.md 第 3 节记录 continuous.keyword 为 0/0 已实现），且 814.1.d.1 的 Defender designation 仍不是 ObjectSnapshot 特征；" +
    "同 gem-jammer / forecaster 的判定。可执行部分：[Predict]（437.1/437.3.a/437.4）的查看 + 选择与回收由已合入的 effect.inspect + effect.recycle 真实执行，" +
    "但牌库顶的精确引用必须在结算期由上游提供（contract 3.6 zoneSlice / picks），静态 IR 只能给出描述性选项。" +
    "另见数据问题：本印刷在本地目录被记为 cardType Unit，而能力文本是法术式措辞（[Reaction] / [Predict]），与同批 rad-034-167 Hunker Down（Spell）不一致。" +
    "依赖：RIFT-91（layers-continuous 关键词授予与到期）、契约 3.8 combatRole。不近似实现。",
  abilities,
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Give a unit [Shield 2] this turn. (+2 :rb_might: while it's a defender.)\n" +
    "[Predict]. (Look at the top card of your Main Deck. You may recycle it.)"
} satisfies CardProgram;

export default program;
