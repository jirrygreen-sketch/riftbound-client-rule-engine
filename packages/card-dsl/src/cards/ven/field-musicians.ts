import type { CardProgram } from "../../ir/index.js";

/**
 * Field Musicians (ven-026-166) — Unit, 4 Energy（无印刷 Power），3 Might,
 * Calm, Ionia。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-026-166，逐字）：
 *   When you play me, give a unit +3 :rb_might: this turn.
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a / 383.4.a.1 / 420.4.a：“When you play me” 是 Play Effect，在打出完成后进链，
 *   时点为封闭的 "card-played"，filter 用契约 3.6 的符号选择器 { source: "self" } 指向自身。
 * - 355.5 / 355.7 / 355.9.a.1 / 355.10：“a unit” 是控制者在 Finalize 选择的一个具体对象
 *   （未特别说明时指 Board 上的单位），因此是 TargetSpec，不是 pick。
 * - 143.2.a / 475–477：“+3 Might this turn” 是带回合期限的临时 Might 修正，属算术图层的
 *   持续效果（continuous.might），本回合结束时到期（315.4 / 317 的清理流程）。
 * - 702 / 703：Buff 是计数器（各 +1 Might、每单位一个），与本卡的 +3 临时修正不是同一机制——
 *   effect.buff 文件头也明确“临时 Might 修改归 continuous.might，不属于本原语”，因此不写成 Buff。
 *
 * status = judge-required（唯一缺口是临时 Might 修正的执行路径）：
 * - 契约 3.6 的封闭 GameAction 集合没有 Might 修改动作（只有 buff 计数与 heal 等），
 *   effects/instructions/ 下也没有注册的 continuous.might / effect.might-modify 原语：
 *   layers 引擎（RIFT-91）能求值算术图层，但没有把结算中的持续效果经
 *   ResolveContext.addContinuous 落地的指令（ctx.addContinuous 目前只有 chain/engine 内部接线），
 *   “this turn” 的到期也没有卡牌侧接线。
 * - 触发结构（383.4.a 的 card-played + 自身 filter）与目标选择（355.5）按契约写出；golden 校验
 *   结构并用参考内核真实求值目标过滤/条件形状，执行场景以待办标注。
 * 不近似实现：不用 effect.buff 的 +1 计数器假造 +3，也不把该修正写成永久的静态能力。
 */
export default {
  canonicalCardId: "card.hash-08498917b444057f23afae275c8776d4bff33d47135466ce826cff2b935cea29",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "唯一缺口是「give a unit +3 :rb_might: this turn」没有可执行路径：契约 3.6 的封闭 GameAction 集合没有" +
    "Might 修改动作，effects/instructions 下也没有注册的 continuous.might / effect.might-modify 原语——" +
    "layers 引擎（RIFT-91）能求值算术图层与 end-of-turn 期限，但没有把结算中的持续效果经 ctx.addContinuous" +
    "落地的指令（该入口目前只有 chain/engine 内部接线），「this turn」的到期（315.4/317）也无卡牌侧接线。" +
    "effect.buff 文件头明确临时 Might 修改归 continuous.might，因此不用 Buff 计数器近似 +3。" +
    "Play Effect 结构（383.4.a 的 card-played + 自身 filter）与「a unit」的目标选择（355.5/355.7/355.9.a.1）" +
    "已按契约写出。依赖：continuous.might / effect.might-modify 指令原语与到期接线（RIFT-91）。不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { source: "self" } }
      },
      optional: false,
      body: [
        {
          id: "field-musicians.give-plus-3-might",
          // 临时 Might +3（算术图层，本回合结束到期）。原语未注册，见 judgeReason。
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 3 },
            duration: { kind: "constant", value: "end-of-turn" },
            target: {
              kind: "constant",
              value: "field-musicians.unit"
            }
          },
          targets: [
            {
              // “a unit”：控制者选择的一个 Board 单位（355.9.a.1、355.10）。
              id: "field-musicians.unit",
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "When you play me, give a unit +3 :rb_might: this turn."
} satisfies CardProgram;
