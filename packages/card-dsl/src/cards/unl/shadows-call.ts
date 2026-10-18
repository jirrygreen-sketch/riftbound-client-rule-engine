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
 * 2026-10-18 复核：整卡仍为 judge-required；当前生产缺口见 judgeReason。
 * 已支持子效果的执行证据保留在对应 golden；不以原语存在替代整卡可执行性。
 */
const program = {
  canonicalCardId: "card.hash-20160abc2cd3adac87c1b0f03192e12ab9103b22ffbd5a8468e4072e00264025",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "当前缺口：(1) without [Temporary] 需要实时关键词特征过滤，programs/filters.ts 不接受 withoutKeyword，无法在 Finalize/Resolve 严格限制目标（CR 355.9.b/816.3）。" +
    "(2) continuous.grant-keyword 新授予 Temporary 后缺 beginning-start 订阅刷新；chain/ 的 addContinuous 只更新图层并请求 cleanup，默认 programs/lifecycle.ts 只在进区时注册；" +
    "KeywordGrantLayerEngine 虽已支持静态关键词重展开，对 Temporary 的动态 triggered 展开仍 fail-closed（816.1.b/816.1.c）。Temporary 定义、一般触发绑定与 effect.draw 已存在。",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 }
      },
      body: [
        {
          // 「Give it [Temporary]」——按已合入的 continuous.grant-keyword 声明；
          // 选择用 objects 的契约 3.6 符号选择器指向本卡的 TargetSpec（355.10.c 的 "it"），
          // 由解释器在运行时绑定；新授予关键词的触发订阅仍需刷新（见 judgeReason）。
          id: "shadows-call.grant-temporary",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Temporary" },
            objects: {
              kind: "constant",
              value: { kind: "target", id: "shadows-call.friendly-unit" }
            }
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

