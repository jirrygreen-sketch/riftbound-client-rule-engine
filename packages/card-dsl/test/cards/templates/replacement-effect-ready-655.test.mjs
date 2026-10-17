import assert from "node:assert/strict";
import test from "node:test";

import { runCardScenario, defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import lingeringAnimus from "../../../dist/cards/rad/lingering-animus.js";
import direwing from "../../../dist/cards/sfd/direwing.js";
import shadowWatcher from "../../../dist/cards/unl/shadow-watcher.js";
import shadowAssassin from "../../../dist/cards/ven/shadow-assassin.js";

/*
 * The four printed cards remain judge-required because their replacement
 * conditions are not executable. This probe removes only that unsupported
 * condition so the shared effect.ready entry body can run through the real
 * ProgramBinding -> ChainEngine -> EventPipeline path. Production programs
 * and statuses remain unchanged in the card files.
 */
function executableEntryBody(program) {
  const abilities = program.abilities.map(ability => {
    if (ability.kind !== "replacement") return ability;
    const { condition: _condition, ...withoutCondition } = ability;
    return withoutCondition;
  });
  const { judgeReason: _judgeReason, ...withoutReason } = program;
  return { ...withoutReason, status: "executable", abilities };
}

const lingeringEntry = executableEntryBody(lingeringAnimus);
const direwingEntry = executableEntryBody(direwing);
const shadowWatcherEntry = executableEntryBody(shadowWatcher);
const shadowAssassinEntry = executableEntryBody(shadowAssassin);

const rows = [
  {
    name: "Lingering Animus · ready entry body",
    canonicalCardId: lingeringAnimus.canonicalCardId,
    program: lingeringEntry,
    scenario: {
      players: { A: { energy: 10 }, B: { energy: 10 } },
      objects: [
        {
          id: "lingering-animus",
          cardId: lingeringAnimus.canonicalCardId,
          program: lingeringEntry,
          types: ["unit"],
          zone: "hand",
          energy: 2,
          might: 2
        }
      ],
      operations: [{ type: "play", object: "lingering-animus", player: "A" }]
    },
    expect: {
      objects: { "lingering-animus": { zone: "board", exhausted: false } },
      events: {
        includes: [
          {
            timingPoint: "object-enters-board",
            object: { ref: { id: "lingering-animus" }, exhausted: false }
          }
        ]
      }
    }
  },
  {
    name: "Direwing · ready entry body with another Dragon present",
    canonicalCardId: direwing.canonicalCardId,
    program: direwingEntry,
    scenario: {
      players: { A: { energy: 10 }, B: { energy: 10 } },
      objects: [
        {
          id: "direwing",
          cardId: direwing.canonicalCardId,
          program: direwingEntry,
          types: ["unit"],
          tags: ["Dragon"],
          zone: "hand",
          energy: 7,
          might: 7
        },
        {
          id: "another-dragon",
          owner: "A",
          controller: "A",
          types: ["unit"],
          tags: ["Dragon"],
          zone: "board",
          might: 3
        }
      ],
      operations: [{ type: "play", object: "direwing", player: "A" }]
    },
    expect: {
      objects: {
        direwing: { zone: "board", exhausted: false },
        "another-dragon": { zone: "board" }
      },
      events: {
        includes: [
          {
            timingPoint: "object-enters-board",
            object: { ref: { id: "direwing" }, exhausted: false }
          }
        ]
      }
    }
  },
  {
    name: "Shadow Watcher · ready entry body",
    canonicalCardId: shadowWatcher.canonicalCardId,
    program: shadowWatcherEntry,
    scenario: {
      phase: "main",
      players: { A: { energy: 10 }, B: { energy: 10 } },
      objects: [
        {
          id: "shadow-watcher",
          cardId: shadowWatcher.canonicalCardId,
          program: shadowWatcherEntry,
          types: ["unit"],
          zone: "hand",
          energy: 4,
          might: 5
        }
      ],
      operations: [{ type: "play", object: "shadow-watcher", player: "A" }]
    },
    expect: {
      objects: { "shadow-watcher": { zone: "board", exhausted: false } },
      events: {
        includes: [
          {
            timingPoint: "object-enters-board",
            object: { ref: { id: "shadow-watcher" }, exhausted: false }
          }
        ]
      }
    }
  },
  {
    name: "Shadow Assassin · ready entry body with a same-name Trash card",
    canonicalCardId: shadowAssassin.canonicalCardId,
    program: shadowAssassinEntry,
    scenario: {
      players: { A: { energy: 10 }, B: { energy: 10 } },
      objects: [
        {
          id: "shadow-assassin",
          cardId: shadowAssassin.canonicalCardId,
          program: shadowAssassinEntry,
          name: "Shadow Assassin",
          types: ["unit"],
          zone: "hand",
          energy: 5,
          might: 5
        },
        {
          id: "shadow-assassin-in-trash",
          owner: "A",
          name: "Shadow Assassin",
          types: ["unit"],
          zone: "trash",
          might: 5
        }
      ],
      operations: [{ type: "play", object: "shadow-assassin", player: "A" }]
    },
    expect: {
      objects: {
        "shadow-assassin": { zone: "board", exhausted: false },
        "shadow-assassin-in-trash": { zone: "trash" }
      },
      events: {
        includes: [
          {
            timingPoint: "object-enters-board",
            object: { ref: { id: "shadow-assassin" }, exhausted: false }
          }
        ]
      }
    }
  }
];

for (const row of defineTemplateSuite("replacement effect.ready 655", rows)) {
  test(row.name, row.run);
}

test("replacement effect.ready 655: an unmet condition remains blocked from whole-card execution", () => {
  assert.equal(lingeringAnimus.status, "judge-required");
  assert.throws(
    () => runCardScenario(lingeringAnimus, {
      objects: [
        {
          id: "blocked-lingering-animus",
          cardId: lingeringAnimus.canonicalCardId,
          types: ["unit"],
          zone: "hand",
          energy: 2,
          might: 2
        }
      ],
      operations: [{ type: "play", object: "blocked-lingering-animus", player: "A" }]
    }),
    /is judge-required/
  );
});
