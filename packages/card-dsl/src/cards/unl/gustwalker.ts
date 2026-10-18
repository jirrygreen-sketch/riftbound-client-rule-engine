import type { CardProgram } from "../../ir/index.js";

/**
 * Gustwalker (unl-075-219) — Unit，3 能量 + 1 Power、Might 3，Mind / Dog / Ionia。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，unl-075-219，逐字）：
 *   [Hunt 2] (When I conquer or hold, gain 2 XP.)
 *   [Level 3][>] I have +1 :rb_might: and [Ganking]. (While you have 3+ XP, get
 *   the effect. A [Ganking] unit can move from battlefield to battlefield.)
 *
 * 规则依据（CR v1.5）：
 * - 823.1 / 823.1.c.1：Hunt 是触发式能力关键词，整句功能上等同「When I Conquer or
 *   Hold, my controller gains X XP.」；相应时点是 conquer / hold（471.1 / 471.2）。
 *   823.1.c.3：X 是 Hunt Value（本卡为 2）。823.2：多个 Hunt 来源的数值由 expandProgram
 *   求和后传给一次 Hunt 展开。
 *   整段能力文本都落在关键词定义里，按 README 第 5 节只声明关键词、不重写展开。
 * - 824.1.a / 824.1.b.1：Level 是依赖式关键词；从关键词到子句末整段是 Level Ability，
 *   功能上等同「只要你有 N 点或更多 XP，本牌获得 '[Text]'」。824.1.c / 824.1.d：
 *   控制者 XP 变化会即时让依赖能力 Active / Inactive。
 * - 依赖能力 [Text] 的两半：
 *   - "I have +1 :rb_might:" 是 479.4 算术层的持续修正；
 *   - "and [Ganking]" 是关键词授予（810：Ganking 为被动能力关键词，给标准移动增加
 *     战场到战场的许可，810.1.c.1 不移除原有选项）。
 *
 * 2026-10-18 复核：整卡仍为 judge-required；当前生产缺口见 judgeReason。
 * 已支持子效果的执行证据保留在对应 golden；不以原语存在替代整卡可执行性。
 */
const gustwalker = {
  canonicalCardId: "card.hash-a232dcd643d13b743c5bad3125bacbefc6b2ef53b24aa91708ec80fc13447153",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口：(1) Hunt.ts 仍用 conquer/hold 作过滤事件名，EVENT_PATTERN_TYPES 只接受 conquered/held，registerProgramTriggers 报 invalid-event-type；turn/flow.ts 的计分事件也未携带征服或固守单位 object，不能命中 When I（823.1.c.1）。" +
    "(2) [Level 3] 仍缺实时控制者 XP 查询与动态失活（824.1.c/824.1.d）：Expr.count 忽略 controller-xp 的 subject 而只数对象，condition.predicate 无静态映射；保留 never 阻断。" +
    "(3) 静态绑定可注册 Might 与 Ganking 授予；KeywordGrantLayerEngine 已把 Ganking 的 permission 规范为 permission.routes，但默认 lifecycle 未接入该适配器，标准移动已有 registry 规则查询接口，但缺默认生命周期将该适配器结果接入移动路径（810.1.c）。",
  abilities: [
    { kind: "keyword", keyword: "hunt", value: 2 },
    {
      kind: "static",
      // 824.1.b.1：Level 3 的依赖能力 = 「控制者 XP ≥ 3 时本牌获得 [Text]」。
      // XP 谓词尚不能读取控制者的实时 XP（见 judgeReason），但静态绑定已能注册
      // continuous.might；这里按可审查的契约形状写出依赖能力的第一半。
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        amount: { kind: "constant", value: 1 },
        appliesTo: "self"
      },
      condition: {
        // CR 824.1.c/d: pending player XP query; never substitute object count.
        kind: "all",
        conditions: [
          { kind: "never" },
          {
            kind: "compare",
            left: { kind: "count", subject: "controller-xp", filter: { player: "controller" } },
            operator: "gte",
            right: { kind: "constant", value: 3 }
          }
        ]
      }
    },
    {
      kind: "static",
      // 依赖能力的第二半：「and [Ganking]」。
      effect: {
        kind: "continuous.grant-keyword",
        keyword: "Ganking",
        appliesTo: "self"
      },
      condition: {
        // CR 824.1.c/d: pending player XP query; never substitute object count.
        kind: "all",
        conditions: [
          { kind: "never" },
          {
            kind: "compare",
            left: { kind: "count", subject: "controller-xp", filter: { player: "controller" } },
            operator: "gte",
            right: { kind: "constant", value: 3 }
          }
        ]
      }
    }
  ],
  sourceText:
    "[Hunt 2] (When I conquer or hold, gain 2 XP.)\n" +
    "[Level 3][>] I have +1 :rb_might: and [Ganking]. (While you have 3+ XP, get the effect. A [Ganking] unit can move from battlefield to battlefield.)"
} satisfies CardProgram;

export default gustwalker;
