import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/akshan-mischievous.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import attach from "../../../../engine-core/dist/effects/instructions/effect.attach.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-237227d339dd27a4f456f9ba38485d4f136673d8abcc77adbca944e2fa427ef8";
const SOURCE_TEXT =
  "[Weaponmaster]\n" +
  "You may pay :rb_rune_body::rb_rune_body: as an additional cost to play me.\n" +
  "When you play me, if you paid the additional cost, move an enemy gear to your base. You control it until I leave the board. If it's an Equipment, attach it to me.";

const [weaponmaster, additionalCost, playTrigger] = program.abilities;
const [moveInstruction, controlInstruction, attachInstruction] = playTrigger.body;

const resultFor = (outcome, id) => outcome.results.find(result => result.id === id);

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

test("sfd-109-221 Akshan, Mischievous: judgeReason names all four gaps with rule and task ids", () => {
  assert.match(program.judgeReason, /356\.2\.b/);
  assert.match(program.judgeReason, /356\.4\.f\.1/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /479\.2\.a/);
  assert.match(program.judgeReason, /array-contains/);
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

test("sfd-109-221 Akshan, Mischievous: the move targets one enemy gear with the descriptive destination", () => {
  // 421.1 / 421.2: a Move between Board locations. 355.5 / 355.9.a.1: "an enemy
  // gear" is chosen when Akshan is played, so it is a target.
  assert.equal(moveInstruction.op, "effect.move");
  assert.deepEqual(moveInstruction.args.objects, {
    kind: "constant",
    value: { target: "akshan-mischievous.enemy-gear" }
  });
  assert.deepEqual(moveInstruction.args.to, {
    kind: "constant",
    value: { kind: "destination-selector", selector: "ability-controller-base" }
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
  // Equipment a tag, whose test is the judged part (see judgeReason).
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
  // The program's authored destination is the descriptive controller-base
  // marker (see judgeReason), which effect.move rejects rather than resolving
  // to the wrong base; the golden supplies the concrete Base the ability means.
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
  const run = runInstruction(
    move,
    {
      objects: moveInstruction.args.objects,
      to: { kind: "constant", value: { type: "base", player: "A" } },
      amount: { kind: "constant", value: 1 },
      linkKey: { kind: "constant", value: "moved-gear" }
    },
    { world: kernel, targets: { "akshan-mischievous.enemy-gear": [kernel.ref("enemy-gear")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked["moved-gear"].count, 1);
  assert.deepEqual(kernel.getObject("enemy-gear").location, { type: "base", player: "A" });
  assert.deepEqual(run.events.map(event => event.action), ["move-location"]);
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
  // The chain adapter executes the authored body verbatim; the move destination
  // is the only value the golden substitutes, because the printed "your base"
  // has no frozen-IR spelling (see judgeReason).
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
  const bodyForKernel = [
    {
      ...moveInstruction,
      args: { ...moveInstruction.args, to: { kind: "constant", value: { type: "base", player: "A" } } },
      // The reference kernel compares filter values literally; the contract
      // "opponent" anchor is resolved by the Finalize target pipeline (RIFT-90),
      // so the kernel-facing copy pins the gear's actual controller.
      targets: [
        {
          ...moveInstruction.targets[0],
          filter: { ...moveInstruction.targets[0].filter, controller: "B" }
        }
      ]
    }
  ];
  const outcome = resolveChainBody(bodyForKernel, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(resultFor(outcome, "akshan-mischievous.move-gear").result.status, "executed");
  assert.deepEqual(kernel.getObject("enemy-gear").location, { type: "base", player: "A" });
});

test.todo(
  "sfd-109-221 Akshan, Mischievous: charge the optional additional cost (two Body runes) and gate the play " +
    "effect on the 356.4.f.1 paid receipt — cost.additional / cost-plan wiring plus a cost-result condition " +
    "(RIFT-89; survey records the missing condition.result)"
);

test.todo(
  "sfd-109-221 Akshan, Mischievous: express \"to your base\" as the ability controller's Base — effect.move's " +
    "'controller-base' resolves against the moved object's controller, and the frozen IR has no " +
    "controller-relative LocationRef expression (contract change request)"
);

test.todo(
  "sfd-109-221 Akshan, Mischievous: support duration-aware take-control for 'You control it until I leave the " +
    "board' (482.3, 359.3.e.16's official Akshan example; 479.2.a) — effect.control currently negates every " +
    "non-permanent duration instead of restoring the underlying controller in timestamp order"
);

test.todo(
  "sfd-109-221 Akshan, Mischievous: gate 'If it's an Equipment, attach it to me' on the moved gear's tags — " +
    "Condition has no array-contains operator (only eq/ne/lt/lte/gt/gte/in) and effect.move links no tag " +
    "snapshot (contract change request; sfd/veiled-temple records the same gap)"
);

test.todo(
  "sfd-109-221 Akshan, Mischievous: the [Weaponmaster] expansion (821.1.c) must choose an Equipment, pay its " +
    "Equip cost reduced by [A], and attach it (keywords/Weaponmaster.ts needs cost.modify / cost.pay)"
);
