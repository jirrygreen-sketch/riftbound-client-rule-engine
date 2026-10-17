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
 *   用 count + object: source + zone: board + location: battlefield 精确约束来源自身。
 * - 被替代对象须同时是 unit、isToken 且由自身控制，不能把所有 token 都当成单位。
 *
 * Heimerdinger, Academy Instructor — CR v1.5 369.1 / 370.1.c (optional
 * replacement before Play), 185.1 / 185.2.a (unit token), 187.4 (3 Might Mech).
 * The source battlefield condition and friendly unit-token filter use executable
 * selectors with the layer query. Production replacement contexts still need
 * location-aware queries; destination, token planning and optionality remain blocked.
 * replaced-play-location explicitly marks the unavailable action destination;
 * it must never be replaced by Heimerdinger's own location.
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    replaces: {
      event: "card-played",
      object: { type: "unit", controller: "self", characteristics: { isToken: true } }
    },
    condition: {
      kind: "compare",
      left: {
        kind: "count",
        subject: "unit",
        filter: { object: "source", zone: "board", location: "battlefield" }
      },
      operator: "eq",
      right: { kind: "constant", value: 1 }
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
    "CR 369.1 / 440.2.c：replacement/planner.ts 对 effect.token 抛 Unsupported replacement opcode，不能计划链上创建 Mech 再打出的替代。替代输入只暴露 REPLACED_EVENT_LINK（replacement.object），缺被替代 play action 的 destination 绑定；对象当前位置不能代替打出目的地。CR 370.1.c：replacement.event 的 args.instead 只读裸指令数组，与 IR 的 Expr 参数冲突；optional 声明也未传入 ReplacementRegistration.optional，无法执行“you may”的询问。来源战场条件还缺 replacement context 的 location 过滤：生产 EngineRuntimeHost 的 query 忽略 location，参考内核的 query 则只比较完整 LocationRef，尚不能直接承接该条件。",
  abilities,
  sourceText:
    "If you would play a unit token to a location while I'm at a battlefield, you may play a 3 :rb_might: Mech unit token to that same location instead."
} satisfies CardProgram;

export default program;
