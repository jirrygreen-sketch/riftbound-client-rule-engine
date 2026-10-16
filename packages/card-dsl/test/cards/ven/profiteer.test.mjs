import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/profiteer.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import empower from "../../../../engine-core/dist/effects/instructions/effect.empower.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-f011b0eba0d960f743fcc486af923c64f5eb0128c2d7d5ff267454e665d10897";
const SOURCE_TEXT =
  "When you play me, you may disempower something you control to empower a legend, unit, or gear.";

const [ability] = program.abilities;
const [optional] = ability.body;
const [payDisempower, empowerTarget] = optional.args.body.value;
const OPTIONAL_ID = "profiteer.may-trade-status/optional";

const profiteerWorld = () => {
  const base = world()
    .unit("profiteer", { might: 4, location: { type: "base", player: "A" } })
    .unit("soldier", { might: 2, location: { type: "base", player: "A" } })
    .build();
  return base.clone({
    controller: "A",
    sourceSnapshot: base.getObject("profiteer")
  });
};

test("ven-082-166 Profiteer: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-082-166 Profiteer: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.match(program.judgeReason, /disempower/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.match(program.judgeReason, /legend-zone/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-082-166: 'When you play me' is a card-played trigger whose leading 'you may' is the ability's option", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.a / 420.4.a："When you play me" 是 Play Effect，在打出完成后进链。
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  // 403.1 / 契约 3.9："you may" 是可选执行，被选指令包进 choice.optional 的 body。
  assert.equal(ability.optional, true);
  assert.equal(optional.id, "profiteer.may-trade-status");
  assert.equal(optional.op, "choice.optional");
  assert.equal(optional.linkedTo, undefined);
  assert.equal(optional.targets, undefined);
});

test("ven-082-166: the disempower half is a Finalize cost with a non-target selection (740.4.a.2, 355.10.c)", () => {
  assert.deepEqual(optional.args.body.value.map((instruction) => [instruction.id, instruction.op]), [
    ["profiteer.pay-disempower", "cost.pay"],
    ["profiteer.empower-target", "effect.empower"]
  ]);
  assert.equal(payDisempower.linkedTo, undefined);
  // 740.4.a.2：触发能力效果首段的费用在 Finalization 支付；443.2.a 的 disempower 是
  // Limited Action，作为费用时只能作为费用计划的付款组件（RIFT-89 缺口见 judgeReason）。
  assert.deepEqual(payDisempower.args.payments, {
    kind: "constant",
    value: [
      {
        kind: "disempower",
        choice: {
          id: "profiteer.disempower-choice",
          options: ["board-object-you-control"],
          filter: { zone: "board", controller: "self" },
          min: 1,
          max: 1,
          selection: "one"
        }
      }
    ]
  });
  // 355.10.c：只作为费用出现的对象不指向目标，因此用 pick（choice）而不是 TargetSpec。
  assert.equal(payDisempower.targets, undefined);
  assert.equal(payDisempower.picks, undefined);
});

test("ven-082-166: the effect half empowers one legend, unit, or gear (442.1)", () => {
  assert.equal(empowerTarget.linkedTo, "profiteer.pay-disempower");
  assert.deepEqual(empowerTarget.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "profiteer.legend-unit-or-gear" }
  });
  assert.deepEqual(empowerTarget.targets, [
    {
      id: "profiteer.legend-unit-or-gear",
      // 355.9.a：unit/gear 默认指 Board 上的对象，legend 指 Legend Zone 中的传奇；
      // 契约 ZoneId 没有 legend-zone，因此不写 zone 键（写 board 会把传奇排除，
      // 写 Legend Zone 又不存在；见 judgeReason 第 3 条）。
      filter: { type: ["legend", "unit", "gear"] },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("ven-082-166 golden: declining the may-body changes nothing", () => {
  const kernel = profiteerWorld();
  kernel.setAnswers({ [OPTIONAL_ID]: false });

  const outcome = resolveChainBody(ability.body, kernel);

  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason]),
    [["profiteer.may-trade-status", "negated", "skipped"]]
  );
  assert.equal(kernel.getObject("soldier").empowered, 0);
  assert.deepEqual(outcome.events, []);
  assert.deepEqual(kernel.events, []);
});

test("ven-082-166 golden: the declared empower half really empowers the locked target", () => {
  // The acceptance branch's first instruction is the unmerged cost.pay op, so
  // the golden runs the card's own effect.empower instruction against the
  // Finalize-locked selection (the blade-dancer/instance pattern).
  const kernel = profiteerWorld();
  const run = runInstruction(
    empower,
    { objects: empowerTarget.args.objects },
    {
      world: kernel,
      targets: { "profiteer.legend-unit-or-gear": [kernel.ref("soldier")] }
    }
  );

  assert.equal(run.result.status, "executed");
  // 442.1：对象成为 Empowered（442.1.a 的二元状态在参考内核里以 empowered 计数表达）。
  assert.equal(kernel.getObject("soldier").empowered, 1);
  assert.deepEqual(kernel.events.map((event) => event.action), ["empower"]);
  assert.deepEqual(run.linked.empowered, {
    mode: "empower",
    count: 1,
    objects: [{ id: "soldier", zoneEntryId: 1 }]
  });
});

test.todo(
  "ven-082-166 Profiteer: pay the printed disempower inside the may-body at Finalize and read its receipt " +
    "(740.4.a.2, 443.2) — cost/plan-values.ts supports no disempower payment kind and cost.pay has no merged " +
    "instruction file (RIFT-89 cost-plan wiring)"
);

test.todo(
  "ven-082-166 Profiteer: the 'When you play me' trigger runs end to end — needs a CardProgram → " +
    "TriggerRegistration subscriber so card-played triggers enter the chain (RIFT-120 chain/events pipeline)"
);

test.todo(
  "ven-082-166 Profiteer: a legend in the Legend Zone can be chosen and empowered — the frozen ZoneId has no " +
    "legend-zone (CR 108.3) and effect.empower only accepts Board objects, so the legend third of the printed " +
    "'legend, unit, or gear' range cannot resolve yet"
);
