import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/guardian-of-the-passage.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// Production resolves a card body through the chain's interpreter adapter
// (chain/interpreter-adapter.ts), which keeps the card's Expr arguments inside
// one literal envelope so each merged primitive validates and evaluates them
// itself. The golden runs use that same path instead of hand-decoding args.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { translateInstructionTargets } from "../../../../engine-core/dist/programs/index.js";

const CARD_ID = "card.hash-291f978c4d26e5c73a603a5f856768f2a0714f4bbe78fc0e3dbe4ac83dfb8767";
const TARGET_ID = "guardian-of-the-passage.card-in-trash";

const [ability] = program.abilities;
const [choice] = ability.body;
const [returnInstruction] = choice.args.body.value;

/**
 * chain/engine.ts resolves the static controller/owner spellings (`self` /
 * `opponent`) before it calls the production matcher, and the interpreter's
 * target preparation reads candidates through the same query. The reference
 * kernel compares raw values, so the golden binds the same normalization the
 * production chain applies (the merged siphon-power / frostcoat-cub goldens use
 * this exact helper).
 */
const chainQuery = (kernel, controller) => (value) => {
  const normalized = { ...value };
  for (const key of ["controller", "owner"]) {
    if (normalized[key] === "self") normalized[key] = controller;
  }
  return kernel.query({}).filter((object) => {
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "opponent" && object[key] === controller) return false;
    }
    return matchesObjectFilter({
      ...normalized,
      ...(normalized.controller === "opponent" ? { controller: "any" } : {}),
      ...(normalized.owner === "opponent" ? { owner: "any" } : {})
    }, object);
  });
};

const chainContext = (kernel, controller) => new Proxy(kernel, {
  get(target, key) {
    if (key === "query") return chainQuery(target, controller);
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  }
});

/** The body exactly as the production program binding translates it. */
const translatedBody = translateInstructionTargets(ability.body);

function guardianWorld() {
  return world()
    .player("A", { energy: 10 })
    .player("B", { energy: 10 })
    .object("guardian", {
      owner: "A",
      controller: "A",
      cardId: CARD_ID,
      types: ["unit"],
      zone: "board",
      location: { type: "battlefield", id: "bf-1" },
      might: 6
    })
    .card("dead-ally", { types: ["unit"], owner: "A", zone: "trash" })
    .card("dead-gear", { types: ["gear"], owner: "A", zone: "trash" })
    .card("enemy-dead", { types: ["unit"], owner: "B", zone: "trash" })
    .build();
}

function runMayReturn(kernel, { accepted, target }) {
  const bound = kernel.clone({ source: kernel.ref("guardian"), sourceSnapshot: kernel.getObject("guardian") });
  bound.setTargets(TARGET_ID, [target]);
  bound.setAnswers({ "guardian-of-the-passage.may-return/optional": accepted });
  return { bound, outcome: resolveChainBody(translatedBody, chainContext(bound, "A")) };
}

test("sfd-035-221 Guardian of the Passage: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-035-221 Guardian of the Passage: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "When I hold, you may return a unit or gear from your trash to your hand."
  );
});

test("sfd-035-221 Guardian of the Passage: judgeReason names the hold-payload gap and the merged half", () => {
  assert.match(program.judgeReason, /held/);
  assert.match(program.judgeReason, /objectId/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("sfd-035-221 Guardian of the Passage: hold trigger whose body is the may-return shape", () => {
  // 383.4.d / 383.4.d.2.a: a Hold Effect, put on the chain when the controller
  // of the triggering source has held (timing point "hold").
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "hold");
  assert.deepEqual(ability.trigger.filter, { event: "held", filter: { source: "self" } });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.optional, false);
  assert.deepEqual(ability.body.map(instruction => instruction.id), ["guardian-of-the-passage.may-return"]);
});

test("sfd-035-221 Guardian of the Passage: contract 3.9 may-shape with the trash target on the may node", () => {
  assert.equal(choice.op, "choice.optional");
  assert.deepEqual(choice.args.prompt, {
    kind: "constant",
    value: "Return a unit or gear from your trash to your hand?"
  });
  assert.equal(choice.args.body.kind, "constant");
  assert.deepEqual(choice.args.body.value.map(instruction => instruction.id), [
    "guardian-of-the-passage.return-to-hand"
  ]);

  // 355.10.a / 108.2.d: the Trash is a Public Zone, so "a unit or gear from
  // your trash" is chosen and therefore a target (355.7); 355.12: every choice
  // for a may-action is made with the ability, so the TargetSpec sits on the
  // may node. 141.2.b / 148.2.b keep card type valid in every zone.
  assert.equal(choice.targets.length, 1);
  const [target] = choice.targets;
  assert.equal(target.id, TARGET_ID);
  assert.deepEqual(target.filter, {
    type: ["unit", "gear"],
    zone: "trash",
    owner: "controller"
  });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
  assert.equal(choice.picks, undefined);

  // The body moves the chosen card to its owner's hand through the closed
  // return-to-hand action (448.2: a zone change, not a Move).
  assert.equal(returnInstruction.op, "effect.zone");
  assert.deepEqual(returnInstruction.args.target, { kind: "constant", value: TARGET_ID });
  assert.deepEqual(returnInstruction.args.to, { kind: "constant", value: "hand" });
  assert.equal(returnInstruction.linkedTo, undefined);
  assert.equal(returnInstruction.targets, undefined);
});

test("sfd-035-221 Guardian of the Passage golden: accepting returns the chosen unit to its owner's hand", () => {
  const kernel = guardianWorld();
  const { bound, outcome } = runMayReturn(kernel, { accepted: true, target: kernel.ref("dead-ally") });

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status]),
    [
      ["guardian-of-the-passage.return-to-hand", "executed"],
      ["guardian-of-the-passage.may-return", "executed"]
    ]
  );
  assert.equal(bound.getObject("dead-ally").zone, "hand");
  assert.deepEqual(bound.zone("A", "hand").map(ref => ref.id), ["dead-ally"]);
  assert.deepEqual(outcome.events.map(event => event.action), ["return-to-hand"]);
  // The interpreter namespaces linked values by the nested execution path
  // (interpreter README's stable ids), so the may-node result is read under
  // the parent/child key.
  assert.equal(outcome.linkedValues["guardian-of-the-passage.may-return/guardian-of-the-passage.return-to-hand.moved"], 1);
  assert.deepEqual(outcome.linkedValues["guardian-of-the-passage.may-return/guardian-of-the-passage.return-to-hand.movedIds"], ["dead-ally"]);
});

test("sfd-035-221 Guardian of the Passage golden: a gear is a legal pick too (355.9.a.1)", () => {
  const kernel = guardianWorld();
  const { bound, outcome } = runMayReturn(kernel, { accepted: true, target: kernel.ref("dead-gear") });
  assert.equal(outcome.status, "executed");
  assert.equal(bound.getObject("dead-gear").zone, "hand");
});

test("sfd-035-221 Guardian of the Passage golden: declining leaves every trash card in place", () => {
  const kernel = guardianWorld();
  const { bound, outcome } = runMayReturn(kernel, { accepted: false, target: kernel.ref("dead-ally") });

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "negated", reason: "skipped", events: [] });
  assert.equal(bound.getObject("dead-ally").zone, "trash");
  assert.equal(bound.getObject("dead-gear").zone, "trash");
  assert.deepEqual(outcome.events, []);
});

test("sfd-035-221 Guardian of the Passage golden: 'your trash' never offers an opponent's card", () => {
  // The production chain normalizes owner: "controller" to the acting seat
  // (chain/engine.ts); the translated filter therefore excludes enemy-dead.
  assert.deepEqual(translatedBody[0].targets[0].filter, {
    type: ["unit", "gear"],
    zone: "trash",
    owner: "self"
  });
  const kernel = guardianWorld();
  const candidates = chainQuery(kernel, "A")(translatedBody[0].targets[0].filter).map(object => object.ref.id);
  assert.deepEqual(candidates.sort(), ["dead-ally", "dead-gear"]);
});

test.todo(
  "sfd-035-221 Guardian of the Passage: emit the held battlefield's object/host identity with the hold " +
    "timing point (383.4.d.2.a) so the card's source: \"self\" anchor can match and the Hold Effect enters " +
    "the chain — depends on the RIFT-120 hold-payload work"
);
