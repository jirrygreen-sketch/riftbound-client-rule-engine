import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/sivir-mercenary.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-bd07122c30b6cd8a4c4c84c4bcce0070fad8ea471344189ee61fb766cb54e888";
const SOURCE_TEXT =
  "[Accelerate] (You may pay :rb_energy_1::rb_rune_chaos: as an additional cost to have me enter ready.)\n" +
  "If you've spent at least :rb_rune_rainbow::rb_rune_rainbow: this turn, I have +2 :rb_might: and [Ganking]. (I can move from battlefield to battlefield.)";

const [accelerate, mightStatic, gankingStatic] = program.abilities;

test("sfd-143-221 Sivir, Mercenary: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-143-221 Sivir, Mercenary: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /163\.2\.b/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-143-221 Sivir, Mercenary: Accelerate keyword declared, never re-expanded in the card", () => {
  assert.equal(program.abilities.length, 3);
  // 805: the optional additional cost and the enter-ready replacement belong to
  // effects/keywords/Accelerate.ts (contract 3.7).
  assert.deepEqual(accelerate, { kind: "keyword", keyword: "accelerate" });
});

test("sfd-143-221 Sivir, Mercenary: the +2 Might half is a conditioned arithmetic-layer static ability", () => {
  assert.equal(mightStatic.kind, "static");
  // 143.2.a / 475-477: Might is altered in the arithmetic layer, never through a
  // Buff counter (702-704).
  assert.equal(mightStatic.effect.kind, "continuous.might");
  assert.equal(mightStatic.effect.mode, "add");
  assert.equal(mightStatic.effect.layer, "arithmetic");
  assert.equal(mightStatic.effect.appliesTo, "self");
  assert.deepEqual(mightStatic.effect.amount, { kind: "constant", value: 2 });

  // "If you've spent at least [A][A] this turn" — the recorded condition shape;
  // no merged Expr reads spent Universal Power (see judgeReason).
  assert.equal(mightStatic.condition.kind, "compare");
  assert.equal(mightStatic.condition.operator, "gte");
  assert.deepEqual(mightStatic.condition.right, { kind: "constant", value: 2 });
  assert.equal(mightStatic.condition.left.kind, "count");
  assert.equal(mightStatic.condition.left.subject, "universal-power-spent-this-turn");
});

test("sfd-143-221 Sivir, Mercenary: the Ganking half is declared as a conditional keyword grant", () => {
  assert.equal(gankingStatic.kind, "static");
  // 810.1.b / 810.3: Ganking is a Passive Ability keyword; the grant is the
  // continuous.grant-keyword shape whose expansion lives in
  // effects/keywords/Ganking.ts (contract 3.7), not restated here.
  assert.equal(gankingStatic.effect.kind, "continuous.grant-keyword");
  assert.equal(gankingStatic.effect.appliesTo, "self");
  assert.deepEqual(gankingStatic.effect.keyword, { id: "Ganking" });
  assert.equal(gankingStatic.effect.duration, "this-turn");
  assert.equal(gankingStatic.condition.kind, "compare");
  assert.equal(gankingStatic.condition.left.subject, "universal-power-spent-this-turn");
  assert.deepEqual(gankingStatic.condition.right, { kind: "constant", value: 2 });
});

test("sfd-143-221 Sivir, Mercenary: the merged arithmetic layer applies the declared +2 Might when registered", () => {
  // The layers engine (RIFT-91) executes the amount this card declares. The
  // "spent [A][A]" gate itself stays TODO (no merged spend read), so this run
  // registers the effect unconditionally the way a met condition would.
  const kernel = world().unit("sivir", { might: 4, location: { type: "battlefield", id: "bf-1" } }).build();
  const snapshot = kernel.getObject("sivir");
  const engine = createLayerEngine([snapshot], [
    {
      effect: {
        id: "sivir-mercenary.might",
        layer: "arithmetic",
        source: snapshot.ref,
        filter: { objectId: "sivir" },
        effect: { kind: "continuous.might", mode: "add", amount: { kind: "constant", value: 2 } }
      },
      duration: { type: "permanent" },
      timestamp: 1,
      sequence: 1
    }
  ]);
  assert.equal(engine.evaluate(snapshot.ref).might, 6);
  // 702-704: the declared +2 is a Might modification, not a Buff counter.
  assert.equal(kernel.getObject("sivir").buffs, 0);
});

test.todo(
  "sfd-143-221 Sivir, Mercenary: evaluate \"you've spent at least [A][A] this turn\" — no merged Expr reads " +
    "spent resources (count counts objects, not amounts; ResolveContext exposes no spend receipt) and [A] is " +
    "163.2.b Universal Power, which the closed Domain type cannot express (RIFT-89; contract change request)"
);

test.todo(
  "sfd-143-221 Sivir, Mercenary: register the conditional +2 Might through a merged continuous.might instruction " +
    "(the layers engine can evaluate it, but effects/instructions/ has no such opcode) — RIFT-9 / RIFT-91"
);

test.todo(
  "sfd-143-221 Sivir, Mercenary: grant [Ganking] for the turn through a continuous.grant-keyword consumer that the " +
    "movement system reads (810.1.b / 144.4.c.1) — no merged instruction or layer path registers the grant"
);

test.todo(
  "sfd-143-221 Sivir, Mercenary: paying the optional Accelerate cost [1][Chaos] and the enter-ready replacement " +
    "run through the Finalize cost plan and the replacement pipeline (805 / RIFT-89)"
);
