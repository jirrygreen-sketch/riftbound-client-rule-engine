import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import zenithBlade from "../../../dist/cards/ogn/zenith-blade-leona.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import stun from "../../../../engine-core/dist/effects/instructions/effect.stun.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine, ChainContractBlockedError } from "../../../../engine-core/dist/chain/engine.js";

const CANONICAL = "card.hash-a4a04e52d4544c14530e273f53c3890ccd0d8688ef9dc725dc0ef6b1d20103de";
const BASE = player => ({ type: "base", player });
const BATTLEFIELD = id => ({ type: "battlefield", id });

const [keyword, play] = zenithBlade.abilities;
const [stunInstruction, readInstruction, optionalInstruction] = play.body;
const stunSpec = stunInstruction.targets[0];
const moveInstruction = optionalInstruction.args.body.value[0];
const moveSpec = moveInstruction.targets[0];

/**
 * Two execution paths are merged, and each accepts different argument shapes.
 *
 * - runAbilityBody with the default registry evaluates every argument first and
 *   hands the primitive literal values (a target id string, a LocationRef),
 *   which is what effect.stun accepts and what effect.move rejects.
 * - resolveChainBody (chain/interpreter-adapter.ts) keeps the raw Expr nodes
 *   inside one literal envelope and decodes the declared literal fields, which
 *   is what effect.move needs to evaluate a linked Location itself.
 * The tests therefore drive each half through the path the merged engine uses
 * for it, with Finalize-style locked targets supplied by the caller.
 */
const withoutTargets = instruction => {
  const { targets, ...rest } = instruction;
  return rest;
};

test("Zenith Blade program is structurally valid EffectIR v2 data", () => {
  const result = validateCardProgram(zenithBlade);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Zenith Blade identity, ruleset, status, printed text and judgeReason", () => {
  assert.equal(zenithBlade.canonicalCardId, CANONICAL);
  assert.equal(zenithBlade.rulesetVersion, "core-1.5");
  assert.equal(zenithBlade.status, "judge-required");
  assert.equal(
    zenithBlade.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "Stun an enemy unit at a battlefield. You may move a friendly unit to that enemy unit's battlefield. " +
      "(A stunned unit doesn't deal combat damage this turn.)"
  );
  // The judgeReason must name the blocked nested-target Finalize surface, the
  // rule that makes the choice part of the Move, and the current Move
  // consequence state.
  assert.match(zenithBlade.judgeReason, /choice\.optional/);
  assert.match(zenithBlade.judgeReason, /355\.12/);
  assert.match(zenithBlade.judgeReason, /assertFinalizationSurface/);
  assert.match(zenithBlade.judgeReason, /RIFT-257/);
  assert.match(zenithBlade.judgeReason, /467\.2\.c\.1\.a/);
  assert.match(zenithBlade.judgeReason, /effect\.stun/);
  assert.equal(cardRegistryById.get(zenithBlade.canonicalCardId), zenithBlade);
});

test("Zenith Blade declares the printed [Action] keyword (CR 806)", () => {
  assert.equal(zenithBlade.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "action" });
  assert.equal(keyword.value, undefined);
});

test("Zenith Blade structure: Stun, publish that battlefield, then the optional linked Move", () => {
  assert.equal(play.body.length, 3);
  assert.equal(play.cost, undefined);

  // "Stun an enemy unit at a battlefield." — a Choice with a location
  // restriction; 355.5.a prints this card as its example.
  assert.equal(stunInstruction.id, "stun-enemy-unit");
  assert.equal(stunInstruction.op, "effect.stun");
  assert.deepEqual(stunInstruction.args, { target: { kind: "constant", value: "enemy-unit-at-battlefield" } });
  assert.deepEqual(stunSpec, {
    id: "enemy-unit-at-battlefield",
    filter: { type: "unit", controller: "opponent", location: "battlefield" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(stunInstruction.picks, undefined);
  assert.equal(stunInstruction.linkedTo, undefined);

  // "that enemy unit's battlefield" — the Location is read at resolution and
  // published for the Move below.
  assert.equal(readInstruction.id, "read-that-battlefield");
  assert.equal(readInstruction.op, "condition.value");
  assert.equal(readInstruction.linkedTo, "stun-enemy-unit");
  assert.deepEqual(readInstruction.args.value, {
    kind: "object-property",
    object: { target: "enemy-unit-at-battlefield" },
    property: "location"
  });
  assert.deepEqual(readInstruction.args.key, { kind: "constant", value: "battlefield" });
  assert.equal(readInstruction.targets, undefined);

  // "You may move a friendly unit to that enemy unit's battlefield" — contract
  // 3.9: choice.optional wraps the chosen instruction, which keeps its own
  // target (CR 355.12: the choice and the game action are independent targets).
  assert.equal(optionalInstruction.id, "may-move-friendly-unit");
  assert.equal(optionalInstruction.op, "choice.optional");
  assert.equal(optionalInstruction.linkedTo, "read-that-battlefield");
  assert.equal(optionalInstruction.args.body.kind, "constant");
  assert.equal(optionalInstruction.args.body.value.length, 1);
  assert.equal(optionalInstruction.targets, undefined);
  assert.equal(moveInstruction.id, "move-friendly-unit");
  assert.equal(moveInstruction.op, "effect.move");
  assert.deepEqual(moveInstruction.args.objects, { kind: "constant", value: { target: "friendly-unit" } });
  assert.deepEqual(moveInstruction.args.to, {
    kind: "linked-value",
    instructionId: "read-that-battlefield",
    key: "battlefield"
  });
  assert.deepEqual(moveSpec, {
    id: "friendly-unit",
    filter: { type: "unit", controller: "self" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(instructionDefinitionsById.has("effect.stun"), true);
  assert.equal(instructionDefinitionsById.has("effect.move"), true);
});

test("Zenith Blade golden: the Stun half stuns the locked enemy unit (CR 424.1)", () => {
  const kernel = world().unit("enemy-unit", { owner: "B", might: 4, location: BATTLEFIELD("bf1") }).build();
  const run = runInstruction(
    stun,
    // The interpreter evaluates target before dispatch, so a direct primitive
    // run receives the already-evaluated spec id (merged Rune Prison precedent).
    { target: stunInstruction.args.target.value },
    { world: kernel, targets: { "enemy-unit-at-battlefield": [kernel.ref("enemy-unit")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy-unit").stunned, true);
  assert.deepEqual(run.events.map(event => event.action), ["stun"]);
  assert.equal(run.linked.stunned.count, 1);
  assert.deepEqual(run.linked["stunned.objects"], [{ id: "enemy-unit", zoneEntryId: 1 }]);
});

test("Zenith Blade golden: an already Stunned unit stays legal and nothing extra happens (424.1.a.1)", () => {
  const kernel = world().unit("enemy-unit", { owner: "B", stunned: true }).build();
  const run = runInstruction(
    stun,
    { target: stunInstruction.args.target.value },
    { world: kernel, targets: { "enemy-unit-at-battlefield": [kernel.ref("enemy-unit")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.stunned.count, 0);
  assert.equal(run.linked.stunned.alreadyStunned, 1);
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("enemy-unit").stunned, true);
});

test("Zenith Blade golden: the Stun half runs through the interpreter with the program body", () => {
  const kernel = world().unit("enemy-unit", { owner: "B", location: BATTLEFIELD("bf1") }).build();
  kernel.setTargets("enemy-unit-at-battlefield", [kernel.ref("enemy-unit")]);

  const outcome = runAbilityBody([withoutTargets(stunInstruction)], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("enemy-unit").stunned, true);
  assert.deepEqual(outcome.events.map(event => event.action), ["stun"]);
});

/**
 * The Move half of the card: the Location read plus the optional Move.
 *
 * This is a harness accommodation, not a card change. The merged chain adapter
 * keeps raw Exprs only for the ops in its literal-field table
 * (chain/interpreter-adapter.ts), which does not list effect.stun, so a Stun
 * instruction with a wrapped target id cannot take part in an adapter run at
 * all. The interpreter half is exercised above, and the full-body rejections of
 * both merged paths are asserted in the test after this one.
 */
const moveHalfBody = [
  { ...withoutTargets(readInstruction), linkedTo: undefined },
  {
    ...withoutTargets(optionalInstruction),
    args: {
      ...optionalInstruction.args,
      body: { kind: "constant", value: [withoutTargets(moveInstruction)] }
    }
  }
];

test("Zenith Blade golden: accepting the optional Move sends the friendly unit to the read battlefield", () => {
  const kernel = world()
    .unit("enemy-unit", { owner: "B", location: BATTLEFIELD("bf2") })
    .unit("friendly-unit", { owner: "A", exhausted: true, location: BASE("A") })
    .build();
  kernel.setTargets("enemy-unit-at-battlefield", [kernel.ref("enemy-unit")]);
  kernel.setTargets("friendly-unit", [kernel.ref("friendly-unit")]);
  kernel.setAnswers({ "may-move-friendly-unit/optional": true });

  // The production chain adapter keeps the raw Exprs, which is how effect.move
  // evaluates a linked Location itself (the default interpreter path passes the
  // already-evaluated LocationRef, and effect.move requires an Expr).
  const outcome = resolveChainBody(moveHalfBody, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(result => [result.id, result.result.status]),
    [
      ["read-that-battlefield", "executed"],
      // The container reports after its children (completion order is
      // documented in effects/interpreter/README.md).
      ["move-friendly-unit", "executed"],
      ["may-move-friendly-unit", "executed"]
    ]
  );
  assert.deepEqual(outcome.linkedValues["read-that-battlefield.battlefield"], BATTLEFIELD("bf2"));
  assert.deepEqual(kernel.getObject("friendly-unit").location, BATTLEFIELD("bf2"));
  // An effect Move is not the Standard Move ability: no exhaust, no cost (144).
  assert.equal(kernel.getObject("friendly-unit").exhausted, true);
  assert.deepEqual(outcome.events.map(event => event.action), ["move-location"]);
});

test("Zenith Blade golden: declining the optional Move leaves the unit untouched", () => {
  const kernel = world()
    .unit("enemy-unit", { owner: "B", location: BATTLEFIELD("bf2") })
    .unit("friendly-unit", { owner: "A", exhausted: true, location: BASE("A") })
    .build();
  kernel.setTargets("enemy-unit-at-battlefield", [kernel.ref("enemy-unit")]);
  kernel.setTargets("friendly-unit", [kernel.ref("friendly-unit")]);
  kernel.setAnswers({ "may-move-friendly-unit/optional": false });

  const outcome = resolveChainBody(moveHalfBody, kernel);

  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results.at(-1).result.reason, "skipped");
  assert.deepEqual(kernel.getObject("friendly-unit").location, BASE("A"));
  assert.equal(kernel.getObject("friendly-unit").exhausted, true);
  assert.deepEqual(outcome.events, []);
});

test("Zenith Blade golden: the merged chain Finalize really blocks the nested Move target today", () => {
  // Real ChainEngine run of this card's own play body: the Move target lives
  // inside choice.optional.args.body, and chain/engine.ts
  // assertFinalizationSurface rejects any target found at nesting depth > 0.
  // Hoisting it onto the optional wrapper would change the frozen 3.9 shape.
  const kernel = world()
    .unit("zenith-blade", { types: ["spell"], zone: "chain", owner: "A", controller: "A" })
    .unit("enemy-unit", { owner: "B", location: BATTLEFIELD("bf1") })
    .unit("friendly-unit", { owner: "A", location: BASE("A") })
    .build();
  const choose = request => {
    if (request.type === "select-objects") return [...request.options].slice(0, request.max ?? 1);
    if (request.type === "optional") return true;
    throw new Error("unexpected choose " + request.type);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: () => false
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });

  assert.throws(
    () => engine.execute({
      id: "zenith-blade:play",
      controller: "A",
      source: kernel.getObject("zenith-blade"),
      kind: "activated",
      speed: "action",
      body: play.body
    }),
    error => error instanceof ChainContractBlockedError &&
      error.status === "blocked" &&
      /Nested\/repeated targets require an interpreter target-selection lifecycle adapter/.test(error.message)
  );
  // Nothing was played and no Move happened.
  assert.deepEqual(kernel.getObject("friendly-unit").location, BASE("A"));
  assert.equal(kernel.events.some(event => event.action === "move-location"), false);
});

test("Zenith Blade: the merged paths really cannot run the card body today", () => {
  // Direct evidence for the judgeReason. Each merged execution path rejects one
  // half of the printed effect, and neither rejection may be papered over in
  // card data:
  // - the default interpreter evaluates arguments before dispatch, so
  //   effect.move receives an already-evaluated LocationRef while the primitive
  //   schema requires an Expr it can evaluate itself;
  // - the chain adapter keeps raw Exprs only for a fixed literal-field table,
  //   which does not list effect.stun, so the Stun target id stays wrapped and
  //   effect.stun rejects it.
  // The nested Move target is stripped in the interpreter body so that the
  // instruction is actually dispatched and the primitive schema is reached;
  // with the spec present the target system simply finds no legal candidate in
  // the reference kernel and reports ignored (the behaviour the merged sibling
  // goldens rely on when they strip specs).
  const interpreterBody = [
    withoutTargets(stunInstruction),
    withoutTargets(readInstruction),
    {
      ...withoutTargets(optionalInstruction),
      args: {
        ...optionalInstruction.args,
        body: { kind: "constant", value: [withoutTargets(moveInstruction)] }
      }
    }
  ];
  const adapterBody = [
    withoutTargets(stunInstruction),
    withoutTargets(readInstruction),
    withoutTargets(optionalInstruction)
  ];

  const interpreterKernel = world()
    .unit("enemy-unit", { owner: "B", location: BATTLEFIELD("bf2") })
    .unit("friendly-unit", { owner: "A", location: BASE("A") })
    .build();
  interpreterKernel.setTargets("enemy-unit-at-battlefield", [interpreterKernel.ref("enemy-unit")]);
  interpreterKernel.setTargets("friendly-unit", [interpreterKernel.ref("friendly-unit")]);
  interpreterKernel.setAnswers({ "may-move-friendly-unit/optional": true });
  assert.throws(
    () => runAbilityBody(interpreterBody, interpreterKernel),
    /effect\.move requires a to Expr/
  );

  const adapterKernel = world().unit("enemy-unit", { owner: "B" }).build();
  adapterKernel.setTargets("enemy-unit-at-battlefield", [adapterKernel.ref("enemy-unit")]);
  assert.throws(
    () => resolveChainBody(adapterBody, adapterKernel),
    /effect\.stun target must be a spec id string/
  );
});

test("Zenith Blade golden: the Move half resolves with a caller-supplied Finalize destination", () => {
  // The production caller owns the runtime Location (355.4.a); this pins the
  // primitive half with the destination the Move above actually read.
  const kernel = world().unit("friendly-unit", { owner: "A", location: BASE("A") }).build();
  const run = runInstruction(
    move,
    { objects: moveInstruction.args.objects, to: { kind: "constant", value: BATTLEFIELD("bf3") } },
    { world: kernel, targets: { "friendly-unit": [kernel.ref("friendly-unit")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("friendly-unit").location, BATTLEFIELD("bf3"));
  assert.deepEqual(run.events.map(event => event.action), ["move-location"]);
  assert.equal(run.linked.moved.count, 1);
});

test("Zenith Blade: the Move target is nested, so production Finalize blocks it today", () => {
  // Structural evidence for the judgeReason: the Move target lives inside
  // choice.optional.args.body, and chain/engine.ts assertFinalizationSurface
  // rejects any target found at nesting depth > 0 ("Nested/repeated targets
  // require an interpreter target-selection lifecycle adapter", chain/README
  // contract change request 2). Hoisting it onto the optional wrapper would
  // change the frozen 3.9 shape for "may".
  const nested = optionalInstruction.args.body.value;
  assert.equal(nested.length, 1);
  assert.equal(nested[0].targets.length, 1);
  assert.equal(nested[0].targets[0].id, "friendly-unit");
});

test.todo(
  "Zenith Blade optional Move: give the interpreter a Finalize/Resolve target-selection lifecycle " +
    "so a nested target inside choice.optional can be finalized, taxed and announced (chain/README " +
    "contract change request 2; 355.12 / 754) instead of ChainContractBlockedError"
);

test.todo(
  "Zenith Blade Move Destination legality: enumerate the runtime-legal Locations (355.4.a / 449.2 / " +
    "451.1); the merged TurnFlow/CombatFlow already produce Contested (452) and stage the Showdown for " +
    "committed effect Moves, but combat start (466.2) and simultaneous combat damage (467.2.c.1.a / 467.3) " +
    "remain explicitly blocked in the Turn/Combat workstream"
);

test.todo(
  "Zenith Blade play binding: playing this spell from hand needs the card-program Play binding (RIFT-257) " +
    "— chain/engine.ts requires a describePlay adapter for Play actions"
);

test.todo(
  "Zenith Blade Stunned consequences: a Stunned unit does not contribute Might to combat damage " +
    "(424.1.b) while still needing its full Might in damage to be killed (424.1.c), and the Stunned " +
    "status is lost at step 3d of the end-of-turn cleanup (424.1.a.2)"
);

