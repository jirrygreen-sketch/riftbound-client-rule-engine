import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { expandProgram, abilitySpeed } from "../../../../engine-core/dist/programs/keywords.js";
import { canAct } from "../../../../engine-core/dist/layers/rules/query.js";
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/crumbling-sands.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import counter from "../../../../engine-core/dist/effects/instructions/effect.counter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-18fffa303c3fbeadfe9840b125d2a8b823e8734036743306d7428faf759c696d";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Counter a spell if an opponent has played another spell this turn.";

const [reactionKeyword, play] = program.abilities;
const [counterInstruction] = play.body;
const [spellSpec] = counterInstruction.targets;
const [requirement] = play.requirements;

// The card layer wraps every argument in an Expr; effect.counter's target is a
// raw TargetSpec id (its argsSchema reads the string directly), and the chain
// adapter decodes exactly that literal field before dispatch. The golden calls
// the primitive the same way the production path does.
const primitiveArgs = { target: spellSpec.id, amount: counterInstruction.args.amount };

const chainSpell = (kernel, id = "enemy-spell") =>
  kernel.addObject(
    {
      ref: { id, zoneEntryId: 1 },
      owner: "B",
      zone: "chain",
      types: ["spell"],
      name: "Enemy Spell"
    },
    "chain"
  );

test("ven-039-166 Crumbling Sands: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("ven-039-166 Crumbling Sands: identity, ruleset, status, judgeReason and verbatim text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("ven-039-166 Crumbling Sands: [Reaction], printed cost and the Counter target on the Chain", () => {
  assert.deepEqual(reactionKeyword, { kind: "keyword", keyword: "reaction" });
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 1 },
    power: { kind: "constant", value: 1 }
  });
  assert.equal(play.body.length, 1);
  assert.equal(counterInstruction.id, "crumbling-sands.counter-spell");
  assert.equal(counterInstruction.op, "effect.counter");
  assert.deepEqual(counterInstruction.args, {
    target: { kind: "constant", value: "crumbling-sands.spell" },
    amount: { kind: "constant", value: 1 }
  });
  assert.equal(counterInstruction.linkedTo, undefined);
  assert.equal(counterInstruction.picks, undefined);
  // 355.9.a.2: "spell" means a finalized object on the Chain.
  assert.deepEqual(spellSpec, {
    id: "crumbling-sands.spell",
    filter: { type: "spell", zone: "chain" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("ven-039-166 Crumbling Sands: the history gate stays a named Requirement until a Condition adapter exists", () => {
  assert.deepEqual(play.requirements, [{ kind: "opponent-played-another-spell-this-turn" }]);
});

test("ven-039-166 Crumbling Sands golden: the merged counter really clears a Chain spell (426.1-426.3)", () => {
  const kernel = world().build();
  const ref = chainSpell(kernel);

  const run = runInstruction(counter, primitiveArgs, {
    world: kernel,
    targets: { [spellSpec.id]: [ref] }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.countered, 1);
  assert.deepEqual(run.linked.counteredObjects, [{ id: "enemy-spell", zoneEntryId: 1 }]);
  // 426.1.a/426.1.a.1: a countered card does nothing and is cleared from the
  // chain to the trash; 426.1.c refunds nothing (no payment happens here).
  assert.equal(kernel.getObject("enemy-spell").zone, "trash");
  assert.deepEqual(run.events.map(event => event.action), ["counter"]);
});

test("ven-039-166 Crumbling Sands boundary: a non-Chain object is not a legal counter target (355.9.a.2)", () => {
  const kernel = world().unit("board-unit", { owner: "B" }).build();

  const run = runInstruction(counter, primitiveArgs, {
    world: kernel,
    targets: { [spellSpec.id]: [kernel.ref("board-unit")] }
  });

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("board-unit").zone, "board");
});

test("ven-039-166 Crumbling Sands boundary: a spell that already left the Chain ignores the counter (359.3.e)", () => {
  const kernel = world().build();
  const ref = chainSpell(kernel);
  kernel.perform({ type: "counter", object: ref });

  const run = runInstruction(counter, primitiveArgs, {
    world: kernel,
    targets: { [spellSpec.id]: [ref] }
  });

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
});



test("crumbling-sands: the review records the current blockers", () => {
  assert.match(program.judgeReason, /355\.8/);
  assert.match(program.judgeReason, /Requirement.condition/);
  assert.match(program.judgeReason, /RIFT-359/);
});

test.todo("crumbling-sands: 355.8/355.17: evaluate opponent spell-play history as a Finalize Requirement.condition (RIFT-359)");

test("Crumbling Sands supported body: the authored counter body resolves through the production interpreter adapter", () => {
  const kernel = world().build();
  const ref = chainSpell(kernel);
  kernel.setTargets(spellSpec.id, [ref]);
  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues[`${counterInstruction.id}.countered`], 1);
  assert.equal(kernel.getObject(ref.id).zone, "trash");
  assert.deepEqual(outcome.events.map(event => event.action), ["counter"]);
});

test("Crumbling Sands Reaction: the declared keyword grants Closed State reaction speed", () => {
  const kernel = world().hand("sands", { types: ["spell"], cardId: CANONICAL }).build();
  const source = kernel.getObject("sands");
  const expanded = expandProgram(program, source);
  const speed = abilitySpeed(expanded.abilities, source);
  assert.equal(speed, "reaction");
  assert.equal(canAct({ player: "A", speed, closedState: true, turnPlayer: "B", priorityHolder: "A", focusHolder: null, showdown: false, chainDepth: 1 }), true);
});
