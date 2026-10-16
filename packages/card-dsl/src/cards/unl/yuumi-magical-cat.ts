import type { Ability, CardProgram, Instruction } from "../../ir/index.js";

/**
 * Yuumi, Magical Cat (unl-056-219) — Unit, 3 Energy + 1 Calm Power, Might 1，Calm，
 * tag Fae/Cat/Bandle City/Yuumi/Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-056-219，逐字）：
 *   When I attack or defend, give one of your other units here +3 :rb_might: and
 *   [Tank] this turn. (It must be assigned combat damage first.)
 *
 * 规则依据（CR v1.5）：
 * - 383.4.e.1 / 383.4.f.1："When I attack or defend" 是同一个效果挂在两个触发条件上
 *   （Attack Trigger 与 Defend Trigger），因此写成两个独立 triggered 能力
 *   （rad/pillaged-armory 的同效果双触发同型），时点分别为 attack-declared 与
 *   defense-declared（events/timing-points.ts；383.4.e/f、466.2.c）。
 * - 355.9 / 355.9.b / 355.10："one of your other units here" 是单个由你选择的单位，属
 *   选目标（targets）；"your" 用 controller 限制，"other" 排除本卡自身（355.9.c，
 *   契约 anchors 的 exclude: "self"），"here" 用 sameLocationAs: "source" 表达同一地点
 *   （359.3.f.1 的 referent，ogn/leona-determined 同型）。
 * - 143.2.a / 475 / 477："+3 :rb_might: this turn" 是带回合末期限的临时 Might 修正，
 *   属算术图层（continuous.might），由 layers 的期限机制在清理步骤移除（315.4）；
 *   effect.buff 只管 702 的 Buff counter，不能替代（其文件头明确二者分工）。
 * - 801.3.a / 815（[Tank]）："and [Tank] this turn" 是给一个对象授予关键词并指定期限；
 *   关键词的规则行为由 effects/keywords/Tank.ts 展开，授予的期限由效果声明（801.3.a.2/a.3）。
 * - 135.2.d.1/d.3：括号内 "(It must be assigned combat damage first.)" 是 [Tank] 的提醒
 *   文字，不影响规则，不另写指令。
 *
 * status = judge-required（缺口不近似实现）：
 * - "give … +3 :rb_might: … this turn" 没有可执行路径：契约 3.6 的封闭 GameAction 集合没有
 *   Might 修改动作，effects/instructions/ 下没有 continuous.might / effect.might-modify 原语，
 *   卡程序也没有把该持续效果注册进 layers 的指令入口（LayerEngine 只消费经
 *   ResolveContext.addContinuous 注册的持续效果），"this turn" 的到期同样未接线（RIFT-91）。
 *   程序按契约形状保留 continuous.might 记录意图，不近似用 effect.buff 表达。
 * - "and [Tank] this turn" 需要带期限的关键词授予（801.3.a.2/a.3 的 duration）：
 *   effects/instructions/ 没有 continuous.grant-keyword 原语，静态的 grant-keyword 持续效果
 *   也没有图层消费方（sfd/gem-jammer、sfd/forecaster 记录同一缺口）。
 * - attack-declared / defense-declared 没有发射方：events/action-adapter.ts 只按已提交的游戏
 *   动作派生时点，combat/ 尚未把取得 Attacker/Defender 身份接入事件管线，全仓库没有这两个时点
 *   的 emit 调用（383.4.e.2/f.2 的 Pending Item 路径缺失，RIFT-33/RIFT-120）。
 * 程序只保留结构、目标形状与两处缺口声明；golden 只做校验与结构断言，不为缺口写执行用例。
 *
 * 依赖：RIFT-91（layers-continuous：continuous.might + 期限 + 关键词授予）、
 * RIFT-33/RIFT-120（attack-declared / defense-declared 发射与触发注册）。
 */

/** "one of your other units here"（两个触发共享同一段印刷效果）。 */
const OTHER_UNIT_HERE = "yuumi-magical-cat.other-unit-here";

/** 383.4.e/f：攻击与防守两个触发条件共享同一段效果。 */
function grantMightAndTank(): readonly Instruction[] {
  return [
    {
      // 143.2.a / 475："give … +3 [M] this turn" 是算术图层的临时 Might 修正；
      // 保留形状（见 judgeReason）——合并内核没有可执行路径，不近似用 Buff 表达。
      id: "yuumi-magical-cat.grant-might",
      op: "continuous.might",
      args: {
        amount: { kind: "constant", value: 3 },
        duration: { kind: "constant", value: "end-of-turn" },
        // 355.10.d：只作用于上面选定的那一个目标（对象的选定由 TargetSpec 承担）。
        objects: { kind: "constant", value: { kind: "target", id: OTHER_UNIT_HERE } }
      },
      targets: [
        {
          id: OTHER_UNIT_HERE,
          // 355.9.b / 355.9.c / 359.3.f.1："your other units here"。
          filter: {
            type: "unit",
            zone: "board",
            controller: "controller",
            sameLocationAs: "source",
            exclude: "self"
          },
          min: 1,
          max: 1,
          selection: "one"
        }
      ]
    },
    {
      // 801.3.a："and [Tank] this turn" 是带期限的关键词授予；保留形状（见 judgeReason）。
      id: "yuumi-magical-cat.grant-tank",
      op: "continuous.grant-keyword",
      args: {
        keyword: { kind: "constant", value: "Tank" },
        duration: { kind: "constant", value: "end-of-turn" },
        objects: { kind: "constant", value: { kind: "target", id: OTHER_UNIT_HERE } }
      },
      targets: [
        {
          id: OTHER_UNIT_HERE,
          filter: {
            type: "unit",
            zone: "board",
            controller: "controller",
            sameLocationAs: "source",
            exclude: "self"
          },
          min: 1,
          max: 1,
          selection: "one"
        }
      ]
    }
  ];
}

const abilities: Ability[] = [
  {
    // 383.4.e.1："When I attack" 的 Attack Trigger。
    kind: "triggered",
    trigger: { at: "attack-declared", filter: { event: "attack-declared", filter: { source: "self" } } },
    optional: false,
    body: grantMightAndTank()
  },
  {
    // 383.4.f.1："or defend" 的 Defend Trigger。
    kind: "triggered",
    trigger: { at: "defense-declared", filter: { event: "defense-declared", filter: { source: "self" } } },
    optional: false,
    body: grantMightAndTank()
  }
];

export default {
  canonicalCardId:
    "card.hash-aae7ffb0cf04d0753642ceccd3901394849fd519821df46ff303c0e450bc6e2d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：（1）『give … +3 :rb_might: this turn』没有可执行路径：契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，" +
    "effects/instructions/ 下没有 continuous.might / effect.might-modify 原语，卡程序也没有把持续效果注册进 layers 的指令入口" +
    "（LayerEngine 只消费经 ResolveContext.addContinuous 注册的持续效果），『this turn』的到期（315.4）同样未接线；" +
    "程序按契约形状保留 continuous.might 记录意图，不近似用 effect.buff 表达（702 的 Buff counter 与本修正语义不同）。" +
    "（2）『and [Tank] this turn』需要带期限的关键词授予（801.3.a.2/a.3）：没有 continuous.grant-keyword 原语，" +
    "静态 grant-keyword 持续效果也没有图层消费方。[Tank] 自身的展开文件（815.1）已合入，但战斗分配消费方也缺失。" +
    "（3）attack-declared / defense-declared 没有发射方：events/action-adapter.ts 只按已提交游戏动作派生时点，" +
    "combat/ 尚未把取得 Attacker/Defender 身份接入事件管线，全仓库没有这两个时点的 emit 调用（383.4.e.2/f.2 的 Pending Item 路径缺失）。" +
    "依赖：RIFT-91（layers-continuous：continuous.might + 期限 + 关键词授予）、RIFT-33/RIFT-120（时点发射与触发注册）。" +
    "本卡所有效果都依赖上述缺口，因此 golden 只做校验、结构断言与缺口 todo，不为缺口写执行用例。",
  abilities,
  sourceText:
    "When I attack or defend, give one of your other units here +3 :rb_might: and [Tank] this turn. " +
    "(It must be assigned combat damage first.)"
} satisfies CardProgram;
