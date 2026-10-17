import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Buhru Captain (sfd-091-221) — Unit, 3 energy + 1 Body power, Might 3，
 * 领域 Body，标签 Bilgewater。
 *
 * sourceText（packages/card-data/data/deck-catalog.json sfd-091-221，逐字）：
 *   "When you play me, you may draw 1 or buff me. (To buff a unit, give it a
 *    +1 :rb_might: buff if it doesn't already have one.)"
 *
 * 规则依据（Core Rules v1.5）：
 * - 383.4.a / 420.4.a："When you play me" 是 Play Effect，打出完成后进链；封闭时点用
 *   "card-played"，filter 用契约 3.6 的符号选择器 { source: "self" } 指向本卡，不写运行时
 *   ObjectRef。
 * - 355.3 / 355.3.a："you may draw 1 or buff me" 是打出流程第 2 步的模式选择——印刷 "or"
 *   的两个分支互斥，各选其一。按契约 3.9 用 choice.mode（count 1、different true），每个模式
 *   各带一条已合入原语；不写成 choice + linkedTo。
 *   - "draw 1"：effect.draw（414.1/414.3），抽牌者缺省为能力控制者（190.6.d 的 "you"）。
 *   - "buff me"：effect.buff（mode "buff"，702.2.a/702.3）把宿主写成 TargetSpec 里的
 *     object: "self" 锚点（已合入 sfd/rumble-hotheaded、ogn/sett-brawler 同型）。
 * - 702.3 / 702.3.a：已有 Buff 的单位仍可被选择但不放置第二个——由原语按实际结果处理，卡不
 *   自行判定；括号内文字是 reminder（703 的 +1 Might 由图层从 Buff 计数派生），不是独立指令。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required（复核 2026-10-17）。
 * - 链侧对 choice.mode 有明确阻断：chain/engine.ts 的 assertFinalizationSurface 对 body 内任何
 *   choice.mode 抛 ChainContractBlockedError（"Mode choices require a Finalize/Resolve
 *   choice-plan adapter"），programs/play.ts 的 validateSurface 对同一形状也 judgeRequired，
 *   因此整卡经过链的真实结算目前不可执行。
 * - 两条分支本体（effect.draw / effect.buff）与 choice.mode 的解释器语义均已合入，golden 用
 *   生产链适配器 + 测试内核真实执行两条分支与「已有 buff 不再放置」边界；choice.mode 的二选一
 *   仍缺 Finalize/Resolve 选择计划接线。
 * - 印刷的 "may" 已经有可依条目：CR v1.5 383.3.a.3 规定 "you may" 出现在触发效果的首段时，
 *   是 finalization 时的整体拒绝决定（383.3.a/403.1），而 "and/or" 的分支选择按 403.2 是
 *   该能力自己的模式选择；本卡因此写成 ability.optional = true（Finalize 的整体拒绝）并在
 *   body 内保留 choice.mode 的二选一（不增加第三选项、不把 "or" 压成单一分支）。
 *   此前把这一读法当作未定点，属过时结论。
 * - filter 的 "self" 锚点与 Finalize/Resolve 选择生命周期属事件/目标管线。
 * 依赖：链的 Finalize/Resolve 对 choice.mode 的选择计划生命周期、目标锚点与触发器绑定。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    // 383.3.a/383.3.a.3/403.1："you may" 是效果首段 → 整条触发能力的 finalization 拒绝权，
    // 由 optional 承载；二选一的 "or" 留在 body 的 choice.mode 里。
    optional: true,
    body: [
      {
        // 355.3/355.3.a："draw 1 or buff me" 是二选一模式（契约 3.9 的 choice.mode）。
        id: "buhru-captain.mode",
        op: "choice.mode",
        args: {
          count: { kind: "constant", value: 1 },
          different: { kind: "constant", value: true },
          prompt: { kind: "constant", value: "Draw 1 or buff me?" },
          modes: {
            kind: "constant",
            value: [
              {
                id: "buhru-captain.draw-mode",
                body: [
                  {
                    id: "buhru-captain.draw",
                    op: "effect.draw",
                    args: { amount: { kind: "constant", value: 1 } }
                  }
                ]
              },
              {
                id: "buhru-captain.buff-mode",
                body: [
                  {
                    id: "buhru-captain.buff",
                    op: "effect.buff",
                    args: {
                      mode: { kind: "constant", value: "buff" },
                      target: { kind: "constant", value: "buhru-captain.self" }
                    },
                    targets: [
                      {
                        id: "buhru-captain.self",
                        // 355.10.d.1："me" 由特征程序化选中、从不做选择，因此不是目标；
                        // 契约 3.6 的 "self" 锚点由解释器在运行时绑定宿主。
                        filter: { object: "self", type: "unit", zone: "board" },
                        min: 1,
                        max: 1,
                        selection: "one"
                      }
                    ]
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

const program = {
  canonicalCardId: "card.hash-9d2270f21698ed5fabefab3f109954da05ef53159ad4d61436d7f4f6c978d4e7",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "复核 2026-10-17，一处真实缺口：效果本体的三段都已合入（choice.mode 的二选一形状 + effect.draw + effect.buff，" +
    "golden 已真实执行两条分支与「已有 buff 不再放置」边界），但链侧对 choice.mode 仍有明确阻断：" +
    "chain/engine.ts 的 assertFinalizationSurface 对 body 内任何 choice.mode 抛 ChainContractBlockedError" +
    "（\"Mode choices require a Finalize/Resolve choice-plan adapter\"），程序绑定层的 validateSurface 对 play 路径同样" +
    " judgeRequired，整卡经链真实结算目前不可执行（缺 Finalize/Resolve 选择计划生命周期）；" +
    "此前记作未定点的 \"may\" 读法已由 CR v1.5 383.3.a.3 结清：\"you may\" 在触发效果首段时是" +
    " finalization 时的整体执行决定（383.3.a/403.1），不是结算期的第三个选项；本卡据此写成触发级 optional: true，" +
    "body 内仍是印刷 \"or\" 的两个互斥模式（不增加第三分支、也不把二选一压成单分支）。" +
    "触发的 { source: \"self\" } 锚点绑定与 Finalize/Resolve 目标重验依赖目标锚点绑定与卡牌程序 → 链触发接线。",
  abilities,
  sourceText:
    "When you play me, you may draw 1 or buff me. (To buff a unit, give it a +1 :rb_might: buff if it doesn't already have one.)"
} satisfies CardProgram;

export default program;
