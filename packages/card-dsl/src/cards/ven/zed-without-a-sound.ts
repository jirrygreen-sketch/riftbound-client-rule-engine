import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Zed, Without a Sound (ven-112-166) — Unit, 5 Energy, Might 5, Chaos,
 * tags Ionia / Zed / Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-112-166，逐字）：
 *   When I conquer, play a 0 :rb_might: Shadow Clone unit token to your base.
 *   (It has "When I attack, you may banish a unit from your trash. If you do,
 *   give me [Assault 4] this turn.")
 *   [Action][>] :rb_energy_1::rb_rune_chaos:: Move me and a Shadow Clone you
 *   control to each other's locations.
 *
 * 规则依据（CR v1.5）：
 * - 383.4.c / 383.4.c.1 / 473.2.a：「When I conquer」是 Conquer Effect，封闭时点
 *   "conquer"（events/timing-points.ts，ruleRefs 468.5.d / 471.1 / 473.2.a）。
 * - 440.2.c / 185.2.a / 350.2 / 354：被「打出」的新 token 先在链上创建、再由 play
 *   动作接手，所以 effect.token 用 mode "play"；「to your base」是 355.2.a 的默认合法
 *   位置，静态 IR 用 { type: "base", player: "controller" } 占位（与 ven-128-166
 *   Noxian Emissary 同款约定，运行时由 Finalize / 管线绑定具体玩家）。
 * - 806.1.d / 381.1 / 404.1.a：「[Action][>]」修饰其后的启动能力，契约 3.1 用
 *   activated.timing = "action" 记录；印刷费「:rb_energy_1::rb_rune_chaos:」是 1 Energy
 *   加一枚 Chaos Power（163.2），写成 CostSpec 的 energy + power。
 * - 355.4 / 448.3：交换位置必须先把两处原始位置锁定、再执行两次 Move，否则第二次移动
 *   会读到已被移动后的位置（与已合入 ogn/tideturner 的交换写法一致）。
 * - 355.7 / 355.9.a：「a Shadow Clone you control」是玩家在结算前选定的游戏对象，写成
 *   TargetSpec；「Shadow Clone」是 token 的印刷名，静态 IR 用 characteristics.name 记录
 *   （程序绑定会把 controller: "controller" 归一化为能力控制者，并由匹配器读取 name 特征）。
 *
 * status = judge-required（两处缺口，均不近似实现）：
 * 1. Shadow Clone token 定义缺失：该 token 自带攻击触发能力（banish + [Assault 4]），
 *    effects/instructions/effect.token.ts 的冻结定义表按设计只含无额外能力的
 *    recruit / sand-soldier / mech / reflection / tentacle；以该定义调用会得到
 *    negated + blockedReason "token-definition-or-abilities-judge-required"。本卡保留
 *    有依据的 effect.token IR（与 sfd/trove-golem 的 Gold 写法一致），但不宣称可执行，
 *    golden 也不断言「当前被拒绝」（依赖落地后会失效）。
 * 2. conquer 触发的闭合事件已有 `conquered` 判别词和程序绑定，但 `turn/flow.ts` 的
 *    conquer Score 发射只携带 player/details，不携带征服单位对象；事件匹配器因此无法用
 *    `source: self` 匹配到本单位，不能把触发改成仅按玩家匹配来近似。
 * 交换本体（两条 condition.value 锁位 + 两条 effect.move）以及 [Action][>] 的费用均只用已合入原语，golden 用真实
 * 解释器 + 参考内核执行。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "conquer",
      // EventPattern 的闭合判别词是 "conquered"；TimingPoint 仍是 "conquer"。
      filter: { event: "conquered", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "zed-without-a-sound.play-shadow-clone",
        op: "effect.token",
        args: {
          // 440.2.c / 185.2.a / 186 / 350.2 / 354：被“打出”的新 token 先在链上生成，
          // 再由 play 动作接手；这是 token 进入 Board 的唯一合法顺序。
          token: { kind: "constant", value: "shadow-clone" },
          amount: { kind: "constant", value: 1 },
          mode: { kind: "constant", value: "play" },
          // “to your base”：单位 token 的唯一合法 Base 目的地是控制者自己的 Base。
          location: {
            kind: "constant",
            value: { type: "base", player: "controller" }
          }
        }
      }
    ]
  },
  {
    kind: "activated",
    // [Action][>]：能力级许可关键词（806.1.d），按契约 3.1 记在 activated.timing。
    timing: "action",
    cost: {
      kind: "activated",
      // :rb_energy_1: 是 1 Energy；:rb_rune_chaos: 是一枚 Chaos Power（163.2、404.1.a）。
      energy: { kind: "constant", value: 1 },
      power: { kind: "constant", value: ["Chaos"] }
    },
    body: [
      {
        // 355.4 / 448.3：移动目的地必须在移动前选定，先锁我的原始位置。
        id: "zed-without-a-sound.origin",
        op: "condition.value",
        args: {
          value: {
            kind: "object-property",
            object: "self",
            property: "location"
          },
          key: { kind: "constant", value: "origin" }
        }
      },
      {
        // 再锁被选 Shadow Clone 的原始位置（第二次移动的目的地）。
        id: "zed-without-a-sound.clone-location",
        op: "condition.value",
        args: {
          value: {
            kind: "object-property",
            object: { target: "zed-without-a-sound.clone" },
            property: "location"
          },
          key: { kind: "constant", value: "cloneLocation" }
        },
        targets: [
          {
            id: "zed-without-a-sound.clone",
            // “a Shadow Clone you control”：token 的印刷名用 characteristics.name 记录
            // 程序绑定会把 controller: "controller" 归一化为能力控制者。
            filter: {
              type: "unit",
              zone: "board",
              controller: "controller",
              characteristics: { name: "Shadow Clone" }
            },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      },
      {
        id: "zed-without-a-sound.move-me",
        op: "effect.move",
        args: {
          objects: { kind: "constant", value: "self" },
          to: {
            kind: "linked-value",
            instructionId: "zed-without-a-sound.clone-location",
            key: "cloneLocation"
          },
          linkKey: { kind: "constant", value: "movedMe" }
        }
      },
      {
        id: "zed-without-a-sound.move-clone",
        op: "effect.move",
        args: {
          objects: {
            kind: "constant",
            value: { target: "zed-without-a-sound.clone" }
          },
          to: {
            kind: "linked-value",
            instructionId: "zed-without-a-sound.origin",
            key: "origin"
          },
          linkKey: { kind: "constant", value: "movedClone" }
        },
        targets: [
          {
            id: "zed-without-a-sound.clone",
            filter: {
              type: "unit",
              zone: "board",
              controller: "controller",
              characteristics: { name: "Shadow Clone" }
            },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-5b42742bf383c1d6c7809e387ff198cfe26b37f06ef74cd7742bf390ea3cf2a7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1) 「play a 0 :rb_might: Shadow Clone unit token to your base」的 token 定义缺失——" +
    "Shadow Clone 自带攻击触发能力（banish + [Assault 4]），而 effects/instructions/effect.token.ts 的冻结定义表按设计只含" +
    "无额外能力的 recruit / sand-soldier / mech / reflection / tentacle，对 shadow-clone 执行会 negated + " +
    "blockedReason \"token-definition-or-abilities-judge-required\"；(2) conquer 触发的闭合事件判别词已改为 " +
    "\"conquered\"，但 turn/flow.ts 的 conquer Score 发射只携带 player/details，不携带征服单位对象，" +
    "事件匹配器因此无法用 source: self 匹配到本单位，不能把触发改成仅按玩家匹配来近似。" +
    "[Action][>] 的 1 Energy + 1 Chaos Power 费用以及交换本体（两条 condition.value 锁位 + 两条 effect.move，" +
    "355.4 / 448.3）均已有 Finalize/Chain 接线，golden 用真实解释器执行；token 与真实 conquer 来源对象保持 test.todo。",
  abilities,
  sourceText:
    'When I conquer, play a 0 :rb_might: Shadow Clone unit token to your base. (It has "When I attack, ' +
    'you may banish a unit from your trash. If you do, give me [Assault 4] this turn.")\n' +
    "[Action][>] :rb_energy_1::rb_rune_chaos:: Move me and a Shadow Clone you control to each other's locations."
} satisfies CardProgram;
