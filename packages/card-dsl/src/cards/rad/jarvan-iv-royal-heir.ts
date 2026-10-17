import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Jarvan IV, Royal Heir (rad-133-167) — Unit, Order,
 * 7 energy / 1 power / 7 Might，标签 Demacia/Jarvan IV/Champion。
 *
 * sourceText (packages/card-data/data/deck-catalog.json, rad-133-167):
 *   "[Assault] (+1 :rb_might: while I'm attacking.)
 *    [Tank] (I must be assigned combat damage first.)
 *    When I attack, you may move a unit you control to my battlefield."
 *
 * 规则依据（CR v1.5）：
 * - [Assault]（807）：被动关键词，807.1.c 等于 "While I am an attacker, I have +X [M]"，
 *   807.1.b.3 省略数值时为 1。effects/keywords/Assault.ts 展开为 arithmetic 的
 *   continuous.might，条件读 object-property(self, "designation")；对象契约提供的是
 *   combatRole（contract.ts 的 ObjectSnapshot.combatRole），解释器对 designation 抛
 *   MissingInformation，生产绑定器按 false 处理（实测 combatRole=attacker 时 Might 仍为
 *   印刷值），因此攻击时的 +1 目前不生效。
 * - [Tank]（815.1.b/c）：effects/keywords/Tank.ts 已合入并展开为 continuous.combat 的
 *   静态声明，生产静态绑定也已能落到 ability 图层（实测不再抛错）；剩余缺口是
 *   combat/base-combat-allocation.ts 的 proof.keywordPriority 只有 'proven-none'，
 *   没有 lethal-first 分配消费方。
 * - "When I attack"：攻击触发（时点 attack-declared；323.2 取得 Attacker 身份时触发）。
 * - "you may move a unit you control"："you may" 是效果第一段 → 383.3.a 由触发能力
 *   控制者在 Finalize 决定是否执行该触发能力（383.3.a.1/.a.2）→ triggered.optional = true。
 * - "to my battlefield"："my battlefield" = 来源当前所在位置（198.2 位置是永久物特征），
 *   用 object-property 的 "source".location 在结算时求值（420.3.b.2 的取值时机）；
 *   移动走 effect.move 的 move-location 动作（421/448-455；452 的 contested 与 453/454
 *   的战斗时序由内核负责）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "assault" },
  { kind: "keyword", keyword: "tank" },
  {
    kind: "triggered",
    trigger: { at: "attack-declared", filter: { self: true } },
    optional: true,
    body: [
      {
        id: "jarvan-iv-royal-heir.move-unit-to-my-battlefield",
        op: "effect.move",
        args: {
          objects: { kind: "constant", value: { target: "jarvan-iv-royal-heir.unit-you-control" } },
          to: { kind: "object-property", object: "source", property: "location" },
          amount: { kind: "constant", value: 1 }
        },
        targets: [
          {
            id: "jarvan-iv-royal-heir.unit-you-control",
            filter: { type: "unit", zone: "board", controller: "controller" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-7218705147869fc19076fda9afe7138fbf4e76073f7e76ef76bb5cb0d67feee9",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处当前缺口：(1) [Tank]（815.1.b/c）的 KeywordDef 已展开为 continuous.combat 静态声明，" +
    "生产静态绑定也已能落到 ability 图层（实测 layerFor 映射该 kind、绑定不再抛错）；" +
    "剩余缺口是战斗分配管线没有 Tank 消费方：combat/base-combat-allocation.ts 的 " +
    "DuelBaseCombatSourceEffectProof.keywordPriority 只有 'proven-none'（basic path 必须显式证明无分配优先级，" +
    "没有 lethal-first 的 Tank 语义接入）。(2) [Assault]（807.1.c）展开为 arithmetic 的 continuous.might，条件读 " +
    "object-property(self, \"designation\")，而 ObjectSnapshot 只有 combatRole：解释器抛 MissingInformation，" +
    "生产绑定器按 false 处理（实测 combatRole=attacker 时 Might 仍为印刷值 7），攻击时的 +1 不生效。" +
    "攻击触发注册（attack-declared，383.4.e/323.2）与 effect.move 移动本体已有引擎路径并有 golden 执行证据；" +
    "在 Tank 消费方与 designation/combatRole 对齐前整卡仍保持 judge-required。",
  abilities,
  sourceText:
    "[Assault] (+1 :rb_might: while I'm attacking.)\n" +
    "[Tank] (I must be assigned combat damage first.)\n" +
    "When I attack, you may move a unit you control to my battlefield."
} satisfies CardProgram;

export default program;
