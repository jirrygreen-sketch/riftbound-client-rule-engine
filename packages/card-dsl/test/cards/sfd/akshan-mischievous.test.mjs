import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/akshan-mischievous.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import attach from "../../../../engine-core/dist/effects/instructions/effect.attach.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-237227d339dd27a4f456f9ba38485d4f136673d8abcc77adbca944e2fa427ef8";
const SOURCE_TEXT =
  "[Weaponmaster]\n" +
  "You may pay :rb_rune_body::rb_rune_body: as an additional cost to play me.\n" +
  "When you play me, if you paid the additional cost, move an enemy gear to your base. You control it until I leave the board. If it's an Equipment, attach it to me.";

const [weaponmaster, additionalCost, playTrigger] = program.abilities;
const [moveInstruction, controlInstruction, attachInstruction] = playTrigger.body;

const resultFor = (outcome, id) => outcome.results.find(result => result.id === id);

// Normalize only player-relative filters as the production chain does. The
// authored LocationExpr is executed unchanged, including for an enemy gear.
const productionContext = kernel => bindResolveContext(kernel, {
  query: filter => kernel.objects.filter(object => matchesObjectFilter(
    Object.fromEntries(Object.entries(filter).map(([key, value]) => [key,
      ["controller", "owner"].includes(key) && value === "opponent" ? "B" :
        ["controller", "owner"].includes(key) && ["self", "controller"].includes(value) ? kernel.controller : value])),
    object
  ))
});
const attachInstructions = () => playTrigger.body;

test("sfd-109-221 Akshan, Mischievous: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-109-221 Akshan, Mischievous: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-109-221 Akshan, Mischievous: judgeReason names the current additional-cost, control and Equip-cost gaps", () => {
  // Fees, source-bound control and the Weaponmaster Equip-cost path still block the card.
  assert.match(program.judgeReason, /356\.2\.b/);
  assert.match(program.judgeReason, /356\.4\.f\.1/);
  assert.match(program.judgeReason, /programs\/play\.ts/);
  assert.match(program.judgeReason, /reduce-equip-cost/);
  assert.match(program.judgeReason, /479\.2\.a/);
  assert.doesNotMatch(program.judgeReason, /array-contains/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("sfd-109-221 Akshan, Mischievous: [Weaponmaster] is declared, never expanded", () => {
  // 821.1: Weaponmaster is a Triggered Ability keyword; README section 5 keeps
  // the declaration on the card and the expansion in keywords/Weaponmaster.ts.
  assert.deepEqual(weaponmaster, { kind: "keyword", keyword: "weaponmaster" });
  assert.equal(weaponmaster.value, undefined);
});

test("sfd-109-221 Akshan, Mischievous: the optional additional cost is two Body runes", () => {
  // 356.2.b / 356.2.b.1: Optional Additional Cost from a Passive Ability. 135.2
  // names Body as a domain, so two Body runes are one Power requirement of
  // amount 2 restricted to Body (the merged allowedDomains shape).
  assert.equal(additionalCost.kind, "static");
  assert.equal(additionalCost.effect.kind, "cost.additional");
  assert.equal(additionalCost.effect.id, "akshan-mischievous.additional-cost");
  assert.equal(additionalCost.effect.appliesTo, "self");
  assert.equal(additionalCost.effect.optional, true);
  assert.equal(additionalCost.effect.stage, "optional-additional");
  assert.deepEqual(additionalCost.effect.payments, [
    { kind: "power", amount: { kind: "constant", value: 2 }, allowedDomains: ["Body"] }
  ]);
});

test("sfd-109-221 Akshan, Mischievous: card-played self trigger with the three instruction chains", () => {
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(playTrigger.optional, false);
  // "if you paid the additional cost" (356.4.f.1) has no readable receipt, so
  // no always-true condition is fabricated (see judgeReason).
  assert.equal(playTrigger.trigger.condition, undefined);
  assert.equal(playTrigger.body.length, 3);
  assert.deepEqual(playTrigger.body.map(instruction => instruction.id), [
    "akshan-mischievous.move-gear",
    "akshan-mischievous.take-control",
    "akshan-mischievous.attach-gear"
  ]);
});

test("sfd-109-221 Akshan, Mischievous: the move targets one enemy gear with the ability controller base destination", () => {
  // 421.1 / 421.2: a Move between Board locations. 355.5 / 355.9.a.1: "an enemy
  // gear" is chosen when Akshan is played, so it is a target.
  assert.equal(moveInstruction.op, "effect.move");
  assert.deepEqual(moveInstruction.args.objects, {
    kind: "constant",
    value: { target: "akshan-mischievous.enemy-gear" }
  });
  assert.deepEqual(moveInstruction.args.to, {
    kind: "location",
    value: "ability-controller-base"
  });
  assert.deepEqual(moveInstruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(moveInstruction.picks, undefined);
  assert.equal(moveInstruction.linkedTo, undefined);

  assert.deepEqual(moveInstruction.targets, [
    {
      id: "akshan-mischievous.enemy-gear",
      filter: { type: "gear", zone: "board", controller: "opponent" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("sfd-109-221 Akshan, Mischievous: control links the moved gear with the while-source-in-zone duration", () => {
  // 482.3: control lasts while the source is on the Board, and 359.3.e.16 (whose
  // official example is this card) says the delayed passive is not generated
  // when Akshan leaves first. effect.control documents exactly this duration.
  assert.equal(controlInstruction.op, "effect.control");
  assert.deepEqual(controlInstruction.args.objects, {
    kind: "constant",
    value: { pick: "akshan-mischievous.referenced-gear" }
  });
  assert.deepEqual(controlInstruction.args.duration, {
    kind: "constant",
    value: { type: "while-source-in-zone" }
  });
  // "it" refers to the previous move result through a non-target pick (355.7).
  assert.deepEqual(controlInstruction.picks, [
    {
      id: "akshan-mischievous.referenced-gear",
      options: [
        {
          kind: "linked-value",
          instructionId: "akshan-mischievous.move-gear",
          key: "moved-gear.objects"
        }
      ],
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(controlInstruction.linkedTo, "akshan-mischievous.move-gear");
  assert.equal(controlInstruction.targets, undefined);
});

test("sfd-109-221 Akshan, Mischievous: the attach links the moved gear onto Akshan itself", () => {
  // 435.1 / 435.1.f-g: Attach the referenced non-Unit to a host; 150.1 makes
  // Equipment a tag and the instruction's own condition tests it (see the next
  // test and the golden below).
  assert.equal(attachInstruction.op, "effect.attach");
  assert.deepEqual(attachInstruction.args.objects, {
    kind: "constant",
    value: { kind: "pick", id: "akshan-mischievous.attached-gear" }
  });
  assert.deepEqual(attachInstruction.args.host, { kind: "constant", value: { kind: "source" } });
  assert.equal(attachInstruction.linkedTo, "akshan-mischievous.take-control");
  assert.equal(attachInstruction.targets, undefined);
  assert.deepEqual(attachInstruction.picks, [
    {
      id: "akshan-mischievous.attached-gear",
      options: [
        {
          kind: "linked-value",
          instructionId: "akshan-mischievous.move-gear",
          key: "moved-gear.objects"
        }
      ],
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("sfd-109-221 Akshan, Mischievous golden: the merged move primitive relocates the locked enemy gear", () => {
  const kernel = world()
    .player("A")
    .player("B")
    .unit("akshan", { zone: "board", location: { type: "base", player: "A" } })
    .unit("enemy-gear", {
      zone: "board",
      types: ["gear"],
      tags: ["Equipment"],
      owner: "B",
      controller: "B",
      location: { type: "battlefield", id: "bf-1" }
    })
    .build();
  kernel.setTargets("akshan-mischievous.enemy-gear", [kernel.ref("enemy-gear")]);
  const outcome = resolveChainBody([moveInstruction], productionContext(kernel));
  assert.equal(outcome.status, "executed");
  const result = resultFor(outcome, moveInstruction.id).result;
  assert.equal(result.status, "executed");
  assert.equal(result.linkedValues["moved-gear"].count, 1);
  assert.deepEqual(kernel.getObject("enemy-gear").location, { type: "base", player: "A" });
  assert.deepEqual(outcome.events.map(event => event.action), ["move-location"]);
});

test("sfd-109-221 Akshan, Mischievous golden: the merged attach primitive binds the gear to Akshan", () => {
  // 435.1.f-g: attach the referenced non-Unit to the Unit that is the ability
  // source (host selection yields exactly one current Unit).
  const built = world()
    .unit("akshan", { zone: "board", location: { type: "base", player: "A" } })
    .unit("enemy-gear", {
      zone: "board",
      types: ["gear"],
      tags: ["Equipment"],
      owner: "B",
      controller: "B",
      location: { type: "base", player: "A" }
    })
    .build();
  const kernel = built.clone({
    source: built.ref("akshan"),
    sourceSnapshot: built.getObject("akshan")
  });
  const moved = kernel.ref("enemy-gear");
  const run = runInstruction(
    attach,
    {
      objects: attachInstruction.args.objects,
      host: attachInstruction.args.host,
      amount: { kind: "constant", value: 1 },
      linkKey: { kind: "constant", value: "attached-gear" }
    },
    {
      world: kernel,
      picks: { "akshan-mischievous.attached-gear": [moved] }
    }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy-gear").attachedTo.id, "akshan");
  assert.equal(run.linked["attached-gear"].count, 1);
  assert.deepEqual(run.events.map(event => event.action), ["attach"]);
});

test("sfd-109-221 Akshan, Mischievous golden: the declared trigger body runs through the real chain adapter", () => {
  const kernel = world()
    .player("A")
    .player("B")
    .unit("akshan", { zone: "board", location: { type: "base", player: "A" } })
    .unit("enemy-gear", {
      zone: "board",
      types: ["gear"],
      tags: ["Equipment"],
      owner: "B",
      controller: "B",
      location: { type: "battlefield", id: "bf-1" }
    })
    .build();
  kernel.setTargets("akshan-mischievous.enemy-gear", [kernel.ref("enemy-gear")]);
  const outcome = resolveChainBody([moveInstruction], productionContext(kernel));
  assert.equal(outcome.status, "executed");
  assert.equal(resultFor(outcome, "akshan-mischievous.move-gear").result.status, "executed");
  assert.deepEqual(kernel.getObject("enemy-gear").location, { type: "base", player: "A" });
});

test.todo(
  "Akshan: collect static cost.additional at Finalize and bind the 356.4.f.1 payment decision before the play effect"
);

test("sfd-109-221 Akshan, Mischievous: relative base follows the ability controller rather than the gear owner", () => {
  const built = world().player("A").player("B")
    .unit("akshan", { owner: "B", controller: "B", location: { type: "base", player: "B" } })
    .unit("gear", { types: ["gear"], owner: "A", controller: "A", location: { type: "battlefield", id: "field" } })
    .build();
  const kernel = built.clone({ controller: "B", sourceSnapshot: built.getObject("akshan") });
  kernel.setTargets("akshan-mischievous.enemy-gear", [kernel.ref("gear")]);
  const context = bindResolveContext(kernel, {
    query: filter => kernel.query({ ...filter, controller: filter.controller === "opponent" ? "A" : filter.controller })
  });
  const outcome = resolveChainBody([moveInstruction], context);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.getObject("gear").location, { type: "base", player: "B" });
  assert.equal(kernel.getObject("gear").controller, "A");
});

test.todo(
  "Akshan: duration-aware take-control must restore the underlying controller when the source leaves (479.2.a/482.3/359.3.e.16)"
);

test("sfd-109-221 Akshan, Mischievous: 'If it's an Equipment' is a real compare/in condition on the moved gear's tags (150.1)", () => {
  // 150.1 / 150.4: Equipment is a tag on the Gear; the condition reads the
  // picked (moved) gear's current tags via the interpreter's object-property
  // expression and tests the scalar "Equipment" against that array with the
  // merged "in" operator. No tag snapshot has to be linked for this card: the
  // gear stays the same Board object, so its tags are current at resolution.
  assert.deepEqual(attachInstruction.condition, {
    kind: "compare",
    left: { kind: "constant", value: "Equipment" },
    operator: "in",
    right: {
      kind: "object-property",
      object: { pick: "akshan-mischievous.attached-gear" },
      property: "tags"
    }
  });
});

test("sfd-109-221 Akshan, Mischievous golden: the Equipment gate really attaches the moved gear (150.1/435.1)", () => {
  const built = world()
    .player("A")
    .player("B")
    .unit("akshan", { zone: "board", location: { type: "base", player: "A" } })
    .unit("enemy-gear", {
      zone: "board",
      types: ["gear"],
      tags: ["Equipment"],
      owner: "B",
      controller: "B",
      location: { type: "battlefield", id: "bf-1" }
    })
    .build();
  const kernel = built.clone({
    source: built.ref("akshan"),
    sourceSnapshot: built.getObject("akshan")
  });
  kernel.setTargets("akshan-mischievous.enemy-gear", [kernel.ref("enemy-gear")]);
  kernel.setPicks("akshan-mischievous.attached-gear", [kernel.ref("enemy-gear")]);

  const outcome = resolveChainBody(attachInstructions(), productionContext(kernel));

  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason]),
    [
      ["akshan-mischievous.move-gear", "executed", undefined],
      // The while-source-in-zone duration is still blocked (479.2.a/482.3).
      ["akshan-mischievous.take-control", "negated", "impossible"],
      ["akshan-mischievous.attach-gear", "executed", undefined]
    ]
  );
  assert.equal(kernel.getObject("enemy-gear").attachedTo.id, "akshan");
  assert.deepEqual(kernel.getObject("enemy-gear").location, { type: "base", player: "A" });
});

test("sfd-109-221 Akshan, Mischievous golden: a non-Equipment gear is skipped, not attached (150.1/150.5)", () => {
  const built = world()
    .player("A")
    .player("B")
    .unit("akshan", { zone: "board", location: { type: "base", player: "A" } })
    .unit("enemy-gear", {
      zone: "board",
      types: ["gear"],
      tags: ["Trinket"],
      owner: "B",
      controller: "B",
      location: { type: "battlefield", id: "bf-1" }
    })
    .build();
  const kernel = built.clone({
    source: built.ref("akshan"),
    sourceSnapshot: built.getObject("akshan")
  });
  kernel.setTargets("akshan-mischievous.enemy-gear", [kernel.ref("enemy-gear")]);
  kernel.setPicks("akshan-mischievous.attached-gear", [kernel.ref("enemy-gear")]);

  const outcome = resolveChainBody(attachInstructions(), productionContext(kernel));

  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason]),
    [
      ["akshan-mischievous.move-gear", "executed", undefined],
      ["akshan-mischievous.take-control", "negated", "impossible"],
      ["akshan-mischievous.attach-gear", "negated", "skipped"]
    ]
  );
  assert.equal(kernel.getObject("enemy-gear").attachedTo, null);
  assert.deepEqual(kernel.getObject("enemy-gear").location, { type: "base", player: "A" });
});

test.todo(
  "Akshan: Weaponmaster needs authoritative Equip-cost binding and original [A] symbol provenance (821.1.c.2-.5); ordinary cost.modify/cost.pay already execute"
);
