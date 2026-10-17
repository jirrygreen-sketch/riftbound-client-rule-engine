import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Heimerdinger, Academy Instructor (rad-132-167) — Unit, Order,
 * 6 energy / 1 power / 5 Might，标签 Yordle/Heimerdinger/Piltover/Champion。
 *
 * sourceText (packages/card-data/data/deck-catalog.json, rad-132-167):
 *   "If you would play a unit token to a location while I'm at a battlefield,
 *    you may play a 3 :rb_might: Mech unit token to that same location instead."
 *
 * 规则依据（CR v1.5）：
 * - "If you would play ... instead"：替代效果（369.1 的 "would" 判定语）。"you may"
 *   使之为可选替代（369.x 的选择；参考 events/pipeline.ts 的 optional replacement
 *   询问机制）。按契约 3.1 用 kind: "replacement" + replaces: EventPattern + with。
 * - "play a unit token"：被替代的游戏动作是"打出一个单位衍生物"，对应打出事件
 *   card-played 且对象为衍生物（185.1 的 token 内在类别、187.4 的 Mech 衍生物定义、
 *   350.2 衍生物可被打出）；衍生物的打出先在链上创建再交付 play（440.2.c/185.2.a）。
 * - "a 3 :rb_might: Mech unit token"：187.4 的 3 Might Mech 定义，effect.token 的
 *   "mech" 定义即该值（本程序不发明衍生物能力）。
 * - "while I'm at a battlefield"：来源的位置（198.2/199.1 位置是永久物的特征）为战场，
 *   写成对来源的命名谓词（同 fiora-peerless 的 one-on-one 先例），由图层/触发上下文求值。
 *
 * 无法执行的依赖（保持 judge-required）：
 * - 当前替代绑定能够匹配 card-played 事件，但 replacement planner 没有把 effect.token
 *   规划成可提交的 GameAction 序列；因此不能完成“创建并打出 Mech token”的替代提交。
 * - "to that same location"：替代动作的目标位置 = 被替代的打出动作将前往的位置。IR 中
 *   没有"被替代事件的 location"选择器；下面的 location 是有意标出的占位常量
 *   （replaced-play-location），必须由替代系统在结算时绑定为被替代打出的目的地——
 *   用来源自身的位置会在这两者不同时给出错误结果，因此这里不用 object-property。
 * - "you may ... instead" 的打出前可选询问仍没有在该 replacement ability 形状中表达。
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    replaces: {
      event: "card-played",
      object: { type: "token" }
    },
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "source-at-a-battlefield" }
    },
    with: [
      {
        id: "heimerdinger-academy-instructor.play-mech-instead",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "mech" },
          amount: { kind: "constant", value: 1 },
          mode: { kind: "constant", value: "play" },
          // 占位：真实值是被替代的打出动作的目标位置，须由替代管线绑定。
          location: { kind: "constant", value: { type: "battlefield", id: "replaced-play-location" } },
          linkKey: { kind: "constant", value: "replacementToken" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-110bcd60a1458cca7d33a12f05a6abe079166042a12661fcba8d64b94016e80a",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "替代绑定已能匹配 369.1 的 card-played 事件，但 replacement planner 尚不能把 effect.token " +
    "规划成创建并打出 Mech token 的 GameAction 序列；\"you may ... instead\" 的打出前可选询问" +
    "也没有在当前 replacement ability 形状中表达。另缺 \"to that same location\" 的绑定：IR 没有" +
    "被替代打出动作目的地的动态选择器，程序里的 location 是有意标注的占位常量，不能用来源自身位置近似。" +
    "依赖：token replacement planner 与动态地点选择（RIFT-357）。",
  abilities,
  sourceText:
    "If you would play a unit token to a location while I'm at a battlefield, you may play a 3 :rb_might: Mech unit token to that same location instead."
} satisfies CardProgram;

export default program;
