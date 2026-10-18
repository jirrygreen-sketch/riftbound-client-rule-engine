import type { CardProgram } from "../../ir/index.js";

/**
 * Smoke and Mirrors (unl-083-219) — Spell, 2 energy, no printed power, no
 * Might, Mind.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-083-219，逐字）：
 *   "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for
 *    :rb_energy_0:.)\n"
 *   "[Action] (Play on your turn or in showdowns.)\n"
 *   "Choose a unit you control and another unit you control at a different
 *    location. If at least one of them has [Temporary], move each to the other's
 *    location. Draw 1."
 *
 * 规则依据（CR v1.5）：
 * - [Hidden]（811）与 [Action]（806）是许可/前置类关键词，展开由关键词注册表
 *   负责（契约 3.7），卡牌只声明。
 * - 「Choose a unit you control and another unit you control at a different
 *   location」：两个由玩家选择的己方单位都是目标（355.5、355.7、355.9.a.1）；
 *   "at a different location" 是两个选择之间的关系限制（RIFT-9 的 target.filter /
 *   group 关系），"another" 排除同一对象。
 * - 「If at least one of them has [Temporary], move each to the other's
 *   location」：让两个单位成对交换地点，必须作为一个原子移动关系处理（448.1：
 *   空间位置改变即 Move；448.3：移动是瞬时的，不存在"移动一半"的中间状态）；
 *   RIFT-9 为此建议新原语 effect.swap-location。异于顺序执行两条 effect.move：
 *   第二条移动的合法性、触发与时点会与原子交换不同（449.1/451.1）。
 *   "at least one of them has [Temporary]" 是读取所选单位关键词特征的谓词。
 * - 「Draw 1」是独立语句（与 "If …" 条件无 "do X to Y" 依赖），用已合入的
 *   effect.draw（414.1）执行。
 *
 * 2026-10-18 复核：整卡仍为 judge-required；当前生产缺口见 judgeReason。
 * 已支持子效果的执行证据保留在对应 golden；不以原语存在替代整卡可执行性。
 */
const smokeAndMirrors = {
  canonicalCardId: "card.hash-6add1fe7f28222eaf95929c9ea158fc564653d8c24fc981553089763dd098361",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口：(1) 缺 effect.swap-location 或等价的双对象位置交换动作，现有 effect.move 不能在同一结算动作中交换两者原地点（CR 448.1/448.3）。" +
    "(2) 所选两单位至少一个具有 Temporary 的实时关键词谓词仍无求值路径；count 的 selected-units-with-temporary subject 不被识别，会退化成对象计数（816.3）。" +
    "(3) TargetPlan 缺 exclude/不同位置这类跨 TargetSpec 关系的 Finalize/Resolve 重验（355.7/355.9）；当前 locationRelation 不是可执行关系过滤。" +
    "(4) cost.hidden 展开、Hidden 费用规划与支付封装已存在，但缺 Hide 动作、facedown 区域和下回合 Reaction 解锁的生产接线（811）。continuous.grant-keyword 与 Temporary 定义已存在；Draw 1 是独立语句，已有真实执行证据。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          // 未注册 op：原子成对交换的保留形状（见 judgeReason）。
          id: "smoke-and-mirrors.swap-locations",
          op: "effect.swap-location",
          args: {
            objects: {
              kind: "constant",
              value: [
                { target: "smoke-and-mirrors.unit-a" },
                { target: "smoke-and-mirrors.unit-b" }
              ]
            }
          },
          targets: [
            {
              id: "smoke-and-mirrors.unit-a",
              filter: { zone: "board", type: "unit", controller: "controller" },
              min: 1,
              max: 1,
              selection: "one"
            },
            {
              id: "smoke-and-mirrors.unit-b",
              // "another unit you control at a different location"："another" 与
              // "at a different location" 都是成对关系限制，尚无消费方（见 judgeReason）。
              filter: {
                zone: "board",
                type: "unit",
                controller: "controller",
                // "another unit": 排除第一个目标（355.9.c / 355.7）。
                exclude: { target: "smoke-and-mirrors.unit-a" },
                locationRelation: "different-from-selected-unit"
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ],
          // 「If at least one of them has [Temporary]」的保留形状：关键词特征没有
          // 过滤器/条件维度（同 guerilla-warfare-teemo），此处仅记录意图。
          condition: {
            kind: "compare",
            left: {
              kind: "count",
              subject: "selected-units-with-temporary",
              filter: { zone: "board", type: "unit" }
            },
            operator: "gte",
            right: { kind: "constant", value: 1 }
          }
        },
        {
          // 独立语句，不 linkedTo：原文没有把抽牌挂在交换结果上。
          id: "smoke-and-mirrors.draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Choose a unit you control and another unit you control at a different location. " +
    "If at least one of them has [Temporary], move each to the other's location. Draw 1."
} satisfies CardProgram;

export default smokeAndMirrors;
