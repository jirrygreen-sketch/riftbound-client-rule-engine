import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/fae-porter.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { assertTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { ChainContractBlockedError } from "../../../../engine-core/dist/chain/engine.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-a08970a66c071f3fd82fd5a9ca7f63e01c9674666037e987829b498e9b9b58db";
const SOURCE_TEXT =
  "When I move to a battlefield, you may pay :rb_rune_chaos: to move a unit you control to the same battlefield.";

const [ability] = program.abilities;
const [mayPay] = ability.body;
const body = mayPay.args.body.value;
const [payInstruction, readInstruction, moveInstruction] = body;

// Use the merged program filter translator, then bind self exactly as the
// chain query does. Keep the authored body/TargetSpecs intact.
function controllerContext(kernel) {
  return new Proxy(kernel, {
    get(target, key) {
      if (key === "query") return filter => {
        const normalized = translateObjectFilter(filter);
        if (normalized.controller === "self") normalized.controller = target.controller;
        return target.query(normalized);
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

const executableBody = [readInstruction, moveInstruction];

test("sfd-125-221 Fae Porter: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-125-221 Fae Porter: judgeReason names event subscription and leading cost binding", () => {
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /449\.1\/449\.2/);
  assert.match(program.judgeReason, /458/);
  assert.match(program.judgeReason, /163\.1\/163\.2/);
  assert.match(program.judgeReason, /383\.3\.b\.1/);
  assert.match(program.judgeReason, /TriggerRegistration.cost/);
  assert.match(program.judgeReason, /Nested\/repeated targets/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
});

test("sfd-125-221 Fae Porter: 'when I move to a battlefield' subscribes to object-moved", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "object-moved");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-moved",
    toZone: "battlefield",
    filter: { source: "self" }
  });
  assert.equal(ability.optional, false);
});

test("sfd-125-221 Fae Porter: the may-shape pays 1 Chaos power, reads \"here\" and moves a friendly unit (contract 3.9)", () => {
  assert.equal(mayPay.op, "choice.optional");
  assert.equal(mayPay.args.body.kind, "constant");
  assert.deepEqual(body.map((instruction) => instruction.id), [
    "fae-porter.pay-chaos",
    "fae-porter.read-battlefield",
    "fae-porter.move-unit"
  ]);

  // 163.1/163.2: one Chaos Power; the cost plan owns payability and domain matching.
  assert.equal(payInstruction.op, "cost.pay");
  assert.deepEqual(payInstruction.args.payments, { kind: "constant", value: { power: ["Chaos"] } });
  assert.equal(payInstruction.linkedTo, undefined);

  // 359.3.f.1: "the same battlefield" is the source's current Location read at
  // resolution; static IR cannot hold a runtime LocationRef.
  assert.equal(readInstruction.op, "condition.value");
  assert.deepEqual(readInstruction.args.value, {
    kind: "object-property",
    object: "source",
    property: "location"
  });
  assert.deepEqual(readInstruction.args.key, { kind: "constant", value: "here" });

  // 451: an effect Move (not the Standard Move); the chosen unit is a target
  // (355.10 / 355.9.a.1) and the destination comes from the linked referent.
  assert.equal(moveInstruction.op, "effect.move");
  assert.deepEqual(moveInstruction.args.objects, {
    kind: "constant",
    value: { target: "fae-porter.friendly-unit" }
  });
  assert.deepEqual(moveInstruction.args.to, {
    kind: "linked-value",
    instructionId: "fae-porter.read-battlefield",
    key: "here"
  });
  assert.equal(moveInstruction.linkedTo, "fae-porter.read-battlefield");
  assert.deepEqual(moveInstruction.targets, [
    {
      id: "fae-porter.friendly-unit",
      filter: { type: "unit", controller: "controller", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(mayPay.targets, undefined);
  assert.equal(mayPay.linkedTo, undefined);
});

test("sfd-125-221 Fae Porter golden: declining the may moves nothing", () => {
  const kernel = world()
    .unit("fae", { owner: "A", location: { type: "battlefield", id: "field-1" } })
    .unit("ally", { owner: "A", location: { type: "base", player: "A" } })
    .build();
  kernel.setAnswers({ "fae-porter.may-pay/optional": false });

  const outcome = resolveChainBody(ability.body, kernel);

  assert.deepEqual(outcome.results.map((entry) => entry.id), ["fae-porter.may-pay"]);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(kernel.events, []);
  assert.deepEqual(kernel.getObject("ally").location, { type: "base", player: "A" });
});

test("sfd-125-221 Fae Porter golden: the linked source Location moves the chosen unit to that battlefield", () => {
  // The move body itself only needs the merged effect.move primitive: the source
  // Location is read with the real read-battlefield instruction (359.3.f.1) and
  // the target is pre-locked, the corinna-veraza / azir-sovereign convention.
  const kernel = world()
    .unit("fae", { owner: "A", location: { type: "battlefield", id: "field-1" } })
    .unit("ally", { owner: "A", location: { type: "base", player: "A" } })
    .build();
  kernel.setTargets("fae-porter.friendly-unit", [kernel.ref("ally")]);
  // The source snapshot of the kernel is the first created object; pin it to
  // Fae Porter so the referent reads the moving unit's battlefield.
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("fae") });
  context.setTargets("fae-porter.friendly-unit", [context.ref("ally")]);

  const outcome = resolveChainBody(executableBody, controllerContext(context));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => entry.result.status), ["executed", "executed"]);
  assert.deepEqual(outcome.linkedValues["fae-porter.read-battlefield.here"], {
    type: "battlefield",
    id: "field-1"
  });
  assert.deepEqual(context.getObject("ally").location, { type: "battlefield", id: "field-1" });
  assert.deepEqual(outcome.events.map((event) => event.action), ["move-location"]);
  assert.equal(outcome.linkedValues["fae-porter.move-unit.moved"].count, 1);
});

test("sfd-125-221 Fae Porter golden: a unit already at the source battlefield is not moved again (448.3.b)", () => {
  const kernel = world()
    .unit("fae", { owner: "A", location: { type: "battlefield", id: "field-1" } })
    .unit("already-there", { owner: "A", location: { type: "battlefield", id: "field-1" } })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("fae") });
  context.setTargets("fae-porter.friendly-unit", [context.ref("already-there")]);

  const run = runInstruction(
    move,
    {
      objects: { kind: "constant", value: { target: "fae-porter.friendly-unit" } },
      to: { kind: "constant", value: { type: "battlefield", id: "field-1" } },
      amount: { kind: "constant", value: 1 }
    },
    { world: context, targets: { "fae-porter.friendly-unit": [context.ref("already-there")] } }
  );

  // A Move to the unit's current Location is skipped, never re-emitted as a
  // Move action (448.3.b) and the instruction still reports success with 0 moved.
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events, []);
  assert.equal(run.linked.moved.count, 0);
});

test("sfd-125-221 Fae Porter: the moved trigger binds structurally but fails closed at production validation", () => {
  const source = world()
    .unit("fae", { cardId: program.canonicalCardId, location: { type: "battlefield", id: "field-1" } })
    .build()
    .getObject("fae");
  const [registration] = triggerRegistrations(
    new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]),
    source
  );
  assert.equal(registration.spec.at, "object-moved");
  assert.equal(registration.cost, undefined);
  assert.equal(registration.mayAtFinalize, undefined);
  assert.throws(
    () => assertTriggerSpec(registration.spec),
    error => error.name === "TriggerSpecValidationError" &&
      /trigger\.filter\.event/.test(error.message)
  );
});

test.todo(
  "sfd-125-221 Fae Porter: admit object-moved into EVENT_PATTERN_TYPES and bind the moved source/" +
    "battlefield restriction to the existing producer (449.1/449.2, Recall excluded by 458)"
);

test("sfd-125-221 Fae Porter: the real chain blocks the nested friendly-unit target before Finalize", () => {
  // 355.9.a.1/355.10: "move a unit you control" is a TargetSpec inside the
  // optional body. assertFinalizationSurface only collects top-level targets, so
  // the production chain refuses the item instead of resolving the selection.
  const f = fixture({ cards: [{ id: "fae-porter", cardId: CANONICAL, types: ["unit"] }] });
  assert.throws(
    () => f.engine.execute({
      id: "fae-porter.moved",
      controller: "A",
      source: f.kernel.getObject("fae-porter"),
      kind: "triggered",
      speed: "action",
      body: ability.body
    }),
    error => error instanceof ChainContractBlockedError &&
      /Nested\/repeated targets require an interpreter target-selection lifecycle adapter/.test(error.message)
  );
  assert.equal(body[2].targets.length, 1);
});

test.todo(
  "sfd-125-221 Fae Porter: lift leading may/pay into TriggerRegistration.cost/mayAtFinalize " +
    "and pay before finalization (383.3.a/383.3.b.1), with authoritative Power-pool deduction"
);

test("sfd-125-221 Fae Porter golden: the authored sub-effects plan 1 Chaos Power before moving the selected ally", () => {
  const base = world()
    .player("A", { power: ["Chaos"] })
    .unit("fae", { location: { type: "battlefield", id: "field-1" } })
    .unit("ally", { location: { type: "base", player: "A" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("fae") });
  kernel.setTargets("fae-porter.friendly-unit", [kernel.ref("ally")]);
  kernel.setAnswers({ "fae-porter.may-pay/optional": true });

  const outcome = resolveChainBody(ability.body, controllerContext(kernel));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.events.map(event => event.action), ["pay", "move-location"]);
  const receipt = outcome.linkedValues["fae-porter.may-pay/fae-porter.pay-chaos.payment"];
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.total.power, [{ amount: 1, allowedDomains: ["Chaos"] }]);
  assert.deepEqual(receipt.actions[0].action.plan.power, ["Chaos"]);
  assert.deepEqual(kernel.getObject("ally").location, { type: "battlefield", id: "field-1" });
  // The reference kernel's pay action does not deduct Power. Its real action
  // and allocator receipt are the evidence here; Finalize remains a TODO.
});

test("sfd-125-221 Fae Porter golden: the normalized controller target excludes an opponent unit", () => {
  const base = world()
    .unit("fae", { location: { type: "battlefield", id: "field-1" } })
    .unit("enemy", { controller: "B", owner: "B", location: { type: "base", player: "B" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("fae") });
  kernel.setTargets("fae-porter.friendly-unit", [kernel.ref("enemy")]);

  const outcome = resolveChainBody(executableBody, controllerContext(kernel));

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.at(-1).result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(kernel.getObject("enemy").location, { type: "base", player: "B" });
  assert.deepEqual(kernel.events, []);
});
