import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// RIFT-1062: found in a real two-browser M1 run on macOS. The combat damage
// input read event.currentTarget inside a state updater; React runs updaters
// after the event has finished dispatching, when currentTarget is null, so the
// first keystroke threw and blanked the board in the middle of combat. Static
// markup renders cannot fire input events, so the pattern itself is checked.

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/u.test(name) ? [path] : [];
  });
}

describe("RIFT-1062 state updaters never read the event", () => {
  it("reads input values before calling a functional state update", () => {
    const root = new URL("../../src", import.meta.url).pathname;
    const offenders = sources(root).flatMap(path =>
      readFileSync(path, "utf8").split("\n").flatMap((line, index) =>
        /set[A-Z]\w*\(\s*\(?\w+\)?\s*=>[^;]*\b(event|e)\.(currentTarget|target)\b/u.test(line)
          ? [`${path.slice(root.length)}:${index + 1}`] : []));
    expect(offenders).toEqual([]);
  });

  it("still lets the combat damage input update its draft", () => {
    const board = readFileSync(new URL("../../src/full-product/v2/V2MatchBoard.tsx", import.meta.url), "utf8");
    expect(board).toMatch(/const amount = event\.currentTarget\.value;\s*setCombatDamageDrafts\(current => \(\{ \.\.\.current, \[target\.objectId\]: amount \}\)\);/u);
  });
});
