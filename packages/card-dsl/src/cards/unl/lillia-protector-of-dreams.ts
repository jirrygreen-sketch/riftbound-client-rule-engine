import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Lillia, Protector of Dreams (unl-058-219) — Unit, 5 Energy、无印刷力量值，
 * Might 4，Calm，tag Fae/Lillia/Ionia/Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-058-219，逐字，含换行）：
 *   When you play a token unit, give me +1 :rb_might: this turn.
 *   Your token units have [Tank]. (They must be assigned combat damage first.)
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a.4："When you play a token unit" 不是 Play Effect（Play Effect 的条件包含
 *   被打出的那张牌本身），而是"另一个对象被打出"的触发；时点 card-played
 *   （events/timing-points.ts，ruleRefs 359 / 383.4.a / 407），filter 取事件对象为
 *   token unit 且由能力控制者控制（ogn/pridestalker 同型）。
 * - 185.1 / 185.2：token 是对象的固有类别；合并的 ObjectFilter 用 type: "token" 表达
 *   （layers/filter.ts 的 typeMatches 与 events/pipeline-match.ts 都按 isToken 匹配）。
 * - 143.2.a / 475 / 477："give me +1 :rb_might: this turn" 是带回合末期限的临时 Might 修正，
 *   属算术图层（continuous.might），期限由清理步骤移除（315.4）；effect.buff 只管 702 的
 *   Buff counter，不能替代（其文件头明确二者分工）。
 * - 801.3.a / 815："Your token units have [Tank]" 是把 [Tank] 授予以你控制的 token 单位
 *   （364.1/364.2 的被动能力）；关键词的规则行为由 effects/keywords/Tank.ts 展开，
 *   授予作用域由本卡的 static 效果声明。括号内是 [Tank] 的提醒文字（135.2.d.1/d.3），
 *   不影响规则，不另写指令。
 *
 * status = judge-required（缺口不近似实现）：
 * - "give me +1 :rb_might: this turn" 没有可执行路径：契约 3.6 的封闭 GameAction 集合没有
 *   Might 修改动作，effects/instructions/ 下没有 continuous.might / effect.might-modify 原语，
 *   卡程序也没有把持续效果注册进 layers 的指令入口（LayerEngine 只消费经
 *   ResolveContext.addContinuous 注册的持续效果），"this turn" 的到期同样未接线（RIFT-91）。
 *   程序按契约形状保留 continuous.might 记录意图，不近似用 effect.buff 表达。
 * - "Your token units have [Tank]" 需要关键词授予的持续效果：effects/instructions/ 没有
 *   continuous.grant-keyword 原语，静态 grant-keyword 也没有图层消费方（sfd/forecaster、
 *   sfd/mechanized-menace 记录同一缺口）；[Tank] 自身的展开文件（815.1）已合入，
 *   但战斗伤害分配的消费方（815.1.c 的分配优先级）也尚未合入。
 * - card-played 触发仍未接线：没有订阅方把卡程序的 triggered ability 注册成
 *   TriggerRegistration，事件载荷也不含"该牌是 token"之外的打出者信息（RIFT-120）。
 * 程序保留触发结构、目标/作用域形状与两处缺口声明；golden 只做校验与结构断言。
 *
 * 依赖：RIFT-91（layers-continuous：continuous.might + 期限 + 关键词授予）、
 * RIFT-120（触发注册）、战斗伤害分配批次。
 */

const abilities: Ability[] = [
  {
    kind: "triggered",
    // 383.4.a.4："当一个 token 单位被打出" 的触发；时点 card-played，
    // 事件对象是刚被打出的那个 token 单位（185.1/185.2）。
    trigger: {
      at: "card-played",
      filter: {
        event: "card-played",
        object: { type: "token", controller: "self" }
      }
    },
    optional: false,
    body: [
      {
        // 143.2.a / 475："give me +1 [M] this turn" 是算术图层的临时 Might 修正；
        // 保留形状（见 judgeReason）——合并内核没有可执行路径，不近似用 Buff 表达。
        id: "lillia-protector-of-dreams.grant-might",
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 1 },
          duration: { kind: "constant", value: "end-of-turn" }
        },
        targets: [
          {
            id: "lillia-protector-of-dreams.self",
            // 355.9.c / 053.1："me" 是能力宿主本身，用 object: "self" 锚点声明。
            filter: { type: "unit", zone: "board", object: "self" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  },
  {
    // 801.3.a / 364.1："Your token units have [Tank]" 是关键词授予的静态效果；
    // 保留形状（见 judgeReason）：没有 continuous.grant-keyword 原语，
    // 静态 grant-keyword 也没有图层消费方。
    kind: "static",
    effect: {
      kind: "continuous.grant-keyword",
      keyword: "Tank",
      filter: {
        type: "token",
        controller: "controller",
        zone: "board"
      }
    }
  }
];

export default {
  canonicalCardId:
    "card.hash-6e0aa33991db4d3499a6f694e8bef73ea18c9f5a92c1cff628ee2afc84a34321",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：（1）『give me +1 :rb_might: this turn』没有可执行路径：契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，" +
    "effects/instructions/ 下没有 continuous.might / effect.might-modify 原语，卡程序也没有把持续效果注册进 layers 的指令入口" +
    "（LayerEngine 只消费经 ResolveContext.addContinuous 注册的持续效果），『this turn』的到期（315.4）同样未接线；" +
    "程序按契约形状保留 continuous.might 记录意图，不近似用 effect.buff 表达。" +
    "（2）『Your token units have [Tank]』需要关键词授予的持续效果：没有 continuous.grant-keyword 原语，" +
    "静态 grant-keyword 也没有图层消费方；[Tank] 自身的展开文件（815.1）已合入，但战斗伤害分配的消费方（815.1.c）尚未合入。" +
    "（3）card-played 触发缺少注册方：没有订阅方把卡程序的 triggered ability 注册成 TriggerRegistration（RIFT-120）。" +
    "依赖：RIFT-91（layers-continuous：continuous.might + 期限 + 关键词授予）、RIFT-120（触发注册）、战斗伤害分配批次。" +
    "本卡所有效果都依赖上述缺口，golden 只做校验、结构断言与缺口 todo。",
  abilities,
  sourceText:
    "When you play a token unit, give me +1 :rb_might: this turn.\n" +
    "Your token units have [Tank]. (They must be assigned combat damage first.)"
} satisfies CardProgram;
