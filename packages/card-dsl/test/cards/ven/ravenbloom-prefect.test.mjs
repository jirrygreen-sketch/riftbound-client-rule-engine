import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/ravenbloom-prefect.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import banish from "../../../../engine-core/dist/effects/instructions/effect.banish.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-d634172fb2585ee4db78e68c349e431e5825d5f5ef9f9bc7e4ce2f3904a44e74";
const SOURCE_TEXT = "When an opponent plays a gear, you may banish me to banish it.";

const [ability] = program.abilities;
const [mayBanish] = ability.body;
const [paySelf, banishIt] = mayBanish.args.body.value;

test("ven-102-166 Ravenbloom Prefect: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-102-166 Ravenbloom Prefect: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /383\.3\.b/);
  assert.match(program.judgeReason, /ObjectSelector/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-120/);
});

test("ven-102-166 Ravenbloom Prefect: an opponent's gear play is the trigger (383.4.a.4 / 420.4.a)", () => {
  // 383.4.a.4：其他物件被打出的触发不是本卡的 Play Effect。
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    object: { type: "gear" },
    player: "opponent"
  });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  // 383.3.a：效果首部的 “you may” 是执行决定。
  assert.equal(ability.optional, true);
});

test("ven-102-166 Ravenbloom Prefect: choice.optional wraps the banish-me cost and banish-it effect (3.9)", () => {
  assert.equal(mayBanish.op, "choice.optional");
  assert.equal(mayBanish.args.body.kind, "constant");
  assert.deepEqual(
    mayBanish.args.body.value.map(instruction => [instruction.id, instruction.op]),
    [
      ["ravenbloom-prefect.pay-banish-self", "cost.pay"],
      ["ravenbloom-prefect.banish-it", "effect.banish"]
    ]
  );
  assert.equal(mayBanish.linkedTo, undefined);

  // 383.3.b / 383.3.b.1：紧跟 “you may” 的 “banish me” 是基础费用（428.5）。
  assert.deepEqual(paySelf.args.payments, {
    kind: "constant",
    value: [{ kind: "banish", object: "self" }]
  });
  // “it” 的事件物件选择器缺口见 judgeReason 第 2 点：只保留描述性占位，不伪造引用。
  assert.deepEqual(banishIt.args.objects, {
    kind: "constant",
    value: { triggerObject: "card-played" }
  });
  assert.equal(banishIt.linkedTo, "ravenbloom-prefect.pay-banish-self");
  assert.equal(banishIt.targets, undefined);
});

test("ven-102-166 golden: effect.banish really sends the locked gear to its owner's banishment", () => {
  // 428.1/428.2：道具进入其拥有者的 Banishment；这一步与「用哪个选择器指向 it」无关，
  // 因此用 Finalize 已锁定目标的等价形状真实执行原语本体。
  const kernel = world()
    .player("controller")
    .player("B")
    .unit("opponent-gear", {
      owner: "B",
      controller: "B",
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "B" }
    })
    .build();
  const run = runInstruction(
    banish,
    {
      objects: { kind: "constant", value: { target: "probe.locked-gear" } },
      amount: banishIt.args.amount,
      linkKey: banishIt.args.linkKey
    },
    { world: kernel, targets: { "probe.locked-gear": [kernel.ref("opponent-gear")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("opponent-gear").zone, "banishment");
  assert.equal(kernel.getObject("opponent-gear").owner, "B");
  assert.equal(run.linked.banishedGear.count, 1);
  assert.deepEqual(run.events.map(event => event.action), ["banish"]);
});

test("ven-102-166 golden: a gear that already left the board makes the banish ignored", () => {
  const kernel = world()
    .player("controller")
    .player("B")
    .unit("opponent-gear", {
      owner: "B",
      controller: "B",
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "B" }
    })
    .build();
  const stale = kernel.ref("opponent-gear");
  kernel.perform({ type: "kill", object: stale });
  const run = runInstruction(
    banish,
    {
      objects: { kind: "constant", value: { target: "probe.locked-gear" } },
      amount: { kind: "constant", value: 1 }
    },
    { world: kernel, targets: { "probe.locked-gear": [stale] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
});

test.todo(
  "ven-102-166 Ravenbloom Prefect: pay 'banish me' as the triggered ability's base cost — banish is not a " +
    "supported nonstandard payment kind in cost/plan-values.ts (RIFT-89), and contract 3.1's TriggeredAbility " +
    "has no cost field"
);

test.todo(
  "ven-102-166 Ravenbloom Prefect: name the triggering event's object — ObjectSelector is self/source/target/pick/" +
    "linked, with no event-object selector (recorded for ogn/back-alley-bar; contract change request)"
);

test.todo(
  "ven-102-166 Ravenbloom Prefect: register the CardProgram triggered ability and normalise the relative " +
    "'opponent' player selector — no merged CardProgram -> TriggerRegistration path (contract 3.5, RIFT-120)"
);
