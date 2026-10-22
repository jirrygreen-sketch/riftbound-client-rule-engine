import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/veiled-temple.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { finalizeChoicePlan } from "../../../../engine-core/dist/chain/finalize/choices.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { ProgramBindingError } from "../../../../engine-core/dist/programs/errors.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { TurnFlow } from "../../../../engine-core/dist/turn/flow.js";

const CARD_ID = "card.hash-9daf60cdf4c82e4fba1f685af1c9b0d748003f7e9ad9c68f02f429bdd0cf85e5";
const SOURCE_TEXT =
  "When you conquer here, you may ready a friendly gear. If it's an Equipment, you may detach it.";

const [ability] = program.abilities;
const [readyChoice] = ability.body;
const [readyGear, detachChoice] = readyChoice.args.body.value;
const [detach] = detachChoice.args.body.value;

// Card filters spell the ability controller "controller"; the reference kernel
// matches filter values literally, so the production matcher runs with that value
// resolved, exactly as chain/engine.ts resolves controller/owner spellings.
const productionContext = (kernel, controller = "A") => bindResolveContext(kernel, {
  source: kernel.getObject("world-atlas-like"),
  sourceSnapshot: kernel.getObject("world-atlas-like"),
  controller,
  query: (filter) => kernel.objects.filter((object) => matchesObjectFilter(
    Object.fromEntries(Object.entries(filter).map(([key, value]) => [
      key,
      (key === "controller" || key === "owner") && value === "controller" ? controller : value
    ])),
    object
  ))
});

function fixture({ tags, attached, exhausted = true }) {
  return world()
    .player("A")
    .unit("world-atlas-like", { types: ["spell"], zone: "chain", owner: "A", controller: "A" })
    .unit("gear-1", {
      types: ["gear"],
      tags,
      exhausted,
      zone: "board",
      owner: "A",
      controller: "A",
      location: { type: "battlefield", id: "bf-1" },
      attachedTo: attached ? { id: "host-unit", zoneEntryId: 1 } : null
    })
    .unit("host-unit", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-1" } })
    .build();
}

test("sfd-221-221 Veiled Temple: program validates, is registered and stays judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // README section 2: the reason states the concrete current gap. The old
  // "here" blocker is closed by the merged EventPattern and pipeline matcher.
  assert.match(program.judgeReason, /here/);
  assert.match(program.judgeReason, /programs\/trigger-adapters\/leading-choice\.ts:78-81/);
  assert.match(program.judgeReason, /programs\/triggers\.ts:23-31/);
  assert.match(program.judgeReason, /chain\/finalize\/choices\.ts:207-217/);
  assert.match(program.judgeReason, /unsupported leading may shape/);
  assert.match(program.judgeReason, /TargetSpec/);
  assert.match(program.judgeReason, /target\/picks\/plan\.ts:220-236/);
  assert.match(program.judgeReason, /target-backed pick/);
  assert.match(program.judgeReason, /本来已 ready/);
  assert.match(program.judgeReason, /383\.3\.a/);
  assert.match(program.judgeReason, /383\.3\.a\.3/);
  assert.match(program.judgeReason, /355\.12/);
  assert.match(program.judgeReason, /conquer/);
  assert.match(program.judgeReason, /details\.battlefieldId/);
  assert.match(program.judgeReason, /events\/trigger-spec\.ts:203-216/);
  assert.match(program.judgeReason, /events\/pipeline-match\.ts:89-94/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-221-221 Veiled Temple: optional conquer structure with ready, Equipment gate and detach", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "conquer");
  assert.equal(ability.optional, true);
  // The battlefield-relative "here" stays in the printed trigger filter and
  // is now consumed by the production pipeline matcher (see judgeReason).
  assert.deepEqual(ability.trigger.filter, { event: "conquer", here: true, player: "controller" });
  assert.deepEqual(ability.body.map((instruction) => instruction.id), ["veiled-temple.ready-opt"]);

  // 403.1 / 355.12: the may-action picks its gear when the action is locked, so
  // the target lives on the choice node.
  assert.equal(readyChoice.op, "choice.optional");
  assert.deepEqual(readyChoice.targets, [
    {
      id: "veiled-temple.gear",
      filter: { type: "gear", zone: "board", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(readyChoice.args.body.kind, "constant");
  assert.equal(readyGear.op, "effect.ready");
  assert.deepEqual(readyGear.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "veiled-temple.gear" }
  });

  // "If it's an Equipment": a real tag membership test on the selected gear.
  assert.equal(detachChoice.op, "choice.optional");
  assert.equal(detachChoice.linkedTo, "veiled-temple.ready-gear");
  assert.deepEqual(detachChoice.condition, {
    kind: "compare",
    left: { kind: "constant", value: "Equipment" },
    operator: "in",
    right: {
      kind: "object-property",
      object: { target: "veiled-temple.gear" },
      property: "tags"
    }
  });

  // 436.3: detaching the readied gear is a non-target pick over the linked result.
  assert.equal(detach.op, "effect.detach");
  assert.equal(detach.args.pick.kind, "constant");
  assert.deepEqual(detach.picks[0].options, [
    { kind: "linked-value", instructionId: "veiled-temple.ready-gear", key: "readied" }
  ]);
});

test("sfd-221-221 Veiled Temple: friendly gear means only controller-owned Board gears", () => {
  const kernel = world()
    .player("A")
    .player("B")
    .unit("friendly-board", { types: ["gear"], zone: "board", location: { type: "base", player: "A" } })
    .unit("enemy-board", { types: ["gear"], zone: "board", owner: "B", controller: "B", location: { type: "base", player: "B" } })
    .unit("friendly-hand", { types: ["gear"], zone: "hand", location: null })
    .unit("friendly-trash", { types: ["gear"], zone: "trash", location: null })
    .build();
  const context = { controller: "A", anchor: kernel.getObject("friendly-board") };
  const filter = readyChoice.targets[0].filter;
  assert.equal(matchesObjectFilter(filter, kernel.getObject("friendly-board"), context), true);
  assert.equal(matchesObjectFilter(filter, kernel.getObject("enemy-board"), context), false);
  assert.equal(matchesObjectFilter(filter, kernel.getObject("friendly-hand"), context), false);
  assert.equal(matchesObjectFilter(filter, kernel.getObject("friendly-trash"), context), false);
});

test("sfd-221-221 Veiled Temple golden: an Equipment gear is readied and then detached", () => {
  const kernel = fixture({ tags: ["Equipment"], attached: true });
  const context = productionContext(kernel);
  kernel.setTargets("veiled-temple.gear", [kernel.ref("gear-1")]);
  kernel.setPicks("veiled-temple.detached-gear", [kernel.ref("gear-1")]);
  // The interpreter scopes choice request ids by execution path: the outer may
  // node asks at "veiled-temple.ready-opt/optional", the nested one under it.
  kernel.setAnswers({
    "veiled-temple.ready-opt/optional": true,
    "veiled-temple.ready-opt/veiled-temple.detach-opt/optional": true
  });

  const outcome = resolveChainBody(ability.body, context);
  assert.equal(outcome.status, "executed");
  const byId = new Map(outcome.results.map((entry) => [entry.id, entry.result]));
  assert.equal(byId.get("veiled-temple.ready-gear").status, "executed");
  assert.equal(byId.get("veiled-temple.detach").status, "executed");
  // 416.1: the gear really became ready; 436.1: the Equipment really detached.
  assert.equal(kernel.getObject("gear-1").exhausted, false);
  assert.equal(kernel.getObject("gear-1").attachedTo, null);
});

test("sfd-221-221 Veiled Temple golden: a non-Equipment gear is readied but never detached", () => {
  const kernel = fixture({ tags: [], attached: true });
  const context = productionContext(kernel);
  kernel.setTargets("veiled-temple.gear", [kernel.ref("gear-1")]);
  kernel.setPicks("veiled-temple.detached-gear", [kernel.ref("gear-1")]);
  kernel.setAnswers({
    "veiled-temple.ready-opt/optional": true,
    "veiled-temple.ready-opt/veiled-temple.detach-opt/optional": true
  });

  const outcome = resolveChainBody(ability.body, context);
  // "If it's an Equipment" fails, so the detach branch is a skipped negation and
  // the gear stays attached; the ready half still happened.
  assert.equal(outcome.status, "partial");
  const byId = new Map(outcome.results.map((entry) => [entry.id, entry.result]));
  assert.equal(byId.get("veiled-temple.ready-gear").status, "executed");
  assert.equal(byId.get("veiled-temple.detach-opt").status, "negated");
  assert.equal(byId.get("veiled-temple.detach-opt").reason, "skipped");
  assert.equal(kernel.getObject("gear-1").exhausted, false);
  assert.deepEqual(kernel.getObject("gear-1").attachedTo, kernel.ref("host-unit"));
});

test("sfd-221-221 Veiled Temple golden: declining the ready skips the detach prompt entirely", () => {
  const kernel = fixture({ tags: ["Equipment"], attached: true });
  kernel.setTargets("veiled-temple.gear", [kernel.ref("gear-1")]);
  kernel.setAnswers({ "veiled-temple.ready-opt/optional": false });
  const outcome = resolveChainBody(ability.body, productionContext(kernel));
  assert.deepEqual(outcome.results.map((entry) => entry.id), ["veiled-temple.ready-opt"]);
  assert.equal(kernel.getObject("gear-1").exhausted, true);
  assert.deepEqual(kernel.getObject("gear-1").attachedTo, kernel.ref("host-unit"));
  assert.deepEqual(kernel.events, []);
});

test("sfd-221-221 Veiled Temple golden: an already-ready Equipment exposes the target-backed pick gap", () => {
  // 416.1.c means the first may changes nothing, but "it" still refers to the
  // selected Equipment. The current linked-receipt pick loses that identity.
  const kernel = fixture({ tags: ["Equipment"], attached: true, exhausted: false });
  kernel.setTargets("veiled-temple.gear", [kernel.ref("gear-1")]);
  kernel.setPicks("veiled-temple.detached-gear", [kernel.ref("gear-1")]);
  kernel.setAnswers({
    "veiled-temple.ready-opt/optional": true,
    "veiled-temple.ready-opt/veiled-temple.detach-opt/optional": true
  });

  assert.throws(
    () => resolveChainBody(ability.body, productionContext(kernel)),
    error => error?.name === "PickSelectionError" && error.code === "invalid-choice" &&
      /veiled-temple\.detached-gear/.test(error.message)
  );
});

function pipelineFixture(sourceLocation) {
  const kernel = world()
    .player("A")
    .player("B")
    .unit("veiled", {
      cardId: CARD_ID,
      types: ["battlefield"],
      controller: "A",
      location: { type: "battlefield", id: sourceLocation },
      energy: null,
      power: null,
      might: null
    })
    .base("mover", { controller: "A", might: 3 })
    .unit("host", { controller: "A", owner: "A", location: { type: "base", player: "A" } })
    .unit("gear", {
      types: ["gear"],
      tags: ["Equipment"],
      controller: "A",
      owner: "A",
      exhausted: true,
      location: { type: "base", player: "A" },
      attachedTo: { id: "host", zoneEntryId: 1 },
      energy: null,
      power: null,
      might: null
    });
  for (const player of ["A", "B"]) {
    kernel.deck(Array.from({ length: 8 }, (_, index) => `${player}:deck:${index}`), { owner: player });
    kernel.rune(Array.from({ length: 8 }, (_, index) => `${player}:rune:${index}`), { owner: player });
  }
  const worldState = kernel.build();
  const requests = [];
  const choose = request => {
    requests.push(structuredClone(request));
    if (request.type === "select-objects" && request.options.length === request.min) return [...request.options];
    if (request.type === "select-objects" && request.min === 0) return [];
    if (request.type === "mode" && request.id.includes(":order:")) return request.options[0];
    if (request.type === "mode" && request.id.startsWith("engagement:")) return request.options[0];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: worldState.snapshot(), links: worldState.clone() }),
    restore: saved => {
      worldState.restore(saved.state);
      worldState.copyLinkedFrom(saved.links);
    },
    objects: () => worldState.objects,
    perform: action => worldState.perform(action),
    performContract: action => worldState.performContract(action),
    performBatchLeaf: (action, batchId) => worldState.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(worldState, {
      source,
      controller,
      timingPoint,
      choose
    }),
    testTrigger: registration => worldState.test(registration.spec.condition)
  });
  return { world: worldState, host, requests };
}

test("sfd-221-221 Veiled Temple: the real program binding fails closed on the mixed Finalize/Resolve may timing", () => {
  const f = pipelineFixture("bf1");
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host: f.host,
    cleanup: () => false
  });
  const live = { ...program, status: "executable", judgeReason: undefined };
  const binding = createProgramBinding({ cardPrograms: [live] });
  assert.throws(
    () => binding.registerProgramTriggers(engine, f.world.getObject("veiled")),
    error => error instanceof ProgramBindingError && error.code === "judge-required" &&
      /unsupported leading may shape/.test(error.message)
  );
  assert.equal(engine.pipeline.checkpoint().triggers.size, 0);
});

test("sfd-221-221 Veiled Temple: real TurnFlow conquer matches only the Veiled Temple battlefield", () => {
  const run = sourceLocation => {
    const f = pipelineFixture(sourceLocation);
    const flow = new TurnFlow({
      host: f.host,
      player: id => f.world.player(id),
      turnOrder: ["A", "B"],
      battlefields: [{ id: "bf1", controller: null }, { id: "bf2", controller: null }]
    });
    const triggerOnly = {
      ...program,
      status: "executable",
      judgeReason: undefined,
      // This probe isolates `here` matching from the card's leading may. The
      // production two-decision program is separately asserted to fail closed.
      abilities: [{ ...ability, optional: false, body: [] }]
    };
    const binding = createProgramBinding({ cardPrograms: [triggerOnly] });
    binding.registerProgramTriggers(flow.chain, f.world.getObject("veiled"));
    flow.start();
    flow.execute({
      id: `conquer-from-${sourceLocation}`,
      controller: "A",
      source: f.world.getObject("mover"),
      kind: "activated",
      speed: "normal",
      body: [{
        id: "move-to-veiled",
        op: "effect.move",
        args: { to: { kind: "constant", value: { type: "battlefield", id: "bf1" } } }
      }]
    });
    for (let guard = 0; flow.chain.items.length || flow.chain.focus !== null; guard++) {
      assert.ok(guard < 80, "production chain must settle");
      flow.pass(flow.chain.items.length ? flow.chain.priority : flow.chain.focus);
    }
    const conquer = flow.chain.pipeline.events.find(event => event.timingPoint === "conquer");
    assert.equal(conquer.details.battlefieldId, "bf1");
    return flow.chain.trace.filter(entry =>
      entry.step === "pending" && String(entry.item).startsWith("trigger:"));
  };

  // The Battlefield says "here"; only the source whose live location is bf1
  // sees the authoritative conquer payload at bf1.
  assert.equal(run("bf1").length, 1);
  assert.equal(run("bf2").length, 0);
});

test("sfd-221-221 Veiled Temple: Finalize planning would ask the later detach may at the wrong time", () => {
  const f = pipelineFixture("bf1");
  f.world.setAnswers({
    "veiled-temple.ready-opt/optional": true,
    "veiled-temple.ready-opt/veiled-temple.detach-opt/optional": false
  });
  const context = bindResolveContext(f.world, {
    source: f.world.getObject("veiled"),
    controller: "A",
    choose: request => {
      f.requests.push(structuredClone(request));
      return f.world.choose(request);
    }
  });
  const plan = finalizeChoicePlan(context, ability.body);

  assert.deepEqual(f.requests.map(request => request.id), [
    "veiled-temple.ready-opt/optional",
    "veiled-temple.ready-opt/veiled-temple.detach-opt/optional"
  ]);
  assert.equal(plan.optionalChoices.length, 2);
  assert.deepEqual(plan.optionalChoices.map(choice => choice.accepted), [true, false]);
  // The TargetSpec is attached to the outer may node, while the Finalize
  // choice-plan walker descends through the optional branch without planning
  // the control node's own target requirement.
  assert.equal(plan.targets.length, 0);
});
