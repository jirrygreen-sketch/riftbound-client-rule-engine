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
 * status = judge-required（唯一缺口是时点发射路径）：
 * - attack-declared 时点没有发射方——combat/ 批次尚未把“取得 Attacker 身份”接入事件管线
 *   （combat/flow.ts 在战斗开始时直接抛 TurnCombatBlockedError；全仓库没有 attack-declared
 *   的 emit 调用），因此该触发无法进入链（383.4.e.2 要求 Attacker 身份取得后把触发作为
 *   Pending Item 放到链上）。现有卡牌触发绑定已合入，仍缺战斗发射事务。
 * - body 本身只用已合入的 effect.ready：golden 用真实解释器与参考内核执行程序原始 body，
 *   并覆盖“已经就绪则什么都不发生”（416.1.b/c）与目标失效（359.3.e.6/e.7）两个边界。
 * 不近似实现：不用别的时点（如 card-played 或任何移动/战斗动作）冒充“When I attack”。
 */
export default {
  canonicalCardId: "card.hash-06ec9960630fdb489ea65176cf2d899ccda0784b50dcc84efaf98e95381f6d46",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "唯一缺口是 attack-declared 时点没有发射方：383.4.e/383.4.e.2 要求单位取得 Attacker 身份后把该触发" +
    "作为 Pending Item 放到链上，但 combat/ 批次尚未把 Attacker 身份接入事件管线（combat/flow.ts 在战斗" +
    "开始时直接抛 TurnCombatBlockedError，全仓库没有 attack-declared 的 emit 调用），触发无法进入链。" +
    "依赖 combat/flow.ts 的 attack-declared 战斗发射路径。body 的「ready another friendly unit」" +
    "只用已合入的 effect.ready（416.1；「another」以契约 3.6 的 exclude: \"self\" 排除来源自身），" +
    "golden 用真实解释器执行并覆盖已就绪无操作与目标失效边界。不近似实现（不用其它时点冒充攻击触发）。",
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
