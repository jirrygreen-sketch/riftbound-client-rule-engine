import type { CardProgram } from "../../ir/index.js";

/**
 * Spectral Centaur (unl-068-219) — Unit，6 能量、无印刷 Power、Might 5，
 * Mind / Spirit / Shadow Isles。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，unl-068-219，逐字）：
 *   When another friendly unit dies, give me +2 :rb_might: this turn.
 *
 * 规则依据（CR v1.5）：
 * - 383.4.d："When another friendly unit dies" 是死亡触发；429.1 / 429.2 的死亡
 *   （Kill：永久物从 Board 进入 Trash）对应封闭时点 object-killed。
 * - 355.7 / 355.9："another friendly unit" 是触发条件里的对象限制：friendly 指与能力
 *   控制者同一控制者（740.1.a，filter.controller: "self" 由触发管线按注册控制者解析，
 *   与已合入 ogn/wraith-of-echoes 同一写法）；"another" 必须把本卡自身排除。
 * - 122.5："give me +2 :rb_might: this turn" 是临时数值修正，归 continuous.might 图层
 *   （effect.buff 的边界注释明确临时 Might 不进 Buff 原语）；"me" 用契约 3.6 的对象
 *   锚点 object: "self" 表达。
 *
 * status = judge-required（缺口不近似实现）：
 * 1. "another" 的排除无已合入形态：events/trigger-spec.ts 的 ObjectFilter 白名单
 *    （objectId/cardId/type/controller/owner/zone/location/states/tags/characteristics）
 *    不含排除锚点，实测 isTriggerSpec 对 { object: { …, exclude: "self" } } 返回 false；
 *    events/pipeline-match.ts 也不解析排除。写成普通 "a friendly unit dies" 会让本卡
 *    自身死亡也触发，属近似实现，故不写。
 * 2. 效果本体使用已合入的 continuous.might（RIFT-91），但触发到图层的卡牌接线仍缺，
 *    封闭 GameAction 集合也没有直接的 might 修改动作。
 * 3. CardProgram 的 triggered ability 尚无注册进 TriggerRegistration 的路径
 *    （引擎批 4 / RIFT-120），object-killed 订在生产链路上不可达。
 * 依赖：RIFT-91（layers-continuous）、RIFT-120（链/事件管线）。
 */
const spectralCentaur = {
  canonicalCardId: "card.hash-54a2013f8d1b41ecedba3f879be7fae1727fe8209e602a142e8ba6550ed829c9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1)「another friendly unit」的排除无已合入形态：events/trigger-spec.ts 的 ObjectFilter 白名单" +
    "不含 exclude 锚点（实测 isTriggerSpec({ object: { …, exclude: \"self\" } }) === false），events/pipeline-match.ts 也不解析排除；" +
    "写成普通「a friendly unit dies」会连本卡自身死亡一起触发；" +
    "(2)「give me +2 :rb_might: this turn」使用已合入的 continuous.might 图层修正（RIFT-91），但触发到图层的卡牌接线仍缺，" +
    "封闭 GameAction 集合也没有直接的 might 修改动作；" +
    "(3) 没有模块把 CardProgram 的 triggered ability 注册成 TriggerRegistration（引擎批 4 / RIFT-120），object-killed 订不可达。" +
    "依赖：RIFT-91、RIFT-120。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-killed",
        filter: {
          event: "object-killed",
          // "another"：排除锚点的缺失见 judgeReason；这里按可审查形状书写，
          // 不使用会被触发的近似写法。
          object: { type: "unit", controller: "self", exclude: "self" }
        }
      },
      optional: false,
      body: [
        {
          id: "spectral-centaur.give-plus-2",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "this-turn" }
          },
          targets: [
            {
              id: "spectral-centaur.me",
              // "me"：只用本能力宿主自身（355.10.g 的自指），用对象锚点表达，
              // 避免用运行时不存在的 objectId 常量。
              filter: { zone: "board", type: "unit", object: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "When another friendly unit dies, give me +2 :rb_might: this turn."
} satisfies CardProgram;

export default spectralCentaur;
