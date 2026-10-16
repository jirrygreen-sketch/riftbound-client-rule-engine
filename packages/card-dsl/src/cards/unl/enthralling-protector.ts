import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Enthralling Protector (unl-162-219) — Unit, Order, energy 2, Might 2,
 * tags Fae/Ionia.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-162-219，逐字）:
 *   "[Hunt] (When I conquer or hold, gain 1 XP.)\n"
 *   "Spend 2 XP: [Buff] me. (Give me a +1 :rb_might: buff if I don't have one.)"
 *
 * 规则依据（CR v1.5）:
 * - [Hunt]（823）：Triggered Ability 关键词，823.1.c.1 功能上等于 "When I
 *   Conquer or Hold, my controller gains X XP"，823.1.c.2 规定省略数值为 1，
 *   823.2 规定多个 Hunt 相加。卡程序按契约 3.7 只声明
 *   { kind: "keyword", keyword: "hunt" }（无数值→省略 value）；展开由已合入的
 *   effects/keywords/Hunt.ts 负责（conquer/hold 两个触发 + effect.xp）。
 * - "Spend 2 XP: [Buff] me."：404.1.a 规定冒号前是启动式能力的 Base Cost；
 *   205 明确"让玩家支付资源/XP 的指令"只有在后面还有 Linked Effect 时才算费用，
 *   本卡的 Linked Effect 是 "[Buff] me"，因此 2 XP 是启动费用（415.5 的横置
 *   符号同族的费用符号），用已合入费用计划支持的 { kind: "xp", amount } 支付
 *   （cost/plan-values.ts 的 xp 分支 → pay 计划里的 spend-xp 动作）。
 * - "[Buff] me"：427.1 / 702.2.a 把 Buff counter 放到单位上；702.3 / 702.3.a
 *   规定同一单位同时只能有一个 Buff，已有 Buff 时再次 Buff 什么也不发生；
 *   用已合入的 effect.buff mode "buff"，宿主用契约 3.6 符号选择器 object:
 *   "self" 指称（不是目标选择，355.10.c；括号内是 702/703 的提示文字）。
 * - 145.2：单位的启动式能力在控制者 Main Phase 的 Open State 执行，本卡没有
 *   [Reaction]，按默认 action 时机声明。
 *
 * status = executable：Hunt 展开（RIFT-265）与 effect.xp / effect.buff / XP 费用
 * 都已合入；golden 用真实费用管线支付 2 XP、用解释器 + 参考内核执行 body
 * （含已有 Buff 的 no-op 边界）。打成启动式能力的 CardProgram → ChainDraft 适配
 * 属横切未集成项（RIFT-120 后继），与已合入的 sfd/assembly-rig 同口径记 test.todo。
 */
const MYSELF = "enthralling-protector.self";

const abilities: Ability[] = [
  { kind: "keyword", keyword: "hunt" },
  {
    kind: "activated",
    timing: "action",
    // 404.1.a / 205："Spend 2 XP:" 是 Base Cost，后面的 [Buff] me 是 Linked Effect。
    cost: {
      kind: "activated",
      payments: [{ kind: "xp", amount: { kind: "constant", value: 2 } }]
    },
    body: [
      {
        id: "enthralling-protector.buff-me",
        op: "effect.buff",
        args: {
          mode: { kind: "constant", value: "buff" },
          target: { kind: "constant", value: MYSELF }
        },
        targets: [
          {
            id: MYSELF,
            // 427.1 / 702.2.a："me" 是本卡自身；object: "self" 是契约 3.6 的
            // 符号锚点，由解释器绑定宿主引用。
            filter: { type: "unit", object: "self" },
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
  canonicalCardId:
    "card.hash-3c81d27035052bbf066d3d86c77c616e488c8b32a943ecf5eb24842c9c273080",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities,
  sourceText:
    "[Hunt] (When I conquer or hold, gain 1 XP.)\n" +
    "Spend 2 XP: [Buff] me. (Give me a +1 :rb_might: buff if I don't have one.)"
} satisfies CardProgram;

export default program;
