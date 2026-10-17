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
 * status = judge-required（2026-10-17 源码复核）：
 * - Reaction 展开的 appliesTo:[card,activated-ability] 仍被 staticTarget 拒绝。
 * - combatRole 已存在于 ObjectSnapshot，expr-ext 也能把 designation 映射到它；
 *   但默认 expr.ts / programs/statics.ts 没有消费该扩展，Shield 展开仍读取 designation。
 * - continuous.grant-keyword 只授予 keyword 特征；生产生命周期尚不重新展开临时授予的
 *   Shield 并绑定它的条件 Might。还需真实战斗角色的生产与到期路径。
 * Predict 的 zoneSlice + inspect/recycle 已通过真实 ChainEngine 验证，不能列作缺口。
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
        // effect.inspect 接受 linked-value；先由解释器读取打出者的来源快照，
        // 保留真实 PlayerId，不把占位字符串作为玩家传给原语。
        id: "consult-the-heavens.bind-controller",
        op: "condition.value",
        args: {
          value: { kind: "object-property", object: "source", property: "controller" },
          key: { kind: "constant", value: "controller" }
        }
      },
      {
        // “[Predict].” — 437.1 的查看 + 选择是否回收；437.3.a 省略数值按 1 张；
        // 437.4 少牌时尽可能看。437.4.a 明确不因此 Burn Out。
        id: "consult-the-heavens.predict-look",
        op: "effect.inspect",
        linkedTo: "consult-the-heavens.bind-controller",
        args: {
          player: {
            kind: "linked-value",
            instructionId: "consult-the-heavens.bind-controller",
            key: "controller"
          },
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
            options: [],
            ordered: true,
            selection: "all",
            // 省略 player 表示能力控制者；短牌库按 437.4 尽可能提供引用。
            // Finalize 只锁定引用，不查看、不公开，也不把 pick 当成目标。
            zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 1 } }
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
    "(1) [Reaction]（CR 813.1.c）的 continuous.timing static 展开仍因 appliesTo:[card,activated-ability] 被 programs/statics.ts 拒绝为 Unsupported static appliesTo。" +
    "(2) [Shield 2]（814.1.d.1）的 combatRole 已是 ObjectSnapshot 特征；但 Shield 展开读取 designation，" +
    "expr-ext 的别名映射未接入默认表达式/静态条件求值。continuous.grant-keyword 还仅授予特征，缺临时 Shield 到条件 Might 展开的生命周期及战斗角色生产。" +
    "zoneSlice/Predict 的 ChainEngine 查看、回收/保留路径已有执行证据，不是缺口。" +
    "目录的 cardType Unit 与法术式原文尚待 card-data 核实，本任务不改类型、原文或 null 印刷值。",
  abilities,
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Give a unit [Shield 2] this turn. (+2 :rb_might: while it's a defender.)\n" +
    "[Predict]. (Look at the top card of your Main Deck. You may recycle it.)"
} satisfies CardProgram;

export default program;
