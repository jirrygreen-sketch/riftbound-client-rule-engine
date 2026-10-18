import type { CardProgram } from "../../ir/index.js";

/**
 * Twilight Reveler (ven-020-166) — Unit, 3 Energy（无印刷 Power），3 Might,
 * Fury, Ionia。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-020-166，逐字）：
 *   When I attack, ready another friendly unit.
 *
 * 规则依据（CR v1.5）：
 * - 383.4.e / 383.4.e.1 / 383.4.e.2："When I attack" 是 Attack Trigger，时点是封闭时点
 *   events/timing-points.ts 的 "attack-declared"（ruleRefs 323.2/383.4.e/466.2.c）；
 *   383.4.e.2.a 规定每个战斗只检查一次触发条件，故 once: "per-combat"（同型先例见已合入的
 *   sfd/ahri-inquisitive 与 ogn/chemtech-enforcer 的写法）。
 * - 416.1/416.1.b/416.1.c："ready" 是 Ready 动作——把横置对象变为就绪；已经就绪的对象
 *   不再重置（"nothing additional happens"），已合入的 effect.ready 原语正是这个语义。
 * - 355.9.b/355.10/740.1.a："another friendly unit" 是控制者选择的一个具体对象，属目标
 *   （未特别说明时 "unit" 指 Board 上的单位，355.9.a.1）；"another" 排除来源自身
 *   （355.9.c），用契约 3.6 的 exclude 锚点表达。
 *
 * status = judge-required（两处缺口，均不近似实现）：
 * - attack-declared 时点没有发射方——combat/flow.ts:151 的战斗开始事务直接抛
 *   TurnCombatBlockedError('combat-start-transaction')，全仓库没有 attack-declared 的 emit
 *   调用（docs/rules/timing-point-producers.md 仍标“待后续”），因此该触发无法进入链
 *   （383.4.e.2 要求 Attacker 身份取得后把触发作为 Pending Item 放到链上）。
 * - “another friendly unit” 的 exclude 锚点在卡牌绑定路径不可消费：
 *   programs/filters.ts 的 translateObjectFilter 以 "Unsupported filter field exclude" 拒绝，
 *   所以即使时点补齐，translateInstructionTargets 也会让 registerProgramTriggers 失败；
 *   解释器的集合查询本身已消费该锚点（queryObjects 的 OBJECT_FILTER_ANCHORS 分支），
 *   缺的是卡牌绑定对 TargetSpec.filter 的翻译。
 * - body 本身只用已合入的 effect.ready：golden 用真实解释器与参考内核执行程序原始 body，
 *   并覆盖“已经就绪则什么都不发生”（416.1.b/c）与目标失效（359.3.e.6/e.7）两个边界。
 * 不近似实现：不用别的时点（如 card-played 或任何移动/战斗动作）冒充“When I attack”。
 */
export default {
  canonicalCardId: "card.hash-06ec9960630fdb489ea65176cf2d899ccda0784b50dcc84efaf98e95381f6d46",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1) attack-declared 时点没有发射方：383.4.e/383.4.e.2 要求单位取得 Attacker " +
    "身份后把该触发作为 Pending Item 放到链上，但 combat/flow.ts:151 的战斗开始事务直接抛 " +
    "TurnCombatBlockedError('combat-start-transaction')，全仓库没有 attack-declared 的 emit 调用，触发无法进入链。" +
    "(2) 「another friendly unit」的 exclude: \"self\" 锚点在卡牌绑定路径不可消费：programs/filters.ts 的 " +
    "translateObjectFilter 以 \"Unsupported filter field exclude\" 拒绝（本任务实测 registerProgramTriggers 直接抛错）；" +
    "解释器的集合查询消费该锚点，但生产卡牌绑定没有对应翻译。" +
    "body 的「ready another friendly unit」只用已合入的 effect.ready（416.1），golden 用真实解释器执行并覆盖" +
    "已就绪无操作与目标失效边界。依赖 combat/flow.ts 的 attack-declared 战斗发射路径与 exclude 锚点的卡牌绑定翻译。" +
    "不近似实现（不用其它时点冒充攻击触发）。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "attack-declared",
        filter: { event: "attack-declared", filter: { source: "self" } },
        // 383.4.e.2.a：攻击触发的条件每个战斗只检查一次。
        once: "per-combat"
      },
      optional: false,
      body: [
        {
          id: "twilight-reveler.ready-another-friendly-unit",
          op: "effect.ready",
          args: {
            objects: {
              kind: "constant",
              value: { kind: "target", id: "twilight-reveler.another-friendly-unit" }
            },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "twilight-reveler.another-friendly-unit",
              // "another friendly unit"：控制者为能力控制者、排除来源自身（355.9.c）。
              filter: {
                type: "unit",
                zone: "board",
                controller: "controller",
                exclude: "self"
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "When I attack, ready another friendly unit."
} satisfies CardProgram;
