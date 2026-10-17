import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Solari Shrine (ogn-072-298) — Gear, 3 Energy, Calm.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-072-298):
 *   When you kill a stunned enemy unit, you may exhaust this to draw 1.
 *
 * 规则依据（CR v1.5）：
 * - “When you kill a stunned enemy unit …” 是触发能力（383.1/383.2），触发事件是击杀
 *   （429：Kill 让永久物从 Board 进入 Trash；时点 object-killed，ruleRefs 429.1）。
 *   “enemy unit” 按 740.1.b 是敌方单位；“stunned” 是 424.1.a 的二元状态
 *   （424.1.a.1 已 Stunned 的单位不能再次被 Stun），“被消灭时仍是 stunned” 属于离场前的
 *   最后已知信息，触发筛选在换区前判定（383.2.c.3.b，时点载荷携带换区前的对象快照）。
 *   触发条件里的 “you”（429.5.c.1 的击杀归因）是目前无法表达的部分，见 status 说明。
 * - “you may exhaust this to draw 1” 是可选触发（“you may”）：拒绝时整条触发不结算。
 *   按契约 3.9，把这句写成 choice.optional，把被选的指令（横置自身 + 抽 1）包进 body，
 *   不用 choice + linkedTo 的旧写法。
 * - “exhaust this” 是效果里的横置（415.1；415.3 说明这是 Limited Action，与费用式横置
 *   415.3.a 分开，因此这里用效果原语 effect.exhaust 而不是费用支付）；目标就是本卡自身，
 *   用契约 3.6 的符号选择器引用（filter { object: "self" }，宿主引用由解释器在运行时绑定）。
 * - “draw 1” 是 effect.draw（414.3），抽牌者是能力控制者（190.6.d 的隐含 “you”）；
 *   按 359.3.e.11 横置失败/被替代时抽牌指令仍尽可能执行，但本卡写明“exhaust this to draw 1”，
 *   因此抽牌与横置是同一可选分支里的两条指令、按顺序结算（linkedTo 用来让横置被 ignored 时
 *   不再抽牌，符合 “do X to do Y” 的成本语义：740.4.a.1 说明指令内成本不支付就拿不到效果）。
 *
 * status = judge-required：
 * - 「you kill」的击杀归因（429.5.c.1：击杀归因于包含 Kill 指令的效果及其控制者）没有进入
 *   可触发的时点载荷：events/timing-points.ts 的 object-killed 是 payloadType "object" 且未列
 *   任何 payloadFields；引擎适配器（events/action-adapter.ts）对 kill 动作把事件 player 记为
 *   被消灭对象的控制者，恰好与“你消灭”相反。因此在 filter 里写 player: "self" 会把语义弄反，
 *   写别的方式又会发明不存在的字段，触发条件无法在现有管线里诚实落地。
 * - 触发与其余效果本身都有已合入实现：object-killed 时点 + 敌方 stunned 单位过滤（383.2.c.3.b
 *   的最后已知信息）、可选分支（choice.optional）、效果横置（effect.exhaust）与抽牌
 *   （effect.draw）。golden 测试用解释器 + 参考内核真实执行可选分支的两种选择与失效边界。
 * 依赖：事件载荷补齐“包含 Kill 指令的效果及其控制者”这一击杀归因字段后复核。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "object-killed",
      filter: {
        event: "object-killed",
        // “a stunned enemy unit”：敌方单位（740.1.b），且被消灭时是 stunned（424.1.a）；
        // 离场前的状态由事件载荷给出（383.2.c.3.b 的最后已知信息）。
        // “you kill” 的归因（429.5.c.1）在此未声明：现有载荷没有该字段（见 status 说明），
        // 用 player: "self" 会把归因误读成“被消灭单位的控制者是你”。
        object: { type: "unit", controller: "opponent", states: "stunned" }
      }
    },
    optional: true,
    body: [
      {
        id: "solari-shrine.exhaust-opt",
        // “you may exhaust this to draw 1” — 可选执行（契约 3.9：choice.optional 把被选指令
        // 包进 body；拒绝则本条 negated(skipped)，后续指令照常）。
        op: "choice.optional",
        args: {
          prompt: {
            kind: "constant",
            value: "Exhaust Solari Shrine to draw 1?"
          },
          body: {
            kind: "constant",
            value: [
              {
                id: "solari-shrine.exhaust-self",
                // “exhaust this” — 效果式横置（415.1）；目标是本卡自身
                // （契约 3.6 的 filter 锚点 object: "self"，不写运行时 ObjectRef）。
                op: "effect.exhaust",
                args: {
                  target: { kind: "constant", value: "solari-shrine.this" }
                },
                targets: [
                  {
                    id: "solari-shrine.this",
                    filter: { object: "self", type: "gear" },
                    min: 1,
                    max: 1,
                    selection: "one"
                  }
                ]
              },
              {
                id: "solari-shrine.draw",
                // “to draw 1” — 740.4.a 的指令内成本语义：横置被 ignored/negated 时
                // 不再继续抽牌（linkedTo 传播）。
                op: "effect.draw",
                linkedTo: "solari-shrine.exhaust-self",
                args: { amount: { kind: "constant", value: 1 } }
              }
            ]
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-3f69a145be4d251c39abc78150e49fb2f5cf77555f18e1d30c3814c595b0f3f1",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「you kill」的击杀归因无法表达：CR v1.5 429.5.c.1 把击杀归因于包含 Kill 指令的效果及其" +
    "控制者，但 events/timing-points.ts 的 object-killed 载荷是 payloadType \"object\" 且 payloadFields 未声明，" +
    "events/action-adapter.ts 对 kill 动作把事件 player 记为被消灭对象的控制者" +
    "（与“你消灭”相反），因此 filter 里既不能写 player: \"self\"（语义会反），也不能假定不存在的" +
    "归因字段。触发点、敌方 stunned 单位过滤（含 383.2.c.3.b 的最后已知信息）、可选分支" +
    "（choice.optional）、效果横置（effect.exhaust）与抽牌（effect.draw）本身都已合入并由 golden" +
    "真实执行。依赖：object-killed 载荷补齐击杀归因字段。",
  abilities,
  sourceText: "When you kill a stunned enemy unit, you may exhaust this to draw 1."
} satisfies CardProgram;

export default program;
