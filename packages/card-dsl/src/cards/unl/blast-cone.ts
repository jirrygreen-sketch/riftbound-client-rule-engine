import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Blast Cone (unl-133-219) — Gear, Chaos。
 * energy 4、power 1（Chaos）、might null（无印刷 Might）、tags []。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-133-219，逐字）：
 *   When you play this, you may move an enemy unit.
 *   When you move an enemy unit, you may exhaust this to [Stun] it.
 *   (It doesn't deal combat damage this turn.)
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a.1：When you play this 是本卡的 Play Effect，时点 card-played、事件过滤指向本源
 *   （同 sfd/disarming-rake、ogn/maddened-marauder 的既有写法）。
 * - 403.1 / 契约 3.9：效果首段的 you may 写成 choice.optional 把被选指令包在 body 里。
 * - 355.7 / 355.10：an enemy unit 是玩家选择的 Board 对象，因此是目标。
 * - 355.4 / 355.4.a / 451.1：Move an enemy unit 的目的地在结算前的选择阶段由控制者从
 *   「当前位置之外、且该单位被允许出现」的合法 Location 中选；目的地在原文里没有印刷，
 *   静态 IR 也无法枚举运行期合法 Location。
 * - 421.1 / 449.1 / 449.2 / 458 / 458.1：When you move an enemy unit 指一次成功完成的 Move
 *   （封闭时点 object-moved），Recall 不是 Move、不触发移动能力。
 * - 412.4 / 412.5：you move 是动作责任归因——移动由本能力控制者执行，而不是被移动单位的
 *   控制者；这是过滤「你移动的」敌方单位所必需的载荷信息。
 * - 355.10.c / 355.10.c.1：it 是被移动的那个单位，出现在费用冒号之前的
 *   exhaust this to [Stun] it 里属于指令内的费用与指代，不是选择；exhaust this 是效果内的
 *   费用（383.3.b 的基础费用，见 judgeReason）。
 * - 424.1 / 424.1.a.1：Stun 是二元状态，已 Stunned 的单位不再被 Stun；括号内的「本回合不
 *   造成战斗伤害」是 424.1.b 的规则结果，不是独立指令。
 *
 * status = judge-required（README 第 2 节，2026-10-18 复核），缺口逐条列出且不近似实现：
 * (1) Move 目的地在运行期选择（355.4.a）：位置选择面已合入（target/location 的
 *     chooseLocations + Expr.kind "location"），但候选集合表达不出 355.4.a 的合法性——
 *     chooseLocations 只提供 type/kind、occupied、open、controlled、contested、hasUnits、
 *     player/owner/controller 这些谓词，LocationCandidateOptions.exclude 需要调用方注入而
 *     解释器不传。实测 type:"any" 的候选包含被移动单位的当前位置，也包含并非其控制者的基地；
 *     写进 IR 会把非法目的地交给玩家（选中当前位置时 effect.move 静默不移动却返回 executed）。
 *     程序因此保留描述性占位，effect.move 在目的地上 fail closed
 *     （实测 TypeError: effect.move to must be a location, controller-base, or location choice）。
 * (2) you move an enemy unit 缺可判定载荷：events/action-adapter.ts 为 move-location 生成的
 *     object-moved 事件把 player 记成被移动对象的原控制者（move-location 动作不带 player），
 *     也没有 cause 归因，因此无法按 412.4 / 412.5 过滤「由你执行」的移动（同 ogn/radiant-dawn
 *     对 unit-stunned 责任归因的同一类缺口）。
 * (3) it 无法指称触发载荷的对象：冻结的 ObjectSelector 集合是 self / source / target / pick /
 *     linked，没有事件对象选择器（同 ogn/back-alley-bar 的契约变更请求）；下方 TargetSpec 只是
 *     让指代有名字的声明式替身，不是该效果做出的目标选择（355.10.c）。
 * (4) 383.3.b 的“exhaust this”紧跟触发效果的 may，按规则属于触发能力基础费用。
 *     TriggerRegistration.cost/mayAtFinalize 已存在且 chain/engine 在 Finalize 消费，但
 *     programs/triggers.ts 只搬运 body/optional/spec，不把 CC 内嵌的 cost.pay 提取进
 *     TriggerRegistration.cost；契约 3.1 的 TriggeredAbility 也没有 cost 槽位。实测该触发的
 *     registration.cost === null、mayAtFinalize === null，因此仍不能把它当作普通结算指令近似。
 *     卡牌 triggered 注册本身已经接通。
 * effect.move 与 effect.stun 本体已合入，golden 真实执行这两条原语路径。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "blast-cone.may-move-enemy-unit",
        op: "choice.optional",
        args: {
          prompt: { kind: "constant", value: "Move an enemy unit?" },
          body: {
            kind: "constant",
            value: [
              {
                id: "blast-cone.move-enemy-unit",
                op: "effect.move",
                args: {
                  objects: {
                    kind: "constant",
                    value: { target: "blast-cone.enemy-unit" }
                  },
                  // 355.4 / 355.4.a：目的地在选择阶段由控制者从运行期合法 Location 中选。
                  // 静态 IR 无法枚举它（见 judgeReason 第 1 点），因此这里是描述性占位：
                  // effect.move 会拒绝该形状而不是落到错误地点。
                  to: {
                    kind: "constant",
                    value: {
                      kind: "choose",
                      id: "blast-cone.destination",
                      options: ["runtime:valid-move-destination"]
                    }
                  },
                  linkKey: { kind: "constant", value: "moved" }
                },
                targets: [
                  {
                    id: "blast-cone.enemy-unit",
                    filter: { type: "unit", controller: "opponent" },
                    min: 1,
                    max: 1,
                    selection: "one"
                  }
                ]
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
      at: "object-moved",
      // you move an enemy unit：事件对象是敌方单位，移动由本能力控制者执行
      // （412.4 / 412.5）。载荷缺口见 judgeReason 第 2 点。
      filter: {
        event: "object-moved",
        object: { type: "unit", controller: "opponent" },
        player: "self"
      }
    },
    optional: false,
    body: [
      {
        id: "blast-cone.may-exhaust-to-stun",
        op: "choice.optional",
        args: {
          prompt: { kind: "constant", value: "Exhaust this to stun it?" },
          body: {
            kind: "constant",
            value: [
              {
                id: "blast-cone.pay-exhaust",
                op: "cost.pay",
                args: {
                  payments: {
                    kind: "constant",
                    value: [{ kind: "exhaust", object: "self" }]
                  }
                }
              },
              {
                id: "blast-cone.stun-moved-unit",
                op: "effect.stun",
                linkedTo: "blast-cone.pay-exhaust",
                args: {
                  target: { kind: "constant", value: "blast-cone.moved-unit" }
                }
              }
            ]
          }
        },
        // 声明式替身：it 是被移动单位，不是本效果选择的目标（355.10.c）；真实绑定需要
        // 事件对象选择器（见 judgeReason 第 3 点，同 sfd/soraka-wanderer 的写法）。
        targets: [
          {
            id: "blast-cone.moved-unit",
            filter: { zone: "board", type: "unit" },
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
    "card.hash-3ffea48ff592a10eca59908e205019c7f50fddff02d49b1eede58694d9b2b348",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处当前缺口，均不近似实现（2026-10-18 复核）：(1) Move 目的地在运行期选择（355.4 / 355.4.a / 451.1）：位置选择面已合入，" +
    "但候选集合没有 355.4.a 要求的 exclude-current-location 谓词（解释器 chooseLocations 不注入 LocationCandidateOptions.exclude，" +
    "matchesFilter 也没有 current 谓词）；实测 type:\"any\" 的候选包含被移动单位的当前位置，写进 IR 会把非法目的地交给玩家，" +
    "因此保留被 effect.move 拒绝的描述性占位（fail closed），不猜目的地。" +
    "(2)「you move an enemy unit」缺可判定载荷：events/action-adapter.ts 的 object-moved 事件把 player 记成被移动对象的原控制者" +
    "（move-location 动作不带 player），也没有 cause 归因，无法按 412.4 / 412.5 过滤「由你执行」的移动（同 ogn/radiant-dawn 的责任归因缺口）。" +
    "(3)「it」是被移动单位，而冻结的 ObjectSelector 集合（self / source / target / pick / linked）没有事件对象选择器" +
    "（同 ogn/back-alley-bar 的契约变更请求）；程序里的 TargetSpec 是声明式替身（355.10.c：触发条件与费用里的对象不是目标），" +
    "不是该效果做出的目标选择。" +
    "(4)「you may exhaust this to [Stun] it」中横置费用按 383.3.b 属于触发能力基础费用；TriggerRegistration.cost/mayAtFinalize 已合入且 Finalize 会消费它们，" +
    "但 programs/triggers.ts 不把 body 内嵌的 cost.pay 提取进 TriggerRegistration.cost，契约 3.1 的 TriggeredAbility 也没有 cost 槽位" +
    "（实测 registration.cost === null、mayAtFinalize === null），不能把它当作普通结算指令近似。" +
    "CardProgram 的 triggered 注册已经接通。effect.move 与 effect.stun 本体已合入，golden 真实执行这两条原语路径。",
  abilities,
  sourceText:
    "When you play this, you may move an enemy unit.\n" +
    "When you move an enemy unit, you may exhaust this to [Stun] it. (It doesn't deal combat damage this turn.)"
} satisfies CardProgram;
