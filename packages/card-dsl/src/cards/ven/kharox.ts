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
    "四处当前缺口（2026-10-17 RIFT-733 复核实测，已合入依赖不再列为缺口）：" +
    "(1) 印刷 Empower 费用没有承载通道：KeywordAbility 只有 keyword/value，programs/keywords.ts 的 expandProgram " +
    "一律调 def.expand({ value, host }) 而不传 params，Empower.ts 因此只能回落到 cost: { kind: \"empower\" }；" +
    "实测 createProgramBinding().describeActivate 抛 ProgramBindingError(judge-required) " +
    "\"Unsupported cost kind empower on activate:…\"（827.1.c.1 / 827.1.c.2）。" +
    "(2) empowered-changed 不在 events/trigger-spec.ts 的 EVENT_PATTERN_TYPES：validateEventPattern 直接以 " +
    "invalid-event-type 拒绝该判别式，所以 programs/triggers.ts 的 triggerRegistrations 无法注册本触发；" +
    "事件载荷（previousCount/currentCount/cause）与 828.1.d 的“成为 Empowered”方向判定同样缺消费方（442.2.a）。" +
    "(3) 「choose an opponent」的 picks 只有描述性 options: [\"dynamic:opponent-players\"]：" +
    "chain/picks/plan.ts 只锁定 zoneSlice/linked 来源，Finalize 没有把动态对手集合解析成玩家选择，" +
    "effect.mill 的 pick 通道实测 negated/impossible（355.9.a / 441.2）。" +
    "(4) 「play it, ignoring its cost」缺真实费用计划：chain/engine.ts 的 Finalize 只对 item.cost 调 buildCostPlan，" +
    "卡片 body 内的常量 finalized 计划不会被生成；effect.play 还要求选中对象已由 Finalize 锁定目标，" +
    "而 effect.play 的 target 在 choice.optional 的 body 内，实测命中 " +
    "ChainContractBlockedError \"Nested/repeated targets require an interpreter target-selection lifecycle adapter\"" +
    "（356.1.b.1）。不近似实现：不改写为 controller 的 trash、不伪造零费计划。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_6::rb_rune_chaos::rb_rune_chaos: (:rb_energy_6::rb_rune_chaos::rb_rune_chaos:: " +
    "Empower me. Use only if not Empowered.)\nWhen I become [Empowered], choose an opponent. They [Burn 3]. " +
    "Then you may do this: Choose a unit in their trash and play it, ignoring its cost. (To Burn 3, " +
    "they put the top 3 cards of their Main Deck into their trash.)"
} satisfies CardProgram;
