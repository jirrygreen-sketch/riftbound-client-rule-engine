import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Demacian Diplomat (unl-092-219) — Unit, 2 energy，无印刷力量，Might 2，Body，
 * 标签 Demacia。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-092-219，逐字）：
 *   When you play me, gain 1 XP.
 *
 * 规则依据（CR v1.5）：
 * - “When you play me”：383.4.a / 420.4.a 的 Play Effect，时点 card-played（封闭表），
 *   filter 用契约 3.6 的符号选择器 { source: "self" } 指称来源自身。
 * - “gain 1 XP”：728–730.1 的 XP 获得（增加该玩家标记的 XP 值）；729.2 规定 XP 是公开信息。
 *   隐式施动者 “you” 是能力控制者（190.6.d），effect.xp 缺省的获得者就是 ctx.controller。
 *   获得者的 XP 变化由已合入的 gain-xp GameAction 提交（effect.xp）。
 *
 * status = executable：触发结构（card-played + 自发 filter）与 effect.xp 都是已合入的契约形状，
 * golden 用链适配器 + 参考内核真实执行程序原始 body（gain-xp 动作、XP 数值、公开链接值、
 * 已弃用/否定的边界）。触发从真实链流程进链的端到端订阅（CardProgram → TriggerRegistration，
 * RIFT-120 后续）与其余已合入触发卡一样记录为 test.todo，不计入本卡的可执行性证据。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "demacian-diplomat.gain-xp",
        // 730.1：gain XP；缺省的获得者与控制者是能力控制者（190.6.d）。
        op: "effect.xp",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-c727b18bcfb5615a8de8a65c546fa6fce2e4ce6fdb7c500d823fd9db1853ef50",
  rulesetVersion: "core-1.5" as const,
  status: "executable" as const,
  abilities,
  sourceText: "When you play me, gain 1 XP."
} satisfies CardProgram;

export default program;
