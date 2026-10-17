import type { CardProgram } from "../../ir/index.js";

/**
 * Wuju Master (unl-191-219) — Legend, Calm/Body, tag Master Yi.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-191-219，逐字）：
 *   [Level 6][>] Your units have +1 :rb_might:. (While you have 6+ XP, get the
 *   effect.)
 *   [Level 11][>] Your units enter ready.
 *
 * 规则依据（CR v1.5）：
 * - 824.1.a / 824.1.b / 824.1.b.1 / 824.1.c：[Level N][>] 是依赖式关键词，从
 *   关键词到子句结尾整段是 Level Ability，功能等价于“当你有 N 点或更多 XP 时，
 *   本牌获得‘[Text]’”；控制者 XP 变化会即时让依赖能力 Active/Inactive
 *   （824.1.c.1 / 824.1.d）。
 * - 第一条依赖能力 “Your units have +1 [M]” 是持续性的图层修正：需要有 XP 门槛
 *   条件的 continuous.might（图层 arithmetic，作用域为你的单位）。
 * - 第二条依赖能力 “Your units enter ready” 是入场状态替代：把单位横置入场
 *   （143.4 / 359.2.c）替换成就绪入场（对照 805.6 的 Accelerate 写法：入场替代，
 *   不是先横置再就绪，不触发“成为就绪”）。
 *
 * status = judge-required（2026-10-17 复核）。
 * - continuous.might 已可绑定；XP 必须来自控制者实时值，不能用场上对象计数冒充。
 *   使用现有 result 条件声明 XP 读数依赖，缺生产方时按不可用信息阻塞；RIFT-268 后续
 *   仍须绑定 Level 依赖能力并随控制者及 XP 变化重算（824.1.c.1/.d）。
 * - “Your units enter ready”引用被替代事件的单位，不能 ready Legend 来源。
 *   replacement.object 是已公开的替代对象链接，但当前 entry binder 只接受 source/self
 *   取向体，拒绝该对象选择符；需要 RIFT-260 后续的按对象入场窗口与条件求值。
 * - test/cards/templates/static-replacement-effect-ready-663.test.mjs 保留真实路径候选及边界；
 *   单卡 golden 仍执行已支持的 Might 子效果，均不作为整卡 executable 证据。
 */
export default {
  canonicalCardId:
    "card.hash-8b7f21bf0986b17b411aeaaeffd500931ea02096c94389c90265a214f7707ab4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺两段生产接线（2026-10-17）：(1) RIFT-268 后续必须提供控制者实时 XP 并绑定 Level 依赖能力，" +
    "按 CR 824.1.b.1/824.1.c.1/824.1.d 重算 Active/Inactive。已修：用现有 result 谓词声明 wuju-master.controller-xp " +
    "读数依赖，不再用 count(subject:controller-xp) 把场上对象数量冒充 XP；当前没有该结果的生产方，缺信息时阻塞。" +
    "continuous.might 的 +1 子效果已支持，但并不证明 XP 门控。" +
    "(2) RIFT-260 后续需要按对象的入场朝向替代窗口（CR 143.4/359.2.c/369.3）：已修 with 的目标为 " +
    "{ linked: replacement.object }，指进入的友方单位而非 Legend 本身。当前 replacement/bind.ts 的 entry-body 检查 " +
    "只接受 source/self，因而拒绝该目标（Unsupported entry body target value），且自身入场路径仍跳过 ability.condition。" +
    "执行证据：test/cards/templates/static-replacement-effect-ready-663.test.mjs；整卡与 XP/友方入场边界仍阻塞，不近似实现。",
  abilities: [
    {
      kind: "static",
      // 824.1.b.1：“当你有 6+ XP 时，本牌获得 ‘Your units have +1 [M]’”。
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        amount: { kind: "constant", value: 1 },
        // 作用域：你的单位（controller 锚点由图层引擎解析）。
        filter: { zone: "board", type: "unit", controller: "controller" }
      },
      condition: {
        kind: "result",
        result: "wuju-master.controller-xp",
        operator: "gte",
        right: { kind: "constant", value: 6 }
      }
    },
    {
      kind: "replacement",
      // “Your units enter ready”：把单位横置入场替换为就绪入场（143.4 / 359.2.c，
      // 对照 805.6）；真实注册与结算属引擎批 4。
      replaces: {
        event: "object-enters-board",
        filter: { controller: "self", type: "unit", exhausted: true }
      },
      condition: {
        kind: "result",
        result: "wuju-master.controller-xp",
        operator: "gte",
        right: { kind: "constant", value: 11 }
      },
      with: [
        {
          id: "wuju-master.enter-ready",
          op: "effect.ready",
          args: { objects: { kind: "constant", value: { linked: "replacement.object" } } }
        }
      ]
    }
  ],
  sourceText:
    "[Level 6][>] Your units have +1 :rb_might:. (While you have 6+ XP, get the effect.)\n" +
    "[Level 11][>] Your units enter ready."
} satisfies CardProgram;
