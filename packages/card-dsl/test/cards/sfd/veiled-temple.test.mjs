import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/veiled-temple.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

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

function fixture({ tags, attached }) {
  return world()
    .player("A")
    .unit("world-atlas-like", { types: ["spell"], zone: "chain", owner: "A", controller: "A" })
    .unit("gear-1", {
      types: ["gear"],
      tags,
      exhausted: true,
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
  // README section 2: the reason states the concrete remaining gap (the here anchor).
  assert.match(program.judgeReason, /here/);
  assert.match(program.judgeReason, /programs\/filters\.ts/);
  assert.match(program.judgeReason, /conquer/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-221-221 Veiled Temple: optional conquer structure with ready, Equipment gate and detach", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "conquer");
  assert.equal(ability.optional, true);
  // The battlefield-relative "here" stays in the printed trigger filter; the
  // binding consumer is what rejects it (see judgeReason).
  assert.deepEqual(ability.trigger.filter, { event: "conquer", here: true, player: "controller" });
  assert.deepEqual(ability.body.map((instruction) => instruction.id), ["veiled-temple.ready-opt"]);

  // 403.1 / 355.12: the may-action picks its gear when the action is locked, so
  // the target lives on the choice node.
  assert.equal(readyChoice.op, "choice.optional");
  assert.deepEqual(readyChoice.targets, [
    {
      id: "veiled-temple.gear",
      filter: { type: "gear", controller: "controller" },
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

  // "If it's an Equipment": a real tag membership test on the readied gear.
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

test.todo(
  "sfd-221-221 Veiled Temple: resolve the conquer event's details.battlefieldId into a location filter so the " +
    "printed 'here' anchor can be bound (programs/filters.ts currently throws Unsupported filter field here)."
);
