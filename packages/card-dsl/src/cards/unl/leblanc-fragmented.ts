import type { Ability, CardProgram, Condition } from "../../ir/index.js";

/**
 * LeBlanc, Fragmented (unl-172-219) — Unit，3 能量 + 1 Order Power、Might 3，
 * 标签 Noxus / LeBlanc / Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，unl-172-219，逐字）：
 *   [Assault] (+1 :rb_might: while I'm an attacker.)
 *   [Deathknell][>] Draw 1. If it's your Beginning Phase, draw 2 instead.
 *   (When I die, get the effect.)
 *
 * 规则依据（CR v1.5）：
 * - 807.1 / 807.1.a / 807.1.b.3：Assault 是单位上的被动能力关键词，印刷未写数值时按
 *   Assault 1；807.1.c 的功能文本是 "while I'm an attacker, I have +1 [M]"。卡上只声明
 *   { kind: "keyword", keyword: "assault" }，展开属 effects/keywords/Assault.ts
 *   （契约 3.7 / README 第 5 节：关键词只声明，不重写）。
 * - 808.1 / 808.1.a / 808.1.c：Deathknell 是永久物上的触发式能力关键词，功能上等同
 *   "When I die, [Effect]."；808.1.d / 429.1 / 429.1.a.1.b：自身死亡触发在送入 Trash 之前
 *   作为 Pending Item 入链，对应封闭时点 object-killed。[Effect]（本卡的 Draw 1 / draw 2）
 *   由卡牌程序挂在 object-killed 触发上（同 ruined-rex / kogmaw-caustic 的写法）。
 * - 383.2.a.1："If it's your Beginning Phase" 并不紧跟触发条件（触发条件是 "When I die"），
 *   因此它属于效果的一部分，在结算时决定 draw 1 还是 draw 2；"your" = 能力控制者
 *   （190.6.d 的隐含 you）。
 * - 367 / "instead"："draw 2 instead" 是同一条效果内对 "Draw 1." 的替代（把 1 张改成 2 张），
 *   属指令级替代；本程序按互斥条件写成两个分支，绝不表达成 "先 draw 1 再补 draw 1"。
 * - 424.1.b / 括注："(When I die, get the effect.)" 是 808.1.c 的提醒文本，不另写指令。
 *
 * status 判定（README 第 2 节）：judge-required —— 三处依赖未合入，均不近似实现：
 * 1. Assault 无可执行消费方：effects/keywords/Assault.ts 的展开读 designation（契约 3.8 的
 *    ObjectSnapshot.combatRole），该特征未合入，layers 的条件求值也不读 compare（同
 *    ogn/petty-officer、ogn/daring-poro 的判定），且没有把卡牌 keyword 能力接进图层的路径。
 * 2. Deathknell KeywordDef 仍展开为未注册的 trigger.leave 原语（effects/instructions 无该文件）；
 *    object-killed 的 CardProgram 触发注册已经合入，但 808.1.d.1–d.3 的离场处理与最后已知信息
 *    仍依赖离场指令和事件/链管线。
 * 3. "If it's your Beginning Phase" 需要可求值的阶段状态，"draw 2 instead" 需要指令级替代；
 *    两者都没有已合入的读取/结算入口（回合与阶段状态、367 替代）。
 * golden 只做校验/身份/结构断言、触发注册与 draw 原语的直接执行，缺口以 test.todo 记录。
 *
 * 依赖：Assault 的 designation/combat 消费方、Deathknell 的 trigger.leave 离场指令、
 * 以及 Beginning Phase 状态读取与指令级替代入口。
 */

/**
 * "If it's your Beginning Phase" 的占位谓词。合并的 ObjectSnapshot 没有阶段特征，
 * 该读取取不到信息时解释器按 MissingInformation 把指令置为 ignored（fail closed），
 * 不会退化成"永远在 Beginning Phase"。真实求值需要回合/阶段状态读取。
 * 特征名沿用 medication.ts 的命名空间化占位写法（"meditation.additional-cost-paid"）。
 */
const CONTROLLER_BEGINNING_PHASE: Condition = {
  kind: "compare",
  left: {
    kind: "object-property",
    object: "self",
    property: "leblanc-fragmented.controller-beginning-phase"
  },
  operator: "eq",
  right: { kind: "constant", value: true }
};

const abilities: Ability[] = [
  // 807.1.b.3：印刷未写 Assault 数值，省略 value（默认 1 由关键词展开处理）。
  { kind: "keyword", keyword: "assault" },
  // 808.1：Deathknell 只声明，展开属关键词注册表（契约 3.7）。
  { kind: "keyword", keyword: "deathknell" },
  {
    kind: "triggered",
    // 808.1.c / 808.1.d.2："When I die" = 本卡被消灭（object-killed，进 Trash 前入链）。
    trigger: { at: "object-killed", filter: { event: "object-killed", filter: { source: "self" } } },
    optional: false,
    body: [
      {
        id: "leblanc-fragmented.draw-1",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } },
        // 367：不在控制者 Beginning Phase 时执行 "Draw 1."。
        condition: { kind: "not", condition: CONTROLLER_BEGINNING_PHASE }
      },
      {
        id: "leblanc-fragmented.draw-2",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 2 } },
        // 367：处在控制者 Beginning Phase 时以 draw 2 替代 draw 1（两分支条件互斥）。
        condition: CONTROLLER_BEGINNING_PHASE
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-b8d443a7b94f10a4f56f95ffc2b338f17de7a1fbc3a76e380bf2cd67a5436a7e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处依赖未合入：(1) [Assault]（807.1.c）的展开不可执行——keywords/Assault.ts 读 designation" +
    "（契约 3.8 的 ObjectSnapshot.combatRole，未合入），layers 的条件求值不识别 compare（同 petty-officer 的判定），" +
    "且没有卡牌 keyword 能力 → 图层的接线。" +
    "(2) [Deathknell]（808.1）的 KeywordDef 仍展开为未注册的 trigger.leave 原语（effects/instructions 无该文件），" +
    "object-killed 的 CardProgram 触发注册已经合入，但 808.1.d.1–d.3 的离场处理与最后已知信息仍缺。" +
    "(3)「If it's your Beginning Phase」需要可求值的阶段状态（当前 IR 没有阶段/回合状态读取入口），" +
    "「draw 2 instead」是同一效果内的指令级替代（367），没有已合入的替代路径。" +
    "程序保留两支互斥的 draw 形状与占位特征名（fail closed），不近似实现：不用无条件 draw 2 代替「instead」，" +
    "也不写成 draw 1 之后补 1 张。Draw 1 本体（414.3）用已合入的 effect.draw 单独执行验证。",
  abilities,
  sourceText:
    "[Assault] (+1 :rb_might: while I'm an attacker.)\n" +
    "[Deathknell][>] Draw 1. If it's your Beginning Phase, draw 2 instead. (When I die, get the effect.)"
} satisfies CardProgram;
