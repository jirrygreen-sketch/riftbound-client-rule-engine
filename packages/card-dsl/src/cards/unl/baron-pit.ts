import type { CardProgram } from "../../ir/index.js";

/**
 * Baron Pit — CR v1.5 187.9/449.1/449.2 grants a Standard Move
 * permission whose destination is this Battlefield, from any origin.
 * It does not grant unrestricted Ganking. 135.2.d.1/d.3: the setup sentence
 * is reminder text.
 *
 * 2026-10-18 复核：static 绑定、permission.routes/endpoints 注册与
 * layers/rules/query.ts 的 movement() 读取都已合入并真实运行（golden 覆盖注册、
 * 读取与 unbind）。剩余缺口只在 Standard Move 的消费端：zones/movement.ts 的
 * moveDuelUnitsStandard 对 battlefield→battlefield 仍只看
 * readiness.hasGanking / ruleView.canGank（即是否存在 battlefield-to-battlefield
 * 这条 route 名），既不解析 destination:self 这个相对端点，也不比较本次
 * destinationLocationId 与本源战场，也没有把 source:"anywhere" 的起点放宽接进
 * 该判定。不能把该许可换成无限定目的地的 Ganking，也不能用 sameLocationAs
 * 限定为已在本战场的单位。
 *
 * 另：production 对局把 battlefield 生成为 chain 区的 token（game/lifecycle.ts
 * 只 create-token，不 move 到 Board），attachProgramLifecycle 仅在
 * object-enters-board 时绑定 static/trigger，所以本卡在真实对局里目前还不会被
 * 注册；这不是本卡可自行弥补的接线。括号句按 135.2.d.1/d.3 是提醒文本。
 */
export default {
  canonicalCardId: "card.hash-9a277d1f603718992521dc7464de01bdb5cc00d5d35d10081db5b0c9cfc4c3db",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口（CR v1.5 187.9、449.1/449.2）只有 Standard Move 消费端：本卡的 continuous.movement 许可已由 static binder 注册，" +
    "layers/rules/query.ts 的 movement() 也真实读回 routes=[standard-move-to-here-from-anywhere] 与 " +
    "endpoints={source:anywhere,destination:self}（golden 实证注册、读取、解绑）。但 zones/movement.ts 的 " +
    "moveDuelUnitsStandard 对 battlefield→battlefield 只检查 readiness.hasGanking 或 ruleView.canGank，" +
    "即只识别 battlefield-to-battlefield 这条 route 名：它不解析 destination:self 这一相对端点、" +
    "不把许可的 source:\"anywhere\" 放宽到起点判定，也不比较本次 destinationLocationId 是否等于本源战场。" +
    "不能把该许可换成无限定目的地的 Ganking，也不能用 sameLocationAs 限定为已在本战场的单位；" +
    "production 对局还把 battlefield 生成为 chain 区 token（game/lifecycle.ts），attachProgramLifecycle 只在 " +
    "object-enters-board 时绑定，因此真实对局尚未注册本卡。依赖：Standard Move 的端点消费（destination:self + source:anywhere）与 battlefield 入 Board 的生命周期。",
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
