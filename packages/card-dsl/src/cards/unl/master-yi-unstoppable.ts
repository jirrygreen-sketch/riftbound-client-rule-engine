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
 * 2026-10-18 复核：仍为 judge-required，当前缺口见 judgeReason。
 * 已有原语、关键词定义或通用适配器不代表本卡完整生产路径可执行。
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
 * XP 门槛使用契约已有的 player-property 形状；解释器和费用收集器仍未把
 * PlayerSnapshot.xp 接入该形状（见 judgeReason）。
 */
function levelAbility(discount: PrintedDiscount): Ability {
  return {
    kind: "static",
    effect: {
      // 356.4.b/c：the printed line has one Energy and one Calm Power
      // reduction. `reductions` is the merged cost collector's multi-resource
      // shape; the Level replacement marker remains descriptive until the
      // collector can consume it.
      kind: "continuous.cost-modification",
      appliesTo: "self",
      stage: "discount",
      reductions: [
        { resource: "energy", amount: discount.energy },
        { resource: "power", amount: discount.calmPower, domain: "Calm" }
      ],
      // "instead"：后一条 Level 能力取代前一条的减费（356.1.c / 356.4 的减费阶段）。
      instead: discount.instead
    },
    // 824.1.c："While you have N+ XP, get the effect."；保留形状，见 judgeReason。
    condition: {
      kind: "compare",
      left: { kind: "player-property", player: "controller", property: "xp" },
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
      left: { kind: "player-property", player: "controller", property: "xp" },
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
    "当前缺口（2026-10-18 实测）：(1) Level 条件已改用契约支持的 player-property(controller, xp) 形状，但 effects/interpreter/expr.ts 不求值 player-property，" +
    "cost/discounts/values.ts 的费用条件求值也没有 PlayerSnapshot.xp 读取，因此 824.1.c/824.1.c.1/824.1.d 的 XP 动态激活与失活仍不可执行。" +
    "(2) cost/discounts/collect.ts 已能收集 continuous.cost-modification 的 Energy/Power reductions，但 chain/engine.ts Finalize 仍直接调用 buildCostPlan；" +
    "CardProgram 静态能力没有进入该收集器，且三级减费的 instead 覆盖没有可消费字段，不能把三行减费近似为叠加。" +
    "(3) Level 16 的 Untargetable choose-as-target 限制已有链消费器，但 programs/statics.ts 的 staticTarget 不接受 appliesTo: spells-and-abilities，" +
    "也没有把 chooser: opponent 与 XP 门槛接入生产规则查询（756/757.1/758）。",
  abilities,
  sourceText:
    "[Level 3][>] I cost :rb_energy_2::rb_rune_calm: less. (While you have 3+ XP, get the effect.)\n" +
    "[Level 6][>] I cost :rb_energy_4::rb_rune_calm::rb_rune_calm: less instead.\n" +
    "[Level 11][>] I cost :rb_energy_6::rb_rune_calm::rb_rune_calm::rb_rune_calm: less instead.\n" +
    "[Level 16][>] I can't be chosen by enemy spells and abilities."
} satisfies CardProgram;
