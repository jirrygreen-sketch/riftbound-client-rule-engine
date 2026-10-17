import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Elnuk Herd (rad-081-167) — Unit, 6 energy, Might 5, Fury, RIFT-178 片 5/8。
 *
 * 原文（packages/card-data/data/deck-catalog.json，sourceText 逐字）：
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)
 *   When you play me, give another friendly unit +3 :rb_might: this turn, then
 *   recycle me if I was played from face down.
 *
 * 规则依据（CR v1.5）：
 * - [Hidden] 是关键词能力（811），以 { kind: "keyword", keyword: "hidden" } 声明；
 *   展开（cost.hidden + Hide 动作 + 从面朝下区域打出）属于 RIFT-84 的关键词文件。
 * - "When you play me"：打出触发（时点 card-played，383.4.a），filter 指向自身。
 * - "give another friendly unit +3 :rb_might: this turn"：带 end-of-turn 期限的临时
 *   Might 修正，属于 layers 的 continuous.might；该指令原语已合入（RIFT-258），
 *   arithmetic 层注册交给图层引擎（effect.buff 文档明确临时 Might 不进 Buff 计数）。
 *   "another friendly unit" 是 355.5/355.9 的选择 → TargetSpec（min=max=1），本卡不禁用
 *   该目标的空选择：正文是强制效果（没有 "may"），目标不存在时该指令不可执行（359.2.c）。
 * - "then recycle me if I was played from face down"：recycle 是 417 的回收动作，
 *   已合入 effect.recycle 原语；"me" 指能力来源（355.10.d 的程序化选择，不是目标），
 *   因此用契约 3.6 的 object-property 读来源引用来给对象，而不是造 TargetSpec。
 *   "if I was played from face down" 需要"从面朝下打出"的事实（811.1.d / 355.10.a.1
 *   的 Facedown Zone），当前 ObjectSnapshot 与事件都不暴露该事实，因此条件用显式
 *   object-property 读取该特征。该特征不存在时读取抛 MissingInformation，解释器按
 *   ignored/mistargeted 处理（golden 测试断言该失败关闭行为），因此该指令在缺事实时
 *   绝不无条件回收（不近似实现）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "hidden" },
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "elnuk-herd.grant-might",
        // 临时 Might 修正：已合入的 continuous.might（objects.target 形态，见文件头说明）。
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 3 },
          duration: { kind: "constant", value: "end-of-turn" },
          objects: {
            kind: "constant",
            value: { kind: "target", id: "elnuk-herd.another-unit" }
          }
        },
        targets: [
          {
            id: "elnuk-herd.another-unit",
            filter: { type: "unit", controller: "controller", other: true, zone: "board" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      },
      {
        id: "elnuk-herd.recycle",
        op: "effect.recycle",
        args: {
          objects: {
            kind: "object-property",
            object: "source",
            property: "ref"
          }
        },
        condition: {
          kind: "compare",
          left: { kind: "object-property", object: "source", property: "playedFromFaceDown" },
          operator: "eq",
          right: { kind: "constant", value: true }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-7451c4c0dfc182af5e8953981779aa897fa4d429f1fbddbbee5cf2c7ba59abe6",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两条缺口：(1) 没有已合入路径把 CardProgram 的能力注册成 TriggerRegistration 或送进 chain" +
    "（RIFT-257 卡牌程序绑定仍在进行），因此 card-played 触发、continuous.might 的结算与 [Hidden] " +
    "的关键词展开都无法从卡牌数据侧生效；(2) 「if I was played from face down」需要「从面朝下区域打出」" +
    "的事实（CR v1.5 811.1.d、355.10.a.1 的 Facedown Zone），当前 ObjectSnapshot／事件管线都不暴露" +
    "该特征。指令本体无缺口：+3 Might 用已合入的 continuous.might（end-of-turn 到期，RIFT-258），" +
    "recycle 用已合入的 effect.recycle，二者均有真实执行证据。不近似实现。",
  abilities,
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "When you play me, give another friendly unit +3 :rb_might: this turn, then recycle me if I was played from face down."
} satisfies CardProgram;

export default program;
