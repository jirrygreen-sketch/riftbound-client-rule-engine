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
 *   表达（matchesTriggerObject 支持该选择符）；“另一个”需要排除本卡自身，
 *   用契约 3.6 的 exclude 锚点书写（该锚点在生产触发匹配里仍无消费方，见 judgeReason）。
 * - “gain 1 XP”：effect.xp 已合入（730.1 / 733；获得者缺省为能力控制者，190.6.d）。
 *
 * status = judge-required（缺口不近似实现，2026-10-17 复核）：
 * - card-program → TriggerRegistration 适配器与 object-killed 的死亡前快照路径已经合入；
 *   但本卡的「another」排除没有已合入消费者，三处实测均拒绝或忽略该锚点：
 *   （a）programs/filters.ts 的 translateTriggerFilter → translateObjectFilter 对 exclude 抛
 *       "Unsupported filter field exclude"，本卡订阅在注册阶段即失败；
 *   （b）events/pipeline-match.ts 的 matchesTriggerObject 只读 objectId/cardId/type/controller/
 *       owner/zone/location/states/tags/characteristics，没有 exclude 分支；
 *   （c）参考内核的 matchesQueryFilter 不认该键（只认 type/tag/types/tags/controller/owner/
 *       zone/location/combatRole），matchesFilter 走 Object.hasOwn 白名单、对该键恒为 false。
 *   解释器侧的 queryObjects（effects/interpreter/selectors.ts）虽实现了 exclude，但它只服务指令内
 *   的集合查询，接不到触发订阅。把 exclude: "self" 当成已实现会让「本卡自身死亡」也触发 +1 XP，
 *   属于把错误行为当预期，故整卡保持 judge-required（结构性声明保留给评审，绝不当作可执行过滤）。
 * 触发效果本体 effect.xp（1 XP）已合入，golden 用解释器 + 参考内核真实执行那 1 点 XP。
 *
 * 依赖：事件管线对 exclude/another 锚点的翻译与消费（程序过滤与触发匹配批次）。
 */
export default {
  canonicalCardId:
    "card.hash-ed7bafa7ae8c55236bdb4f3b21b17843836fdd9a22879336da866ccc90523a6f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "card-program → TriggerRegistration 适配器与 429.1.a.1.b 所需的 object-killed 死亡前快照路径已经合入；但触发过滤的「另一个」（383.4.a.4 / 740.1.a）" +
    "仍无可执行消费者：programs/filters.ts 的 translateObjectFilter 对 exclude 抛 \"Unsupported filter field exclude\"（订阅注册即失败），" +
    "events/pipeline-match.ts 的 matchesTriggerObject 只读 objectId/cardId/type/controller/owner/zone/location/states/tags/characteristics，" +
    "参考内核的 matchesQueryFilter 不认该键、matchesFilter 走 Object.hasOwn 白名单对该键恒为 false；" +
    "解释器侧 queryObjects 的 exclude 只服务指令集合查询，接不到触发订阅。" +
    "若把 exclude: \"self\" 当成已实现，本卡自身死亡也会触发 +1 XP，因此排除条件仍不可判定。" +
    "触发效果本体 effect.xp（730.1，1 XP）已合入，golden 用解释器 + 参考内核真实执行该 1 点 XP。" +
    "依赖：程序过滤器与触发匹配对 exclude/another 锚点的翻译与消费。",
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
