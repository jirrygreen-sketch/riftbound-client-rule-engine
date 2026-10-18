import type { CardProgram } from "../../ir/index.js";

/**
 * Vilemaw's Lair — CR v1.5 054.1, 053.3, 144.4.b, 358.3.a, 359.3.e.14.b.
 * 复核 2026-10-17：Standard Move 已被禁止，effect Move 仍不读这条路线限制，
 * 所以卡面禁止在效果移动路径上不生效。
 */
export default {
  canonicalCardId: "card.hash-3e2d969f2528a782a98c698fc45d9937d376dd06244c444271adf9cbd4100e77",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Units can't move from here to base」（CR 054.1、358.3.a、359.3.e.14.b）只在 Standard Move 上生效（2026-10-17 复核）：" +
    "zones/movement.ts::routeBlocked 与 layers/rules/query.ts::movement 已消费该标签，实测两侧的 Standard Move 都被禁止" +
    "（\"prohibited from moving\"），解除绑定后放行；但 effect.move 提交的是 move-location GameAction，" +
    "其执行路径不查这条路线限制——实测同一战场的单位仍能从战场被 effect.move 移到基地（count 1），" +
    "即卡面禁止在效果移动上不生效（358.3.a、359.3.e.14.b 要求效果移动同样受禁止约束）。" +
    "待 effect.move / ChainEngine 的 move-location 消费该路线限制并对被禁止的移动给出否定结果、其余独立指令继续执行。" +
    "已合入并有执行证据：静态绑定把 sameLocationAs:self 解析成来源的 LocationRef，规则查询按位置值比较、覆盖双方并排除其他战场；" +
    "声明同时提供图层快照用的 restriction 与规则查询用的 restrictions。",
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
