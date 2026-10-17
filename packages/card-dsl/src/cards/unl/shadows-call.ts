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
 * - 授予原语与关键词定义都已合入：continuous.grant-keyword（RIFT-258，ability 图层注册）
 *   与 Temporary KeywordDef（RIFT-265，816.1.b 的 beginning-start 消灭触发）都在；
 *   golden 已用真实解释器执行授予指令，并用图层引擎读出被授予的 Temporary。
 *   仍缺的是「卡牌程序 → 关键词展开 → 时点/链」的生产接线（RIFT-257 的 programs/ 适配器
 *   没有运行时调用方），所以 816.1.b 的触发不会真的挂到时点上。
 * - 「without [Temporary]」的目标限制需要读取关键词特征（816.3）：冻结 ObjectFilter 没有
 *   关键词键，未知键会被 layers/filter.ts 与测试内核静默忽略（实测没有 Temporary 的单位与
 *   已有的单位都能通过同一 filter）。
 * 「Draw 2」半段用已合入的 effect.draw 并在 golden 中真实执行。
 *
 * 依赖：RIFT-257（卡牌程序绑定）、关键词特征过滤谓词。无契约变更请求。
 */
const program = {
  canonicalCardId: "card.hash-20160abc2cd3adac87c1b0f03192e12ab9103b22ffbd5a8468e4072e00264025",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处依赖未合入：(1) 授予原语与关键词定义都已合入——continuous.grant-keyword（RIFT-258）在 ability 图层注册关键词，" +
    "Temporary KeywordDef（RIFT-265）提供 816.1.b/816.1.c 的 beginning-start 消灭触发；golden 已用真实解释器执行授予指令，" +
    "并用图层引擎读出被授予的 Temporary。仍缺的是卡牌程序 → 关键词展开 → 时点/链的生产接线（RIFT-257 的 programs/ 适配器" +
    "没有运行时调用方），因此 816.1.b 的触发不会真的挂到时点上。" +
    "(2)「without [Temporary]」是 355.9.b 的目标限制、依 816.3 读取当前关键词特征，冻结 ObjectFilter 没有关键词键，" +
    "未知键会被 layers/filter.ts 与测试内核静默忽略（实测无 Temporary 与已有 Temporary 的单位都能通过同一 filter），" +
    "不得当作已实现的限制。" +
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
          // 「Give it [Temporary]」——按已合入的 continuous.grant-keyword（RIFT-258）声明；
          // 选择用 objects 的契约 3.6 符号选择器指向本卡的 TargetSpec（355.10.c 的 "it"），
          // 由解释器在运行时绑定。仍缺的是卡牌程序 → 关键词展开 → 时点/链的生产接线（见 judgeReason）。
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

