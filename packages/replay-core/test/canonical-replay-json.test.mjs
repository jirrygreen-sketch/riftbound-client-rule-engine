import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import {
  canonicalReplayJson,
  parseCanonicalReplayJson,
  reviveLegacyJournalCounters,
  stringifyCanonicalReplayJson,
  stringifyPersistedReplayJson
} from "../dist/index.js";

test("canonical replay JSON preserves Map and Set values across persistence", () => {
  const value = {
    counters: new Map(),
    set: new Set(["B", "A"]),
    omitted: undefined,
    nested: { z: 1, a: new Map([["counter", 2]]) }
  };

  const encoded = stringifyCanonicalReplayJson(value);
  const parsed = parseCanonicalReplayJson(encoded);

  assert.deepEqual(parsed, {
    counters: { map: [] },
    set: { set: ["B", "A"] },
    nested: { a: { map: [["counter", 2]] }, z: 1 }
  });
  assert.equal(encoded.includes('"omitted"'), false);
  assert.equal(stringifyCanonicalReplayJson(parsed), encoded);
});

test("canonical replay JSON rejects values that cannot round-trip", () => {
  assert.throws(() => stringifyCanonicalReplayJson({ value: Number.NaN }), /finite JSON numbers/);
  assert.throws(() => stringifyCanonicalReplayJson({ value: [undefined] }), /must not be undefined/);
  assert.throws(() => stringifyCanonicalReplayJson({ value: new Date(0) }), /plain JSON objects/);
});

test("canonical replay JSON retains undefined Map entries as a contract error", () => {
  assert.throws(() => canonicalReplayJson(new Map([["key", undefined]])), /undefined Map entries/);
});

test("canonical replay JSON preserves empty and populated journal counter semantics", () => {
  const runtime = { object: { counters: new Map([["Ready", 0], ["XP", 2]]) } };
  const stored = parseCanonicalReplayJson(stringifyCanonicalReplayJson(runtime));

  assert.deepEqual(stored, { object: { counters: { map: [["Ready", 0], ["XP", 2]] } } });
  assert.equal(stringifyCanonicalReplayJson(runtime), stringifyCanonicalReplayJson(stored));
});

test("legacy persisted counter objects are restored without rewriting other objects", () => {
  const legacy = {
    object: { counters: {}, payload: {}, details: { before: { counters: { Ready: 2 } } } },
    seed: "archive-046"
  };

  const restored = reviveLegacyJournalCounters(legacy);

  assert.deepEqual(restored, {
    object: { counters: { map: [] }, payload: {}, details: { before: { counters: { map: [["Ready", 2]] } } } },
    seed: "archive-046"
  });
  const encoded = stringifyCanonicalReplayJson(restored);
  assert.equal(stringifyCanonicalReplayJson(parseCanonicalReplayJson(encoded)), encoded);
});

test("RIFT-990 completed archives reproduce their integrity after counter restoration", () => {
  const directory = "/root/swarm-rift/shared/rift990-evidence/journals";
  const files = readdirSync(directory).filter(name => name.endsWith(".journal.json"));
  assert.equal(files.length, 81);
  for (const file of files) {
    const archive = JSON.parse(readFileSync(`${directory}/${file}`, "utf8"));
    const restored = reviveLegacyJournalCounters(archive);
    const { integrity, ...content } = restored;
    assert.equal(createHash("sha256").update(stringifyPersistedReplayJson(content)).digest("hex"), integrity);
  }
});
