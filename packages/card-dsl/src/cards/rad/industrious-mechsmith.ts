import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Industrious Mechsmith (rad-049-167) — Unit, 4 energy, 1 Might, 无领域。
 *
 * 原文："When you play me, play a 3 :rb_might: Mech unit token here."
 *
 * 规则依据（CR v1.5）：
 * - "When you play me"：Play Effect，时点 card-played（383.4.a / 420.4.a）。
 * - "play a 3 [M] Mech unit token"：440.2.c / 185.2.a 规定被"打出"的 token 先在链上
 *   生成，再由 play 动作接手完成打出流程；3 [M] Mech 是 187.4 的定型 token。
 *   effect.token 的 mode "play" + Mech 定义（effect.token 的 DEFINITIONS 含 "mech"，
 *   might 3 / tags ["Mech"]）已合入。
 * - "here"：打出本单位的那个位置（420.3.b 示例中的 here referent；464.2.b 的后续引用
 *   重新指向该位置），用 object-property 在结算时取来源对象的当前位置。
 *
 * status 判定（README 第 2 节）：judge-required。缺口："here" 只有契约 3.6 的符号
 * ObjectSelector 形状可以表达（`{ kind: "object-property", object: "source",
 * property: "location" }`，IR 校验器接受），但已合入的 `effect.token.argsSchema` 尚未与契约
 * 同步：它的 `isExpr` 要求 object-property 的 `object` 是运行时 ObjectRef，符号选择器会被
 * 直接拒绝（README 第 3 节的"类型/校验器尚未同步契约"情形，先记录依赖 RIFT-1 / RIFT-62）。
 * 不近似实现：不把"来源所在位置"写成 target/pick（那会让本单位"成为目标"或让玩家另作选择，
 * 原文都没有），也不用固定 LocationRef 硬编码。token 定义（187.4 的 3 [M] Mech）、链上创建 +
 * 打出流程本身已合入，golden 测试以 Finalize 提供的位置真实执行该路径。
 */

const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self", player: "controller" } }
    },
    optional: false,
    body: [
      {
        id: "industrious-mechsmith.play-mech-token",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "mech" },
          amount: { kind: "constant", value: 1 },
          // 440.2.c / 185.2.a：被"打出"的 token 先在链上创建，再交给 play 动作。
          mode: { kind: "constant", value: "play" },
          // "here" = 结算时本单位所在的位置（420.3.b 的 here referent）：契约 3.6 的符号
          // 选择器形状；effect.token 的 argsSchema 尚未同步该形状（见文件头 status 说明）。
          location: {
            kind: "object-property",
            object: "source",
            property: "location"
          },
          linkKey: { kind: "constant", value: "mechToken" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-fd4d12013cc7cd7178ca0dc066919c845a2ca4cf3a00d76ebd6d1532e7fff561",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「play a 3 [M] Mech unit token here」的「here」只能用契约 3.6 的符号 ObjectSelector " +
    "（{ kind: \"object-property\", object: \"source\", property: \"location\" }）表达，" +
    "但已合入的 effect.token.argsSchema 尚未与契约同步：其 isExpr 要求 object-property 的 object " +
    "是运行时 ObjectRef（treasure-hoard 也记录了同一 IR 层不一致），符号选择器被直接拒绝，" +
    "因此该指令不可执行。依赖：RIFT-62（effect.token 参数解析）与契约同步（RIFT-1）。" +
    "不近似实现：不用 target/pick 让来源「成为目标」或让玩家另作选择，也不硬编码固定 LocationRef。" +
    "token 定义（187.4 的 3 [M] Mech）、链上创建 + 打出（440.2.c/185.2.a）与触发时点" +
    "（420.4.a）本身已合入，golden 测试以 Finalize 提供的位置真实执行该路径。",
  abilities,
  sourceText: "When you play me, play a 3 :rb_might: Mech unit token here."
} satisfies CardProgram;

export default program;
