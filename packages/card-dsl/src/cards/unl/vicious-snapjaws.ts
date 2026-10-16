import type { CardProgram } from "../../ir/index.js";

/**
 * Vicious Snapjaws (unl-129-219) — Unit, Chaos, tag Bilgewater。
 * catalog：energy 5、power null（无印刷力量）、might 5。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-129-219，逐字）：
 *   When another friendly unit dies, gain 1 XP.
 *
 * 规则依据（CR v1.5）：
 * - 429.1 / 429.1.a.1：“dies” 是永久物从 Board 进入 Trash；封闭时点 object-killed
 *   （timing-points.ts，refs 429.1/429.2/808.1.d）承载该事件，自身死亡触发在替代处理后、
 *   实际换区前收集。
 * - “another friendly unit”：740.1.a（friendly = 与控制者共享控制者）、740.2（unit）与
 *   “另一个”（383.4.a.4 的“另一张牌”读法）——友方用内层 object filter 的 controller: self
 *   表达（已合入的 matchesTriggerObject 支持该选择符）；“另一个”需要排除本卡自身，
 *   用契约 3.6 的 exclude 锚点书写（见 judgeReason：该锚点在已合入的触发匹配里没有消费方）。
 * - “gain 1 XP”：effect.xp 已合入（730.1 / 733；获得者缺省为能力控制者，190.6.d）。
 *
 * status = judge-required（缺口不近似实现）：
 * - 缺「card-played / object-killed 等事件 → TriggerRegistration」的注册适配器：
 *   合并内核里没有任何路径用卡牌程序声明的 TriggerSpec 注册触发器（ogn/wraith-of-echoes
 *   的 golden 必须由测试 harness 手工 registerTrigger 才能跑），也没有按 383.2.c.3.b /
 *   429.1.a.1.b 用离场前最后已知信息收集该死亡单位的路径，因此“another friendly unit dies”
 *   这条订阅在已合入代码里不可达；
 * - “another” 的排除没有已合入消费者：events/pipeline-match.ts 的 matchesTriggerObject
 *   只读 objectId/cardId/type/controller/owner/zone/location/states/tags/characteristics，
 *   未知键（包括 exclude）被静默忽略；测试内核的 matchesFilter 亦然。把 exclude: "self"
 *   当成已实现会让「本卡自身死亡」也触发 +1 XP，属于把错误行为当预期，故整卡保持
 *   judge-required（结构性声明保留给评审，绝不当作可执行过滤）。
 * 触发效果本体 effect.xp（1 XP）已合入，golden 用解释器 + 参考内核真实执行那 1 点 XP；
 * 整卡仍因上述订阅/过滤缺口保持 judge-required。
 *
 * 依赖：RIFT-120 后续（card-program → TriggerRegistration 适配器、object-killed 的最后已知
 * 信息收集）、事件管线的另一对象/排除过滤（引擎批 4）。
 */
export default {
  canonicalCardId:
    "card.hash-ed7bafa7ae8c55236bdb4f3b21b17843836fdd9a22879336da866ccc90523a6f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 card-program → TriggerRegistration 的订阅适配器：合并代码里没有任何路径用卡牌程序声明的 " +
    "TriggerSpec/body 注册触发器（ogn/wraith-of-echoes 的 golden 也只能由测试 harness 手工 registerTrigger），" +
    "也没有按 383.2.c.3.b / 429.1.a.1.b 在换区前收集被消灭单位最后已知信息的路径，因此 " +
    "「When another friendly unit dies」在已合入内核里不可达。" +
    "触发过滤的「另一个」同样无消费者：events/pipeline-match.ts 的 matchesTriggerObject 只读 " +
    "objectId/cardId/type/controller/owner/zone/location/states/tags/characteristics，未知键（含 exclude 锚点）" +
    "被静默忽略（测试内核的 matchesFilter 亦然），若按已实现对待会让本卡自身死亡也触发 +1 XP，" +
    "因此排除本卡自身的过滤在已合入代码里不可判定。" +
    "触发效果本体 effect.xp（730.1，1 XP）已合入，golden 用解释器 + 参考内核真实执行该 1 点 XP。" +
    "依赖：RIFT-120 后续（触发注册适配器、object-killed 最后已知信息）与引擎批 4 的事件过滤扩展。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-killed",
        filter: {
          event: "object-killed",
          // “a friendly unit”：被消灭的单位与本能力控制者同控制者（740.1.a/740.2）。
          // “another”：排除本卡自身（740.1.a；exclude 是契约 3.6 的锚点，见 judgeReason）。
          object: {
            type: "unit",
            controller: "self",
            exclude: "self"
          }
        }
      },
      optional: false,
      body: [
        {
          id: "vicious-snapjaws.gain-xp",
          op: "effect.xp",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText: "When another friendly unit dies, gain 1 XP."
} satisfies CardProgram;
