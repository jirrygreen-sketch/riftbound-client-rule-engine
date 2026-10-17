import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/magma-wurm.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";

const CARD_ID = "card.hash-d92b1df4324a20717aaeab68c916883889ea337f917bdf10104e9df82f9a3c19";
const ENTRY = program.abilities[0].with[0];
const ENTER_READY = ENTRY.args.instead.value[0];
const c = value => ({ kind: "constant", value });

/**
 * Production adapter duty: the card DSL wraps every argument in an Expr
 * (validateExpr rejects raw values), while replacement/bind.ts reads
 * `replacement.event.instead` as the raw instruction body. The unwrap below
 * covers exactly that one declared literal field; `event` stays Expr-wrapped
 * because the binder evaluates it. The card itself is unchanged.
 */
const bindFromProgram = (ability, hostRef, deps) => bindReplacement({
  ...ability,
  with: ability.with.map(instruction => instruction.op === "replacement.event" ? {
    ...instruction,
    args: { ...instruction.args, instead: instruction.args.instead.value }
  } : instruction)
}, hostRef, deps);

function fixture(turnPlayer = "A") {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .base("wurm", { energy: null, power: null, might: 8 })
    .hand("ally", { energy: 0, power: [] })
    .hand("ally2", { energy: 0, power: [] })
    .hand("enemy-unit", { owner: "B", energy: 0, power: [] })
    .deck(["A:deck:1", "A:deck:2"])
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => {
      if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) return [...request.options];
      if (request.type === "optional") return true;
      throw new Error(`Unexpected choice: ${request.id}`);
    },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer, phase: "main", host, cleanup: () => false });
  return { engine, kernel, host };
}

const resolveAll = engine => {
  engine.advance();
  let guard = 0;
  while (engine.items.length) {
    if (++guard > 50) throw new Error("Nonterminating test chain");
    engine.pass(engine.priority);
  }
};

const playUnit = (state, id, controller, sourceId) => state.engine.execute({
  id: `${id}-play`,
  kind: "unit",
  controller,
  speed: "normal",
  source: state.kernel.getObject(sourceId),
  body: [],
  cost: { id: `cost:${id}`, cost: { kind: "explicit", energy: c(0) } }
});

const bindDeps = state => ({
  host: { object: ref => state.kernel.object(ref), objects: () => state.kernel.objects, context: () => state.kernel },
  pipeline: state.engine.pipeline
});

test("magma-wurm: passes validateCardProgram and is indexed by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardProgramsById.get(CARD_ID), program);
});

test("magma-wurm: identity, ruleset, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Expr-wrapped/);
  assert.match(program.judgeReason, /369\.3/);
  assert.match(program.judgeReason, /359\.2\.c/);
  assert.match(program.judgeReason, /replacement\.object/);
  assert.equal(program.sourceText, "Other friendly units enter ready.");
});

test("magma-wurm: a single replacement ability for other friendly units entering the board (369.3)", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "replacement");
  assert.deepEqual(ability.replaces, {
    event: "object-enters-board",
    filter: { type: "unit", controller: "controller", other: true, exhausted: true }
  });
  // 740.1.a/364.3: "Other" excludes the source itself; 370.1.b makes the entry
  // filter read the replaced event (the default exhausted entry).
  assert.equal(ability.replaces.filter.other, true);
  assert.equal(ability.replaces.filter.exhausted, true);
  assert.equal(ability.condition, undefined);
});

test("magma-wurm: the replacement declares the merged replacement.event form with the replaced-object binding", () => {
  assert.equal(program.abilities[0].with.length, 1);
  assert.equal(ENTRY.id, "magma-wurm.register-entry");
  assert.equal(ENTRY.op, "replacement.event");
  assert.deepEqual(ENTRY.args.event, {
    kind: "constant",
    value: {
      event: "object-enters-board",
      filter: { type: "unit", controller: "controller", other: true, exhausted: true }
    }
  });
  // The instead body orients the replaced event's object (CR 355.10.c "it")
  // through the merged REPLACED_EVENT_LINK spelling, never a TargetSpec.
  assert.equal(ENTER_READY.id, "magma-wurm.enter-ready");
  assert.equal(ENTER_READY.op, "effect.ready");
  assert.deepEqual(ENTER_READY.args.objects, {
    kind: "constant",
    value: { linked: "replacement.object" }
  });
  assert.equal(ENTER_READY.targets, undefined);
  assert.equal(ENTER_READY.picks, undefined);
  assert.equal(ENTER_READY.linkedTo, undefined);
});

test("magma-wurm golden: a friendly unit that would enter exhausted enters ready instead", () => {
  const state = fixture("A");
  bindFromProgram(program.abilities[0], state.kernel.ref("wurm"), bindDeps(state));
  playUnit(state, "ally", "A", "ally");
  resolveAll(state.engine);
  assert.equal(state.kernel.getObject("ally").zone, "board");
  assert.equal(state.kernel.getObject("ally").exhausted, false);
  // The replacement is an entry rewrite: no separate "becomes ready" timing
  // fires for the entering unit (CR 805.6/369.3, same shape as Accelerate).
  assert.equal(state.engine.pipeline.events.some(event => event.timingPoint === "object-readied"), false);
  // Magma Wurm itself stays untouched on the board.
  assert.equal(state.kernel.getObject("wurm").zone, "board");
});

test("magma-wurm golden: without a bound replacement the same unit enters exhausted (359.2.c)", () => {
  const state = fixture("A");
  playUnit(state, "ally", "A", "ally");
  resolveAll(state.engine);
  assert.equal(state.kernel.getObject("ally").zone, "board");
  assert.equal(state.kernel.getObject("ally").exhausted, true);
});

test("magma-wurm golden: an enemy unit entering exhausted is not readied (740.1.a friendly)", () => {
  const state = fixture("B");
  bindFromProgram(program.abilities[0], state.kernel.ref("wurm"), bindDeps(state));
  playUnit(state, "enemy", "B", "enemy-unit");
  resolveAll(state.engine);
  assert.equal(state.kernel.getObject("enemy-unit").zone, "board");
  assert.equal(state.kernel.getObject("enemy-unit").exhausted, true);
});

test("magma-wurm golden: the replacement stays live and readies each friendly entry (CR 370.2 once per event)", () => {
  const state = fixture("A");
  bindFromProgram(program.abilities[0], state.kernel.ref("wurm"), bindDeps(state));
  playUnit(state, "ally", "A", "ally");
  resolveAll(state.engine);
  playUnit(state, "ally2", "A", "ally2");
  resolveAll(state.engine);
  assert.equal(state.kernel.getObject("ally").exhausted, false);
  assert.equal(state.kernel.getObject("ally2").exhausted, false);
});

test.todo(
  "magma-wurm: register the declared replacement from the CardProgram in the production lifecycle " +
    "(production binding must unwrap the DSL's Expr-wrapped instead body into the binder's raw " +
    "instruction-body field; event stays Expr-wrapped because the binder evaluates it); the golden " +
    "drives the binder directly today"
);
