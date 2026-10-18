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
 * status = judge-required（2026-10-18 复核）：半段已验证可执行，唯一剩余缺口不近似实现：
 * - "give me +1 [M] this turn" 已被真实执行：解释器登记 arithmetic 层的 continuous.might，
 *   图层求值给出 Might +1，end-of-turn 到期按 315.4 移除（golden 断言注册、加成与到期）。
 * - "Your token units have [Tank]" 的静态授予也已被真实绑定：本卡的 static 效果在
 *   programs/statics.ts 里映射到 ability 层，实测只授予控制者的 token units（敌方 token 不受影响）。
 * - 仍然缺 Tank 的实际战斗伤害分配消费者：keywords/Tank.ts 的展开是 `continuous.combat`
 *   （mode damage-assignment，priority first），layers 没有该 kind 的求值分支，combat 的
 *   基础分配内核要求调用方提供 keywordPriority: "proven-none" 的证明，没有任何已合入路径
 *   读取该注册来排定 815.1.c 的 lethal-first 顺序——所以授予本身可执行，授予的规则行为不可执行。
 *   实测：static binder 接受该 registration（layer=["ability"]），但 layers 的 evaluate 不会
 *   因它改变任何快照，combat/base-combat-allocation.ts 只接受 keywordPriority: "proven-none"。
 * golden 保留 Might 体、Tank 静态绑定与触发注册的真实执行证据，并为战斗分配消费者留 TODO。
 *
 * 依赖：Tank 的 continuous.combat 消费者（815.1.c 战斗伤害分配顺序）。
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
    "唯一当前缺口是 Tank 的战斗伤害分配消费者（815.1.c 的 lethal-first 顺序）：keywords/Tank.ts 的展开是 " +
    "`continuous.combat`（mode damage-assignment、priority first），而 layers/engine.ts 没有该 kind 的求值分支，" +
    "combat/base-combat-allocation.ts 的基础分配内核要求调用方证明 keywordPriority: \"proven-none\"，" +
    "没有任何已合入路径读取该注册来排定分配顺序（实测：registration 能绑定但不改变图层快照，战斗分配仍只接受 proven-none）。" +
    "两个效果半段都有真实执行证据：continuous.might 的算术登记 + 图层加成 + end-of-turn 到期（315.4），" +
    "以及 continuous.grant-keyword 的 static 绑定（实测只授予控制者的 token units）；card-played 触发注册也已合入。" +
    "在战斗分配消费者合入前保持 judge-required。",
  abilities,
  sourceText:
    "When you play a token unit, give me +1 :rb_might: this turn.\n" +
    "Your token units have [Tank]. (They must be assigned combat damage first.)"
} satisfies CardProgram;
