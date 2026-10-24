import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

import voidSeeker from "../../../dist/cards/ogn/void-seeker.js";

// Official interaction evidence:
// - Core Rules v1.5 (last updated 2026-10-09, effective 2026-10-16):
//   https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// - Radiance patch notes, effective 2026-10-16:
//   https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
// canonicalCardId: card.hash-600e0796e82099284b213e87b112b1c5df42777ef72b70a3b4cd49a84d27dd10.
// [Action] grants 159.2.a/806.1.b Showdown permission. A play follows
// Pending -> Finalize -> Priority window -> Resolve (354.2, 359.3.a/c/d);
// the locked target is rechecked under 359.3.e.5, while the independent Draw 1
// still resolves. The spell is discarded after Resolve under 351.2.
// In an already-open Showdown it uses that Showdown's Focus/Priority rather than
// creating a new one. A moved target is ignored without departed-object LKI.

const [speed, play] = voidSeeker.abilities;

test("Void Seeker program is structurally valid and executable", () => {
  const result = validateCardProgram(voidSeeker);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(voidSeeker.status, "executable");
  assert.equal(
    voidSeeker.canonicalCardId,
    "card.hash-600e0796e82099284b213e87b112b1c5df42777ef72b70a3b4cd49a84d27dd10"
  );
  assert.match(voidSeeker.sourceText, /Deal 4 to a unit at a battlefield\. Draw 1\./);
});

test("Void Seeker ability structure: [Action] keyword + play body", () => {
  assert.equal(voidSeeker.abilities.length, 2);

  // [Action] is a speed keyword ability (v1.5 806), expanded by the engine's
  // keyword registry — the card only names it.
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });

  assert.equal(play.kind, "play");
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["damage", "effect.damage"],
      ["draw", "effect.draw"]
    ]
  );

  // "Deal 4 to a unit at a battlefield": exactly one target spec, one unit
  // at a battlefield; amount is the printed constant 4.
  const damageInstruction = play.body[0];
  assert.equal(damageInstruction.targets.length, 1);
  assert.equal(damageInstruction.targets[0].id, "unit-at-battlefield");
  assert.equal(damageInstruction.targets[0].selection, "one");
  assert.equal(damageInstruction.targets[0].filter.type, "unit");
  assert.deepEqual(damageInstruction.args.amount, { kind: "literal", value: 4 });

  // "Draw 1." is a separate sentence: it does NOT link to the damage
  // instruction, so a replaced/negated damage does not stop the draw
  // (v1.5 359.3.e.14).
  const drawInstruction = play.body[1];
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.targets, undefined);
  assert.deepEqual(drawInstruction.args.amount, { kind: "literal", value: 1 });
});

test("Void Seeker golden: deals 4 to the targeted unit and draws 1", () => {
  const kernel = world()
    .deck("drawn-card")
    .unit("enemy-unit-id", { owner: "B", might: 3 })
    .build();
  const targetRef = kernel.ref("enemy-unit-id");
  const [damageInstruction, drawInstruction] = play.body;

  const dealt = runInstruction(
    damage,
    { amount: damageInstruction.args.amount, target: "unit-at-battlefield" },
    { world: kernel, targets: { "unit-at-battlefield": [targetRef] } }
  );
  assert.equal(dealt.result.status, "executed");
  assert.equal(dealt.linked.dealt, 4);
  assert.equal(dealt.linked.dealtCount, 1);
  assert.equal(kernel.getObject("enemy-unit-id").damage, 4);

  const drawn = runInstruction(
    draw,
    { amount: drawInstruction.args.amount },
    { world: kernel }
  );
  assert.equal(drawn.result.status, "executed");
  assert.equal(drawn.linked.drawn, 1);
  assert.equal(drawn.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 0);
});

test("Void Seeker golden: damage source is the spell itself (CR 418.6.a)", () => {
  const kernel = world()
    .unit("enemy-unit-id", { owner: "B", might: 5 })
    .build();
  const targetRef = kernel.ref("enemy-unit-id");
  const damageInstruction = play.body[0];

  const dealt = runInstruction(
    damage,
    { amount: damageInstruction.args.amount, target: "unit-at-battlefield" },
    { world: kernel, targets: { "unit-at-battlefield": [targetRef] } }
  );
  assert.equal(dealt.result.status, "executed");
  // effect.damage defaults source to the resolving spell (the test-world
  // source snapshot), matching CR 418.6.a; the damage is non-combat.
  assert.equal(dealt.linked.dealt, 4);
  assert.equal(kernel.getObject("enemy-unit-id").damage, 4);
  const recorded = kernel.events.filter((event) => event.action === "damage");
  assert.equal(recorded.length, 1);
});

// --- Production goldens: original registry program, real describePlay,
// ChainEngine speed/target/cost/pass/Resolve (test/fixtures/production-play.mjs).
// Printed: Spell, Fury, 3 Energy + 1 Fury Power.
import { productionPlay } from "../../fixtures/production-play.mjs";

const vsHand = { owner: "A", controller: "A", cardId: voidSeeker.canonicalCardId, types: ["spell"], zone: "hand", energy: 3, power: ["Fury"] };
const vsTable = ({ power = ["Fury"], answers = { "target:unit-at-battlefield": ["bf-enemy"] }, battlefieldUnits = true } = {}) => productionPlay({
  programs: [voidSeeker],
  answers,
  build: w => {
    let b = w.player("A", { energy: 3, power }).player("B").object("vs", vsHand)
      .unit("base-enemy", { owner: "B", controller: "B", might: 5, location: { type: "base", player: "B" } })
      .deck("top");
    if (battlefieldUnits) {
      b = b.unit("bf-enemy", { owner: "B", controller: "B", might: 5, location: { type: "battlefield", id: "bf-1" } })
        .unit("bf-friend", { owner: "A", controller: "A", might: 3, location: { type: "battlefield", id: "bf-2" } });
    }
    return b;
  },
});

test("ogn-024-298 Void Seeker production: Action speed, deals 4 to the chosen battlefield unit, draws 1, pays 3 Energy + 1 Fury", () => {
  const f = vsTable();
  const draft = f.play("vs");
  assert.equal(draft.speed, "action");
  const [request] = f.targetRequests();
  assert.deepEqual(new Set(request.options.map(ref => ref.id)), new Set(["bf-enemy", "bf-friend"]),
    "every unit at a battlefield is offered, a unit at a base is not");
  assert.equal(f.kernel.getObject("bf-enemy").damage, 4);
  assert.equal(f.kernel.getObject("bf-friend").damage, 0);
  assert.equal(f.kernel.getObject("base-enemy").damage, 0);
  assert.equal(f.kernel.player("A").handSize, 1);
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.equal(f.kernel.getObject("vs").zone, "trash");
});

test("ogn-024-298 Void Seeker production: without the Fury Power the play is rejected before anything moves", () => {
  const f = vsTable({ power: [] });
  const before = f.kernel.snapshot();
  assert.throws(() => f.play("vs"), /insufficient matching Power/);
  assert.deepEqual(f.kernel.snapshot(), before);
});

test("ogn-024-298 Void Seeker production: with no unit at any battlefield the play has no legal target and is rejected", () => {
  const f = vsTable({ battlefieldUnits: false, answers: {} });
  const before = f.kernel.snapshot();
  assert.throws(() => f.play("vs"), error => error.code === "no-legal-targets");
  assert.deepEqual(f.kernel.snapshot(), before);
  assert.equal(f.kernel.getObject("vs").zone, "hand");
});

test("ogn-024-298 Void Seeker production: [Action] uses its Showdown response window before both players pass", () => {
  const f = twoSpellTable();
  f.engine.openShowdown("A");
  assert.equal(f.engine.canAct("A", "normal", f.kernel.ref("vs"), f.kernel.getObject("vs")), false,
    "an Action spell is not a normal-speed play in a Showdown");
  assert.equal(f.engine.canAct("A", "action", f.kernel.ref("vs"), f.kernel.getObject("vs")), true,
    "Action supplies the legal Showdown play permission");

  const opener = f.describe("vs", "A");
  assert.equal(opener.speed, "action");
  f.engine.execute(opener);
  assert.equal(f.engine.turnState, "showdown-closed");
  assert.equal(f.engine.items.length, 1);
  assert.equal(f.kernel.getObject("bf-enemy").damage, 0);
  f.engine.pass("A");
  assert.equal(f.engine.priority, "B");
  assert.equal(f.engine.canAct("B", "reaction"), true);
  f.engine.pass("B");
  assert.equal(f.kernel.getObject("bf-enemy").damage, 4);
  assert.equal(f.kernel.getObject("bf-friend").damage, 0);
  assert.deepEqual(f.engine.items, []);
});

function twoSpellTable() {
  return productionPlay({
    programs: [voidSeeker],
    answers: { "target:unit-at-battlefield": ["bf-enemy"] },
    build: w => w.player("A", { energy: 3, power: ["Fury"] })
      .player("B", { energy: 3, power: ["Fury"] })
      .object("vs", vsHand)
      .unit("bf-enemy", {
        owner: "B", controller: "B", might: 5,
        location: { type: "battlefield", id: "bf-1" }
      })
      .unit("bf-friend", {
        owner: "A", controller: "A", might: 3,
        location: { type: "battlefield", id: "bf-2" }
      })
      .deck("top")
  });
}
