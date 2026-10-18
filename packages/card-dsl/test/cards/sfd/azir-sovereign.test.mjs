import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import program from "../../../dist/cards/sfd/azir-sovereign.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runInstruction } from "../../../../engine-core/dist/effects/testing/index.js";
import { buildAdditionalCostPlan } from "../../../../engine-core/dist/cost/kinds/additional.js";
import costPay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";
import { CombatFlow } from "../../../../engine-core/dist/combat/flow.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { bindStaticAbility, createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CARD_ID = "card.hash-f83c5d61c7ea4a0d2c54ba2c2a17020893a7a3b5a90d16003fe815b2b61c5c12";
const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };
const BASE = { type: "base", player: "A" };
const MAY_ID = "azir-sovereign.may-move-tokens";
const READ_ID = "azir-sovereign.read-battlefield";
const MOVE_ID = "azir-sovereign.move-tokens";
const TARGET_ID = "azir-sovereign.token-units";

const azirWorld = () => world()
  .unit("azir", { might: 4, location: BATTLEFIELD })
  .unit("token-a", { isToken: true, might: 1, location: BASE })
  .unit("token-b", { isToken: true, might: 1, location: BASE })
  .unit("plain", { might: 2, location: BASE })
  .build();

// The ability host is the attacked unit; TestWorld captures its default source
// when the (still empty) world is built, so bind the real host reference.
const boundWorld = (kernel) => kernel.clone({
  source: kernel.ref("azir"),
  sourceSnapshot: kernel.getObject("azir")
});

const body = () => program.abilities[1].body;
const innerBody = () => body()[0].args.body.value;

// The reference test kernel's own filter matcher compares scalars by value and
// has no `type: "token"` branch, and no `controller` placeholder binding; the
// production matchers (layers/filter.ts, events/pipeline-match.ts, and
// chain/engine.ts's self/opponent normalization) own both. Bind the production
// matcher here so the golden test executes the real declared filter, exactly
// like the target pipeline does in production.
const productionContext = (kernel) => bindResolveContext(kernel, {
  query: (filter) => kernel.objects.filter((object) => matchesObjectFilter(
    Object.fromEntries(Object.entries(filter).map(([key, value]) => [key, value === "controller" ? kernel.controller : value])),
    object
  ))
});

test("sfd-177-221 Azir, Sovereign: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-177-221 Azir, Sovereign: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /attack-declared/);
  assert.match(program.judgeReason, /combat-start-transaction/);
  assert.match(program.judgeReason, /accelerate\.cost has no layer mapping/);
  assert.match(program.judgeReason, /Nested\/repeated targets/);
  assert.doesNotMatch(program.judgeReason, /RIFT-/);
  assert.equal(
    program.sourceText,
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_order: as an additional cost to have me enter ready.)\n" +
      "When I attack, you may move any number of your token units to this battlefield."
  );
});

test("sfd-177-221 Azir, Sovereign: Accelerate keyword plus an attack trigger with an optional body", () => {
  assert.equal(program.abilities.length, 2);
  const [accelerate, attack] = program.abilities;
  assert.deepEqual(accelerate, { kind: "keyword", keyword: "accelerate" });

  // "When I attack" is an Attack Trigger (383.4.e) at the attack-declared timing point.
  assert.equal(attack.kind, "triggered");
  assert.equal(attack.trigger.at, "attack-declared");
  assert.deepEqual(attack.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  assert.equal(attack.trigger.condition, undefined);
  assert.equal(attack.optional, true);
  assert.equal(body().length, 1);

  // "you may ...": the chosen instructions are wrapped in the choice body (3.9).
  const choice = body()[0];
  assert.equal(choice.id, MAY_ID);
  assert.equal(choice.op, "choice.optional");
  assert.deepEqual(choice.args.prompt, { kind: "constant", value: "Move any number of your token units to this battlefield?" });
  assert.equal(choice.args.body.kind, "constant");
  assert.deepEqual(innerBody().map((instruction) => [instruction.id, instruction.op]), [
    [READ_ID, "condition.value"],
    [MOVE_ID, "effect.move"]
  ]);
});

test("sfd-177-221 Azir, Sovereign: the move reads \"this battlefield\" from the source referent and moves up to every token unit", () => {
  const [read, move] = innerBody();

  // "this battlefield" is the source's location (359.3.f.1/.2): read it at
  // resolution time rather than storing a runtime ObjectRef in static IR.
  assert.deepEqual(read.args.value, { kind: "object-property", object: "source", property: "location" });
  assert.deepEqual(read.args.key, { kind: "constant", value: "here" });

  assert.equal(move.op, "effect.move");
  assert.equal(move.linkedTo, READ_ID);
  assert.deepEqual(move.args.objects, { kind: "constant", value: { target: TARGET_ID } });
  assert.deepEqual(move.args.to, { kind: "linked-value", instructionId: READ_ID, key: "here" });
  // "any number" is bounded by the number of token units actually chosen (355.13).
  assert.equal(move.args.amount.kind, "count");
  assert.deepEqual(move.args.amount.filter, { object: { target: TARGET_ID } });

  // "your token units": a target choice (355.12) that may be zero, not a pick.
  assert.equal(move.picks, undefined);
  assert.deepEqual(move.targets, [
    {
      id: TARGET_ID,
      filter: { type: "token", controller: "controller", zone: "board" },
      min: 0,
      selection: "up-to"
    }
  ]);
});

test("sfd-177-221 Azir, Sovereign: declining the may-ability moves nothing", () => {
  const kernel = boundWorld(azirWorld());
  kernel.setAnswers({ [`${MAY_ID}/optional`]: false });
  const outcome = resolveChainBody(body(), kernel);

  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status, result.result.reason]), [
    [MAY_ID, "negated", "skipped"]
  ]);
  assert.deepEqual(kernel.events, []);
  assert.deepEqual(kernel.getObject("token-a").location, BASE);
  assert.deepEqual(kernel.getObject("token-b").location, BASE);
  assert.deepEqual(kernel.getObject("plain").location, BASE);
});

test("sfd-177-221 Azir, Sovereign: accepting moves the chosen token units to this battlefield and leaves non-tokens behind", () => {
  const kernel = boundWorld(azirWorld());
  kernel.setTargets(TARGET_ID, [kernel.ref("token-a"), kernel.ref("token-b")]);
  kernel.setAnswers({ [`${MAY_ID}/optional`]: true });
  const outcome = resolveChainBody(body(), productionContext(kernel));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    [READ_ID, "executed"],
    [MOVE_ID, "executed"],
    [MAY_ID, "executed"]
  ]);
  const readResult = outcome.results.find((result) => result.id === READ_ID);
  assert.deepEqual(readResult.result.linkedValues.here, BATTLEFIELD);
  const moveResult = outcome.results.find((result) => result.id === MOVE_ID);
  assert.deepEqual(moveResult.result.linkedValues.moved, {
    count: 2,
    objects: [kernel.ref("token-a"), kernel.ref("token-b")],
    movements: [
      { object: kernel.ref("token-a"), from: BASE, to: BATTLEFIELD },
      { object: kernel.ref("token-b"), from: BASE, to: BATTLEFIELD }
    ]
  });

  assert.deepEqual(kernel.getObject("token-a").location, BATTLEFIELD);
  assert.deepEqual(kernel.getObject("token-b").location, BATTLEFIELD);
  assert.deepEqual(kernel.getObject("plain").location, BASE);
  assert.deepEqual(kernel.events.map((event) => [event.action, event.outcome ?? "done"]), [
    ["move-location", "done"],
    ["move-location", "done"]
  ]);
  assert.equal(kernel.history({ action: "move-location" }), 2);
});

test.todo(
  "Azir, Sovereign: emit attack-declared from the real Attacker designation transaction (383.4.e.2/466.2.c) — " +
    "combat/flow.ts still throws TurnCombatBlockedError('combat-start-transaction') before any role emission"
);
test.todo(
  "Azir, Sovereign: build the interpreter target-selection lifecycle adapter that lets Finalize lock (or legally empty) " +
    "the nested up-to token-target group inside the optional body (355.12/355.13)"
);
test.todo(
  "Azir, Sovereign: map accelerate.cost into the optional-additional cost pipeline and gate the 805.6 entry replacement " +
    "on the paid decision, without a becomes-ready trigger (805.2.b/805.6.a)"
);

test("Azir, Sovereign: the real combat start transaction is still blocked (383.4.e.2/466.2.c)", () => {
  // Attacker designation is produced by the combat start task. That task keeps
  // throwing before any attack-declared emission exists, so the trigger cannot
  // fire from real play.
  const f = fixture({});
  const flow = new CombatFlow(f.engine, f.engine.pipeline.host, [{ id: "bf", controller: null }], () => {});
  assert.equal(f.engine.commit({ type: "move-zone", object: f.kernel.ref("source"), to: "board", location: { type: "battlefield", id: "bf" } }).status, "done");
  assert.equal(f.engine.commit({ type: "move-zone", object: f.kernel.ref("enemy"), to: "board", location: { type: "battlefield", id: "bf" } }).status, "done");
  assert.equal(flow.entered(f.host.objects().find(object => object.ref.id === "source")).length, 1);
  assert.equal(flow.cleanup(), true);
  assert.deepEqual(flow.battlefields.map(field => field.staged), ["combat"]);
  assert.throws(() => flow.advance(), error => error.code === "combat-start-transaction" && /466\.2/.test(error.message));
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "attack-declared").length, 0);
});

test("Azir, Sovereign: the declared accelerate.cost static has no binding, so it never reaches Finalize", () => {
  // 805.2.b/805.6.a: Accelerate's paid decision must gate the entry replacement.
  // The keyword's static accelerate.cost has no layer mapping and play.ts
  // rejects additional costs, so nothing collects or charges it.
  const f = fixture({ cards: [{ id: "azir-sovereign", cardId: CARD_ID, types: ["unit"], might: 4 }] });
  const source = f.kernel.getObject("azir-sovereign");
  const registry = new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]);
  const expanded = expandProgram(registry.get(CARD_ID), source);
  const declared = expanded.abilities.find(candidate => candidate.kind === "static" && candidate.effect.kind === "accelerate.cost");
  assert.equal(declared !== undefined, true);
  assert.throws(() => bindStaticAbility(createEngineStaticBinder(f.engine), declared, source),
    error => error.code === "judge-required" && /accelerate\.cost has no layer mapping/.test(error.message));
});

test("Azir, Sovereign: the real chain blocks the nested token target before Finalize can lock it", () => {
  // 355.12/355.13: the "any number of your token units" choice lives inside the
  // optional body. assertFinalizationSurface only collects top-level targets, so
  // the production chain refuses the item outright rather than resolving a
  // possibly-empty group.
  const f = fixture({ cards: [{ id: "azir-sovereign", cardId: CARD_ID, types: ["unit"], might: 4 }] });
  const source = f.kernel.getObject("azir-sovereign");
  assert.throws(
    () => f.engine.execute({
      id: "azir-sovereign.attack",
      controller: "A",
      source,
      kind: "triggered",
      speed: "action",
      body: program.abilities[1].body
    }),
    error => error.name === "ChainContractBlockedError" &&
      /Nested\/repeated targets require an interpreter target-selection lifecycle adapter/.test(error.message)
  );
  // The declared target really is nested inside the choice body, which is why
  // the surface check fires.
  assert.equal(program.abilities[1].body[0].args.body.value[1].targets.length, 1);
});


test("Azir, Sovereign: the source referent follows a real move before the trigger body resolves", () => {
  const kernel = boundWorld(azirWorld());
  const destination = { type: "battlefield", id: "battlefield-2" };
  const moved = runInstruction(move, {
    objects: { kind: "constant", value: "self" }, to: { kind: "constant", value: destination }
  }, { world: kernel });
  assert.equal(moved.result.status, "executed");
  kernel.setTargets(TARGET_ID, [kernel.ref("token-a")]);
  kernel.setAnswers({ [`${MAY_ID}/optional`]: true });
  const outcome = resolveChainBody(body(), productionContext(kernel));
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.linkedValues[`${MAY_ID}/${READ_ID}.here`], destination);
  assert.deepEqual(kernel.getObject("token-a").location, destination);
  assert.deepEqual(kernel.getObject("token-b").location, BASE);
});

test("Azir, Sovereign: Accelerate's merged planner records paid and declined decisions with Order allocation", () => {
  for (const selected of [false, true]) {
    const base = world().player("A", { energy: 5, power: ["Order"] })
      .hand("azir", { types: ["unit"], energy: 4, power: null }).build();
    const kernel = base.clone({ sourceSnapshot: base.getObject("azir") });
    const plan = buildAdditionalCostPlan(kernel, { id: "azir.play", cost: { kind: "printed" }, domains: ["Order"] }, [
      { id: "azir.accelerate", kind: "accelerate", selected }
    ]);
    assert.equal(plan.printed.power, null);
    assert.equal(plan.total.energy, selected ? 5 : 4);
    const run = runInstruction(costPay, { cost: { kind: "constant", value: plan } }, { world: kernel });
    assert.equal(run.result.status, "executed");
    assert.deepEqual(run.linked.payment.additional, selected ? [{ id: "azir.accelerate", kind: "accelerate", paid: true }] : []);
    assert.deepEqual(run.linked.payment.power.power, selected ? [{ requirementIndex: 0, from: "Order", amount: 1 }] : []);
    assert.equal(kernel.player("A").energy, selected ? 0 : 1);
    assert.equal(kernel.getObject("azir").zone, "hand");
  }
});
