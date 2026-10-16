import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Divining Shells (unl-161-219) — Gear, 2 energy, Might null（无印刷 Might）, Order, tags []。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json, unl-161-219）：
 *   "[Vision] (When you play this, look at the top card of your Main Deck. You may recycle it.)\n" +
 *   "[Action][>] Kill this, :rb_exhaust:: Give a unit +2 :rb_might: this turn."
 *
 * 规则依据（CR v1.5）：
 * - 817.1 / 817.1.b / 817.1.c：Vision 是触发能力关键词，功能上等于
 *   "When this is played, [Predict]."，触发点是该永久物进入 Board；817.2 规定多个实例
 *   各自独立触发。437.1 / 437.3 / 437.3.a：Predict 看牌库顶一张并选择是否回收它。
 * - 135.2.e.7 / 135.2.e.7.a-b："[Action][>]" 是压在启动能力上的许可类关键词，
 *   806.1.c.2 / 806.1.d 说明它把该启动能力的时机改写为 Showdown（契约 3.1 用
 *   activated.timing 表达速度）。
 * - 404.1.a / 415.4 / 415.5：":" 之前的 "Kill this" 与 ":rb_exhaust:" 都是启动费用——
 *   429.3.a 的 Kill 是被指示时可执行的 Limited Action，355.10.c.1 明确 "[do X] to [do Y]"
 *   里的 X 是费用。费用计划（cost/plan-values.ts）的 nonstandard 支付种类含 kill 与
 *   exhaust。
 * - 费用的支付顺序：357.2 规定非标准费用由支付者按任意顺序支付，357.3 又禁止支付那些
 *   “deterministically 使后续选择/动作非法”的费用。两项费用都指向本卡自身：先支付
 *   Kill 会让来源离开 Board，随后的横置费用必然无法支付，因此唯一合法顺序是先
 *   ":rb_exhaust:" 再 "Kill this"。`payments` 按该合法顺序声明（两项费用都在，
 *   不新增/改写印刷内容）；已合入的费用计划按声明顺序检查与支付（实测先 kill 会抛
 *   CostPlanError "A payment reference is no longer in its selected zone"）。
 * - "Give a unit +2 :rb_might: this turn"：这是临时 Might 修正（143.2.a / 475–477 的
 *   算术图层），"this turn" 的期限由 317.2.c 的同时到期清理结束；effect.buff 的文件头
 *   明确临时 Might 归 continuous.might，绝不能用 Buff 计数器（702）近似。
 *
 * status = judge-required（缺口不近似实现）：
 * - 第二段的临时 Might 修正没有可执行路径：契约 3.6 的封闭 GameAction 集合没有
 *   Might 修改动作，effects/instructions/ 下也没有注册 continuous.might 原语
 *   （实测 runAbilityBody 对该 op 抛 "Unregistered instruction opcode: continuous.might"），
 *   "this turn" 的到期也没有接线（与 sfd/punch-first、sfd/undertitan、rad/elnuk-herd
 *   同一口径）。
 * - Vision 的展开（keywords/Vision.ts，817）已合入且其 body 可在参考内核真实执行，
 *   但卡牌的关键词能力尚未被解析到 KeywordDef 并接入 object-enters-board 触发
 *   （契约 3.5；当前只有 registry.generated.ts 与其测试消费关键词注册表）。
 * 已合入部分由 golden 真实执行：Vision 展开的 look + 可选 recycle（437.1）与启动费用的
 * 费用计划（kill this + [E]，415.4/415.5）。依赖：continuous.might 原语与 end-of-turn
 * 期限（RIFT-9 原语清单 / RIFT-91 后续）、契约 3.5 的关键词→触发接线；不近似实现。
 */
const abilities: Ability[] = [
  // 817.1：Vision 只声明关键词，展开（看牌 + 可选回收）归 keywords/Vision.ts。
  { kind: "keyword", keyword: "vision" },
  {
    // 135.2.e.7.b / 806.1.c.2 / 806.1.d："[Action][>]" 修饰其后的启动能力，
    // 把它的时机许可改写为 Showdown 许可。
    kind: "activated",
    timing: "action",
    cost: {
      kind: "activated",
      // 415.4 / 415.5：":" 之前的两项费用——消灭自身与横置自身（355.10.c.1）。
      // 357.2 / 357.3：两项费用都指向本卡，先 Kill 会让来源离场、横置必然无法支付，
      // 故按唯一合法顺序声明横置在前（见文件头）。
      payments: [
        { kind: "exhaust", object: "self" },
        { kind: "kill", object: "self" }
      ]
    },
    body: [
      {
        id: "divining-shells.give-might",
        op: "continuous.might",
        args: {
          // 143.2.a / 475–477：+2 Might 的算术图层修正；effect.buff 明确不承接它。
          amount: { kind: "constant", value: 2 },
          duration: { kind: "constant", value: "end-of-turn" }
        },
        targets: [
          {
            // "a unit" 是选择（355.5），故用 TargetSpec；不限定控制者，任意单位皆可。
            id: "divining-shells.unit",
            filter: { type: "unit", zone: "board" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-936666b1ffbf93681f930f27e502217a077f8c82e423bac72257ce1acaf12420",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「Give a unit +2 :rb_might: this turn」无可执行路径：契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，" +
    "effects/instructions/ 下也没有注册 continuous.might 原语（实测 runAbilityBody 抛 " +
    "\"Unregistered instruction opcode: continuous.might\"），effect.buff 的文件头明确临时 Might 修正归 " +
    "continuous.might、不能近似成 Buff 计数器（702）；「this turn」的到期（317.2.c）同样未接线" +
    "（与 sfd/punch-first、sfd/undertitan、rad/elnuk-herd 同一口径）。另外 Vision（817）的展开 keywords/Vision.ts " +
    "虽已合入且 body 可在参考内核真实执行，但卡牌关键词能力→object-enters-board 触发的接线（契约 3.5）仍未合入。" +
    "已合入部分由 golden 真实执行：Vision 展开的 look + 可选 recycle（437.1）与 kill this + [E] 的费用计划" +
    "（415.4/415.5）。依赖：continuous.might 原语与 end-of-turn 期限（RIFT-9 原语清单 / RIFT-91 后续）、" +
    "契约 3.5 关键词→触发接线；不近似实现。",
  abilities,
  sourceText:
    "[Vision] (When you play this, look at the top card of your Main Deck. You may recycle it.)\n" +
    "[Action][>] Kill this, :rb_exhaust:: Give a unit +2 :rb_might: this turn."
};

export default program satisfies CardProgram;
