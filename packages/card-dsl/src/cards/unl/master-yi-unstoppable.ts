import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Master Yi, Unstoppable (unl-059-219) — Unit, 12 Energy + 3 Calm Power, Might 12，
 * Calm，tag Master Yi/Ionia/Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-059-219，逐字，含换行）：
 *   [Level 3][>] I cost :rb_energy_2::rb_rune_calm: less. (While you have 3+ XP, get the effect.)
 *   [Level 6][>] I cost :rb_energy_4::rb_rune_calm::rb_rune_calm: less instead.
 *   [Level 11][>] I cost :rb_energy_6::rb_rune_calm::rb_rune_calm::rb_rune_calm: less instead.
 *   [Level 16][>] I can't be chosen by enemy spells and abilities.
 *
 * 规则依据（CR v1.5）：
 * - 824.1 / 824.1.a-c：Level 是**依赖式关键词**，"[Level N][>] [Text]" 从关键词到子句结尾
 *   整段是 Level Ability，功能等价于"当控制者有 N 点或更多 XP 时，本牌获得 '[Text]'"；
 *   控制者 XP 变化会即时让该依赖能力 Active/Inactive（824.1.c.1 / 824.1.d）。
 *   每一行是独立的依赖能力，且后面的行用 instead 覆盖前面的减费（356.1.c 的印刷基础费用
 *   与 356.4 的减费阶段）。
 * - 356.4 / 356.4.b / 356.4.c："I cost [2][Calm] less" 是减费（Energy 2 + 1 Calm Power）；
 *   356.6 规定 Energy 与 Power 的下限为 0。
 * - 756 / 757 / 757.1 / 758：最后一条 Level 能力授予 Untargetable（"can't be chosen by
 *   enemy spells and abilities"）。
 *
 * status = judge-required（缺口不近似实现）：
 * - Level 的关键词展开已经合入，但 824.1.c 的 XP 谓词仍不能从
 *   PlayerSnapshot.xp 求值，因而依赖能力不会随 XP 动态启停。
 * - cost.modify 指令已经合入；本卡的静态 cost.modify 仍没有接入打出费用
 *   Finalize 的 discounts 阶段，所以三条减费仍只是声明。
 * - 最后一条的 Untargetable（756/757/758）仍没有目标合法性消费方。
 * golden 只做校验、结构断言与缺口 todo，不为任一缺口写执行用例。
 *
 * 依赖：Level 的 XP 谓词求值、静态 cost.modify 到 Finalize 费用计划的接线、
 * Untargetable 的目标合法性消费方。
 */

/** 356.4.b / 356.4.c：每一条 Level 能力的印刷减费（Energy + Calm Power）。 */
interface PrintedDiscount {
  readonly id: string;
  readonly level: number;
  readonly energy: number;
  readonly calmPower: number;
  readonly instead: boolean;
}

const DISCOUNTS: readonly PrintedDiscount[] = [
  { id: "master-yi-unstoppable.level-3-discount", level: 3, energy: 2, calmPower: 1, instead: false },
  { id: "master-yi-unstoppable.level-6-discount", level: 6, energy: 4, calmPower: 2, instead: true },
  { id: "master-yi-unstoppable.level-11-discount", level: 11, energy: 6, calmPower: 3, instead: true }
];

/**
 * 824.1.b.1：每一条 [Level N][>] 展开为一个受 XP 门槛约束的依赖能力。
 * 减费本身是不可执行的描述性声明（见 judgeReason）；XP 门槛按 824.1.c 的"控制者有 N 点
 * 或更多 XP"写成保留形状（合并 Condition 读不到 PlayerSnapshot.xp）。
 */
function levelAbility(discount: PrintedDiscount): Ability {
  return {
    kind: "static",
    effect: {
      kind: "cost.modify",
      id: discount.id,
      appliesTo: "play-cost",
      // 356.4.b："cost [amount] less" 的减费量（Energy 与 Calm Power 两个分量）。
      value: {
        kind: "constant",
        value: {
          energy: -discount.energy,
          power: [{ domain: "Calm", amount: -discount.calmPower }]
        }
      },
      // "instead"：后一条 Level 能力取代前一条的减费（356.1.c / 356.4 的减费阶段）。
      instead: discount.instead
    },
    // 824.1.c："While you have N+ XP, get the effect."；保留形状，见 judgeReason。
    condition: {
      kind: "compare",
      left: { kind: "count", subject: "controller-xp", filter: { player: "controller" } },
      operator: "gte",
      right: { kind: "constant", value: discount.level }
    }
  };
}

const abilities: Ability[] = [
  ...DISCOUNTS.map(levelAbility),
  {
    // 824.1.b.1 / 757.1：最后一条 Level 能力授予 Untargetable；保留形状（见 judgeReason）。
    kind: "static",
    effect: {
      kind: "continuous.restrict",
      operation: "choose-as-target",
      forbidden: true,
      chooser: "opponent",
      appliesTo: "spells-and-abilities",
      filter: { type: "unit", zone: "board", object: "self" }
    },
    condition: {
      kind: "compare",
      left: { kind: "count", subject: "controller-xp", filter: { player: "controller" } },
      operator: "gte",
      right: { kind: "constant", value: 16 }
    }
  }
];

export default {
  canonicalCardId:
    "card.hash-d985b0a1d9b07b7fc028a94da70fd37a60f56a62bcb6c91698366ce148cefbc9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：（1）[Level N][>] 的关键词展开已合入，但 " +
    "824.1.c 的『控制者有 N 点或更多 XP 时依赖能力 Active』需要可求值的 XP 谓词，" +
    "合并 IR 的 Condition 虽能表达 compare，但读取 PlayerSnapshot.xp 尚未进入 Expr/谓词路径" +
    "（824.1.c.1/.d 的动态失活同样缺失）。" +
    "（2）三条减费（356.4/356.4.b/356.4.c，下限 356.6）的 cost.modify 指令已经存在，" +
    "但静态 cost.modify 尚未接入 cost/cost-plan.ts 的 Finalize discounts 阶段，因此程序中的数值还不能实际改写打出费用。" +
    "（3）最后一条的『I can't be chosen by enemy spells and abilities』是 756/757/757.1/758 的 Untargetable，" +
    "目标合法性消费方仍未合入。依赖：XP 谓词求值、静态 cost.modify 到 Finalize 的接线、" +
    "Untargetable 的目标合法性消费方。本卡所有效果都依赖上述缺口，golden 只做校验、结构断言与缺口 todo。",
  abilities,
  sourceText:
    "[Level 3][>] I cost :rb_energy_2::rb_rune_calm: less. (While you have 3+ XP, get the effect.)\n" +
    "[Level 6][>] I cost :rb_energy_4::rb_rune_calm::rb_rune_calm: less instead.\n" +
    "[Level 11][>] I cost :rb_energy_6::rb_rune_calm::rb_rune_calm::rb_rune_calm: less instead.\n" +
    "[Level 16][>] I can't be chosen by enemy spells and abilities."
} satisfies CardProgram;
