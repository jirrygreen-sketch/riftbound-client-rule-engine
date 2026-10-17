import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/lilting-lullaby.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import counter from "../../../../engine-core/dist/effects/instructions/effect.counter.js";
import restrict from "../../../../engine-core/dist/effects/instructions/continuous.restrict.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { canAct, restrictions } from "../../../../engine-core/dist/layers/rules/query.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { abilitySpeed } from "../../../../engine-core/dist/programs/keywords.js";

const CANONICAL_ID =
  "card.hash-0fd730fbefcd79781194c269d2e2a4c9e610d42a403c6f112d892d3bf8f1a3fe";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Counter a spell. Its controller can't play spells this turn.";

const [reactionKeyword, play] = program.abilities;
const [counterSpell, noSpells] = play.body;
const spellTargetSpec = counterSpell.targets[0];

// The reference kernel compares filter values literally, so the chain-spell
// target is supplied through Finalize in production and directly here; the
// authored TargetSpec stays asserted structurally above.
const bodyWithoutTargetSpecs = play.body.map(({ targets, ...rest }) => rest);

test("unl-190-219 Lilting Lullaby: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-190-219 Lilting Lullaby: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  // The unresolved part is the prohibition's consumer and the referent that
  // names the player it applies to.
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /359\.3\.f\.1/);
  // Re-checked against the merged sources: the consumer exists, the remaining
  // gap is the dynamic player referent the primitive cannot accept.
  assert.match(program.judgeReason, /appliesTo must be an object filter/);
  assert.match(program.judgeReason, /actionIsRestricted/);
  assert.match(program.judgeReason, /Action is restricted by a continuous rule/);
  assert.doesNotMatch(program.judgeReason, /尚未读取本回合 restriction|尚未消费/);
  // The counter half cites the rule entries that make the chain spell a legal
  // target and exclude self-targeting and pending items.
  assert.match(program.judgeReason, /426\.1/);
  assert.match(program.judgeReason, /355\.9\.a\.2/);
  assert.match(program.judgeReason, /355\.9\.c/);
});

test("unl-190-219 Lilting Lullaby: [Reaction] plus a chain-spell counter target and an independent prohibition", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(reactionKeyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(reactionKeyword.value, undefined);
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.deepEqual(
    play.body.map((instruction) => instruction.id),
    ["lilting-lullaby.counter-spell", "lilting-lullaby.no-spells"]
  );

  // 355.9.a.2: "spell" means a finalized object on the Chain; 355.9.c keeps a
  // spell from targeting itself and contract 3.4 excludes Pending items. Both
  // are the target system's Finalize obligations, not card data.
  assert.equal(counterSpell.op, "effect.counter");
  assert.deepEqual(counterSpell.args.target, {
    kind: "constant",
    value: "lilting-lullaby.spell"
  });
  assert.deepEqual(counterSpell.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(spellTargetSpec, {
    id: "lilting-lullaby.spell",
    filter: { type: "spell", zone: "chain" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(counterSpell.linkedTo, undefined);

  // "Its controller can't play spells this turn" is a separate instruction (no
  // do-X-to-Y dependency, 055 / 359.3.e.11), so it is not linked. The chooser
  // of the prohibition is the countered spell's controller referent
  // (359.3.f.1); the consumer itself is the judged gap.
  assert.equal(noSpells.op, "continuous.restrict");
  assert.equal(noSpells.linkedTo, undefined);
  assert.equal(noSpells.targets, undefined);
  assert.deepEqual(noSpells.args.mode, { kind: "constant", value: "prohibit" });
  assert.deepEqual(noSpells.args.action, { kind: "constant", value: "play-spell" });
  assert.deepEqual(noSpells.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(noSpells.args.appliesTo, {
    kind: "object-property",
    object: { target: "lilting-lullaby.spell" },
    property: "controller"
  });
});

test("unl-190-219 Lilting Lullaby golden: effect.counter really clears the chain spell and links the countered object", () => {
  const kernel = world().unit("spell", { owner: "B", types: ["spell"], zone: "chain" }).build();
  const run = runInstruction(
    counter,
    { target: "lilting-lullaby.spell", amount: { kind: "constant", value: 1 } },
    { world: kernel, targets: { "lilting-lullaby.spell": [kernel.ref("spell")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.countered, 1);
  // 426.2: a countered spell does nothing and leaves the Chain; the kernel
  // routes it to Trash and does not refund any cost.
  assert.equal(kernel.getObject("spell").zone, "trash");
  assert.deepEqual(run.linked.counteredObjects.map((ref) => ref.id), ["spell"]);
  assert.deepEqual(run.events.map((event) => event.action), ["counter"]);
});

test("unl-190-219 Lilting Lullaby golden: the counter half really runs through the interpreter", () => {
  const kernel = world().unit("spell", { owner: "B", types: ["spell"], zone: "chain" }).build();
  const ctx = kernel.clone();
  ctx.setTargets("lilting-lullaby.spell", [ctx.ref("spell")]);

  // Only the merged half is executed here: the prohibition clause has no
  // registered primitive (judgeReason), and the interpreter reports an unknown
  // opcode instead of silently discarding it - asserted separately below.
  const outcome = resolveChainBody([bodyWithoutTargetSpecs[0]], ctx);

  assert.equal(outcome.status, "executed");
  assert.equal(ctx.getObject("spell").zone, "trash");
  const counterResult = outcome.results.find((result) => result.id === "lilting-lullaby.counter-spell");
  assert.equal(counterResult.result.status, "executed");
  assert.deepEqual(outcome.events.map((event) => event.action), ["counter"]);
});

test("unl-190-219 Lilting Lullaby golden: the dynamic player referent is refused, so the prohibition never registers", () => {
  // continuous.restrict requires an ObjectFilter for appliesTo. The card's
  // "Its controller" referent evaluates to a player id string, and the merged
  // primitive rejects it, so the whole clause (and the counter that precedes it
  // in the same body) fails to resolve as authored.
  const kernel = world()
    .unit("spell", { owner: "B", controller: "B", types: ["spell"], zone: "chain" })
    .unit("source", { owner: "A", controller: "A" })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("source"), controller: "A" });
  scoped.setTargets("lilting-lullaby.spell", [kernel.ref("spell")]);
  assert.throws(
    () => resolveChainBody(bodyWithoutTargetSpecs, scoped),
    (error) => error instanceof TypeError &&
      /continuous\.restrict appliesTo must be an object filter/.test(error.message)
  );
  assert.deepEqual(scoped.continuousEffects, []);
});

test("unl-190-219 Lilting Lullaby golden: the merged restriction primitive registers a one-turn spell prohibition", () => {
  const kernel = world().unit("spell", { owner: "B", controller: "B", types: ["spell"], zone: "chain" }).build();
  const literal = {
    ...bodyWithoutTargetSpecs[1],
    args: {
      ...bodyWithoutTargetSpecs[1].args,
      // The card's target.controller referent is the remaining dynamic gap;
      // this literal filter exercises the merged primitive and query contract.
      appliesTo: { kind: "constant", value: { controller: "B", zone: "board" } }
    }
  };
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("spell"), controller: "A" });
  const outcome = resolveChainBody([literal], scoped);
  assert.equal(outcome.status, "executed");
  const registry = createContinuousEffectRegistry();
  for (const entry of scoped.continuousEffects) registry.register(entry.effect, entry.duration);
  const found = restrictions(registry, "play-spell");
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].actions, ["play-spell"]);
  assert.deepEqual(found[0].filter, { controller: "B", zone: "board" });
});

test("unl-190-219 Lilting Lullaby golden: the chain refuses the prohibited player's spell once the restriction is registered", () => {
  // The consumer that was missing is merged now: actionIsRestricted queries
  // layers/rules/query.ts at execute() time. With a literal controller filter
  // (the shape the card cannot yet author) the prohibited player's play is
  // refused, while the identical play is legal without the registration.
  function fixtureForProhibition(withRestriction) {
    const kernel = world()
      .player("A", { energy: 20 })
      .player("B", { energy: 20 })
      .unit("source", { owner: "A", controller: "A", might: 2 })
      .card("spell", { owner: "A", controller: "A", zone: "hand", types: ["spell"], energy: 1, power: [] })
      .build();
    if (withRestriction) {
      const registered = runInstruction(
        restrict,
        {
          mode: { kind: "constant", value: "prohibit" },
          action: { kind: "constant", value: "play-spell" },
          appliesTo: { kind: "constant", value: { controller: "A" } },
          duration: { kind: "constant", value: "this-turn" }
        },
        { world: kernel, source: kernel.getObject("source"), controller: "A" }
      );
      assert.equal(registered.result.status, "executed");
    }
    const host = createActionPipelineHost({
      checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
      restore: (checkpoint) => {
        kernel.restore(checkpoint.state);
        kernel.copyLinkedFrom(checkpoint.links);
      },
      objects: () => kernel.objects,
      perform: (action) => kernel.perform(action),
      choose: (request) => { throw new Error(`AwaitChoice ${request.id}`); },
      context: (source, controller, timingPoint) =>
        bindResolveContext(kernel, { source, controller, timingPoint })
    });
    const engine = new ChainEngine({
      turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false
    });
    for (const entry of kernel.continuousEffects) engine.layers.addContinuous(entry.effect, entry.duration);
    return { engine, kernel };
  }

  const unrestricted = fixtureForProhibition(false);
  unrestricted.engine.execute({
    id: "play:lullaby:control",
    controller: "A",
    source: unrestricted.kernel.getObject("spell"),
    kind: "spell",
    speed: "normal",
    body: []
  });
  assert.equal(unrestricted.engine.items.length, 1, "without a registration the play reaches the chain");

  const prohibited = fixtureForProhibition(true);
  assert.throws(
    () => prohibited.engine.execute({
      id: "play:lullaby:prohibited",
      controller: "A",
      source: prohibited.kernel.getObject("spell"),
      kind: "spell",
      speed: "normal",
      body: []
    }),
    /Action is restricted by a continuous rule/
  );
  assert.equal(prohibited.engine.items.length, 0);
});

test("unl-190-219 Lilting Lullaby golden: a countered spell keeps its printed cost unrefunded", () => {
  // 426.3: countering does not refund costs. The kernel models the card in
  // Trash; no energy is returned to its controller here.
  const kernel = world()
    .player("B", { energy: 0 })
    .unit("spell", { owner: "B", types: ["spell"], zone: "chain" })
    .build();
  const run = runInstruction(
    counter,
    { target: "lilting-lullaby.spell", amount: { kind: "constant", value: 1 } },
    { world: kernel, targets: { "lilting-lullaby.spell": [kernel.ref("spell")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("B").energy, 0);
  assert.equal(kernel.getObject("spell").zone, "trash");
});

test("unl-190-219 Lilting Lullaby golden: a stale chain reference is mistargeted instead of countered", () => {
  const kernel = world().unit("spell", { owner: "B", types: ["spell"], zone: "chain" }).build();
  const stale = kernel.ref("spell");
  // The spell resolved and left the Chain before this instruction resolves.
  assert.equal(kernel.perform({ type: "move-zone", object: stale, to: "trash" }).status, "done");
  const run = runInstruction(
    counter,
    { target: "lilting-lullaby.spell", amount: { kind: "constant", value: 1 } },
    { world: kernel, targets: { "lilting-lullaby.spell": [stale] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.deepEqual(run.events, []);
});

test("unl-190-219 Lilting Lullaby golden: the merged Reaction expansion admits a Closed-State play", () => {
  const source = world().object("lilting-lullaby", {
    zone: "hand",
    types: ["spell"],
    cardId: CANONICAL_ID
  }).build().getObject("lilting-lullaby");
  const definition = keywordDefinitionsById.get("Reaction");
  assert.ok(definition, "keywords/Reaction.ts must be registered");
  const [permission] = definition.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(permission.effect.kind, "continuous.timing");
  assert.deepEqual(permission.effect.grants, ["showdown", "closed-state"]);
  assert.equal(abilitySpeed(program.abilities, source), "reaction");
  assert.equal(canAct({
    player: "A",
    speed: abilitySpeed(program.abilities, source),
    showdown: false,
    closedState: true,
    turnPlayer: "B",
    priorityHolder: "A",
    grants: permission.effect.grants
  }), true);
});

test.todo(
  "unl-190-219 Lilting Lullaby: consume the registered this-turn prohibition from the chain's canAct/Finalize timing query (CR 355.8 / 806 / 159.2)"
);
test.todo(
  "unl-190-219 Lilting Lullaby: resolve \"Its controller\" as the countered spell's controller referent and expire the prohibition at the end-of-turn timing point (CR 359.3.f.1)"
);
test.todo(
  "unl-190-219 Lilting Lullaby: enforce the printed target legality for a finalized Chain spell, including the self-target and pending-item exclusions (355.9.a.2 / 355.9.c / contract 3.4) in the production chain"
);
