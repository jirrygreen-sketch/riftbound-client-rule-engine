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
 *   发出 empowered-changed（events/timing-points.ts，需前后状态载荷；828.1.d 要求识别成为 Empowered 的变化）。
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
 * status = judge-required。已合入依赖与剩余生产接线已重新核对；
 * 当前真实缺口以 judgeReason 为准，子效果执行不证明整卡可执行。
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
          // CR 828.1.d: this source becomes Empowered. The shared timing
          // also covers Disempower; direction still needs a consumer.
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
    "仍缺：(1) KeywordAbility / programs/keywords.ts 未传 params.cost，无法把本卡 6 Energy + 2 Chaos Power 交给 Empower 展开（827.1.c.1）；" +
    "(2) empowered-changed 不在 EVENT_PATTERN_TYPES，事件缺 Empower/Disempower 方向与前后状态，无法只在来源成为 Empowered 时触发（442.2.a / 828.1.d）；" +
    "(3) choose an opponent 缺玩家目标/选择的 Finalize 绑定（355.9.a），其 trash 也需关联同一被选玩家；" +
    "(4) effect.play 的忽略基础费用入口仍未接到 buildCostPlan 的 ignore-base（356.1.b.1），常量 finalized 标记不能替代真实费用计划及追加费用处理。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_6::rb_rune_chaos::rb_rune_chaos: (:rb_energy_6::rb_rune_chaos::rb_rune_chaos:: " +
    "Empower me. Use only if not Empowered.)\nWhen I become [Empowered], choose an opponent. They [Burn 3]. " +
    "Then you may do this: Choose a unit in their trash and play it, ignoring its cost. (To Burn 3, " +
    "they put the top 3 cards of their Main Deck into their trash.)"
} satisfies CardProgram;
