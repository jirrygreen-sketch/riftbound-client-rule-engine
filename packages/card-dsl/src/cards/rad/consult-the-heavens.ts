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
 *   持续效果/图层授予：已合入的 `continuous.grant-keyword` 指令原语（RIFT-258）负责建立
 *   ability 层注册，授予带“this turn”期限（317.2.c 的到期时点，别名 end-of-turn）。
 * - [Predict]（437.1 / 437.3.a / 437.4）：看牌库顶一张并选择是否回收它；数值省略时按 1 张。
 *   Predict 的查看 + 选择由 effect.inspect，回收由 effect.recycle，二者均已合入。
 *
 * status = judge-required（2026-10-17 第三轮复核，见 judgeReason）：授予与 Predict 两半的
 * 指令都已可用（grant 经解释器 + 图层求值，Predict 经 inspect + recycle），但 [Reaction] 的
 * 展开在卡牌程序绑定路径上失败：`programs/statics.ts` 对 `continuous.timing` 的
 * `appliesTo: ["card", "activated-ability"]` 抛 “Unsupported static appliesTo”（实测）；
 * [Shield] 的展开体（`continuous.might`）能绑定，但 814.1.d.1 的 Defender designation
 * 仍不是 ObjectSnapshot 的求值特征；牌库顶的有序 pick 也必须由上游在结算期提供
 * （契约 3.6 zoneSlice，提供方属 RIFT-358）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "reaction" },
  {
    kind: "play",
    body: [
      {
        // “Give a unit [Shield 2] this turn.” — 814.1.c 的关键词授予（+2 while defender，
        // 814.1.d.1 的 designation 时效），执行方是已合入的 continuous.grant-keyword
        // ability 层注册（RIFT-258）；形态同 keywords/Shield.ts 的 static 展开。
        // 选择单位按 355.7/355.10.b 是目标。
        id: "consult-the-heavens.grant-shield",
        op: "continuous.grant-keyword",
        args: {
          keyword: { kind: "constant", value: "shield" },
          value: { kind: "constant", value: 2 },
          duration: { kind: "constant", value: "end-of-turn" },
          // 选择器用已合入原语接受的符号形态（objects.target），由解释器在结算期解析为
          // 运行时 ObjectRef（契约 3.6）。
          objects: {
            kind: "constant",
            value: { kind: "target", id: "consult-the-heavens.unit" }
          }
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
    "两半指令都已合入并各有真实执行证据（[Shield 2] 授予经 continuous.grant-keyword 建 ability 层注册、" +
    "end-of-turn 到期；[Predict] 经 effect.inspect + effect.recycle，437.1/437.3.a/437.4），但整卡仍有三处真实缺口：" +
    "[Reaction]（813.1.c）的展开体是 continuous.timing static，programs/statics.ts 对其 " +
    "appliesTo: [\"card\", \"activated-ability\"] 抛 \"Unsupported static appliesTo\"（实测），" +
    "展开无法经 CardProgram 注册；[Predict] 的牌库顶引用必须由上游在结算期按 " +
    "437.1/契约 3.6 zoneSlice 提供有序 picks（RIFT-358）；814.1.d.1 的 Defender designation 仍未成为 " +
    "ObjectSnapshot 特征（契约 3.8 combatRole，无产生方），Shield 的 +2 只能作为层注册被读出，暂不能按防守身份求值。" +
    "另见数据问题：本印刷在本地目录被记为 cardType Unit，而能力文本是法术式措辞（[Reaction] / [Predict]），" +
    "与同批 rad-034-167 Hunker Down（Spell）不一致。不近似实现。",
  abilities,
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Give a unit [Shield 2] this turn. (+2 :rb_might: while it's a defender.)\n" +
    "[Predict]. (Look at the top card of your Main Deck. You may recycle it.)"
} satisfies CardProgram;

export default program;
