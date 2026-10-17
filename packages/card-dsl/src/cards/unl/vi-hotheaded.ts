import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Vi, Hotheaded (unl-030-219) — Unit, 4 energy, no printed power, Might 3,
 * Fury, tags Vi/Zaun/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-030-219，逐字）：
 *   [Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell
 *   or ability.)
 *   :rb_energy_2::rb_rune_fury:: Double my Might this turn.
 *
 * 规则依据（CR v1.5）：
 * - [Deflect]（809.1.b.3）：省略数值时 Deflect Value 为 1（本卡印刷 [Deflect] 无数字）；
 *   809.1.c / 809.1.c.1 让对手用法术/能力选择我时额外支付相应数量的 [A]。只声明 keyword（契约 3.7），
 *   展开（target.tax 静态效果）由 effects/keywords/Deflect.ts 负责。
 * - 377.1 / 404.1.a / 415.5：“:” 之前是费用——2 Energy 加 1 点 Fury Power；
 *   合并费用管线（cost/plan-values.ts、cost/payment.ts）真实支持该组合。
 * - 381 / 381.1：印刷没有 [Action] 或 [Reaction]，启动能力在控制者回合的 Open State 以默认 Action
 *   速度启动，因此 timing = "action"。
 * - 433.1 / 433.1.a：Doubling 是把数值属性按该属性当前值增加同量，并按该效果指定的期限生效；
 *   433.1.a 的示例正是 “Double a friendly unit's Might this turn.”。所以数额写成结算时读取来源
 *   当前 Might 的 object-property 表达式，期限 this turn（143.2.a 的 Might 指有效 Might；
 *   475/478 的算术层与期限）。“my Might” 是自我指称（355.10.g），不是目标，因此不写 TargetSpec，
 *   也不使用 target 参数。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，一处缺口不近似实现：
 * - Doubling 本体已可执行：RIFT-258 合入的 continuous.might 原语按 478 在 arithmetic 图层注册
 *   Might 修正，duration "this-turn" 映射 end-of-turn 到期（317.1.a / 468.7.c）。433.1 / 433.1.a
 *   要求增量等于“结算时该属性的当前值”（含图层结果），因此先由已合入的 condition.value 绑定原语
 *   读出 source.might（解释器经 ObjectSelector "self" 绑定运行时引用；链上解析走 layers.evaluate，
 *   读到的就是当前 Might），再以 linked-value 作为 continuous.might 的 amount。golden 用真实
 *   解释器 + 图层引擎执行并断言“当前值 4 → +4 → 有效 Might 8”。
 * - [Deflect]（809.1.b.3 省略数值时按 1；809.1.c 对手用法术/能力选择我时额外支付 [A]）仍不可执行：
 *   已合入的 effects/keywords/Deflect.ts 只展开成 target.tax 图层声明，没有任何已合入消费方——链的
 *   Finalize（chain/engine.ts）只接受调用方经 TargetFinalizeOptions.tax / taxAdapter 传入的税，
 *   TargetPlan 不读取图层里的 target.tax，且没有卡牌关键词展开→layers 的生产注册路径（programs/
 *   statics.ts 只有默认 noop 的 binder 钩子）。依赖：RIFT-90（target tax 接线）与 layers 注册路径。
 * 已合入并可真实执行的部分（golden 覆盖）：2 Energy + 1 Fury Power 的印刷费用与上面的 Doubling。
 */
const abilities: Ability[] = [
  // 809.1.b.3：印刷的 [Deflect] 省略数值，Deflect Value 按 1 处理（省略 value）。
  { kind: "keyword", keyword: "deflect" },
  {
    kind: "activated",
    timing: "action",
    cost: {
      kind: "activated",
      energy: { kind: "constant", value: 2 },
      power: { kind: "constant", value: ["Fury"] }
    },
    body: [
      {
        id: "vi-hotheaded.read-might",
        // 433.1 / 433.1.a：Doubling 读取“该属性当前值”；在结算时读出 source 的 Might（含图层
        // 结果）并链接，供下一条指令作为增量使用。condition.value 是已合入的绑定原语。
        op: "condition.value",
        args: {
          value: { kind: "object-property", object: "self", property: "might" },
          key: { kind: "constant", value: "might" }
        }
      },
      {
        id: "vi-hotheaded.double-might",
        // 433.1.a：把 433.1 读到的当前 Might 追加为同量修正，期限由本效果指定（this turn；
        // 478.1.a arithmetic 图层，continuous.might 的 end-of-turn 到期）。
        op: "continuous.might",
        args: {
          mode: { kind: "constant", value: "add" },
          amount: {
            kind: "linked-value",
            instructionId: "vi-hotheaded.read-might",
            key: "might"
          },
          duration: { kind: "constant", value: "this-turn" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-8cb7905705a7f0e4995a084c0d8fa96d23d5387f51a0294a9e8cdc4250cb4b83",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「Double my Might this turn.」已可执行：433.1/433.1.a 的增量取结算时该属性的当前值，程序用已合入的 " +
    "condition.value 绑定 source.might，再由 continuous.might（RIFT-258）以 linked-value 作为 amount 在 " +
    "arithmetic 图层注册本回合（duration \"this-turn\" → end-of-turn 到期，317.1.a/468.7.c）的 Might 修正；" +
    "golden 用真实解释器 + 图层引擎断言当前值 4 → 有效 Might 8。" +
    "整卡仍不可执行：[Deflect]（809.1.b.3 省略数值按 1；809.1.c 对手用法术/能力选择我时额外支付 [A]）" +
    "只有 effects/keywords/Deflect.ts 展开的 target.tax 图层声明，没有消费方——链的 Finalize 只接受调用方经 " +
    "TargetFinalizeOptions.tax / taxAdapter 传入的税（chain/engine.ts），TargetPlan 不读取图层 target.tax，" +
    "也没有卡牌关键词展开 → layers 的生产注册路径（programs/statics.ts 只有默认 noop 的 binder 钩子）。" +
    "依赖：RIFT-90（target tax 接线）与 layers 注册路径（RIFT-91 后续/RIFT-257）。不近似实现。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    ":rb_energy_2::rb_rune_fury:: Double my Might this turn."
} satisfies CardProgram;

export default program;
