import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Suave Negotiator (rad-099-167) — Unit, 3 energy, Might 3, Chaos。
 *
 * 原文（packages/card-data/data/deck-catalog.json，sourceText 逐字）：
 *   When you play me, choose an opponent. You and that player each draw 1.
 *
 * 规则依据（CR v1.5）：
 * - "When you play me"：card-played（383.4.a；时点由 chain/engine.ts 产生，RIFT-270 审计），
 *   filter 指向自身。
 * - "choose an opponent"：选择一名玩家。CR 355.7/355.9.a 把"玩家"列为可选目标
 *   （"a player or zone"），且 355.10 的豁免都不适用（对手不在非公开区域、不属费用/
 *   触发条件/替代、不是纯程序化集合），所以这是**玩家选择**；契约 3.6 的
 *   `targets()` 只返回 ObjectRef[]，没有玩家目标形状，因此这里用非目标 pick
 *   （ctx.picks() 允许 PlayerId）表达，并声明动态选项集（选项由 Finalize 按对手集合
 *   解析，静态 IR 无法列出玩家 id）。
 * - "You and that player each draw 1"：414.1/414.3 的 Draw 1。己方抽牌省略 player
 *   （190.6.d 的 "you" 默认 ctx.controller）；"that player" 用 effect.draw 的 pick 参数
 *   读取同一 pick 的 PlayerId，由内核按 355.10.e（由其他玩家参与选定的集合）确认非目标。
 *
 * status = judge-required：effect.draw 与 card-played 时点已合入，golden 用解释器 +
 * 参考内核真实执行「双方各抽 1」（pick 由测试内核 provision），但整卡仍不能执行：
 * - 「把对手集合解析为 PlayerId 并在 Finalize 锁定」没有已合入实现：ChoiceRequest 只有
 *   optional / mode / select-objects / order / number，契约 3.6 的 targets() 只返回
 *   ObjectRef[]，没有玩家目标/玩家选择形状；玩家选择的生产路径属未完成的卡牌程序绑定
 *   （RIFT-257）与目标系统。
 * 依赖：玩家目标/选择（target.player 或 choice 扩展）与 RIFT-257；
 * 附带契约变更请求：请为玩家目标/玩家 pick 增补 EffectIR 形状。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "suave-negotiator.draw-self",
        // "You … draw 1"（190.6.d 的隐含 you = 能力控制者；effect.draw 缺省即此）。
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      },
      {
        // "choose an opponent" 与 "that player … draw 1" 共用一个非目标 pick：
        // 355.10.e 的 pick（由玩家参与选定、非目标）不触发"成为目标"，选项是当前
        // 对手玩家（PlayerId），由 Finalize 解析后经 ctx.picks 读取并成为抽牌者。
        id: "suave-negotiator.draw-opponent",
        op: "effect.draw",
        args: {
          amount: { kind: "constant", value: 1 },
          pick: { kind: "constant", value: "suave-negotiator.chosen-player" }
        },
        picks: [
          {
            id: "suave-negotiator.chosen-player",
            options: ["dynamic:opponent-players"],
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-e7d215ccfa0f015b2ba252effc317eb2e2c19280d7d01a4eb41aba1ea8340507",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「choose an opponent」是玩家选择（CR v1.5 355.7/355.9.a：玩家可以是目标；355.10 的豁免都不适用），" +
    "但契约 3.6 的 `targets()` 只返回 ObjectRef[]，没有玩家目标形状；ChoiceRequest 也没有选择玩家的请求类型" +
    "（只有 optional/mode/select-objects/order/number），所以「把对手集合解析为 PlayerId 并在 Finalize 锁定」" +
    "没有已合入实现，生产接线属未完成的卡牌程序绑定（RIFT-257）。这里用非目标 pick（ctx.picks() 允许 PlayerId）" +
    "+ 动态选项标记保留可审查结构；effect.draw 的 player/pick 与「You draw 1」半段已合入并在 golden 测试中真实执行" +
    "（card-played 时点由 chain/engine.ts 产生，pick 绑定 PlayerId 的路径由测试内核 provision）。" +
    "依赖：玩家目标/选择（target.player 或 choice 扩展）与 RIFT-257。附带契约变更请求：请为玩家目标/玩家 pick 增补 EffectIR 形状。",
  abilities,
  sourceText: "When you play me, choose an opponent. You and that player each draw 1."
} satisfies CardProgram;

export default program;
