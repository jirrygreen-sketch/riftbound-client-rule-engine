import type {
  GameEvent,
  ObjectRef,
  ObjectSnapshot,
  PlayerId,
  ResolveContext,
  Value
} from "../effects/contract.js";

/**
 * A catalog-backed Legend candidate supplied by deck construction.  A legend
 * has no printed Energy, Power, or Might; callers must preserve null for those
 * characteristics rather than manufacturing a numeric zero.
 */
export interface LegendCandidate {
  readonly id?: string;
  readonly cardId: string;
  readonly canonicalCardId?: string;
  readonly name: string;
  readonly cardType?: string;
  readonly types?: readonly string[];
  readonly tags?: readonly string[];
  readonly might?: number | null;
  readonly energy?: number | null;
  readonly power?: readonly string[] | null;
  readonly [key: string]: Value | undefined;
}

export interface LegendSourceBinding {
  readonly source: ObjectRef;
  readonly duration: "permanent" | "while-source-in-zone";
}

export interface LegendZoneEntry {
  readonly ref: ObjectRef;
  readonly cardId: string;
  readonly canonicalCardId?: string;
  readonly name: string;
  readonly owner: PlayerId;
  readonly controller: PlayerId;
  readonly source?: LegendSourceBinding;
  readonly snapshot: Omit<ObjectSnapshot, "zone"> & { readonly zone: "legend-zone" };
}

export interface LegendActionOutcome {
  readonly status: "done" | "replaced" | "prevented" | "impossible";
  readonly events: readonly GameEvent[];
  readonly result?: Value;
}

export interface CreateLegendInput {
  readonly candidate: LegendCandidate;
  readonly owner: PlayerId;
  readonly controller: PlayerId;
  readonly source: ObjectRef;
  readonly duration: LegendSourceBinding["duration"];
}

/**
 * The small additive seam consumed by effect.create-legend.  The current
 * frozen primitive contract has no `legend-zone` ZoneId or GameAction, so the
 * instruction uses this optional capability and fails closed when a host has
 * not installed it.  A production adapter can implement this interface over
 * its authoritative permanent-state store without changing the primitive.
 */
export interface LegendZoneContext {
  readonly createLegend: (input: CreateLegendInput) => LegendActionOutcome;
  readonly removeLegend: (ref: ObjectRef) => LegendActionOutcome;
  readonly removeForSource?: (source: ObjectRef) => readonly ObjectRef[];
  readonly entries?: () => readonly LegendZoneEntry[];
}

export interface LegendContext extends ResolveContext {
  readonly legendZone?: LegendZoneContext;
  readonly additionalLegends?: (player: PlayerId) => readonly LegendCandidate[];
}

function cloneRef(ref: ObjectRef): ObjectRef {
  return { id: ref.id, zoneEntryId: ref.zoneEntryId };
}

function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}

function copyCandidate(candidate: LegendCandidate): LegendCandidate {
  return {
    ...candidate,
    ...(candidate.types === undefined ? {} : { types: [...candidate.types] }),
    ...(candidate.tags === undefined ? {} : { tags: [...candidate.tags] }),
    ...(candidate.power === undefined || candidate.power === null ? {} : { power: [...candidate.power] })
  };
}

function defaultSnapshot(input: CreateLegendInput, ref: ObjectRef): LegendZoneEntry["snapshot"] {
  const candidate = input.candidate;
  return {
    ref: cloneRef(ref),
    cardId: candidate.cardId,
    name: candidate.name,
    types: candidate.types === undefined ? ["legend"] : [...candidate.types],
    tags: candidate.tags === undefined ? [] : [...candidate.tags],
    keywords: [],
    owner: input.owner,
    controller: input.controller,
    zone: "legend-zone",
    location: null,
    might: candidate.might === undefined ? null : candidate.might,
    energy: candidate.energy === undefined ? null : candidate.energy,
    // Legends have no printed Power. Preserve the null sentinel.
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
}

/**
 * A deterministic in-memory Legend Zone authority useful for production
 * adapters and focused primitive tests.  It owns object identity and keeps
 * source-bound legends removable as soon as the source leaves its zone.
 */
export class LegendZone implements LegendZoneContext {
  private readonly values = new Map<string, LegendZoneEntry>();
  private nextIdentity = 1;

  createLegend(input: CreateLegendInput): LegendActionOutcome {
    if (!input.candidate.cardId.trim() || !input.candidate.name.trim() ||
      !input.owner.trim() || !input.controller.trim() || !input.source.id.trim() ||
      !Number.isSafeInteger(input.source.zoneEntryId) || input.source.zoneEntryId < 0) {
      return { status: "impossible", events: [] };
    }
    if (input.candidate.cardType !== undefined &&
      input.candidate.cardType.toLowerCase() !== "legend") {
      return { status: "impossible", events: [] };
    }
    const id = `legend-${this.nextIdentity++}`;
    const ref = { id, zoneEntryId: 1 };
    const entry: LegendZoneEntry = {
      ref,
      cardId: input.candidate.cardId,
      ...(input.candidate.canonicalCardId === undefined ? {} : { canonicalCardId: input.candidate.canonicalCardId }),
      name: input.candidate.name,
      owner: input.owner,
      controller: input.controller,
      ...(input.duration === "while-source-in-zone"
        ? { source: { source: cloneRef(input.source), duration: input.duration } }
        : {}),
      snapshot: defaultSnapshot(input, ref)
    };
    this.values.set(id, entry);
    return { status: "done", events: [], result: cloneRef(ref) as unknown as Value };
  }

  removeLegend(ref: ObjectRef): LegendActionOutcome {
    const entry = this.values.get(ref.id);
    if (entry === undefined || entry.ref.zoneEntryId !== ref.zoneEntryId) {
      return { status: "impossible", events: [] };
    }
    this.values.delete(ref.id);
    return { status: "done", events: [], result: cloneRef(ref) as unknown as Value };
  }

  removeForSource(source: ObjectRef): readonly ObjectRef[] {
    const removed: ObjectRef[] = [];
    for (const [id, entry] of this.values) {
      if (entry.source === undefined || entry.source.duration !== "while-source-in-zone" || !sameRef(entry.source.source, source)) continue;
      this.values.delete(id);
      removed.push(cloneRef(entry.ref));
    }
    return removed;
  }

  entries(): readonly LegendZoneEntry[] {
    return [...this.values.values()].map(entry => ({
      ...entry,
      ref: cloneRef(entry.ref),
      ...(entry.source === undefined ? {} : { source: { source: cloneRef(entry.source.source), duration: entry.source.duration } }),
      snapshot: { ...entry.snapshot, ref: cloneRef(entry.snapshot.ref), types: [...entry.snapshot.types], tags: [...entry.snapshot.tags] }
    }));
  }

  forSource(source: ObjectRef): readonly LegendZoneEntry[] {
    return this.entries().filter(entry => entry.source !== undefined && sameRef(entry.source.source, source));
  }

  snapshot(): readonly LegendZoneEntry[] {
    return this.entries();
  }

  restore(entries: readonly LegendZoneEntry[]): void {
    this.values.clear();
    let maximum = 0;
    for (const entry of entries) {
      this.values.set(entry.ref.id, {
        ...entry,
        ref: cloneRef(entry.ref),
        ...(entry.source === undefined ? {} : { source: { source: cloneRef(entry.source.source), duration: entry.source.duration } }),
        snapshot: { ...entry.snapshot, ref: cloneRef(entry.snapshot.ref), types: [...entry.snapshot.types], tags: [...entry.snapshot.tags] }
      });
      const match = /^legend-(\d+)$/.exec(entry.ref.id);
      if (match) maximum = Math.max(maximum, Number(match[1]));
    }
    this.nextIdentity = Math.max(1, maximum + 1);
  }

  /** Adapter shape for a context that wants one authoritative zone port. */
  asContext(): LegendZoneContext {
    return this;
  }

  /** Preserve a candidate without allowing callers to mutate zone state. */
  static candidate(value: LegendCandidate): LegendCandidate {
    return copyCandidate(value);
  }
}

