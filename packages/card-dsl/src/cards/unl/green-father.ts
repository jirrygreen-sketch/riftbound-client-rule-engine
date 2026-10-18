import type { CardProgram } from "../../ir/index.js";

/**
 * Green Father (unl-195-219) — Legend, Calm/Order, tag Ivern.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-195-219，逐字）：
 *   When you conquer or hold, you may exhaust me to replace that battlefield with
 *   a Brush battlefield token. (Bird, Cat, Dog, Poro, and Ivern units have +1
 *   :rb_might: in Brush. It can be swapped back when scored.)
 *
 * 规则依据（CR v1.5）：
 * - 383.4.c / 383.4.c.1 / 383.4.c.2.b：「When you conquer」是 Conquer Effect，引用
 *   「执行征服的玩家」的能力在控制者完成征服时进链，时点用封闭表的 conquer
 *   （events/timing-points.ts，refs 468.5.d / 471.1 / 473.2.a；由 turn/flow.ts 的
 *   计分波发出）。383.4.c.2.c：征服的点数被否定或替代时照常触发。
 * - 383.4.d / 383.4.d.1 / 383.4.d.2.b：同一句里的「hold」是 Hold Effect，时点 hold
 *   （refs 315.2.b.2 / 471.2 / 473.2.b，同样由 turn/flow.ts 的计分波发出）。
 *   「conquer or hold」是两个独立触发条件，因此写成两条 triggered 能力，不合并成
 *   一个自定义时点。
 * - 383.3.a / 403.1：效果开头的「you may」是触发能力自身的 Finalize 决定，由
 *   TriggeredAbility.optional 承载；契约 3.9 要求「可以……」把被选指令包进
 *   choice.optional 的 body，不使用 choice + linkedTo 的写法。
 * - 383.3.b / 204.3 / 355.10.c.1：紧跟「you may」的「exhaust me」是触发能力的基础费用
 *   （cost within instructions），必须能完成（415.4 / 415.5）才能把触发放进链；这类
 *   费用不产生目标，所以是引用来源自身的非目标选择。
 * - 187.8：Brush 是「无域战场 token」，带「Bird/Cat/Dog/Poro/Ivern units here have
 *   +1 [M]」与「When you score here, you may replace this with the battlefield it
 *   replaced.」自身能力。439.1 / 439.3：「Replace [X] with [Y]」是 Replace 行动
 *   （有限行动，439.2），被替代的牌进入 Banishment（439.5），token 可在计分时
 *   Swap Back（439.7）。359.3.f.1「that battlefield」指触发事件里的那个战场。
 *
 * status = judge-required（按 2026-10-17 HEAD 复核；缺口不近似实现）：
 * - 触发拼写已改为封闭词表 conquered/held（pipeline-match.ts 映射到运行期
 *   conquer/hold）：实测两个订阅都能注册，生产形状的 hold 与本控制者 conquer 发射
 *   都能命中并生成触发项。
 * - 缺 CR 439.1/439.3 的 Replace 行动：registry.generated.ts 没有 effect.replace，
 *   replacement/ 的事件替代规划不是 Replace/Swap-Back，187.8 的 Brush 战场 token
 *   也不在 effect.token 的定义表（后者同时缺 439.5 放逐关联与 439.7 换回）。
 * - 缺把 conquer/hold 的 details.battlefieldId 绑定为「that battlefield」的载荷选择器
 *   （359.3.f.1）；"that battlefield" 没有可用的 ObjectSelector/LocationSelector 形态。
 * - programs/triggers.ts 未把前置 may/exhaust 转为 Finalize 的 cost / mayAtFinalize
 *   （383.3.a/383.3.b、204.3）。
 * - 仍缺 Legend Zone 生命周期：game/lifecycle.ts 把传奇创建在 chain，仅另记
 *   legendZone；ZoneId 没有 legend-zone，横置费用也只接受 board/rune-zone（107.4.a/c）。
 * 保留不可执行声明供审查；横置子效果与触发注册测试不能证明 Replace 与传奇费用已执行。
 */
const greenFather = {
  canonicalCardId:
    "card.hash-cbd7d8a764f8a0a4bf62c8365cd14d5dd5deb06823365bffea237f2d3dd757a6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "触发拼写已改用封闭词表 conquered/held（events/trigger-spec.ts 的 EVENT_PATTERN_TYPES；pipeline-match.ts 映射到运行期 conquer/hold），" +
    "实测两个订阅都能经 registerProgramTriggers 注册，且 turn/flow.ts 形状的 hold 发射与本控制者 conquer 发射都能命中并生成触发项。仍缺（均不近似实现）：" +
    "(1) CR 439.1/439.3 的 Replace 行动没有已注册原语——registry.generated.ts 无 effect.replace，replacement/ 的事件替代规划不能代替 Replace；" +
    "187.8 的 Brush 战场 token 也不在 effect.token 的 DEFINITIONS（recruit/sand-soldier/mech/reflection/tentacle），并缺 439.5 的原战场放逐关联与 439.7 的 Swap Back。" +
    "(2)「that battlefield」无法绑定：conquer/hold 的生产发射只有 { player, details: { battlefieldId } }（turn/flow.ts 的计分波），没有时点载荷选择器，" +
    "359.3.f.1 要求指称该触发事件里的战场，不能用结算时来源位置替代。" +
    "(3) 前置「you may/exhaust me」没有成为触发基础费用：programs/triggers.ts 不把 choice.optional 与前置费用提取为 TriggerRegistration.cost / mayAtFinalize（383.3.a/383.3.b、204.3）。" +
    "(4) Legend Zone 归属仍缺：ZoneId（effects/contract.ts）只有 hand/deck/rune-deck/trash/banishment/board/rune-zone/chain；game/lifecycle.ts 用 create-token 把传奇创建到 chain 并只另记 report.legendZone，" +
    "而 cost/payment.ts 的 exhaust 支付要求对象在 board/rune-zone（107.4.a/107.4.c、415.4/415.5）。" +
    "已真实执行：两个触发的注册与命中、choice.optional 的拒绝分支、effect.exhaust 本体（golden）。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        // 383.4.c.2.b：「引用执行征服的玩家」的 Conquer Effect。
        // 事件名用封闭词表 conquered（pipeline-match.ts 映射到运行期 conquer）。
        filter: { event: "conquered", player: "self" }
      },
      // 383.3.a / 403.1：效果开头的「you may」是触发自身的 Finalize 决定。
      optional: true,
      body: [
        {
          id: "green-father.conquer-may",
          op: "choice.optional",
          args: {
            prompt: {
              kind: "constant",
              value: "Exhaust me to replace that battlefield with a Brush battlefield token?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  // 383.3.b 的基础费用形状（355.10.c.1：费用不产生目标；真实费用在
                  // Finalize 支付，见 judgeReason）。
                  id: "green-father.conquer-exhaust-self",
                  op: "effect.exhaust",
                  args: {
                    choose: {
                      kind: "constant",
                      value: {
                        id: "green-father.conquer-exhaust-self",
                        filter: { object: "self" }
                      }
                    }
                  }
                },
                {
                  // 「to replace that battlefield with …」：只有费用成立才执行
                  // （359.3.e.14 的链接语义）。439.3.a 的 [X] 是「该战场」——合并 IR 没有
                  // 事件载荷选择器，占位常量仅记录形状（见 judgeReason；任何执行路径都会
                  // 因 effect.replace 未注册而失败）。
                  id: "green-father.conquer-replace",
                  op: "effect.replace",
                  linkedTo: "green-father.conquer-exhaust-self",
                  args: {
                    battlefield: {
                      kind: "constant",
                      value: { type: "battlefield", id: "that-battlefield" }
                    },
                    // 439.3.b.1： [Y] 永远是「要创建的 token」；187.8 的 brush 定义未合入。
                    withToken: { kind: "constant", value: "brush" }
                  }
                }
              ]
            }
          }
        }
      ]
    },
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        // 383.4.d.2.b：「引用执行固守的玩家」的 Hold Effect。
        // 事件名用封闭词表 held（pipeline-match.ts 映射到运行期 hold）。
        filter: { event: "held", player: "self" }
      },
      optional: true,
      body: [
        {
          id: "green-father.hold-may",
          op: "choice.optional",
          args: {
            prompt: {
              kind: "constant",
              value: "Exhaust me to replace that battlefield with a Brush battlefield token?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "green-father.hold-exhaust-self",
                  op: "effect.exhaust",
                  args: {
                    choose: {
                      kind: "constant",
                      value: {
                        id: "green-father.hold-exhaust-self",
                        filter: { object: "self" }
                      }
                    }
                  }
                },
                {
                  id: "green-father.hold-replace",
                  op: "effect.replace",
                  linkedTo: "green-father.hold-exhaust-self",
                  args: {
                    battlefield: {
                      kind: "constant",
                      value: { type: "battlefield", id: "that-battlefield" }
                    },
                    withToken: { kind: "constant", value: "brush" }
                  }
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you conquer or hold, you may exhaust me to replace that battlefield with a Brush battlefield token. " +
    "(Bird, Cat, Dog, Poro, and Ivern units have +1 :rb_might: in Brush. It can be swapped back when scored.)"
} satisfies CardProgram;

export default greenFather;
