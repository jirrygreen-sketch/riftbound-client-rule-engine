import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Chem-Baroness (sfd-201-221) — Legend, Mind/Order, tag Renata Glasc.
 * energy: null / power: null / might: null（传奇没有印刷费用与 Might；null 不是 0）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-201-221，逐字）:
 *   "When you or an ally hold, you may exhaust me to play a Gold gear token exhausted.\n"
 *   "While your score is within 3 points of the Victory Score, your Gold [Add] an additional :rb_energy_1:."
 *
 * 规则依据（CR v1.5）：
 * - "When you or an ally hold" 是 Hold Effect（383.4.d/383.4.d.1：条件包含"做出 Hold 的玩家"的能力）；
 *   封闭时点 hold（refs 315.2.b.2/471.2/473.2.b）。事件词汇写作 "held"——TriggerSpec 的
 *   EVENT_PATTERN_TYPES 只接受 "held"，events/pipeline-match.ts 的 EVENT_NAMES 把
 *   时点 hold 映射到 "held"；写 "hold" 会在 registerTrigger 的 assertTriggerSpec 处被拒。
 *   "you" = 能力控制者；"an ally" 是 491.8.e 的 Teammate 关系（740.1.a 的 friendly 定义包含
 *   teammates），闭源的单挑内核没有队友关系读法。
 * - "you may exhaust me to play a Gold gear token exhausted."：[do X] to [do Y] 的代价式结构
 *   （740.4.a.2：触发能力效果首段的代价在 Finalization 支付）；415.5 说明能力里的 :rb_exhaust: 是
 *   费用 "Exhaust me"，415.4 要求该动作必须能完成。"you may" 是效果首段的可选项（403.1/383.3.a），
 *   因此 optional = true，并按契约 3.9 把被选指令包进 choice.optional 的 body。
 * - "play a Gold gear token exhausted"：440.2.c / 185.2.a 规定 "play a … token" 先在链上生成再交给
 *   play 流程；185.2.d / 143.4 规定单位与 token 的入场状态，本卡额外写明 "exhausted"（143.4 的
 *   入场状态规定，不是事后补一次横置动作——effect.exhaust 的文档明确"先创建再补横置不等价，会多产生
 *   一次『成为横置』事件并错过入场替代"）。Gold 的印刷定义见 187.5："A Gold gear token is a
 *   domainless gear token with \"[Reaction][>] Kill this, [E]: [Add] [A].\""（同 canonicalCardId 的
 *   sfd-t03 / unl-t05 目录条目）。effect.token 的 argsSchema 目前没有入场状态参数（其文档记录
 *   "Entry overrides are not supported"），所以打印的 "exhausted" 只能写在理由里，不能塞进 args。
 * - "While your score is within 3 points of the Victory Score, your Gold [Add] an additional :rb_energy_1:."
 *   是 364.x 的条件 Passive Ability：条件是本回合的行动者/控制者分数与 Victory Score 的差值，效果是
 *   让由其控制的 Gold 的 [Add] 多产生 1 Energy。194.3/194.3.a：Victory Score 默认 8，可被游戏模式或
 *   卡牌效果改变（485.3.a 允许任意正整数），因此不能硬编码 8。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required（复核 2026-10-17，逐条对源码）。
 * - Gold 的 token 定义不在 effect.token 的冻结定义表里（文件头明确记录：需要自身能力的定义（包括 Gold）
 *   保持 blocked/judge-required；表内只有 recruit/sand-soldier/mech/reflection/tentacle），
 *   运行期以 blockedReason "token-definition-or-abilities-judge-required" 判负。
 * - "exhausted" 是 143.4/185.2.d 的入场状态规定；合并的 effect.token 明确记录"Entry overrides are not
 *   supported"，argsSchema 对 entersExhausted 直接抛 TypeError，事后补 effect.exhaust 不等价。
 * - 费用式 "exhaust me" 依赖 legend-zone 表达与触发点费用计划接线（契约 3.6 的 ZoneId 没有
 *   Legend Zone，CR 108.3；同 ogn/the-boss）。
 * - "an ally"（491.8.e 的 Teammate）没有已合入的队友关系读法：ResolveContext 只暴露 player/query，
 *   没有 team/ally 概念（"ally" 在整个 cards 目录只有 732 条的注释提及）。
 * - "within 3 points of the Victory Score" 需要当前 Victory Score（194.3/194.3.a），ResolveContext 的
 *   PlayerSnapshot 只暴露各自 score，没有 victoryScore；硬编码 8 就是臆造（同 ogn/find-your-center）。
 * - "your Gold [Add] an additional :rb_energy_1:" 是改写在先资源能力产出上的条件持续效果：需要把
 *   [Add] 的产出量按持有者与条件改写。既没有 continuous-effect 的"资源产出加成"图层/谓词，也没有把
 *   CardProgram 的 static 能力注册进 LayerEngine 的路径（同 ogn/darius-executioner），且 :rb_rune_rainbow:
 *   这类 [A] 的 Universal Power 在六域封闭集合下不可表达（163.2.b）——本卡只加 1 Energy，不受该条限制。
 * 依赖：费用计划的触发点接线、modify-resource-ability 的图层读者与持续效果形状，以及 legend-zone、
 * Victory Score 读数、Teammate(ally) 关系、Gold token 定义与入场状态表达的契约补充。
 * golden 测试用解释器 + 参考内核真实执行已合入的 effect.token 部分形状（把 Gold 定义与 base 占位换成
 * 可执行值）与费用计划的 exhaust 收费；这些都不是整卡证据。
 * 不近似实现（不用另一个 token 定义冒充 Gold，不硬编码 8 分，不把 ally 当成自己）。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    // "When you or an ally hold"：383.4.d.1 的 Hold Effect；"you" = 能力控制者。
    // 事件词汇用 "held"：时点 hold 事件名在 TriggerSpec 词汇表里就是 held
    // （events/pipeline-match 的 EVENT_NAMES 把 hold 映射到 held），写 "hold"
    // 会被 registerTrigger 的 assertTriggerSpec 拒绝。
    // "an ally"（491.8.e 的 Teammate）没有已合入的关系读法，见 judgeReason。
    trigger: { at: "hold", filter: { event: "held", player: "self" } },
    optional: true,
    body: [
      {
        id: "chem-baroness.may-play-gold",
        op: "choice.optional",
        args: {
          prompt: {
            kind: "constant",
            value: "Exhaust Chem-Baroness to play a Gold gear token exhausted?"
          },
          body: {
            kind: "constant",
            value: [
              {
                // "exhaust me"：740.4.a.2 的费用在 Finalization 支付（415.4/415.5）；
                // 形状是费用计划，不是 effect.exhaust 的状态改变。
                id: "chem-baroness.pay-exhaust",
                op: "cost.pay",
                args: {
                  payments: {
                    kind: "constant",
                    value: [{ kind: "exhaust", object: "self" }]
                  }
                }
              },
              {
                // "play a Gold gear token exhausted"：187.5 的 Gold 定义 + 440.2.c/185.2.a 的
                // 链上生成后打出 + 185.2.d/143.4 的入场状态。Gold 不在冻结的 token 定义表里，
                // "exhausted" 入场状态也不被 create-token 支持（见 judgeReason）。
                id: "chem-baroness.play-gold",
                op: "effect.token",
                linkedTo: "chem-baroness.pay-exhaust",
                args: {
                  token: { kind: "constant", value: "gold" },
                  amount: { kind: "constant", value: 1 },
                  mode: { kind: "constant", value: "play" },
                  // 打印的 "exhausted" 是 185.2.d/143.4 的入场状态规定；effect.token 的
                  // argsSchema 没有该参数（Entry overrides are not supported），故不写进 args，
                  // 见 judgeReason。
                  linkKey: { kind: "constant", value: "goldToken" }
                }
              }
            ]
          }
        }
      }
    ]
  },
  {
    kind: "static",
    // "While your score is within 3 points of the Victory Score, your Gold [Add] an additional :rb_energy_1:."
    // 364.x 的条件 Passive Ability；条件与效果都还不可执行，见 judgeReason。
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "your-score-within-3-of-victory-score" }
    },
    effect: {
      kind: "modify-resource-ability",
      // "your Gold"：由你控制、印刷名为 Gold 的 gear token（187.5）。
      filter: {
        type: "gear",
        controller: "controller",
        zone: "board",
        characteristics: { name: "Gold" }
      },
      // "[Add] an additional :rb_energy_1:"：在 [Add] 的产出上再加 1 Energy（430.1）。
      resource: "energy",
      amount: { kind: "constant", value: 1 }
    }
  }
];

const program = {
  canonicalCardId: "card.hash-db953801bed05d82fb44e885fa9fb48eee8dd92368d3933f1b858ca4c05c67e5",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "按 2026-10-17 源码逐条复核，仍缺六项，均不近似实现。" +
    "（1）Gold token 定义缺失：187.5 的 Gold 是带自身能力的 gear token（\"[Reaction][>] Kill this, [E]: [Add] [A].\"），" +
    "effect.token 的冻结定义表按设计保持 blocked/judge-required，表内只有 recruit/sand-soldier/mech/reflection/tentacle，" +
    "实测该原语对 gold 返回 negated + blockedReason \"token-definition-or-abilities-judge-required\"；" +
    "（2）「exhausted」是 143.4/185.2.d 的入场状态规定，但合并的 create-token 明确不支持入场改写（effect.token：Entry overrides are not supported），" +
    "argsSchema 对 entersExhausted 抛 TypeError，事后补 effect.exhaust 不等价（会多产生一次「成为横置」事件并错过入场替代）；" +
    "（3）费用式「exhaust me」（415.4/415.5）依赖 legend-zone 表达（契约 3.6 的 ZoneId 无 Legend Zone，CR 108.3）；" +
    "cost.pay 原语已注册，但其 payments 参数只接受 { energy, power, xp } 形状，本卡声明的裸数组 " +
    "[{ kind: \"exhaust\", object: \"self\" }] 会被 paymentsPlan 拒绝（CostPlanError cannot-pay-cost）——" +
    "buildCostPlan/payCostPlan 已能支付直接构造的 exhaust 计划（见 golden），缺的是 cost.pay 对非资源支付数组的解包与触发点接线；" +
    "（4）「an ally」是 491.8.e 的 Teammate 关系（740.1.a 的 friendly 含 teammates），ResolveContext 没有队友关系读法，无法把队友的 Hold 与自己的 Hold 合并判定；" +
    "（5）「within 3 points of the Victory Score」需要当前 Victory Score（194.3/194.3.a，默认可被游戏模式改），ResolveContext 只暴露各自 score、没有 victoryScore，硬编码 8 就是臆造；" +
    "（6）「your Gold [Add] an additional :rb_energy_1:」是改写 [Add] 产出的条件持续效果：programs/statics.ts 的 layerFor 对 " +
    "modify-resource-ability 没有映射，绑定会抛 ProgramBindingError（static ability kind has no layer mapping），" +
    "也没有资源产出加成的持续效果形状。" +
    "复核记录：hold 时点的订阅词汇是 \"held\"（TriggerSpec 的 EVENT_PATTERN_TYPES 只接受 held，" +
    "events/pipeline-match.ts 的 EVENT_NAMES 把 hold 映射为 held），本卡已按该词汇声明，触发注册可达。" +
    "依赖：cost.pay 非资源支付数组形状、modify-resource-ability 图层读者，以及 legend-zone、Victory Score 读数、" +
    "Teammate(ally) 关系、Gold token 定义与入场状态的契约补充。不近似实现。",
  abilities,
  sourceText:
    "When you or an ally hold, you may exhaust me to play a Gold gear token exhausted.\n" +
    "While your score is within 3 points of the Victory Score, your Gold [Add] an additional :rb_energy_1:."
} satisfies CardProgram;

export default program;
