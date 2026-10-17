import type { CardProgram } from "../../ir/index.js";

/**
 * Mageseeker Warden (ogn-070-298).
 * CR v1.5 355.17.b explicitly uses Mageseeker Warden as a play restriction example.
 * Both restrictions exist only while the host is at a battlefield.
 * The second clause affects enemy units AND gear, but only spell/ability ready actions.
 * These are blocked continuous.restrict declarations, not executable layer registrations.
 */
const program = {
  canonicalCardId: "card.hash-b2b0dc0db7b4646ebf76c4865cc10fb826a643400e758e6396dfeca70062a616",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason: "continuous.restrict 原语和 ruleRestrictions 查询已合入，但本卡的静态 binder 仍不能消费其形状：" +
    "condition 需要动态读取 self 是否在 battlefield，第一条限制需要相对 opponent 与 acting-player-base，" +
    "第二条还需要将 causes=spell/ability 传入 ready 动作的限制查询。当前 staticFilter 与规则查询没有这些字段的完整绑定路径" +
    "（CR 355.17.b / 416）。依赖：动态 battlefield 条件、相对玩家目标与 ready cause 过滤；不替换成入场触发或笼统禁止一切重置。",
  abilities: [
    {
      kind: "static",
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "objects",
          filter: {
            object: "self",
            zone: "battlefield"
          }
        },
        operator: "gte",
        right: {
          kind: "constant",
          value: 1
        }
      },
      effect: {
        kind: "continuous.restrict",
        action: "play",
        filter: {
          type: "unit",
          controller: "opponent"
        },
        allowedDestination: "acting-player-base"
      }
    },
    {
      kind: "static",
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "objects",
          filter: {
            object: "self",
            zone: "battlefield"
          }
        },
        operator: "gte",
        right: {
          kind: "constant",
          value: 1
        }
      },
      effect: {
        kind: "continuous.restrict",
        action: "ready",
        filter: {
          type: [
            "unit",
            "gear"
          ],
          controller: "opponent"
        },
        causes: [
          "spell",
          "ability"
        ],
        allowed: false
      }
    }
  ],
  sourceText: "While I'm at a battlefield, opponents can only play units to their base.\nWhile I'm at a battlefield, spells and abilities can't ready enemy units and gear."
} satisfies CardProgram;

export default program;
