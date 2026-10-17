import type { CardProgram } from "../../ir/index.js";

/**
 * Vilemaw's Lair — CR v1.5 054.1, 053.3, 144.4.b, 358.3.a, 359.3.e.14.b.
 * Static binding and Standard Move rule queries are merged. Retain both the
 * snapshot and rules-query restriction spellings; effect Move still needs the
 * same production restriction consumer.
 */
export default {
  canonicalCardId: "card.hash-3e2d969f2528a782a98c698fc45d9937d376dd06244c444271adf9cbd4100e77",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "CR 054.1、358.3.a、359.3.e.14.b 的「Units can't move from here to base」仍缺效果移动消费：Standard Move 已读取 layers/rules/query.movement，但 ChainEngine 的 move-location 执行路径与 effect.move 尚未应用该路线限制。" +
    "静态生命周期与 sameLocationAs→LocationRef 绑定已合入，规则查询按位置值比较，已验证 Standard Move 的 here 范围涵盖双方且排除其他战场。" +
    "声明须同时提供图层快照使用的 restriction 和规则查询使用的 restrictions；已补齐后验证 Standard Move 的真实禁止路径，整卡仍等待效果 Move 的否定与后续独立指令继续执行。",
  sourceText: "Units can't move from here to base.",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.movement",
        restriction: "move-from-here-to-base",
        restrictions: ["move-from-here-to-base"],
        // Snapshot and rules-query readers currently use distinct spellings.
        addsPermission: false,
        filter: {
          type: "unit",
          zone: "board",
          sameLocationAs: "self"
        }
      }
    }
  ]
} satisfies CardProgram;
