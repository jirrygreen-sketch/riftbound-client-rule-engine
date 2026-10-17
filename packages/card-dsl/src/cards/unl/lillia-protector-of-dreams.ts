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
 * - `continuous.might` 的解释器、arithmetic 图层和 end-of-turn 到期已经合入；本卡的触发体
 *   可以通过解释器真实登记该修正。
 * - `continuous.grant-keyword`、Tank KeywordDef 和 CardProgram static binder 已经合入；本卡的
 *   static 能力可以真实把 Tank 授予己方 token units。
 * - Tank 的实际战斗伤害分配消费者仍缺失（815.1.c 的 lethal-first 顺序），所以整卡不能标记
 *   executable。card-played 触发注册也已经合入。
 * 程序保留触发结构与作用域形状；golden 执行 Might 体、Tank 静态绑定和触发注册，缺口以 test.todo 记录。
 *
 * 依赖：Tank 战斗伤害分配消费者（815.1.c）。
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
        // continuous.might 经解释器登记 arithmetic 层修正，不用 Buff 表达。
        id: "lillia-protector-of-dreams.grant-might",
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 1 },
          duration: { kind: "constant", value: "end-of-turn" },
          // 355.9.c / 053.1："me" 是能力宿主本身；appliesTo self 由解释器直接绑定来源。
          appliesTo: { kind: "constant", value: "self" }
        }
      }
    ]
  },
  {
    // 801.3.a / 364.1："Your token units have [Tank]" 是关键词授予的静态效果；
    // continuous.grant-keyword 与 static binder 已合入；Tank 的战斗分配消费者仍缺失。
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
    "当前唯一的规则缺口是 Tank 的战斗伤害分配消费者（815.1.c）：continuous.might 的算术登记与本回合到期、" +
    "continuous.grant-keyword 的 static binder、Tank KeywordDef 以及 card-played CardProgram 触发注册都已合入。" +
    "因此本卡的两个效果半段均有执行证据，但在战斗分配消费者合入前仍保持 judge-required。",
  abilities,
  sourceText:
    "When you play a token unit, give me +1 :rb_might: this turn.\n" +
    "Your token units have [Tank]. (They must be assigned combat damage first.)"
} satisfies CardProgram;
