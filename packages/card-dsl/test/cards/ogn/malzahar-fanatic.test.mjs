import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/malzahar-fanatic.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import resources from "../../../../engine-core/dist/effects/instructions/effect.resources.js";

const [action, activated] = program.abilities;
const c = value => ({ kind: "constant", value });

test("Malzahar, Fanatic program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Malzahar, Fanatic identity, ruleset and judge-required reason", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-0821b41b5d117a852897d54edb6109cc048ab5637104799b63924d6edb073ee4"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // 缺的是 Universal Power 的契约表示与 cost.sacrifice 型非标准费用。
  assert.match(program.judgeReason, /163\.2\.b/);
  assert.match(program.judgeReason, /Universal/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.equal(
    program.sourceText,
    "Kill a friendly unit or gear, :rb_exhaust:: [Action] — [Add] :rb_rune_rainbow::rb_rune_rainbow:. " +
      "(Use on your turn or in showdowns. Abilities that add resources can't be reacted to.)"
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("structure: [Action] keyword plus an action-speed activated ability", () => {
  assert.deepEqual(action, { kind: "keyword", keyword: "action" });
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  assert.equal(activated.restriction, undefined);
});

test("structure: the printed cost is 'kill a friendly unit or gear, then exhaust this'", () => {
  assert.equal(activated.cost.kind, "activated");
  assert.equal(activated.cost.payments.length, 2);

  // 355.10.c.1："[do X] to [do Y]" 的 X 是 cost within instructions，不算目标；
  // 这里以 kill 支付 + 对象选择表达。
  const [kill, exhaust] = activated.cost.payments;
  assert.equal(kill.kind, "kill");
  assert.deepEqual(kill.choice.options, ["friendly-unit-or-gear"]);
  assert.deepEqual(kill.choice.type, ["unit", "gear"]);
  assert.equal(kill.choice.owner, "controller");
  assert.equal(kill.choice.selection, "one");
  assert.equal(kill.choice.min, 1);
  assert.equal(kill.choice.max, 1);

  // :rb_exhaust: = "Exhaust this"（135.2.e.2 / 415.5）。
  assert.equal(exhaust.kind, "exhaust");
});

test("structure: [Add] two Universal Power, kept as Universal and never a named domain", () => {
  assert.equal(activated.body.length, 1);
  const [add] = activated.body;
  assert.equal(add.id, "malzahar.add-universal");
  assert.equal(add.op, "effect.resources");
  assert.deepEqual(add.args.power, c(["Universal", "Universal"]));
  assert.equal(add.args.energy, undefined, "[A][A] adds no Energy");
  assert.equal(add.targets, undefined);
  // 绝不能把 [A] 近似成任一具体域。
  for (const domain of ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]) {
    assert.equal(JSON.stringify(add.args).includes(`"${domain}"`), false);
  }
});

test("golden: the merged primitive refuses an unrepresentable Universal Power gain", () => {
  // effect.resources 文档明确：Universal Power 不在封闭 Domain 类型内，且"never
  // approximated by a chosen domain"；这里断言实现是 negated impossible 而不是悄悄
  // 选一个域或加 0。
  const kernel = world().build();
  const run = runInstruction(
    resources,
    { power: c(["Universal", "Universal"]) },
    { world: kernel }
  );

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.deepEqual(run.events, []);
  assert.deepEqual(kernel.player("A").power, []);
});

test.todo(
  "Malzahar, Fanatic: charging the 'Kill a friendly unit or gear' cost at Finalize (415.4 / 357.2) needs " +
    "the cost.sacrifice-style non-standard payment and its object chooser (RIFT-89 batch3-cost-plan)"
);

test.todo(
  "Malzahar, Fanatic: [Add] [A][A] needs a contract change for Universal Power (CR 163.2.b / 135.2.e.5) — " +
    "either a Universal member of the closed Domain type or a dedicated gain-universal-power action"
);
