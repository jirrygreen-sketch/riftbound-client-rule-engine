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
 * - 卡牌程序的替代能力→事件管线注册（replacement.event 原语）未合入；当前没有任何
 *   已注册指令或管线读取 CardProgram 的 replacement 能力。这里的 replaces 是规则层的
 *   事件模式（打出衍生物），把它翻译成引擎的"游戏动作级"替代注册（events/pipeline 的
 *   ReplacementRegistration 以 GameAction 匹配）是替代原语的一部分，尚未实现。
 * - "to that same location"：替代动作的目标位置 = 被替代的打出动作将前往的位置。IR 中
 *   没有"被替代事件的 location"选择器；下面的 location 是有意标出的占位常量
 *   （replaced-play-location），必须由替代系统在结算时绑定为被替代打出的目的地——
 *   用来源自身的位置会在这两者不同时给出错误结果，因此这里不用 object-property。
 * - "you may ... instead" 的选择时机（打出前、369.x 的替代选择）依赖替代管线的可选询问；
 *   当前 chain/events 只实现事件层的 replace 注册，未接卡牌程序。
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
    "缺替代效果的卡牌接线：369.1 的 \"If you would play a unit token ... instead\" 需要" +
    "replacement.event 原语把 CardProgram 的 replacement 能力注册到 events/pipeline，" +
    "当前没有任何已注册指令或管线读取卡牌程序的替代能力，\"you may ... instead\" 的打出前" +
    "选择时机也未实现。另缺 \"to that same location\" 的绑定：IR 没有\"被替代打出动作的" +
    "目标位置\"选择器，程序里的 location 是有意标注的占位常量（replaced-play-location），" +
    "不得用来源自身位置近似。依赖：replacement.event 原语与替代管线（关键词/事件批次）。",
  abilities,
  sourceText:
    "If you would play a unit token to a location while I'm at a battlefield, you may play a 3 :rb_might: Mech unit token to that same location instead."
} satisfies CardProgram;

export default program;
