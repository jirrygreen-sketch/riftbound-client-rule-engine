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
 * - 185.1 / 185.2：token 是对象的固有类别；ObjectFilter 必须同时限定单位类型与 token 类别
 *   （以 type:unit 与 characteristics.isToken:true 同时限定，排除装备 token）。
 * - 143.2.a / 475 / 477："give me +1 :rb_might: this turn" 是带回合末期限的临时 Might 修正，
 *   属算术图层（continuous.might），期限由清理步骤移除（315.4）；effect.buff 只管 702 的
 *   Buff counter，不能替代（其文件头明确二者分工）。
 * - 801.3.a / 815："Your token units have [Tank]" 是把 [Tank] 授予以你控制的 token 单位
 *   （364.1/364.2 的被动能力）；关键词的规则行为由 effects/keywords/Tank.ts 展开，
 *   授予作用域由本卡的 static 效果声明。括号内是 [Tank] 的提醒文字（135.2.d.1/d.3），
 *   不影响规则，不另写指令。
 *
 * 2026-10-18 复核：整卡仍为 judge-required；当前生产缺口见 judgeReason。
 * 已支持子效果的执行证据保留在对应 golden；不以原语存在替代整卡可执行性。
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
        object: { type: "unit", characteristics: { isToken: true }, controller: "self" }
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
        type: "unit",
        characteristics: { isToken: true },
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
    "当前缺口是 Tank 的战斗伤害分配消费者（CR 815.1.b/815.1.c）：continuous.combat 的 damage-assignment/priority:first 声明可以注册，" +
    "KeywordGrantLayerEngine 也能重展开授予的 Tank，但默认 lifecycle 未接入；layers 无该声明的伤害分配执行分支，combat/base-combat-allocation.ts 仍只接受 keywordPriority:proven-none。" +
    "缺少按 Tank 优先且逐单位分配致死伤害的完整战斗路径。continuous.might 的本回合加成与到期、continuous.grant-keyword 的 token unit 过滤及 card-played 订阅已有实测证据；整卡保持 judge-required。",
  abilities,
  sourceText:
    "When you play a token unit, give me +1 :rb_might: this turn.\n" +
    "Your token units have [Tank]. (They must be assigned combat damage first.)"
} satisfies CardProgram;
