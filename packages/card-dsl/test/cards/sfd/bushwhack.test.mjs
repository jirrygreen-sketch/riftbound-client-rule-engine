import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/bushwhack.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-ee775877b722c8156c89940004f522bef67be48c96cbc0ae9175061e38ad6c56";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "Friendly units enter ready this turn. Play a Gold gear token exhausted.";

const [hidden, play] = program.abilities;
const [enterReady, goldToken] = play.body;

test("sfd-004-221 Bushwhack: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-004-221 Bushwhack: judge-required for Hidden, the entry replacement and the Gold token", () => {
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /811\.1/);
  assert.match(program.judgeReason, /replacement\.enter/);
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /Entry overrides are not supported/);
  assert.match(program.judgeReason, /host\/source/);
  assert.match(program.judgeReason, /ResolveContext\.replacement/);
});

test("sfd-004-221 Bushwhack: [Hidden] expands through the merged keyword registry", () => {
  // 811.1.b / contract 3.7: the card only declares the keyword; the expansion
  // lives in effects/keywords/Hidden.ts. The primitive/zone work that would
  // execute the Hide action is the remaining dependency (see judgeReason).
  assert.equal(keywordDefinitionsById.has("Hidden"), true);
  const definition = keywordDefinitionsById.get("Hidden");
  assert.equal(definition.stacking, "single");
  assert.deepEqual(definition.expand({ host: { canonicalCardId: CANONICAL } }), [
    { kind: "static", effect: { kind: "cost.hidden" } }
  ]);
  assert.ok(definition.ruleRefs.includes("811.1.b"));
});

test("sfd-004-221 Bushwhack: the authored Gold play creates and plays one exhausted token", () => {
  // The declared Gold definition and entry stipulation are exercised exactly
  // as authored through the shared create-token -> Play handoff.
  const kernel = world().player("A")
    .unit("cask", { types: ["gear"], zone: "board", location: { type: "base", player: "A" } })
    .build();
  const bound = kernel.clone({ sourceSnapshot: kernel.getObject("cask") });
  const host = bound.getObject("cask");
  const run = runInstruction(token, {
    token: { kind: "constant", value: "gold" },
    amount: { kind: "constant", value: 1 },
    mode: { kind: "constant", value: "play" },
    location: { kind: "constant", value: { type: "base", player: "A" } },
    entersExhausted: goldToken.args.entersExhausted,
    linkKey: { kind: "constant", value: "goldToken" }
  }, { world: bound });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.goldToken.blockedReason, undefined);
  assert.equal(run.linked.goldToken.amount, 1);
  assert.equal(run.linked.goldToken.createdAmount, 1);
  assert.equal(run.linked.goldToken.objectsComplete, true);
  const [gold] = bound.objects.filter((object) => object.isToken);
  assert.ok(gold);
  assert.equal(gold.name, "Gold");
  assert.deepEqual(gold.types, ["gear"]);
  assert.equal(gold.zone, "board");
  assert.deepEqual(gold.location, { type: "base", player: "A" });
  assert.equal(gold.exhausted, true);
  assert.equal(gold.energy, null);
  assert.equal(gold.power, null);
  assert.deepEqual(bound.objects.find((object) => object.ref.id === "cask"), host);
  assert.deepEqual(run.events.map((event) => [event.action, event.timingPoint]), [
    ["create-token", "chain-item-pending"],
    ["pay", "main-start"],
    ["play", "card-played"]
  ]);
});

test("sfd-004-221 Bushwhack structure: [Hidden], the entry-ready stipulation and the Gold token", () => {
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
  assert.equal(play.kind, "play");
  // Catalog printed cost: 2 energy + 1 Fury power.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });
  assert.deepEqual(play.body.map((instruction) => instruction.id), [
    "bushwhack.units-enter-ready",
    "bushwhack.play-gold-token"
  ]);

  // "Friendly units enter ready this turn": an entry replacement for the
  // controller's units (143.4 / 184.1 / 185.2.d, 369.1/369.3), not a later
  // Ready. The affected units are chosen by characteristics, not targeted
  // (355.10.d), so no TargetSpec is declared.
  assert.equal(enterReady.op, "replacement.enter");
  assert.deepEqual(enterReady.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(enterReady.args.exhausts, { kind: "constant", value: false });
  assert.deepEqual(enterReady.args.appliesTo, {
    kind: "constant",
    value: { type: "unit", controller: "controller" }
  });
  assert.equal(enterReady.targets, undefined);
  assert.equal(enterReady.picks, undefined);

  // "Play a Gold gear token exhausted": CR 187.5's Gold definition, the
  // 440.2.c / 185.2.a chain-create + play path and the 143.4 / 185.2.d entry
  // stipulation are authored here; the held-out Hidden and entry-replacement
  // clauses remain judge-required.
  assert.equal(goldToken.op, "effect.token");
  assert.deepEqual(goldToken.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(goldToken.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(goldToken.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(goldToken.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  assert.deepEqual(goldToken.args.entersExhausted, { kind: "constant", value: true });
  assert.equal(goldToken.linkedTo, undefined);

  // The sentences are independent (no reference between them, 359.3.e.14), so
  // the unsupported cross-object entry replacement does not gate the token instruction.
  assert.equal(enterReady.linkedTo, undefined);
});

test.todo(
  "sfd-004-221 Bushwhack: [Hidden]'s expansion must grant the Hide Discretionary Action, the facedown " +
    "zone and the facedown play (811.1.b / 811.1.c / 811.6); the merged cost.hidden declaration has no " +
    "reader yet"
);

test.todo(
  "sfd-004-221 Bushwhack: 'Friendly units enter ready this turn' is an entry replacement (143.4 / " +
    "184.1 / 185.2.d; 805.6 says it is not 'enter exhausted then become ready'), so it needs a " +
    "cross-object this-turn entry orientation including create-token, plus production forwarding of " +
    "ResolveContext.replacement; the merged replacement.enter only orients host/source entries"
);

test.todo(
  "sfd-004-221 Bushwhack: play the card's Gold token through the production TriggerRegistration lifecycle " +
    "(440.2.c / 185.2.a / 350.2 / 354), including the authored exhausted entry stipulation of 143.4 / 185.2.d"
);

test("sfd-004-221 Bushwhack: merged entry primitive cannot broaden the spell to a host-only replacement", () => {
  const definition = instructionDefinitionsById.get(enterReady.op);
  assert.equal(definition.op, "replacement.enter");
  assert.deepEqual(definition.argsSchema.parse(enterReady.args), enterReady.args);
  const kernel = world().unit("friendly", { exhausted: true }).build();
  const before = kernel.objects;
  assert.throws(() => runInstruction(definition, enterReady.args, { world: kernel }), {
    name: "BlockedReplacementError",
    message: /appliesTo must identify the host\/source object/
  });
  assert.deepEqual(kernel.objects, before);
  assert.deepEqual(kernel.events, []);
});
