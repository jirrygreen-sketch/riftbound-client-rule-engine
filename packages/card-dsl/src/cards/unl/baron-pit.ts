import type { CardProgram } from "../../ir/index.js";

/**
 * Baron Pit — CR v1.5 187.9/449.1/449.2 grants a Standard Move
 * permission whose destination is this Battlefield, from any origin.
 * It does not grant unrestricted Ganking. 135.2.d.1/d.3: the setup sentence
 * is reminder text. Static registration and movement queries are executable;
 * the Standard Move still needs to consume the destination endpoint.
 *
 * 复核后仍缺一处：位置选择器（RIFT-357）已合入，本程序的 permission.routes/
 * endpoints 形状能真实注册并由 movement() 读出；但 zones/movement.ts 消费移动
 * 规则时只识别 canGank 与按 route 名禁止的规则（routeKinds 只给出
 * base/battlefield 的方向类别），既不解析 destination:self 这个相对端点，
 * 也不把“本次目的地是否等于本源战场”与许可匹配。此外 Standard Move 请求仍以
 * destinationLocationId 表达目的地，没有把许可的 source:"anywhere" 起点放宽
 * 接入该判定。不能把该许可换成无限定目的地的 Ganking，也不能用 sameLocationAs
 * 限定为已在本战场的单位。括号句按 135.2.d.1/d.3 是提醒文本。
 *
 * 第三轮复核确认该口径仍然成立：RIFT-360 只增加目标税成本计划、RIFT-359 只增加
 * 事件/结果谓词，两者都不消费 movement 许可；moveDuelUnitsStandard 的
 * battlefield→battlefield 分支依旧只看 readiness.hasGanking / ruleView.canGank。
 */
export default {
  canonicalCardId: "card.hash-9a277d1f603718992521dc7464de01bdb5cc00d5d35d10081db5b0c9cfc4c3db",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口（CR v1.5 187.9、449.1/449.2）：static 图层绑定与 layers/rules 的 movement() 查询已合入，" +
    "本程序使用 permission.routes/endpoints 形状，能真实注册并读出 routes=[standard-move-to-here-from-anywhere]、" +
    "endpoints={source:anywhere,destination:self}（golden 已实证）。位置选择器（RIFT-357）已合入，不再是缺口。" +
    "剩余的是 Standard Move 端点消费方：zones/movement.ts 只用 canGank 判定 Battlefield→Battlefield 是否合法，" +
    "routeKinds 只返回 base/battlefield 的方向类别，既不解析 destination:self 这个相对端点，" +
    "也不比较本次 destinationLocationId 是否等于本源战场，source:anywhere 的起点放宽同样未接入该判定。" +
    "不能把该许可换成无限定目的地的 Ganking，也不能用 sameLocationAs 限定为已在本战场的单位。括号句按 135.2.d.1/d.3 是提醒文本。",
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
