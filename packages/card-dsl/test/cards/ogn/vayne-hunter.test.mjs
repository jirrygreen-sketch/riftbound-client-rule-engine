import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/vayne-hunter.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-af6a9ff16e9f4f9849e489bb4ab37b18a1f12ed88da4b151ac85c770eb68d8c6";
const MAY_ID = "vayne-hunter.may-return";

test("ogn-035-298 Vayne, Hunter: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /battlefield/);
  assert.match(program.judgeReason, /TargetSpec|嵌套|payment scope/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(260|261)/);
});

test("ogn-035-298 Vayne, Hunter: identity, ruleset and exact source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "[Assault 3] (+3 :rb_might: while I'm an attacker.)\n" +
      "If an opponent controls a battlefield, I enter ready.\n" +
      "When I conquer, you may pay :rb_energy_1: to return me to my owner's hand."
  );
});

test("ogn-035-298 Vayne, Hunter: Assault 3 keyword, conditional enter-ready replacement, optional conquer return", () => {
  assert.equal(program.abilities.length, 3);
  const [assault, replacement, triggered] = program.abilities;
  assert.deepEqual(assault, { kind: "keyword", keyword: "assault", value: 3 });

  // "If an opponent controls a battlefield, I enter ready." — a conditional
  // replacement (364.3 / 369.3), not a post-entry effect.ready.
  assert.equal(replacement.kind, "replacement");
  assert.deepEqual(replacement.replaces, {
    event: "object-enters-board",
    filter: { source: "self", exhausted: true }
  });
  assert.equal(replacement.condition.kind, "compare");
  assert.equal(replacement.condition.left.kind, "count");
  assert.equal(replacement.condition.left.subject, "battlefields");
  assert.deepEqual(replacement.condition.left.filter, { controller: "opponent" });
  assert.equal(replacement.condition.operator, "gte");
  assert.deepEqual(replacement.condition.right, { kind: "constant", value: 1 });
  assert.deepEqual(replacement.with.map((instruction) => [instruction.id, instruction.op]), [
    ["vayne-hunter.enter-ready", "replacement.enter"]
  ]);
  assert.deepEqual(replacement.with[0].args.state, { kind: "constant", value: "ready" });
  assert.deepEqual(replacement.with[0].args.zone, { kind: "constant", value: "board" });

  // "When I conquer, you may pay :rb_energy_1: to return me to my owner's hand."
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "conquer");
  assert.deepEqual(triggered.trigger.filter, { event: "conquered", object: { objectId: "self" } });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 1);
  const [choice] = triggered.body;
  assert.equal(choice.id, MAY_ID);
  assert.equal(choice.op, "choice.optional");
  const body = choice.args.body.value;
  assert.equal(choice.args.body.kind, "constant");
  assert.deepEqual(body.map((instruction) => [instruction.id, instruction.op]), [
    ["vayne-hunter.pay-1", "cost.pay"],
    ["vayne-hunter.return-to-hand", "effect.zone"]
  ]);
  assert.deepEqual(body[0].args, {
    payments: { kind: "constant", value: { energy: 1 } }
  });
  assert.equal(body[1].linkedTo, "vayne-hunter.pay-1");
  assert.deepEqual(body[1].args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(body[1].targets, [
    {
      id: "vayne-hunter.self",
      filter: { source: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("ogn-035-298 Vayne, Hunter: declining the optional pay leaves the board unchanged", () => {
  const kernel = world().build();
  kernel.setAnswers({ [`${MAY_ID}/optional`]: false });
  const outcome = runAbilityBody([program.abilities[2].body[0]], kernel);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.events.length, 0);
});

test("ogn-035-298 Vayne, Hunter golden: the merged entry replacement rewrites the exhausted entry to ready (369.3)", () => {
  // "If an opponent controls a battlefield, I enter ready." — the merged
  // replacement registration binds the entry-orientation rewrite;
  // the rewrite is applied to the chain-zone permanent so the move carries it
  // to the Board (no separate becomes-ready timing happens on Board).
  const kernel = world()
    .unit("vayne", { zone: "hand", location: null, might: 2 })
    .build();
  const hostRef = kernel.ref("vayne");
  const registrations = [];
  bindReplacement(program.abilities[1], hostRef, {
    host: {
      object: (ref) => kernel.object(ref),
      objects: () => kernel.objects,
      context: () => kernel
    },
    pipeline: { clock: { turn: 1 }, registerReplacement: (registration) => registrations.push(registration) }
  });

  assert.equal(kernel.perform({ type: "move-zone", object: hostRef, to: "chain" }).status, "done");
  // The resolver lands the default exhausted entry state on the chain-zone card.
  assert.equal(kernel.perform({ type: "exhaust", object: kernel.ref("vayne") }).status, "done");
  const entering = {
    type: "move-zone",
    object: kernel.ref("vayne"),
    to: "battlefield",
    location: { type: "battlefield", id: "battlefield-1" }
  };
  const [registration] = registrations;
  assert.equal(registration.matches(entering, entering), true);
  const replacement = registration.apply(entering, entering);
  assert.equal(replacement.status, "replace");
  assert.deepEqual(replacement.actions.map((action) => action.type), ["ready", "move-zone"]);
  for (const action of replacement.actions) assert.equal(kernel.perform(action).status, "done");

  const entered = kernel.getObject("vayne");
  assert.equal(entered.zone, "board");
  assert.deepEqual(entered.location, { type: "battlefield", id: "battlefield-1" });
  assert.equal(entered.exhausted, false);
});

test("ogn-035-298 Vayne, Hunter: the return-to-hand instruction returns the chosen self object to its owner's hand", () => {
  const kernel = world()
    .unit("vayne", {
      zone: "board",
      location: { type: "battlefield", id: "battlefield-1" },
      might: 2
    })
    .build();
  const instruction = program.abilities[2].body[0].args.body.value[1];
  const run = runInstruction(
    zone,
    { target: "vayne-hunter.self", to: instruction.args.to },
    { world: kernel, targets: { "vayne-hunter.self": [kernel.ref("vayne")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("vayne").zone, "hand");
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["vayne"]);
  assert.deepEqual(run.events.map((event) => event.action), ["return-to-hand"]);
});

test("ogn-035-298 Vayne, Hunter golden: accepting the optional payment charges Energy before returning Vayne", () => {
  const base = world()
    .player("A", { energy: 1 })
    .unit("vayne", {
      zone: "board",
      location: { type: "battlefield", id: "battlefield-1" },
      might: 2
    })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("vayne") });
  kernel.setAnswers({ [`${MAY_ID}/optional`]: true });
  kernel.setTargets("vayne-hunter.self", [kernel.ref("vayne")]);

  const outcome = resolveChainBody([program.abilities[2].body[0]], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["vayne-hunter.pay-1", "executed"],
      ["vayne-hunter.return-to-hand", "executed"],
      [MAY_ID, "executed"]
    ]
  );
  assert.equal(kernel.player("A").energy, 0);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["vayne"]);
  assert.deepEqual(outcome.events.map((event) => event.action), ["pay", "return-to-hand"]);
});

test.todo(
  "ogn-035-298 Vayne, Hunter: the entry rewrite runs, but the printed 'an opponent controls a " +
    "battlefield' condition has no evaluable predicate (battlefields are not ObjectSnapshot objects, the " +
    "count subject is not evaluated) and bind.ts matches entry rewrites before the ability condition; " +
    "effect.ready must not be used to approximate the entry rewrite."
);
test.todo(
  "ogn-035-298 Vayne, Hunter: production Chain Finalize must support the nested TargetSpec inside " +
    "choice.optional and give cost.pay a payment scope/savepoint so an unpayable optional body is skipped " +
    "without aborting the enclosing trigger (383.3.b)."
);
