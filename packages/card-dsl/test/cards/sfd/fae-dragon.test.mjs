import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/fae-dragon.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { assertTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-25827836268ab76ff935741b947b08a906c9a719348a2c911526d1b8321ecce9";
const SOURCE_TEXT =
  "When you play me, buff up to four friendly units. (Give each a +1 :rb_might: buff if it doesn't have one.)\n" +
  "When you spend a buff, play a Gold gear token exhausted.";

const [playTrigger, spendTrigger] = program.abilities;
const [buffInstruction] = playTrigger.body;
const [buffSpec] = buffInstruction.targets;
const [readBase, tokenInstruction] = spendTrigger.body;

const resultFor = (outcome, id) => outcome.results.find(result => result.id === id);

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

test("sfd-101-221 Fae Dragon: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-101-221 Fae Dragon: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-101-221 Fae Dragon: judgeReason names the Gold token and entry-state gaps", () => {
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /440\.2\.c/);
  assert.match(program.judgeReason, /184\.1/);
  assert.match(program.judgeReason, /143\.4/);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /token-definition-or-abilities-judge-required/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
});

test("sfd-101-221 Fae Dragon: 'When you play me' is a mandatory card-played self trigger", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(playTrigger.optional, false);
  assert.equal(playTrigger.trigger.condition, undefined);
  assert.equal(playTrigger.trigger.once, undefined);
});

test("sfd-101-221 Fae Dragon: buff up to four friendly units is a 0..4 up-to target (355.13)", () => {
  assert.equal(playTrigger.body.length, 1);
  assert.equal(buffInstruction.id, "fae-dragon.buff-up-to-four");
  assert.equal(buffInstruction.op, "effect.buff");
  assert.deepEqual(buffInstruction.args, {
    mode: { kind: "constant", value: "buff" },
    target: { kind: "constant", value: "fae-dragon.friendly-units" }
  });
  assert.deepEqual(buffSpec, {
    id: "fae-dragon.friendly-units",
    // "friendly units": units the ability controller controls; the printed text
    // has no "other", so this unit is itself a legal choice.
    filter: { type: "unit", zone: "board", controller: "controller" },
    min: 0,
    max: 4,
    selection: "up-to"
  });
  assert.equal(buffInstruction.picks, undefined);
  assert.equal(buffInstruction.linkedTo, undefined);
});

test("sfd-101-221 Fae Dragon: 'When you spend a buff' subscribes to the buff-spent point (702.2.b, 705)", () => {
  assert.equal(spendTrigger.kind, "triggered");
  assert.equal(spendTrigger.trigger.at, "buff-spent");
  assert.deepEqual(spendTrigger.trigger.filter, { event: "buff-spent", player: "self" });
  assert.equal(spendTrigger.optional, false);
  assert.equal(spendTrigger.trigger.condition, undefined);

  assert.equal(spendTrigger.body.length, 2);
  // 440.2.b.1 / 107.1.c: the controller's Base is resolved to a concrete
  // PlayerId at resolution; the primitive refuses a symbolic controller.
  assert.deepEqual(readBase, {
    id: "fae-dragon.read-base",
    op: "condition.value",
    args: {
      value: { kind: "location", value: "ability-controller-base" },
      key: { kind: "constant", value: "base" }
    }
  });
  assert.equal(tokenInstruction.id, "fae-dragon.play-gold-token");
  assert.equal(tokenInstruction.op, "effect.token");
  assert.equal(tokenInstruction.linkedTo, "fae-dragon.read-base");
  assert.deepEqual(tokenInstruction.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(tokenInstruction.args.amount, { kind: "constant", value: 1 });
  // 440.2.c / 185.2.a: a *played* token is created on the Chain first.
  assert.deepEqual(tokenInstruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(tokenInstruction.args.location, {
    kind: "linked-value",
    instructionId: "fae-dragon.read-base",
    key: "base"
  });
  // Exhausted entry (184.1/185.2.d) is a remaining blocker, kept in the TODO.
  assert.deepEqual(tokenInstruction.args.linkKey, { kind: "constant", value: "goldToken" });
});

test("sfd-101-221 Fae Dragon golden: the buff body places one Buff on every locked friendly unit", () => {
  const kernel = world()
    .unit("fae-dragon", { might: 7, controller: "A" })
    .unit("ally-1", { might: 2, controller: "A" })
    .unit("ally-2", { might: 3, controller: "A" })
    .unit("enemy", { might: 4, controller: "B" })
    .build();
  // Finalize locks the chosen subset; the reference kernel compares the
  // filter's raw values (the "controller" anchor belongs to the Finalize
  // pipeline, programs/filters.ts), so the golden pins the four-unit maximum explicitly.
  kernel.setTargets("fae-dragon.friendly-units", [
    kernel.ref("fae-dragon"),
    kernel.ref("ally-1"),
    kernel.ref("ally-2")
  ]);

  const outcome = resolveChainBody(playTrigger.body, controllerContext(kernel));
  assert.equal(outcome.status, "executed");
  assert.equal(resultFor(outcome, "fae-dragon.buff-up-to-four").result.status, "executed");
  assert.equal(kernel.getObject("fae-dragon").buffs, 1);
  assert.equal(kernel.getObject("ally-1").buffs, 1);
  assert.equal(kernel.getObject("ally-2").buffs, 1);
  // The printed text is "friendly units", so an opponent's unit is untouched.
  assert.equal(kernel.getObject("enemy").buffs, 0);
  assert.equal(outcome.events.filter(event => event.action === "buff").length, 3);
});

test("sfd-101-221 Fae Dragon golden: exactly four units fit the printed ceiling (355.13)", () => {
  const kernel = world()
    .unit("u1", { controller: "A" })
    .unit("u2", { controller: "A" })
    .unit("u3", { controller: "A" })
    .unit("u4", { controller: "A" })
    .unit("u5", { controller: "A" })
    .build();
  kernel.setTargets("fae-dragon.friendly-units", [
    kernel.ref("u1"),
    kernel.ref("u2"),
    kernel.ref("u3"),
    kernel.ref("u4")
  ]);
  const outcome = resolveChainBody(playTrigger.body, controllerContext(kernel));
  assert.equal(outcome.status, "executed");
  for (const id of ["u1", "u2", "u3", "u4"]) assert.equal(kernel.getObject(id).buffs, 1, id);
  assert.equal(kernel.getObject("u5").buffs, 0);
});

test("sfd-101-221 Fae Dragon golden: choosing fewer units is legal (min 0 makes the set optional)", () => {
  const kernel = world()
    .unit("fae-dragon", { controller: "A" })
    .unit("ally-1", { controller: "A" })
    .build();
  kernel.setTargets("fae-dragon.friendly-units", [kernel.ref("ally-1")]);
  const outcome = resolveChainBody(playTrigger.body, controllerContext(kernel));
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("ally-1").buffs, 1);
  assert.equal(kernel.getObject("fae-dragon").buffs, 0);
});

test("sfd-101-221 Fae Dragon golden: an already-buffed unit is not buffed again (702.3.a, 427.1.c)", () => {
  const kernel = world()
    .unit("buffed-ally", { controller: "A", buffs: 1 })
    .unit("fresh-ally", { controller: "A", buffs: 0 })
    .build();
  kernel.setTargets("fae-dragon.friendly-units", [kernel.ref("buffed-ally"), kernel.ref("fresh-ally")]);
  const outcome = resolveChainBody(playTrigger.body, controllerContext(kernel));
  // 359.3.e.11: the instruction still does as much as it can — one unit gains
  // its Buff, the already-buffed one is left alone.
  assert.equal(resultFor(outcome, "fae-dragon.buff-up-to-four").result.status, "executed");
  assert.equal(kernel.getObject("buffed-ally").buffs, 1);
  assert.equal(kernel.getObject("fresh-ally").buffs, 1);
  assert.equal(outcome.events.filter(event => event.action === "buff").length, 1);
});

test("sfd-101-221 Fae Dragon golden: the printed body resolves the Base then plays Gold", () => {
  // 187.5 / 440.2.b.1: the card's own two instructions run for real. The Base
  // resolves to the ability controller's seat and the canonical Gold is played
  // there through the shared token handoff.
  const kernel = world().player("A").build();
  const outcome = resolveChainBody(spendTrigger.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["fae-dragon.read-base", "executed"],
    ["fae-dragon.play-gold-token", "executed"]
  ]);
  assert.deepEqual(outcome.linkedValues["fae-dragon.read-base.base"], { type: "base", player: "A" });
  const receipt = outcome.linkedValues["fae-dragon.play-gold-token.goldToken"];
  assert.equal(receipt.blockedReason, undefined);
  assert.equal(receipt.amount, 1);
  assert.equal(receipt.createdAmount, 1);
  const golds = kernel.objects.filter(object => object.isToken);
  assert.equal(golds.length, 1);
  assert.equal(golds[0].name, "Gold");
  assert.deepEqual(golds[0].types, ["gear"]);
  assert.deepEqual(golds[0].location, { type: "base", player: "A" });
});

test("sfd-101-221 Fae Dragon: the controller Base really follows the ability controller", () => {
  // 440.4 / 107.1.c: the created token belongs to the ability controller, so the
  // destination must be that player's Base, not a hard-coded seat.
  for (const controller of ["A", "B"]) {
    const base = world().player("A").player("B").build();
    const kernel = base.clone({ controller });
    const outcome = resolveChainBody([readBase], kernel);
    assert.equal(outcome.status, "executed");
    assert.deepEqual(outcome.linkedValues["fae-dragon.read-base.base"], { type: "base", player: controller });
  }
});

test("sfd-101-221 Fae Dragon: the real buff-spent trigger is rejected by the event-pattern vocabulary", () => {
  const source = world()
    .unit("fae-dragon", { cardId: CARD_ID, controller: "A" })
    .build()
    .getObject("fae-dragon");
  const registrations = triggerRegistrations(
    new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]),
    source
  );
  const spendRegistration = registrations.find(registration => registration.spec.at === "buff-spent");
  assert.ok(spendRegistration);
  assert.throws(
    () => assertTriggerSpec(spendRegistration.spec),
    error => error.name === "TriggerSpecValidationError" &&
      /trigger\.filter\.event/.test(error.message)
  );
});

test.todo(
  "sfd-101-221 Fae Dragon: create/play Gold with exhausted entry (187.5/184.1/185.2.d); " +
    "this needs a Gold definition and an entry-state override on the create/play actions " +
    "(the controller-base destination is merged)"
);

test.todo(
  "sfd-101-221 Fae Dragon: register buff-spent in the pipeline event-pattern vocabulary and connect " +
    "the existing action producer to this trigger (702.2.b/705)"
);
