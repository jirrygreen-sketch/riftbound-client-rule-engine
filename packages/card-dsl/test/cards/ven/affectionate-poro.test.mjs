import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/affectionate-poro.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-7147fd68039b666d195da6d7372d88c419ee1487989e3243510c28f11248e3f3";
const SOURCE_TEXT =
  "When a combat that I was in ends, if I haven't been dealt damage this turn, draw 1.";

const [ability] = program.abilities;
const [drawOne] = ability.body;

const poroWorld = (deck) => {
  const builder = world().unit("poro", { controller: "A", might: 3 });
  if (deck.length > 0) builder.deck(deck);
  const base = builder.build();
  return base.clone({ controller: "A", sourceSnapshot: base.getObject("poro") });
};

/** The program as the production registry sees it (status still judge-required). */
const executableView = { ...program, status: "executable", judgeReason: undefined };

test("ven-024-166 Affectionate Poro: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-024-166 Affectionate Poro: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  // The reason names the three measured gaps and the fail-closed spelling.
  assert.match(program.judgeReason, /combat-end/);
  assert.match(program.judgeReason, /468\.7/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /HistoryQuery/);
  assert.match(program.judgeReason, /Unsupported expression/);
  assert.ok(program.judgeReason.includes("all[never, 描述性 expression]"));
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-024-166 Affectionate Poro: one combat-end trigger filtered to self", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  // 468.7 / 468.7.b: the closed combat-end timing point carries combat-end
  // effects; EVENT_PATTERN_TYPES spells the discriminant "combat-ended".
  assert.equal(ability.trigger.at, "combat-end");
  assert.deepEqual(ability.trigger.filter, {
    event: "combat-ended",
    filter: { source: "self" }
  });
  assert.equal(ability.trigger.once, undefined);
});

test("ven-024-166 Affectionate Poro: the damage clause is a fail-closed descriptive condition", () => {
  // "if I haven't been dealt damage this turn" needs a turn-scoped,
  // object-filtered damage-event count. HistoryQuery already has
  // objectFilter/exclude, but no card-side Condition expresses a history count.
  // The description is therefore wrapped in `all: [never, ...]` so the ability
  // can never fire a trigger the engine cannot actually gate: a bare
  // `expression` condition evaluates Boolean("...") === true (measured below).
  assert.equal(ability.trigger.condition.kind, "all");
  assert.deepEqual(ability.trigger.condition.conditions, [
    { kind: "never" },
    {
      kind: "expression",
      value: { kind: "constant", value: "not-dealt-damage-this-turn" }
    }
  ]);
});

test("ven-024-166 Affectionate Poro: the body is one unlinked effect.draw of exactly 1", () => {
  assert.deepEqual(ability.body.map((instruction) => instruction.id), ["affectionate-poro.draw-1"]);
  assert.equal(drawOne.op, "effect.draw");
  assert.deepEqual(drawOne.args.amount, { kind: "constant", value: 1 });
  // 414.1/414.3: the draw needs no target, pick, link or per-instruction condition.
  assert.equal(drawOne.targets, undefined);
  assert.equal(drawOne.picks, undefined);
  assert.equal(drawOne.linkedTo, undefined);
  assert.equal(drawOne.condition, undefined);
});

test("ven-024-166 Affectionate Poro evidence: a bare expression condition would be an always-true gate", () => {
  // Measured counter-example that justifies the fail-closed wrapper: the
  // interpreter's `expression` case is Boolean(evaluateExpression(value)), so a
  // descriptive constant string is truthy.
  const kernel = poroWorld([]);
  const environment = {
    context: kernel,
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false
  };
  assert.equal(
    evaluateCondition(
      {
        kind: "expression",
        value: { kind: "constant", value: "not-dealt-damage-this-turn" }
      },
      environment
    ),
    true
  );
  // The authored condition is the conjunction and stays false on every board;
  // it never turns the missing gate into a pass.
  assert.equal(evaluateCondition(ability.trigger.condition, environment), false);
});

test("ven-024-166 Affectionate Poro evidence: the trigger registers against the real pipeline", () => {
  // The authored filter spelling is valid, so registration succeeds; the only
  // remaining blockers are the missing combat-end emitter and the ungated clause.
  const registry = new ProgramRegistry([executableView]);
  const { engine, kernel } = fixture({
    cards: [{ id: "poro", cardId: CANONICAL_ID, types: ["unit"], might: 3, energy: null, power: null }]
  });
  const registrations = triggerRegistrations(registry, kernel.getObject("poro"));
  assert.deepEqual(
    registrations.map((registration) => [registration.spec.at, registration.spec.filter]),
    [["combat-end", { event: "combat-ended", object: { objectId: "poro" } }]]
  );
  assert.equal(typeof engine.pipeline.registerTrigger, "function");
});

test("ven-024-166 Affectionate Poro evidence: an emitted combat-end carries no participant identity", () => {
  // 468.7.b needs an emitter; the merged turn/combat flow has none. Even a
  // manual emission carries no object, so the self-scoped filter cannot match:
  // the producer must also supply the participating-unit identity (323.2/468.7.a).
  const { engine, kernel } = fixture({
    cards: [{ id: "poro", cardId: CANONICAL_ID, types: ["unit"], might: 3, energy: null, power: null }]
  });
  engine.pipeline.emit({ timingPoint: "combat-end", player: "A", details: { battlefieldId: "bf-1" } });
  const combatEnd = engine.pipeline.events.filter((event) => event.timingPoint === "combat-end");
  assert.equal(combatEnd.length, 1);
  assert.equal(combatEnd[0].object, undefined);
  assert.equal(engine.items.length, 0);
  assert.ok(kernel.getObject("poro"));
});

test("ven-024-166 golden: the trigger body really draws 1 through the interpreter", () => {
  const kernel = poroWorld(["top-card", "second-card"]);
  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["affectionate-poro.draw-1", "executed"]
  ]);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.equal(outcome.linkedValues["affectionate-poro.draw-1.drawn"], 1);
});

test("ven-024-166 golden: an empty deck draws nothing and does not invent a card", () => {
  const kernel = poroWorld([]);
  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(outcome.linkedValues["affectionate-poro.draw-1.drawn"], 0);
});

test.todo(
  "ven-024-166 Affectionate Poro: 'a combat that I was in' needs a production Attacker/Defender " +
    "designation (CR 323.2 / 466.2.c.3 / 468.7.a) - ObjectSnapshot.combatRole is declared in the " +
    "contract but engine-runtime/host.ts always builds combatRole: null"
);

test.todo(
  "ven-024-166 Affectionate Poro: the combat-end timing point (CR 468.7.b) has no emitter; " +
    "CombatFlow.advance() still throws TurnCombatBlockedError('combat-start-transaction') (466.2)"
);

test.todo(
  "ven-024-166 Affectionate Poro: 'if I haven't been dealt damage this turn' needs a turn-scoped " +
    "damage-event count predicate; Condition/Requirement has no history form and the default " +
    "interpreter rejects player-property/turn-number/object-designation"
);
