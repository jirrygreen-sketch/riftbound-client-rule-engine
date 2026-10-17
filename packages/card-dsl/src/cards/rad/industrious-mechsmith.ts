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
 *   effect.token 的 mode "play" + Mech 定义（DEFINITIONS 含 "mech"，might 3 / tags
 *   ["Mech"]）已合入，链上创建 + 打出在半段执行中真实发生。
 * - "here"：打出本单位的那个位置（420.3.b 示例中的 here referent；464.2.b 的后续引用
 *   重新指向该位置）。静态 IR 不能写运行时 LocationRef，改用已合入的 condition.value
 *   在结算时读出来源当前位置（object-property source.location 写入链接值），再由
 *   effect.token 的 location 经 linked-value 读取——与已合入 sfd/azir-sovereign、
 *   sfd/fae-porter、ogn/noxian-drummer 的「先读后写」形状一致，且把符号选择器放在
 *   condition.value（其 argsSchema 接受契约 3.6 的 ObjectSelector）而不是
 *   effect.token 的 location 字段里。
 *
 * status 判定（README 第 2 节）：judge-required。缺口：
 * - 触发侧没有已合入订阅方把 CardProgram 的 triggered ability 注册成
 *   TriggerRegistration（卡牌程序绑定 RIFT-257 进行中），"When you play me" 目前无法从
 *   card-played 时点自动进链。
 * 正文两段（读 here + 链上创建并打出 3 [M] Mech）都已用真实执行测试覆盖：golden 用链
 * 解释器适配器 + 参考内核执行卡内原始 body，断言 Mech 的数值/标签/控制者/落点与
 * create-token → play 事件序列，并覆盖替代导致 play 被 negated 的边界。
 * 依赖：RIFT-257。
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
        // "here" = 结算时本单位所在的位置（420.3.b 的 here referent）：先用
        // condition.value 读出（359.3.f.1 的 referent 读取），写入链接值 here。
        id: "industrious-mechsmith.read-here",
        op: "condition.value",
        args: {
          value: {
            kind: "object-property",
            object: "source",
            property: "location"
          },
          key: { kind: "constant", value: "here" }
        }
      },
      {
        id: "industrious-mechsmith.play-mech-token",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "mech" },
          amount: { kind: "constant", value: 1 },
          // 440.2.c / 185.2.a：被"打出"的 token 先在链上创建，再交给 play 动作。
          mode: { kind: "constant", value: "play" },
          // "here"：读取上一条指令写出的来源位置（静态 IR 不写运行时 LocationRef）。
          location: {
            kind: "linked-value",
            instructionId: "industrious-mechsmith.read-here",
            key: "here"
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
    "正文已可执行并有真实执行证据：「play a 3 [M] Mech unit token here」用已合入的 condition.value 读出「here」（来源当前位置，" +
    "object-property source.location 写入链接值）再交给 effect.token 的 location（linked-value），Mech 定义（187.4）与链上创建 + 打出" +
    "（440.2.c / 185.2.a）都在参考内核里真实发生。整卡仍不可执行：没有已合入订阅方把 CardProgram 的 triggered ability 注册成 " +
    "TriggerRegistration，「When you play me」无法从 card-played 时点自动进链（卡牌程序绑定 RIFT-257 进行中）。依赖：RIFT-257。不近似实现。",
  abilities,
  sourceText: "When you play me, play a 3 :rb_might: Mech unit token here."
} satisfies CardProgram;

export default program;
