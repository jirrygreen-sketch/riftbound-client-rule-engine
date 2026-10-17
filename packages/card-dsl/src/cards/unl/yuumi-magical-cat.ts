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
 * status = judge-required（2026-10-17 复核）：
 * continuous.might / continuous.grant-keyword 及图层期限均已合入；golden 用原始 body 经
 * resolveChainBody + 测试内核执行，断言 +3、Tank、失效目标与图层到期。仍有三处整卡缺口：
 * - combat/flow.ts 仍阻断战斗开始事务，尚未发出携带取得身份单位的 attack/defense 时点；
 * - programs/filters.ts 的目标绑定尚不能翻译 sameLocationAs / exclude 锚点，不能丢弃
 *   “other / here” 限制（RIFT-359）；
 * - Tank 已能授予为特征，但 continuous.combat 的 lethal-first 分配要求尚未被战斗消费（815.1.b）。
 * 两个触发各用 once: per-combat，遵循 383.4.e.2.a / 383.4.f.2.a。
 */

/** "one of your other units here"（两个触发共享同一段印刷效果）。 */
const OTHER_UNIT_HERE = "yuumi-magical-cat.other-unit-here";

/** 383.4.e/f：攻击与防守两个触发条件共享同一段效果。 */
function grantMightAndTank(): readonly Instruction[] {
  return [
    {
      // 143.2.a / 475："give … +3 [M] this turn" 是算术图层的临时 Might 修正；
      // 已合入的算术图层原语；不使用 Buff 计数器替代。
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
            controller: "self",
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
      // 801.3.a：已合入的关键词授予入口；Tank 的分配规则由战斗消费者负责。
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
            controller: "self",
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
    trigger: { at: "attack-declared", filter: { event: "attack-declared", filter: { source: "self" } }, once: "per-combat" },
    optional: false,
    body: grantMightAndTank()
  },
  {
    // 383.4.f.1："or defend" 的 Defend Trigger。
    kind: "triggered",
    trigger: { at: "defense-declared", filter: { event: "defense-declared", filter: { source: "self" } }, once: "per-combat" },
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
    "仍缺：(1) combat/flow.ts 的战斗开始事务与取得 Attacker/Defender 身份的单位时点载荷" +
    "（383.4.e.2/f.2、466.2.c）；(2) programs/filters.ts 尚不能把目标的 sameLocationAs/exclude 锚点" +
    "编译进 Finalize，需保留「one of your other units here」的完整限制（RIFT-359）；" +
    "(3) Tank 的 continuous.combat lethal-first 伤害分配要求尚未接入战斗消费者（815.1.b）。",
  abilities,
  sourceText:
    "When I attack or defend, give one of your other units here +3 :rb_might: and [Tank] this turn. " +
    "(It must be assigned combat damage first.)"
} satisfies CardProgram;
