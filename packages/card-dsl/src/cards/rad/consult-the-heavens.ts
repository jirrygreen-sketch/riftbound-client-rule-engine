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
 * status = judge-required（2026-10-18 第五轮源码复核，逐项实测）：
 * 1. [Reaction] 的 continuous.timing 展开仍被 programs/statics.ts 的 staticTarget 拒绝
 *    （appliesTo:[card,activated-ability] → "Unsupported static appliesTo"）。实测把该程序
 *    接到生产绑定（createProgramBinding + attachProgramLifecycle）并提交
 *    object-enters-board 后，生命周期回调收到该错误、图层注册表为空、
 *    actionTimings() 返回 []。声明的 reaction 关键词本身仍让 describePlay 得到
 *    speed "reaction"（实测），链许可由 chain/engine.ts 的 canAct + layers/rules 的
 *    canAct 判定，所以这一条只影响 layers 侧的许可登记，不改变打出速度。
 * 2. [Shield 2] 的授予半段可执行（continuous.grant-keyword 注册 ability 图层效果），
 *    但生产默认的 LayerEngine 根本不展开被授予的关键词：实测经真实解释器授予后
 *    Shield 只停在 object.keywords，Might 保持印刷值（814.1.c 的 +2 不生效）；
 *    expandEffectiveKeywords 对该关键词求值得到的是 continuous.might + designation
 *    条件的 static 展开，而生产链路没有任何调用方把该展开注册回图层。
 *    RIFT-710 的 KeywordGrantLayerEngine 会展开并按 designation 条件求值
 *    （实测 defender 时 Might 3→5，attacker/无角色时保持 3），但它不是生产默认
 *    （ChainEngine 仍构造 LayerEngine，programs/lifecycle.ts 也绑到该引擎）。
 * 3. combatRole 已存在于 ObjectSnapshot，expr-ext 也能把 designation 映射到它；
 *    但没有任何生产方写入 combatRole（combat/flow.ts 在 staged combat 抛
 *    combat-start-transaction），因此即便接线也无法在真实战斗里得到 defender。
 * 4. 默认 LayerEngine 的 conditionMatches 对未实现的 compare 条件返回 true：实测
 *    把 Shield 展开的条件 Might 直接注册到默认引擎时，defender/attacker/无角色都读到
 *    +2（814.1.d.1 被违反）。若后续只把展开接进默认引擎而不接条件求值器，就会无条件加 Might。
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
    "(2026-10-18 第五轮复核实测) (1) [Reaction]（813.1.c）的 continuous.timing static 展开仍因 " +
    "appliesTo:[card,activated-ability] 被 programs/statics.ts 拒绝为 Unsupported static appliesTo：" +
    "实测生产绑定（createProgramBinding + attachProgramLifecycle）在该时点收到该错误、图层注册表为空、" +
    "actionTimings() 返回 []；reaction 关键词声明仍让 describePlay 得到 speed \"reaction\"（实测），" +
    "链许可走 chain/engine.ts 的 canAct + layers/rules。" +
    "(2) [Shield 2]（814.1.c/814.1.d.1）的授予半段可执行，但生产默认 LayerEngine 不展开被授予的关键词：" +
    "实测经真实解释器授予后 Shield 只停在 object.keywords，Might 保持印刷值，+2 不生效。" +
    "RIFT-710 的 KeywordGrantLayerEngine 会展开并按 designation 求值（实测 defender Might 3→5，attacker/无角色保持 3），" +
    "但不是生产默认（ChainEngine 仍构造 LayerEngine，programs/lifecycle.ts 也绑到它）。" +
    "(3) 没有生产方写入 combatRole（combat/flow.ts 抛 combat-start-transaction），即便接线也没有真实 defender。" +
    "(4) 默认 LayerEngine 的 conditionMatches 对未实现的 compare 条件返回 true：实测把展开的条件 Might 注册到默认引擎时，" +
    "defender/attacker/无角色都读到 +2，违反 814.1.d.1。" +
    "zoneSlice/Predict 的 ChainEngine 查看、回收/保留路径已有执行证据，不是缺口。" +
    "目录的 cardType Unit 与法术式原文尚待 card-data 核实，本任务不改类型、原文或 null 印刷值。",
  abilities,
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Give a unit [Shield 2] this turn. (+2 :rb_might: while it's a defender.)\n" +
    "[Predict]. (Look at the top card of your Main Deck. You may recycle it.)"
} satisfies CardProgram;

export default program;
