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
 * status = judge-required（不近似实现）：
 * - 缺 effect.swap-location：已合入的 effect.move 每条指令只移动一个选择集到固定
 *   LocationRef/controller-base/静态候选，不能把两个永久物的 Origin/Destination
 *   作为同一个原子 Move 关系交换；顺序两次 effect.move 会产生不同的合法性、战斗
 *   与触发结果，故不用它近似。
 * - 「at least one of them has [Temporary]」无求值路径：Condition 只支持
 *   always/never/compare/all/any/not/expression，ObjectFilter 没有关键词维度
 *   （ObjectSnapshot.keywords 没有过滤器键，同 guerilla-warfare-teemo），谓词也
 *   不能跨两个 TargetSpec 读取特征。
 * - 「at a different location」是两个选择之间的关系限制：TargetPlan（RIFT-90）
 *   只有单 spec 的 filter/location，未提供成对关系重验。
 * Draw 1 一半已合入并有 golden 执行测试。依赖：RIFT-9 的 effect.swap-location、
 * 关键词特征谓词与成对关系限制。
 */
const smokeAndMirrors = {
  canonicalCardId: "card.hash-6add1fe7f28222eaf95929c9ea158fc564653d8c24fc981553089763dd098361",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处依赖未合入，均不近似实现：(1) 缺 RIFT-9 建议的 effect.swap-location：" +
    "CR 448.1/448.3 要求两个永久物的 Origin/Destination 作为同一个原子 Move 关系交换，" +
    "已合入的 effect.move 每条指令只把单个选择集移到固定 LocationRef/controller-base/静态候选，" +
    "顺序执行两次 effect.move 会在第二条的合法性重验与触发时点上产生不同结果（449.1/451.1），故不近似。" +
    "(2)「If at least one of them has [Temporary]」无求值路径：Condition 只有 always/never/compare/all/any/not/expression，" +
    "ObjectFilter 没有关键词维度（ObjectSnapshot.keywords 无过滤器键，同 guerilla-warfare-teemo），且谓词不能跨两个 TargetSpec 读特征。" +
    "(3)「at a different location」是两个选择之间的关系限制，TargetPlan（RIFT-90）只有单 spec 的 filter/location，没有成对关系重验。" +
    "「Draw 1」是独立语句，只用已合入的 effect.draw，golden 真实执行。依赖：RIFT-9 的 effect.swap-location、关键词特征谓词与成对关系限制。",
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
