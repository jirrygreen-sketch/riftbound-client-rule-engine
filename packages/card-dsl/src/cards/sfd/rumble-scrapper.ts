import type { CardProgram } from "../../ir/index.js";

/**
 * Rumble, Scrapper (sfd-089-221) — rumble-sfd (RIFT-95).
 *
 * "Your Mechs have +1 [M] (including me).
 *  When I hold, play a 3 [M] Mech unit token to your base."
 *
 * 规则依据（CR v1.5）：
 * - 「Your Mechs have +1 [M] (including me)」是静态算术层 Might 修改（478 / 478.1.a），
 *   由 continuous.might 承载（RIFT-258 的指令原语已合入，layers/engine.ts 的 arithmetic
 *   层能求值 amount/value 并做终值钳制）。
 * - 「When I hold」是 Hold Effect（383.4.d / 471.2 / 473.2.b）：封闭时点 hold 由已合入的
 *   回合/计分流程发出（turn/flow.ts 的 scheduleScore）。
 * - 「play a 3 [M] Mech unit token to your base」：Mech 是 CR 187.4 定义的 3 Might 单位 token，
 *   effect.token 的定义表 id 为 "mech"；440.2.c/185.2.a 的打出流程由 mode "play" 交付
 *   （链上生成后由 play 动作接手；合并内核实测可执行）。
 *
 * status = judge-required：两块都已合入但不是整卡可执行，且不近似实现：
 * - 静态光环没有注册消费方：图层只消费已注册的 ContinuousEffectSpec，把 CardProgram
 *   static 能力接进图层仍是调用方提供的 ProgramStaticBinder 回调（programs/statics.ts
 *   默认 noop，生产路径无调用者）；静态过滤器也没有 programs/filters.ts 那样的
 *   tag→tags / controller→self 翻译（该翻译只在指令 target 路径上接线）。
 * - 光环过滤器无法表达「己方」：layers/filter.ts 的 selectorMatches 把 controller 的
 *   "self"/"opponent" 都用对象自身作为相对玩家求值（"self" 恒真、"opponent" 恒假），
 *   卡牌拼写 "controller" 更不匹配（实测："controller" 不命中、拼成 "self" 后连对手的
 *   Mech 一起 +1）；programs/filters.ts 的 normalizePlayer 只做拼写改写，不能填补该语义。
 * - hold 触发的对象锚点无法命中：turn/flow.ts 发出的 hold 事件只有 player 与
 *   details.battlefieldId、没有 object，而 translateTriggerFilter 把 filter.source: "self"
 *   译成 object.objectId（实测），events/pipeline-match.ts 对无 object 的过滤返回 false，
 *   所以「When I hold」永远不会触发。
 */
export default {
  canonicalCardId: "card.hash-01bd7d3ff52eabd0afc59248a33845b648d9f61db8b544052f51057f967ceb7c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两条能力都有已合入构件，但整卡仍不可执行，且不近似实现：" +
    "(1)「Your Mechs have +1 :rb_might: (including me)」——continuous.might 原语（RIFT-258）与 arithmetic 层求值都已合入，" +
    "但把 CardProgram static 能力接进图层仍靠调用方提供的 ProgramStaticBinder 回调（programs/statics.ts 默认 noop，生产路径无调用者）；" +
    "并且图层过滤器无法表达「己方」：layers/filter.ts 的 selectorMatches 把 controller 的 \"self\"/\"opponent\" 都以对象自身为相对玩家求值" +
    "（\"self\" 恒真、\"opponent\" 恒假），卡牌拼写 \"controller\" 根本不匹配（实测：\"controller\" 不命中，译成 \"self\" 后连对手 Mech 一起 +1），" +
    "programs/filters.ts 的 normalizePlayer 只改写拼写、补不上这条语义。" +
    "(2)「When I hold, play a 3 :rb_might: Mech unit token to your base」——hold 时点本身已由 turn/flow.ts 的计分波发出，" +
    "effect.token 的 mech 定义（187.4）在合并内核实测可真实打出；但 hold 事件不带 object（只有 player 与 details.battlefieldId），" +
    "而 translateTriggerFilter 把 filter.source: \"self\" 译成 object.objectId，events/pipeline-match.ts 对无 object 的过滤返回 false，" +
    "因此「When I hold」永远不会命中。" +
    "依赖：卡牌 static 注册消费方（RIFT-257 后续）、图层过滤器的相对控制者语义、hold 事件的对象/场地身份载荷（RIFT-120/270 后续）。",
  abilities: [
    {
      kind: "static",
      // “Your Mechs have +1 [M] (including me)” — the arithmetic-layer Might
      // modification registered by the merged continuous.might primitive; the
      // source itself is a Mech, so it is inside its own filter (478.1.a).
      effect: {
        kind: "continuous.might",
        // Card-program filter vocabulary (the merged siblings rumble-hotheaded /
        // mechanized-menace use the same `tag` spelling); the layer engine reads
        // `tags`, and no merged static registration path translates it yet.
        filter: { tag: "Mech", controller: "controller", zone: "board" },
        value: { kind: "constant", value: 1 }
      }
    },
    {
      kind: "triggered",
      // “When I hold” — a Hold Effect (383.4.d, 471.2, 473.2.b) at the closed
      // `hold` timing point; the trigger points at this card through the
      // source anchor, which the merged programs layer translates to objectId.
      trigger: {
        at: "hold",
        filter: {
          event: "hold",
          filter: { source: "self" }
        }
      },
      optional: false,
      body: [
        {
          id: "play-mech-token",
          // “play a 3 [M] Mech unit token to your base” — the printed Mech
          // token definition (187.4) played through the chain-creation path
          // (440.2.c / 185.2.a) to the controller's base.
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "mech" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: { kind: "constant", value: { type: "base", player: "you" } }
          }
        }
      ]
    }
  ],
  sourceText:
    "Your Mechs have +1 :rb_might: (including me).\nWhen I hold, play a 3 :rb_might: Mech unit token to your base."
} satisfies CardProgram;
