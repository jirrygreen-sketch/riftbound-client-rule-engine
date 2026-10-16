import type { CardProgram } from "../../ir/index.js";

/**
 * Malzahar, Fanatic (ogn-113-298) — Unit, 4 energy, Might 3，
 * 标签 Malzahar / The Void / Champion。
 *
 * 原文：Kill a friendly unit or gear, :rb_exhaust:: [Action] —
 *      [Add] :rb_rune_rainbow::rb_rune_rainbow:. (Use on your turn or in
 *      showdowns. Abilities that add resources can't be reacted to.)
 *
 * 规则依据（CR v1.5）：
 * - 启动能力：196.1 的"[cost]: [effect]"格式；本卡的费用是
 *   "Kill a friendly unit or gear" 加上 （横置符号，表示 Exhaust this，135.2.e.2 / 415.5）。
 * - 355.10.c / 355.10.c.1："[do X] to [do Y]" 里的 X 是 cost within instructions，
 *   "Kill a friendly unit or gear" 因此不是目标选择（不产生“成为目标”触发）。
 * - [Action]：806 的速度关键词；在本卡它是 printed 的 [Action] 提示文本 →
 *   { kind: "keyword", keyword: "action" }（对照 void-seeker 的处理）。
 * - [Add]：430，资源加入 Rune Pool；430.4.a 说明 Add 是有限动作。
 *   430.1<br>430.5："Add [one or more resources]." 315.2.e.5 / 163.2.b 的
 *   :rb_rune_rainbow: = Power of any Domain（[A]，Universal Power）。
 *
 * 状态：judge-required。已合入的启动能力 cost / action 关键词 / effect.resources
 * 能表达大部分骨架，但 Universal Power 在契约层不可表示：
 * - 163.2.b 的 Universal Power 不在封闭 Domain 联合
 *   ("Fury" | "Calm" | "Mind" | "Body" | "Chaos" | "Order") 内；
 *   effect.resources 文档明确写着“Universal Power (163.2.b) is not representable by
 *   the closed Domain type / gain-power action. It remains unsupported, never
 *   approximated by a chosen domain.”（对应实现会 negated impossible）。
 *   因此不能把 [A][A] 近似成任一具体域的两点 Power。
 * - 费用侧的 "Kill a friendly unit or gear" 是 cost.sacrifice 型非标准费用：
 *   费用管线（cost/kill 支付动作）尚未合入（RIFT-89），且“unit or gear”的
 *   二选一费用需要费用选择器支持。
 *
 * 依赖：契约变更（Domain 增补 Universal / 或新增 gain-universal-power 动作）+ 
 * RIFT-89（非标准费用收取）。
 */
const malzaharFanatic = {
  canonicalCardId: "card.hash-0821b41b5d117a852897d54edb6109cc048ab5637104799b63924d6edb073ee4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Add] :rb_rune_rainbow::rb_rune_rainbow: 是 CR v1.5 163.2.b / 135.2.e.5 的 Universal Power（[A]），" +
    "但契约的封闭 Domain 类型只有六个命名域；effect.resources 文档明确 Universal Power 不可表示" +
    "（never approximated by a chosen domain，实现会 negated impossible），不得近似成任一具体域。" +
    "费用侧「Kill a friendly unit or gear」（355.10.c 的 cost within instructions）属 cost.sacrifice 型非标准费用，" +
    "费用管线的收取与二选一费用选择尚未合入（RIFT-89）。" +
    "依赖：契约变更（Domain 增补 Universal 或新增 gain-universal-power 动作）+ RIFT-89（非标准费用收取）。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "activated",
      cost: {
        kind: "activated",
        payments: [
          {
            // 355.10.c.1 / 415.5："Kill a friendly unit or gear" + exhaust self。
            kind: "kill",
            choice: {
              id: "malzahar.fodder",
              options: ["friendly-unit-or-gear"],
              min: 1,
              max: 1,
              selection: "one",
              zone: "board",
              type: ["unit", "gear"],
              owner: "controller"
            }
          },
          { kind: "exhaust" }
        ]
      },
      timing: "action",
      body: [
        {
          id: "malzahar.add-universal",
          op: "effect.resources",
          args: {
            // 163.2.b：两点 Universal Power。封闭 Domain 类型无 Universal，
            // 保留原文形状，等待契约变更；绝不写成具体域名。
            power: { kind: "constant", value: ["Universal", "Universal"] }
          }
        }
      ]
    }
  ],
  sourceText:
    "Kill a friendly unit or gear, :rb_exhaust:: [Action] — [Add] :rb_rune_rainbow::rb_rune_rainbow:. " +
    "(Use on your turn or in showdowns. Abilities that add resources can't be reacted to.)"
} satisfies CardProgram;

export default malzaharFanatic;
