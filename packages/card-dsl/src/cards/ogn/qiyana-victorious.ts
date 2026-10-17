import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Qiyana, Victorious (ogn-155-298) — Unit（能量 4，力量 1，Might 4，Body；Qiyana/Ixtal/Champion）。
 *
 * 原文：
 *   [Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)
 *   When I conquer, draw 1 or channel 1 rune exhausted.
 *
 * 规则依据（CR v1.5）：
 * - [Deflect] 809：关键词声明（target.tax 的按次追加支付）。
 * - 383.4.c / 383.4.c.1："When I conquer…" 是 Conquer Effect，时点 "conquer"
 *   （由 scoring/ 在建立控制并得分后发出，473.1）。
 * - "draw 1 or channel 1 rune exhausted" 是结算时的二选一（355.5.a 的选择），
 *   用 choice.mode（count 1、different true）表达，两个分支分别用已合入的
 *   effect.draw（414.3）与 effect.channel（431.1/431.2：符文横置进场）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required（复核 2026-10-17）。
 * - [Deflect] 的展开（keywords/Deflect.ts 输出 static target.tax）没有消费方：
 *   TargetPlan 的 TargetTaxAdapter（target/target-plan.ts）只接受调用方经
 *   TargetFinalizeOptions.tax 传入的税，链的 Finalize 没有从图层读取 target.tax
 *   静态效果的路径（静态绑定的 layerFor 也没有 target.tax 映射）；
 *   chain/engine.ts 虽然把税记进 mandatoryAdditional，但换算按 Energy 记账而
 *   809.1.c.1 要求任意域 Power。cost.pay/cost.modify 已合入，「目标税请求 →
 *   实际收费」仍缺的是目标税生产接线（RIFT-360，进行中）。
 * - conquer 时点（473.1）现已由 turn/flow.ts 的 Score wave 发出（见
 *   docs/rules/timing-point-producers.md），但「When I conquer」指「我参与并成功
 *   征服」：conquer 载荷只有 player + details.battlefieldId，没有参战单位/地点
 *   身份；把事件源与宿主当前位置比较的 "here"/source 锚点在 EventPattern 词表中
 *   不存在（嵌套 filter.source 拼写会被引擎校验拒绝），因此无法诚实地收窄到本卡。
 * - 触发注册的卡牌程序绑定（RIFT-257）已合入：programs/triggers.ts 的
 *   registerProgramTriggers + attachProgramLifecycle 可注册普通触发；本卡的
 *   conquer 触发仍因上面的载荷/词表缺口无法收窄绑定。
 * - body 的 choice.mode 也过不了链的 Finalize：assertFinalizationSurface 对
 *   choice.mode 抛 ChainContractBlockedError（Mode choices require a
 *   Finalize/Resolve choice-plan adapter）。
 * 依赖：RIFT-360（目标税生产接线）、EventPattern 的 source/here 参照词表、
 * choice.mode 的 Finalize/Resolve 接线。不近似实现（不把 Deflect 写成静态数值，
 * 也不跳过目标税）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "deflect" },
  {
    kind: "triggered",
    trigger: {
      at: "conquer",
      filter: { event: "conquer", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "qiyana.draw-or-channel",
        op: "choice.mode",
        args: {
          count: { kind: "constant", value: 1 },
          different: { kind: "constant", value: true },
          modes: {
            kind: "constant",
            value: [
              {
                id: "qiyana.draw-mode",
                body: [
                  {
                    id: "qiyana.draw",
                    op: "effect.draw",
                    args: { amount: { kind: "constant", value: 1 } }
                  }
                ]
              },
              {
                id: "qiyana.channel-mode",
                body: [
                  {
                    id: "qiyana.channel",
                    op: "effect.channel",
                    args: {
                      amount: { kind: "constant", value: 1 },
                      exhausted: { kind: "constant", value: true }
                    }
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
  canonicalCardId: "card.hash-f26c9365df2b773179f654031d3a114d51b6f183d2086ba1fa9f1891050a0a71",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处依赖仍未接通：（1）[Deflect]（809）的展开是 static target.tax，但没有消费方——" +
    "TargetPlan 的 TargetTaxAdapter 只接受调用方经 TargetFinalizeOptions.tax 传入的税，链的 Finalize 没有从图层读取 " +
    "CardProgram 静态 target.tax 的接线（静态绑定的 layerFor 也没有 target.tax 映射）；chain/engine.ts 已把税记进 " +
    "mandatoryAdditional，但换算按 Energy 记账而 809.1.c.1 要求任意域 Power。cost.pay/cost.modify 已合入，" +
    "仍缺的是目标税生产接线（RIFT-360，进行中）。" +
    "（2）conquer 时点（473.1）已由 turn/flow.ts 的 Score wave 发出，但「When I conquer」= 我参与并成功征服：" +
    "载荷只有 player + details.battlefieldId，没有参战单位/地点身份，EventPattern 词表也没有把事件源与宿主当前位置" +
    "比较的 source/here 锚点（嵌套 filter.source 拼写会被引擎校验拒绝），无法诚实收窄到本卡。（3）触发注册的卡牌程序绑定" +
    "已合入（programs/triggers.ts 的 registerProgramTriggers + attachProgramLifecycle），" +
    "本卡 conquer 触发仍因上述载荷/词表缺口无法收窄绑定；body 的 choice.mode 也过不了链的 Finalize" +
    "（assertFinalizationSurface 抛 ChainContractBlockedError）。" +
    "body 的 draw/channel 二选一结构完整，golden 分别用已合入的 effect.draw 与 effect.channel 原语执行。不近似实现。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "When I conquer, draw 1 or channel 1 rune exhausted."
} satisfies CardProgram;

export default program;
