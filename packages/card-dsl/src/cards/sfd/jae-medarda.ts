import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Jae Medarda (sfd-142-221) — Unit, Chaos, Noxus.
 * energy 5, power 2, Might 5.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-142-221，逐字）:
 *   "When you choose me with a spell, draw 1."
 *
 * 规则依据（CR v1.5）：
 * - 383.4.b / 383.4.b.1 / 383.4.b.2 / 383.4.b.3："When you choose me with a spell" 是
 *   Targeting Effect——条件是某个 Game Object 成为目标，在法术指定目标后作为 Pending Item 进链；
 *   355.6/E7 规定卡面的 "choose" 等于 Targeting。时点用封闭枚举的 became-target
 *   （events/timing-points.ts，ruleRefs 355.7/383.4.b）。
 * - "with a spell"：EventPattern.source 是法术（355.9 对 "spell" 的用法），写 source: { type: "spell" }。
 * - "me"：能力宿主，filter 的 target 锚点用符号选择器 "self"（契约 3.6 的对象锚点；参考已合入
 *   ogn/the-dreaming-tree 的 target 锚点写法），不写运行时 ObjectRef。
 * - "draw 1"：414.1 / 414.3，缺省抽牌者是能力控制者（"you"，190.6.d），已合入的 effect.draw
 *   只提交封闭的 draw GameAction。
 *
 * status 判定（cards/README.md 第 2 节）：executable。
 * - 触发送达：RIFT-257 的 programs/triggers.ts 把 CardProgram 的 triggered ability 注册为
 *   TriggerRegistration（attachProgramLifecycle 在 object-enters-board 时安装），became-target
 *   由 chain/engine.ts 的 TargetPlan Finalize 发出（355.6/355.7、383.4.b.2）。
 * - "me"：binding 把 self: true 译为 objectId 锚点（programs/filters.ts 的
 *   translateTriggerFilter），事件对象是本卡快照。
 * - "with a spell"：事件载荷的 source 是施法/启动来源对象的快照，EventPattern.source 的
 *   { type: "spell" } 经 events/pipeline-match.ts 的 matchesTriggerObject 按快照类型求值——
 *   法术是链上的 spell（133.3.a），unit/gear 的打出与启动能力都不匹配。
 * - "you"：383.4.b.1 的 "When you choose me" 与 190.6.d 的隐含控制者一致，用
 *   player: "self"（事件 player === 触发控制者）表达。
 * - "draw 1"：414.1/414.3 的 effect.draw（缺省抽牌者是能力控制者）。
 * 执行证据：golden 在真实 ChainEngine + EventPipeline 上注册本卡触发，A 的法术选择本卡时
 * 抽 1；B 的法术与 A 的启动能力选择本卡时不触发（合规负例，不是近似）。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "became-target",
      filter: {
        event: "became-target",
        // 355.7 / 383.4.b：条件是"我成为目标"；binding 把 self: true 译为
        // objectId 锚点（programs/filters.ts 的 translateTriggerFilter）。
        self: true,
        // 383.4.b.3："with a spell" 判别事件来源快照的类型（spell 是链上对象，
        // 133.3.a：unit/gear 的打出与启动能力都不是 spell）。
        source: { type: "spell" },
        // 383.4.b.1 的 "you"：做出选择的是能力控制者（190.6.d）。
        player: "self"
      }
    },
    optional: false,
    body: [
      {
        // 414.3：抽 1；缺省抽牌者是能力控制者（190.6.d）。
        id: "jae-medarda.draw-1",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-41956626d8e2085aa462cfe2ee446c4b1d4f6fed16272a0a937256f92f5d68bb",
  rulesetVersion: "core-1.5" as const,
  status: "executable" as const,
  abilities,
  sourceText: "When you choose me with a spell, draw 1."
} satisfies CardProgram;

export default program;
