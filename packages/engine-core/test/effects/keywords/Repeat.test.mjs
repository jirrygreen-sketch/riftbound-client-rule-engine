import assert from "node:assert/strict";
import test from "node:test";
import {
  EFFECT_IR_V2_RULESET,
  validateCardProgram
} from "@riftbound/card-dsl";
import repeat from "../../../dist/effects/keywords/Repeat.js";
import { keywordDefinitionsById } from "../../../dist/effects/keywords/registry.generated.js";
import { runAbilityBody } from "../../../dist/effects/interpreter.js";
import { instructionDefinitionsById } from "../../../dist/effects/instructions/registry.generated.js";
import { world } from "../../../dist/effects/testing/index.js";

const HOST = { canonicalCardId: "test-repeat-spell" };
const constant = value => ({ kind: "constant", value });

function program(abilities) {
  return {
    canonicalCardId: HOST.canonicalCardId,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities,
    sourceText: "[Repeat]"
  };
}

// CR v1.5 820.1 / 820.1.a：Repeat 是法术与能力上的可选附加费用关键词。
test("Repeat keyword definition declares a non-valued keyword with v1.5 rule refs", () => {
  assert.equal(repeat.keyword, "Repeat");
  assert.equal(repeat.valued, false);
  assert.ok(repeat.ruleRefs.includes("820.1"));
  assert.ok(repeat.ruleRefs.includes("820.1.a"));
  assert.ok(repeat.ruleRefs.includes("820.1.d"));
  assert.ok(repeat.ruleRefs.includes("820.3"));
});

// CR v1.5 820.1.c.2 / 820.1.c.3 / 820.3：多个 Repeat 实例各自独立支付。
test("Repeat stacking is separate per 820.1.c.2 / 820.3", () => {
  assert.equal(repeat.stacking, "separate");
});

test("Repeat expands to a static repeat.cost ability that validates", () => {
  const abilities = repeat.expand({ host: HOST });
  assert.equal(abilities.length, 1);
  assert.equal(abilities[0].kind, "static");
  assert.equal(abilities[0].effect.kind, "repeat.cost");
  assert.equal(abilities[0].effect.appliesTo, "self");
  assert.equal(abilities[0].effect.host, HOST.canonicalCardId);
  assert.equal(abilities[0].effect.count, 1);
  const result = validateCardProgram(program(abilities));
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("Repeat expansion carries the printed Repeat cost when provided", () => {
  const abilities = repeat.expand({ host: HOST, cost: { kind: "additional-cost", energy: 2 } });
  assert.deepEqual(abilities[0].effect.cost, { kind: "additional-cost", energy: 2 });
  const result = validateCardProgram(program(abilities));
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

// 820.1.c：费用来自印刷文本，不是 keyword 数值；value 被忽略也能展开。
test("Repeat expansion ignores value because the keyword is not valued (820.1.c)", () => {
  const abilities = repeat.expand({ value: 3, host: HOST });
  assert.equal(abilities.length, 1);
  const result = validateCardProgram(program(abilities));
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("each separate Repeat instance expands to its own repeat.cost ability", () => {
  const first = repeat.expand({ host: HOST, cost: { energy: 2 } });
  const second = repeat.expand({ host: HOST, cost: { energy: 3 } });
  assert.notEqual(first, second);
  assert.deepEqual(first[0].effect.cost, { energy: 2 });
  assert.deepEqual(second[0].effect.cost, { energy: 3 });
  const result = validateCardProgram(program([...first, ...second]));
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

// 解释器端语义边界：0/1/N 个已付费 Repeat 实例 → 额外执行 0/1/N 次。
// 付费实例数由 cost 管线得出后接到解释器内建 repeat 指令上（管线未合入，
// 见 Repeat.ts 头部说明）；此处用测试原语验证已合入的 repeat 指令的
// 数值边界（重复执行 + 不重复打出）。
const testGain = {
  op: "test.gain-energy",
  argsSchema: {
    parse: value => {
      if (typeof value.amount !== "number" || !Number.isFinite(value.amount)) {
        throw new TypeError("amount must be a finite number");
      }
      return value;
    }
  },
  execute(context, args) {
    const outcome = context.perform({ type: "gain-energy", player: context.controller, amount: args.amount });
    if (outcome.status !== "done") {
      return { status: "negated", reason: outcome.status === "replaced" ? "replaced" : "impossible", events: [...outcome.events] };
    }
    return { status: "executed", events: [...outcome.events], linkedValues: { value: outcome.result ?? args.amount } };
  }
};
const registry = new Map([...instructionDefinitionsById, [testGain.op, testGain]]);
const gainInstruction = (id, amount) => ({ id, op: "test.gain-energy", args: { amount: constant(amount) } });
const repeatInstruction = (id, count, body) => ({
  id,
  op: "repeat",
  args: { count: constant(count), body: constant(body) }
});

test("interpreter repeat executes the body once per paid instance (820.1.d.1)", () => {
  const kernel = world().build();
  const body = [gainInstruction("gain", 1)];
  const outcome = runAbilityBody([repeatInstruction("repeat", 2, body)], kernel, registry);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").energy, 2);
});

test("interpreter repeat with zero paid instances does not re-execute (820.1.d)", () => {
  const kernel = world().build();
  const body = [gainInstruction("gain", 1)];
  const outcome = runAbilityBody([repeatInstruction("repeat", 0, body)], kernel, registry);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").energy, 0);
  assert.equal(kernel.events.length, 0);
});

// 820.3.a：无论额外执行多少次，该牌/能力只被打出一次——repeat 迭代本身
// 不产生额外的 play 动作。
test("interpreter repeat runs the body in resolution without replaying the card (820.3.a)", () => {
  const kernel = world().build();
  const body = [gainInstruction("gain", 1)];
  const outcome = runAbilityBody([repeatInstruction("repeat", 3, body)], kernel, registry);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").energy, 3);
  const playedEvents = kernel.events.filter(event => event.action === "play");
  assert.equal(playedEvents.length, 0);
});

test("Repeat is registered in the generated keyword registry", () => {
  const registered = keywordDefinitionsById.get("Repeat");
  assert.ok(registered);
  assert.equal(registered.keyword, "Repeat");
});
