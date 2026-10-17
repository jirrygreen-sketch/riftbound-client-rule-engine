import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/iterative-design.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-8bbb12806c358b79644e7b09758a93f6352628f3333f245dd101bc444f171209";
const SOURCE_TEXT =
  "Play a 3 :rb_might: Mech unit token.\n" +
  "[Flow] :rb_energy_2::rb_rune_mind: (You may play this from your trash for its Flow cost. Then banish it.)";

const [flow, play] = program.abilities;
const [playMech] = play.body;

test("ven-051-166 Iterative Design: program passes validateCardProgram with the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("ven-051-166 Iterative Design: judgeReason names the chain-creation wiring, the Flow cost and the Flow replacement", () => {
  assert.match(program.judgeReason, /187\.4/);
  assert.match(program.judgeReason, /440\.2\.c/);
  assert.match(program.judgeReason, /assertFinalizationSurface/);
  assert.match(program.judgeReason, /flow\.cost/);
  assert.match(program.judgeReason, /leavingInstruction/);
  assert.match(program.judgeReason, /params\.cost/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-051-166 Iterative Design: printed energy 4, absent power, and a parameterless [Flow] declaration", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 4 }
  });
  // power: null in the catalog means no printed power; the field is absent.
  assert.equal(Object.hasOwn(play.cost, "power"), false);

  // 829.1.c is "Flow [Cost]"; the printed 2 Energy + 1 Mind Power are keyword
  // parameters, and contract 3.1's KeywordAbility has no field for them (3.8.3
  // is not merged). They are recorded in judgeReason, never as value / cost.
  assert.deepEqual(flow, { kind: "keyword", keyword: "flow" });
});

test("ven-051-166 Iterative Design: structure — one Mech token played through the Chain handoff, no invented location", () => {
  assert.equal(play.body.length, 1);
  assert.equal(playMech.id, "iterative-design.play-mech-token");
  assert.equal(playMech.op, "effect.token");
  assert.deepEqual(playMech.args.token, { kind: "constant", value: "mech" });
  assert.deepEqual(playMech.args.amount, { kind: "constant", value: 1 });
  // 440.2.c / 185.2.a: a played NEW token is created on the Chain first.
  assert.deepEqual(playMech.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playMech.args.linkKey, { kind: "constant", value: "mechToken" });
  // The printed text names no destination, so no location / target / pick is
  // authored: 355.2 / 355.2.a pick a valid location during the play procedure.
  assert.equal(Object.hasOwn(playMech.args, "location"), false);
  assert.equal(Object.hasOwn(playMech.args, "target"), false);
  assert.equal(Object.hasOwn(playMech.args, "pick"), false);
  assert.equal(playMech.targets, undefined);
  assert.equal(playMech.picks, undefined);
});

test("ven-051-166 Iterative Design golden: the body really creates and plays a 3 Might Mech token", () => {
  const kernel = world().build();
  // The reference kernel needs a concrete destination for the play handoff; the
  // production flow chooses it at Finalize (355.2.a: the controller's Base).
  const run = runInstruction(
    token,
    { ...playMech.args, location: { kind: "constant", value: { type: "base", player: "A" } } },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  const created = kernel.query({ zone: "board", type: "unit" }).filter(object => object.isToken);
  assert.equal(created.length, 1);
  // 187.4: the Mech definition is 3 Might, Mech tag, no printed cost.
  assert.equal(created[0].name, "Mech");
  assert.equal(created[0].might, 3);
  assert.deepEqual(created[0].tags, ["Mech"]);
  assert.equal(created[0].energy, null);
  assert.equal(created[0].power, null);
  assert.equal(created[0].cardId, null);
  assert.deepEqual(created[0].location, { type: "base", player: "A" });
  assert.equal(created[0].controller, "A");
  assert.equal(run.linked["mechToken.amount"], 1);
  assert.deepEqual(run.events.map(event => `${event.action}@${event.timingPoint}`), [
    "create-token@chain-item-pending",
    "play@card-played"
  ]);
});

test("ven-051-166 Iterative Design golden: a replaced play negates the instruction and leaves no token on the Board", () => {
  const kernel = world().build();
  kernel.addReplacement(action => (action.type === "play" ? "replaced" : null));
  const run = runInstruction(
    token,
    { ...playMech.args, location: { kind: "constant", value: { type: "base", player: "A" } } },
    { world: kernel }
  );

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "replaced");
  assert.deepEqual(kernel.query({ zone: "board", type: "unit" }).filter(object => object.isToken), []);
  // The Chain creation really happened; only the play was replaced, and the
  // receipt keeps that distinction (effect.token's createdAmount semantics).
  assert.equal(run.linked["mechToken.createdAmount"], 1);
  assert.equal(run.linked["mechToken.amount"], 0);
});

test.todo(
  "ven-051-166 Iterative Design: play from Trash for the 2 Energy + 1 Mind Power Flow cost " +
    "(829.1.c.1 / 829.1.c.2 alternate cost) and the delayed banish (829.1.b.1) — the merged Flow expand " +
    "emits flow.cost plus an object-leaves-chain replacement, but cost/plan-values.ts and chain/engine.ts " +
    "read neither, and replacement/bind.ts does not consume leavingInstruction"
);

test.todo(
  "ven-051-166 Iterative Design: the production Chain create-token(to: chain) + play handoff " +
    "(440.2.c / 185.2.a / 350.2 / 354) — effect.token documents the reference-kernel path, but the " +
    "production Finalize/Resolve wiring is unmerged (chain/engine.ts assertFinalizationSurface still " +
    "rejects choice.mode and nested targets)"
);

test.todo(
  "ven-051-166 Iterative Design: a play-effect token whose printed text names no destination still " +
    "needs an authorable argument — effect.token requires exactly one destination, so the card body " +
    "fails closed instead of letting the ordinary play procedure (355.2 / 355.2.a) pick the location"
);
