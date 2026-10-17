import type { M1PreconId } from "./decks.js";

const { M1_DECK_IDS } = await import(new URL("./decks.ts", import.meta.url).href);
const { HEADLESS_MATRIX_SEEDS, runHeadlessMatrix } = await import(new URL("./duel.ts", import.meta.url).href);

function flagValue(name: string): string | undefined {
  const equals = process.argv.find(argument => argument.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positiveIntegerFlag(name: string, fallback: number): number {
  const raw = flagValue(name) ?? String(fallback);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  return value;
}

function deckFlag(): readonly M1PreconId[] {
  const raw = flagValue("--decks");
  if (!raw) return M1_DECK_IDS;
  const requested = raw.split(",").map(value => value.trim()).filter(Boolean);
  if (requested.length < 2) throw new RangeError("--decks must name at least two comma-separated decks");
  for (const id of requested) {
    if (!(M1_DECK_IDS as readonly string[]).includes(id)) throw new RangeError(`Unknown --decks value: ${id}`);
  }
  return requested as M1PreconId[];
}

const games = positiveIntegerFlag("--games", 100);
const decks = deckFlag();
const summary = runHeadlessMatrix({ games, decks, seeds: HEADLESS_MATRIX_SEEDS });
console.log(JSON.stringify(summary, null, 2));
