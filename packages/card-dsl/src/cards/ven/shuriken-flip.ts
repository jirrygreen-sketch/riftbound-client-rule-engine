import type { CardProgram } from "../../ir/index.js";

/**
 * Shuriken Flip (ven-140-166) — Spell, 1 energy + 1 Fury/Calm power, tags Akali/Signature.
 * Might null（法术无印刷 Might；domains ["Fury", "Calm"] 是双领域印刷）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-140-166，逐字）:
 *   "Deal 2 to up to one enemy unit at a battlefield, then move a friendly unit.\n"
 *   "[Flow] :rb_energy_3::rb_rune_rainbow: (You may play this from your trash for its Flow cost. Then banish it.)"
 *
 * 规则依据（CR v1.5）：
 * - "Deal 2 to up to one enemy unit at a battlefield"：418 的 Deal 动作，来源是该法术自身
 *   （418.6.a，缺省 source），非战斗伤害（418.1.c）。"up to one" 允许选 0 个（355.13），
 *   因此 TargetSpec 为 min 0 / max 1 / selection "up-to"；被点名的单位是目标（355.7/355.9.a.1），
 *   "enemy" 用 controller: "opponent"，"at a battlefield" 是目标限制而非第二个目标（355.10.b），
 *   用已合入的 location: "battlefield" 表达（ogn/gust、sfd/arcane-shift 同写法）。
 * - "then move a friendly unit"：421/448-451 的效果 Move（非 144 的标准移动：无横置费用、
 *   无 Main Phase 门槛，451.1 由来源声明目的地限制）。原文**没有印刷目的地**，因此目的地按
 *   355.4/355.4.a 在结算时选一个合法 Location（451.1）。被移动的友方单位是目标
 *   （355.7/355.9.a.1）。"then" 只是 158.1 的自上而下结算顺序；这句不引用伤害的结果对象，
 *   因此不写 linkedTo（README 第 4 节：独立语句不强行链接；否则「选择 0 个伤害目标」
 *   会让移动被 linked-ignored 连坐，凭空发明条件）。
 * - [Flow]（829）同其他卡：只声明关键词身份，展开归 keywords/Flow.ts。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。三处依赖未合入，均不近似实现：
 * (1) 没有运行期 Location 选择器：355.4/355.4.a 要求结算时选定目的地，而 effect.move 的
 *     `to` 只接受静态 LocationRef / "controller-base" / 静态候选列表；本文件保留描述性
 *     目的地标记，解释器会拒绝该形状而不是移动到一个编造的地点（同型记录见
 *     rad/sirens-song、rad/demon-shade；依赖 RIFT-90/RIFT-91）。
 * (2) 两条指令的目标 Finalize 生命周期（"up to one" 的 0 选择、目标锁定与结算重验）
 *     属 RIFT-90 的目标批次；卡程序只声明结构与 158.1 的顺序。
 * (3) [Flow] 的备选费用与延迟替代路径未合入（829.1.b/829.1.c；依赖 RIFT-261 与 RIFT-260）。
 * golden 用真实原语执行已支持的伤害半段与 linkedTo 的结果引用语义；未合入部分用 test.todo 记录。
 */

/** 描述性目的地标记，不是可执行 LocationRef（见 judgeReason 第 1 点）。 */
const CHOSEN_LOCATION = {
  kind: "destination-selector",
  filter: { type: "location" }
} as const;

const shurikenFlip = {
  canonicalCardId: "card.hash-eead7ad848e8aa64f2ca544f7174c4bc3764b8eb661c26cfd050804e8ce278e5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处依赖未合入，均不近似实现：(1)「then move a friendly unit」没有印刷目的地，目的地按 " +
    "355.4/355.4.a/451.1 在结算时选择，但合并 IR 没有运行期 Location 选择器；effect.move 的 to " +
    "只接受静态 LocationRef / controller-base / 静态候选列表，本卡只保留描述性目的地标记" +
    "（解释器会拒绝该形状而不是移动到编造的地点；同型记录见 rad/sirens-song、rad/demon-shade；" +
    "依赖 RIFT-90/RIFT-91）。(2) 两条指令的目标 Finalize 生命周期（up-to 的 0 选择与结算重验）" +
    "属 RIFT-90 目标批次（结构已表达）。(3) [Flow]（829.1.b/829.1.c）的备选费用与延迟替代" +
    "需要 RIFT-261（费用消费方）与 RIFT-260（替代注册/排序），没有卡牌侧生产者。" +
    "伤害半段（418.1.c/418.6.a，up to one 可为零：355.13）与目标限制" +
    "（355.10.b 的 at a battlefield）只用已合入的 effect.damage，golden 用真实解释器 + 参考内核执行。",
  abilities: [
    { kind: "keyword", keyword: "flow" },
    {
      kind: "play",
      body: [
        {
          // "Deal 2 to up to one enemy unit at a battlefield"：up to one 可为零（355.13）。
          id: "shuriken-flip.deal-2",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 2 },
            target: { kind: "constant", value: "shuriken-flip.enemy-unit" }
          },
          targets: [
            {
              id: "shuriken-flip.enemy-unit",
              filter: { type: "unit", zone: "board", controller: "opponent", location: "battlefield" },
              min: 0,
              max: 1,
              selection: "up-to"
            }
          ]
        },
        {
          // "then move a friendly unit"（158.1 的顺序，非结果引用）：目的地是运行期
          // Location 选择，只有描述性标记（见 judgeReason 第 1 点）。
          id: "shuriken-flip.move-unit",
          op: "effect.move",
          args: {
            objects: { kind: "constant", value: { target: "shuriken-flip.friendly-unit" } },
            to: { kind: "constant", value: CHOSEN_LOCATION },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "shuriken-flip.friendly-unit",
              filter: { type: "unit", zone: "board", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "Deal 2 to up to one enemy unit at a battlefield, then move a friendly unit.\n" +
    "[Flow] :rb_energy_3::rb_rune_rainbow: (You may play this from your trash for its Flow cost. Then banish it.)"
} satisfies CardProgram;

export default shurikenFlip;
