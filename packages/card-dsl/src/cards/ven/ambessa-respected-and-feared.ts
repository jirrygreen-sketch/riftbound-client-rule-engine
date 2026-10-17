import type { CardProgram } from "../../ir/index.js";

/**
 * Ambessa, Respected and Feared (ven-136-166) — Unit, 5 Energy, 5 Might, Order,
 * Noxus/Ambessa/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-136-166，逐字）：
 *   [Empower] :rb_energy_1::rb_rune_order::rb_rune_order:
 *   (:rb_energy_1::rb_rune_order::rb_rune_order:: Empower me. Use only if not
 *   Empowered.)
 *   [Empowered][>] I have [Assault 2]. (+2 :rb_might: while I'm an attacker.)
 *   [Empowered][>] When I attack, kill an enemy unit here with less Might than me.
 *
 * 规则依据（CR v1.5）：
 * - 827.1/827.1.c.1：[Empower] 是启动能力关键词，功能等价于“[1 Energy + 2 Order
 *   Power]：Empower me。仅当未 Empowered 时启动。”
 * - 828.1.a/828.1.b.1：[Empowered][>] 是依赖型关键词，整段功能等价于“当我拥有
 *   Empowered 状态时，此牌获得 [Text]”。
 * - 807.1.c：Assault 2 功能等价于“当我是攻击者时 +2 [M]”；已合入的关键词展开
 *   （keywords/Assault.ts）负责该效果，卡程序只声明授予。
 * - 383.4.e / 466.2.c：“When I attack” 是攻击触发（attack-declared）。
 * - “kill an enemy unit here with less Might than me”：单个敌方单位是选目标
 *   （355.9/355.10.g）；“here” = 宿主所在战场（sameLocationAs 宿主）；
 *   “with less Might than me” 是结算时的目标效力比较（契约 3.6）。effect.kill 已合入。
 *
 * 复核（2026-10-17，第一轮 M2 覆盖率复核）：原第 3 条已解决——continuous.grant-keyword
 * 指令原语随 RIFT-258 合入（effects/instructions/continuous.grant-keyword.ts，注册表可见），
 * 它按 478.1.a 建立 ability 层注册；卡侧选择器写法与 smoke-screen / siphon-power 一致。
 * 攻击触发的 “kill an enemy unit here with less Might than me” 半段仍用真实解释器 +
 * 生产链适配器执行（含 Might 不小于我时不消灭的边界）。
 *
 * status = judge-required（唯一未解决的依赖仍是 Empower / Empowered）：
 * 1. 没有 Empower / Empowered 的 KeywordDef（effects/keywords/registry.generated.ts
 *    的 RIFT-81~88 与 264~268 两批都不含它们），827.1.c.1 的“1 Energy + 2 Order Power：
 *    Empower me，仅当未 Empowered 时启动”无法展开；
 * 2. 没有 Empowered 状态谓词（442.1.a）：ObjectSnapshot / Condition 都没有该二元状态，
 *    两条 [Empowered][>] 依赖能力（828.1.b.1）的门槛不可求值。程序里的 empowered /
 *    empoweredCount 只是描述性记录：Condition 的 expression 分支在图层里落回
 *    conditionMatches 的默认 true（layers/engine.ts），所以这些静态能力即使被绑定
 *    也会恒真，不能当作可执行门控；
 * 3. 依赖 828.1.d 的“成为 Empowered”来源事件与 Empowered 谓词一起落地后，本卡才能复核。
 * 依赖新的 Empower/Empowered 关键词任务。不近似实现（不把依赖能力改成无条件能力）。
 */
export default {
  canonicalCardId: "card.hash-e8af5c2839945839572f9122c2803fdda719845f1a7356eca006d791891545cd",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "唯一未解决的依赖是 Empower / Empowered：(1) keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef，" +
    "827.1.c.1 的“1 Energy + 2 Order Power：Empower me，仅当未 Empowered 时启动”无法展开；" +
    "(2) 没有 Empowered 状态谓词——442.1.a 的二元状态不在 ObjectSnapshot / Condition 里，两条 " +
    "[Empowered][>] 依赖能力（828.1.b.1）的门槛不可求值（本程序以描述性 empoweredCount / " +
    "empowered 记录门槛，不伪造可执行条件；图层 conditionMatches 对未知 condition kind 落回 true，故这些静态能力不是可执行门控）；" +
    "“I have [Assault 2]” 的授予原语 continuous.grant-keyword 已随 RIFT-258 合入（RIFT-91 的图层引擎也已合入），" +
    "真正缺的是 828.1.b.1 的可求值门控本身。依赖新的 Empower/Empowered 关键词任务与 442.1.a 的状态谓词。" +
    "攻击触发的 “kill an enemy unit here with less Might than me” 半段用已合入的 effect.kill 真实执行（含边界）。不近似实现。",
  abilities: [
    {
      // 印刷费 1 Energy + 2 Order Power 见 judgeReason；不伪造启动能力。
      kind: "keyword",
      keyword: "empower"
    },
    {
      // [Empowered][>] I have [Assault 2]：828.1.b.1 的依赖能力只在宿主 Empowered 时
      // 授予 Assault 2（807.1.c）；关键词本体由已合入的 Assault KeywordDef 展开。
      kind: "static",
      effect: {
        kind: "continuous.grant-keyword",
        keyword: "assault",
        value: { kind: "constant", value: 2 },
        appliesTo: "self"
      },
      condition: {
        kind: "compare",
        left: {
          kind: "object-property",
          object: "self",
          property: "empoweredCount"
        },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      }
    },
    {
      // [Empowered][>] When I attack, kill an enemy unit here with less Might
      // than me.（828.1.b.1 的依赖能力 + 383.4.e 攻击触发）
      kind: "triggered",
      trigger: {
        at: "attack-declared",
        filter: { event: "attack-declared", filter: { source: "self" }, empowered: true }
      },
      optional: false,
      body: [
        {
          id: "ambessa.kill-weaker-enemy-here",
          op: "effect.kill",
          args: { target: { kind: "constant", value: "ambessa.enemy-unit-here" } },
          targets: [
            {
              id: "ambessa.enemy-unit-here",
              // “an enemy unit here”：同一战场上的敌方单位（355.9/355.10.g）。
              filter: {
                type: "unit",
                zone: "board",
                controller: "opponent",
                sameLocationAs: "self",
                exclude: "self"
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ],
          // “with less Might than me”：结算时比较目标当前 Might 与宿主 Might。
          condition: {
            kind: "compare",
            left: {
              kind: "object-property",
              object: { target: "ambessa.enemy-unit-here" },
              property: "might"
            },
            operator: "lt",
            right: {
              kind: "object-property",
              object: "self",
              property: "might"
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Empower] :rb_energy_1::rb_rune_order::rb_rune_order: " +
    "(:rb_energy_1::rb_rune_order::rb_rune_order:: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] I have [Assault 2]. (+2 :rb_might: while I'm an attacker.)\n" +
    "[Empowered][>] When I attack, kill an enemy unit here with less Might than me."
} satisfies CardProgram;
