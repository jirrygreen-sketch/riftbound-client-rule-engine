import type { CardProgram } from "../../ir/index.js";

/**
 * Bashful Bloom — CR v1.5 404.1.a/415.5 (4 Energy + exhaust),
 * 187.2/816 (Sprite with Temporary), 184.1 (ready entry),
 * 404.2/404.3 (variable activation discount). cost.pay/cost.modify and
 * Temporary are merged; token definition, entry override, live discount
 * and controller-relative Base remain incomplete.
 */
export default {
  canonicalCardId:
    "card.hash-7c38c7fbf3d002c5be05a68b52e8d74195df7d791f974e04b64a12b0a010fb46",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口（CR v1.5）：(1) effect.token 的冻结定义表仍缺 187.2 的 sprite（3 Might、无域、Fae、Temporary）：" +
    "golden 对 \"sprite\" 执行真实原语得到 negated(impossible)，Temporary KeywordDef 本身已合入。(2) effect.token 的 " +
    "argsSchema 只接受 Expr 形状的 location（实测抛 Invalid effect.token argument: location），" +
    "解释器分发不会把 LocationExpr/相对选择器求值后交给它，常数 { type:\"base\", player:\"controller\" } 也不是 LocationRef" +
    "（实测经生产链 negated(impossible)：resolveLocationSelector 认得 controller，但 effect.token 只接受具体 PlayerId），" +
    "create-token 的 GameAction 也没有 143.4/184.1/185.2.d 的 ready 入场状态字段；" +
    "先横置进场再 ready 会产生额外的“成为就绪”事件，不算等价实现。" +
    "(3) 404.2/404.3 的「每个带 Temporary 的友方单位少 1 Energy」仍缺关键词特征过滤计数（ObjectFilter 没有关键词维度）" +
    "与 programs/activate.ts 把变量折扣接入 Finalize discounts 的路径；cost.modify/cost.pay 本体已合入，不能在结算时再收费替代启动费用。" +
    "(4) location 中 player:controller 是未解析的描述值：effect.token 只接受实际 LocationRef/PlayerId，" +
    "RIFT-357 的相对选择器虽已合入，但尚未接到该原语的参数边界，缺能力控制者 Base 的求值。",
  abilities: [
    {
      kind: "activated",
      timing: "action",
      cost: {
        kind: "activated",
        energy: { kind: "constant", value: 4 },
        payments: [{ kind: "exhaust", object: "self" }]
      },
      body: [
        {
          id: "bashful-bloom.play-sprite",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "sprite" },
            amount: { kind: "constant", value: 1 },
            // 187.2 / 440.2.c：“Play … token” 需要链上创建再打出；合并内核的
            // mode "play" 已支持链上创建与打出；Sprite 定义仍缺。
            mode: { kind: "constant", value: "play" },
            location: { kind: "constant", value: { type: "base", player: "controller" } },
            linkKey: { kind: "constant", value: "spriteToken" }
            // 184.1 的入场状态改写（“ready”）：create-token 尚不支持
            // （见 judgeReason）。不新增 IR 参数键，也不会先创建再补一次
            // “成为就绪”的效应。
          }
        }
      ]
    }
  ],
  sourceText:
    ":rb_energy_4:, :rb_exhaust:: Play a ready 3 :rb_might: Sprite unit token with [Temporary]. " +
    "This ability costs :rb_energy_1: less for each friendly unit with [Temporary]."
} satisfies CardProgram;
