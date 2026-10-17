import type { CardProgram } from "../../ir/index.js";

/**
 * Baron Pit — CR v1.5 187.9/449.1/449.2 grants a Standard Move
 * permission whose destination is this Battlefield, from any origin.
 * It does not grant unrestricted Ganking. 135.2.d.1/d.3: the setup sentence
 * is reminder text. Static registration and movement queries are executable;
 * the Standard Move still needs to consume the destination endpoint.
 */
export default {
  canonicalCardId: "card.hash-9a277d1f603718992521dc7464de01bdb5cc00d5d35d10081db5b0c9cfc4c3db",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口（CR v1.5 187.9、449.1/449.2）：static 图层绑定与 layers/rules/movement 查询已合入，本程序使用 permission.routes/endpoints 形状，能真实注册并读出任意起点与 destination:self。zones/movement.ts 也已消费移动规则，但仅识别 canGank 与路线禁止，尚未按本源战场解析 destination:self 并以本次目的地匹配该许可；仍需目的地相对锚点与 Standard Move 端点消费（位置选择 RIFT-357）。不能把该许可换成无限定目的地的 Ganking，也不能用 sameLocationAs 限定为已在本战场的单位。括号句按 135.2.d.1/d.3 是提醒文本。",
  sourceText: "(You can't start the game with a token battlefield.)\nUnits can move here from anywhere.",
  abilities: [
    {
      kind: "static",
      effect: {
        // 187.9 / 449.1–449.2: the permission belongs to this destination,
        // rather than granting every unit unrestricted Battlefield-to-Battlefield movement.
        kind: "continuous.movement",
        permission: {
          routes: ["standard-move-to-here-from-anywhere"],
          source: "anywhere",
          destination: "self",
          move: "standard"
        },
        filter: { type: "unit", zone: "board" }
      }
    }
  ]
} satisfies CardProgram;
