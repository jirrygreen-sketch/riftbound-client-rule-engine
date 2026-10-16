import type { CardProgram } from "../../ir/index.js";

/**
 * Shadow's Call (unl-165-219) — Spell, 2 energy, no printed power, Order.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-165-219，逐字):
 *   Choose a friendly unit without [Temporary]. Give it [Temporary]. Draw 2.
 *   (Kill it at the start of its controller's Beginning Phase, before scoring.)
 *
 * 规则依据（CR v1.5）:
 * - 没有 [Action]/[Reaction] 印刷线：按 159.2.a 默认 Action 时机。
 * - 「Choose a friendly unit」是 Choice（355.5 / 355.7），所以该单位是一个目标
 *   （TargetSpec），不是 pick；「friendly」由 controller 锚点表达。
 * - 「without [Temporary]」是 355.9.b 的目标限制：816.3 说明「是否具有 Temporary」
 *   是永久的特征，可被其它游戏效果检查/引用。该限制需要读取当前关键词特征。
 * - 「Give it [Temporary]」是向对象授予一个关键词特征。按 cards/README 第 5 节，
 *   关键词只声明、不重写展开；816.1.a/b 规定 Temporary 的功能等价于
 *   「在此永久控制者的 Beginning Phase 开始时、计分前，消灭它」（816.1.c 触发条件）。
 * - 「Draw 2」是已合入的 effect.draw（414.1/414.3），与授予半段是两句独立文本，
 *   故不写 linkedTo（055 / 359.3.e.11：能做什么做什么）。
 * - 括号内是 Temporary 的规则释义，不是本卡的额外指令。
 *
 * status: judge-required —— 两处依赖未合入，均不近似实现:
 * - 没有「向对象授予关键词」的已合入原语：keywords/ 无 Temporary 定义
 *   （ability-templates.md 的 kw-temporary，24 处引用、高优先级未实现），
 *   effects/instructions 也没有 continuous.grant-keyword 的卡牌指令（RIFT-91），
 *   本文件沿用同批次已合入程序（ogn/fading-memories、sfd/gem-jammer）的写法声明形状。
 * - Temporary 的展开本体（816.1.b 在 beginning-start 注册延迟消灭触发）没有已合入路径；
 *   在卡内手写会重复关键词展开（README 第 5 节禁止）。
 * - 「without [Temporary]」的目标限制需要读取关键词特征（816.3）；冻结 ObjectFilter
 *   没有关键词键，未知键会被静默忽略。
 * 「Draw 2」半段用已合入的 effect.draw 并在 golden 中真实执行。
 *
 * 依赖：kw-temporary 关键词（RIFT-83 关键词批次）、RIFT-91（continuous.grant-keyword 图层）、
 * 关键词特征过滤谓词。无契约变更请求。
 */
const program = {
  canonicalCardId: "card.hash-20160abc2cd3adac87c1b0f03192e12ab9103b22ffbd5a8468e4072e00264025",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处依赖未合入：(1)「Give it [Temporary]」需要「向对象授予关键词」的已合入路径：keywords/ 没有 Temporary 定义" +
    "（ability-templates.md 的 kw-temporary 未实现），effects/instructions 也没有 continuous.grant-keyword 卡牌指令" +
    "（图层消费方归 RIFT-91）；Temporary 本体（816.1.b/816.1.c：控制者 Beginning Phase 开始时、计分前消灭它）" +
    "需要在 beginning-start 注册延迟触发，同样无已合入路径，卡内手写会重复关键词展开（cards/README 第 5 节）。" +
    "(2)「without [Temporary]」是 355.9.b 的目标限制、依 816.3 读取当前关键词特征，冻结 ObjectFilter 没有关键词键，" +
    "未知键会被 layers/filter.ts 与测试内核静默忽略，不得当作已实现的限制。" +
    "「Draw 2」（414.1/414.3）只用已合入的 effect.draw，并在 golden 中真实执行。不近似实现。",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 }
      },
      body: [
        {
          // 「Give it [Temporary]」——按关键词授予的连续效果形状记录意图；
          // 没有已注册的授予指令与 Temporary 关键词（见 judgeReason）。
          id: "shadows-call.grant-temporary",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Temporary" }
          },
          targets: [
            {
              id: "shadows-call.friendly-unit",
              // 「without [Temporary]」是描述性限制（816.3）；没有消费方读取该键。
              filter: {
                type: "unit",
                zone: "board",
                controller: "controller",
                withoutKeyword: "Temporary"
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // 「Draw 2」——414.1/414.3，独立句子，不链接到授予半段。
          id: "shadows-call.draw",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 2 } }
        }
      ]
    }
  ],
  sourceText:
    "Choose a friendly unit without [Temporary]. Give it [Temporary]. Draw 2. (Kill it at the start of its controller's Beginning Phase, before scoring.)"
} satisfies CardProgram;

export default program;

