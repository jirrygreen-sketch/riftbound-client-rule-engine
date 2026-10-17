import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Kharox (ven-114-166) — Unit, 6 Energy, Might 5, Chaos,
 * tags Spirit / Shadow Isles.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-114-166，逐字）：
 *   [Empower] :rb_energy_6::rb_rune_chaos::rb_rune_chaos:
 *   (:rb_energy_6::rb_rune_chaos::rb_rune_chaos:: Empower me. Use only if not
 *   Empowered.)
 *   When I become [Empowered], choose an opponent. They [Burn 3]. Then you may
 *   do this: Choose a unit in their trash and play it, ignoring its cost. (To
 *   Burn 3, they put the top 3 cards of their Main Deck into their trash.)
 *
 * 规则依据（CR v1.5）：
 * - 827.1 / 827.1.c / 827.1.c.1：[Empower] 是启动能力关键词，本卡印刷形态为
 *   "Empower [6 Energy + 2 Chaos Power]"，功能等价于「[费用]：Empower 我。仅当未
 *   Empowered 时启动」；827.1.b.1 明确来源自身不是目标；827.2 / 827.2.a 规定动作
 *   完成后宿主成为 Empowered 并产生可被引用的事件。按契约 3.7 与 README 第 5 节只
 *   声明关键词，不重写展开（印刷费用见 judgeReason）。
 * - 828.1 / 828.1.b / 828.1.c / 828.1.d："When I become [Empowered]" 是依赖能力的
 *   Condition 之一，在来源成为 Empowered 时 Active 并触发；状态变化由动作层在完成后
 *   发出 empowered-changed（events/timing-points.ts，payload 含 previousCount /
 *   currentCount，828.1.c 要求只对增加方向触发）。
 * - 355.7 / 355.9.a / 355.10.e："choose an opponent" 选择的是玩家，玩家可以是目标；
 *   契约 3.6 的 targets() 只返回 ObjectRef[]，所以用非目标 pick（ctx.picks() 允许
 *   PlayerId）表达并声明动态选项集，与已合入 rad/suave-negotiator 同款写法（见
 *   judgeReason 的契约变更请求）。
 * - 441.1 / 441.2 / 441.4：「They [Burn 3]」的烧牌者是被选对手，用 effect.mill 的
 *   pick 参数读取同一份 PickSpec（441.1.a 的触发归属由内核负责）。
 * - 356.1.b / 356.1.b.1 / 420.3.b.1 / 420.3.c："play it, ignoring its cost" 把被选单位
 *   的基础费用置零后按正常 Play 流程打出；"you may do this" 按契约 3.9 写成
 *   choice.optional 并把被选指令包在 body 里。
 *
 * status = judge-required（四处缺口均不近似实现）：
 * 1. 没有 Empower / Empowered 的 KeywordDef：keywords/registry.generated.ts 只含
 *    RIFT-81~88 批次，827.1.c.1 的启动费用与「仅当未 Empowered」限制、828.1.b.1 的
 *    依赖能力都无展开实现；
 * 2. 没有 Empowered 状态谓词（442.1.a），且 empowered-changed 的 direction 过滤与
 *    previousCount/currentCount 载荷尚未接到 TriggerSpec，触发过滤只能以描述性键记录；
 * 3. 玩家选择没有已合入管线：targets() 只返回 ObjectRef[]，ChoiceRequest 也没有选择
 *    玩家的请求类型，「把对手集合解析为 PlayerId 并在 Finalize 锁定」没有消费方；
 * 4. "ignoring its cost" 需要费用管线生成 finalized 零费计划（356.1.b.1）：EffectIR 的
 *    CostSpec 没有 ignore / 替代费用字段的消费方，已合入的 effect.play 明确要求 cost
 *    参数是费用系统产出、已 Finalize 的计划。
 * golden 用已合入的 effect.mill（RIFT-112）以实例化的 PlayerId 真实执行 "[Burn 3]"，
 * 这是子效果证据而非整卡证据。
 */
const abilities: Ability[] = [
  {
    // 印刷费 6 Energy + 2 Chaos Power 见 judgeReason；KeywordAbility 没有 params 字段
    // （契约 3.8.3 的 params 只加在 KeywordDef.expand 的输入上），不伪造第二条启动能力。
    kind: "keyword",
    keyword: "empower"
  },
  {
    kind: "triggered",
    trigger: {
      at: "empowered-changed",
      filter: {
        event: "empowered-changed",
        filter: {
          // 828.1.d：来源自身成为 Empowered；`direction: "increase"` 是 828.1.c 要求的
          // 增加方向（empower 与 disempower 共用该时点，443.1），当前载荷不带该字段，
          // 也没有 Empowered 状态谓词（见 judgeReason）。
          source: "self",
          direction: "increase"
        }
      }
    },
    optional: false,
    body: [
      {
        // "choose an opponent"：目标玩家列表的 Finalize 锁定（355.9.a）也没有消费方，
        // 本 PickSpec 记录该选择；"They [Burn 3]" 读同一份 pick（355.10.e）。
        id: "kharox.chosen-opponent-burn-3",
        op: "effect.mill",
        args: {
          amount: { kind: "constant", value: 3 },
          pick: { kind: "constant", value: "kharox.chosen-opponent" }
        },
        picks: [
          {
            id: "kharox.chosen-opponent",
            // 静态 IR 无法列出运行时 PlayerId；选项由 Finalize 按对手集合解析。
            options: ["dynamic:opponent-players"],
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      },
      {
        // 契约 3.9："Then you may do this: …" 是可选效果，被选指令包在 body 里。
        id: "kharox.may-play-option",
        op: "choice.optional",
        args: {
          prompt: {
            kind: "constant",
            value: "Play a unit from that opponent's trash, ignoring its cost?"
          },
          body: {
            kind: "constant",
            value: [
              {
                // "Choose a unit in their trash and play it, ignoring its cost"：
                // 356.1.b.1 把基础 Energy 与 Power 置零；费用计划的生成器未合入
                // effect.play 要求 cost 已是 Finalize 完成的计划。
                id: "kharox.play-unit-from-trash",
                op: "effect.play",
                args: {
                  target: {
                    kind: "constant",
                    value: "kharox.unit-in-opponent-trash"
                  },
                  cost: {
                    kind: "constant",
                    value: {
                      finalized: true,
                      energy: 0,
                      power: [],
                      xp: 0,
                      ignore: ["energy", "power"]
                    }
                  },
                  linkKey: { kind: "constant", value: "playedUnit" }
                },
                targets: [
                  {
                    id: "kharox.unit-in-opponent-trash",
                    // "their trash"：被选对手的 trash；其控制者是该对手（"their" 指向前一条
                    // pick 的玩家），用 controller: "opponent" 记录。
                    filter: {
                      type: "unit",
                      zone: "trash",
                      controller: "opponent"
                    },
                    min: 1,
                    max: 1,
                    selection: "one"
                  }
                ]
              }
            ]
          }
        }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-3d223dbad167b8ba77b7ea78144ef2178d6804de4c7d260449f02325a2d81e71",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口，均不近似实现：(1) keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef" +
    "（RIFT-81~88 批次不含它们），827.1.c.1 的「6 Energy + 2 Chaos Power：Empower me，仅当未 Empowered 时启动」" +
    "与 828.1.b.1 的依赖能力都无展开实现；(2) 没有 Empowered 状态谓词（442.1.a）——状态不在 ObjectSnapshot / " +
    "Condition 里，触发过滤的 direction \"increase\" 只是描述性记录（828.1.c 要求只对增加方向触发，" +
    "programs/filters.ts 当前拒绝 direction，且 empowered-changed emission 没有 previousCount/currentCount 载荷）；(3) 「choose an opponent」是玩家选择" +
    "（355.9.a），但契约 3.6 的 targets() 只返回 ObjectRef[]，ChoiceRequest 也没有选择玩家的请求类型，" +
    "「把对手集合解析为 PlayerId 并在 Finalize 锁定」没有已合入实现（同 suave-negotiator 的缺口）；" +
    "(4) 「play it, ignoring its cost」需要费用管线生成 finalized 零费计划（356.1.b / 356.1.b.1），" +
    "CostSpec 的 ignore / 替代费用没有卡牌程序入口，已合入的 effect.play 明确要求 cost 是费用系统产出、" +
    "已 Finalize 的计划。依赖：新增 Empower/Empowered 关键词任务、CardProgram 的 ignore-cost 计划生成与接线、" +
    "empowered-changed 的方向/载荷契约与玩家目标/选择的契约增补。「They [Burn 3]」半段用已合入的 effect.mill 真实执行" +
    "（实例化 PlayerId），golden 覆盖按序烧 3 张与牌库不足的边界。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_6::rb_rune_chaos::rb_rune_chaos: (:rb_energy_6::rb_rune_chaos::rb_rune_chaos:: " +
    "Empower me. Use only if not Empowered.)\nWhen I become [Empowered], choose an opponent. They [Burn 3]. " +
    "Then you may do this: Choose a unit in their trash and play it, ignoring its cost. (To Burn 3, " +
    "they put the top 3 cards of their Main Deck into their trash.)"
} satisfies CardProgram;
