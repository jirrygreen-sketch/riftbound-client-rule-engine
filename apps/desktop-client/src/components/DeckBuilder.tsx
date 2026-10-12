import { useEffect, useMemo, useState } from "react";
import "./DeckBuilder.css";
import {
  ChevronDown,
  ChevronRight,
  Minus,
  Plus,
  Search,
  Sparkles
} from "lucide-react";
import { CardArtPreview, CardArtThumbnail } from "./CardArtPreview";

export type DeckCardVariant = "standard" | "alternate" | "unknown";

export interface DeckBuilderCard {
  readonly id: string;
  readonly canonicalCardId: string;
  readonly name: string;
  readonly subtitle: string;
  readonly fullName: string;
  readonly localizedName: string;
  readonly localizedSubtitle: string;
  readonly cardType: string;
  readonly domains: readonly string[];
  readonly tags: readonly string[];
  readonly setCode: string;
  readonly cardNumber: string;
  readonly variant: DeckCardVariant;
  readonly imageUrl: string | null;
  readonly banned?: boolean;
  readonly available?: boolean;
  readonly availabilityReason?: string;
}

export interface DeckBuilderEntry {
  readonly cardId: string;
  readonly quantity: number;
}

interface DeckBuilderProps {
  readonly cards: readonly DeckBuilderCard[];
  readonly deck: readonly DeckBuilderEntry[];
  readonly cardLimits: ReadonlyMap<string, number>;
  readonly onChange: (nextDeck: readonly DeckBuilderEntry[]) => void;
}

interface CardGroup {
  readonly canonicalCardId: string;
  readonly title: string;
  readonly subtitle: string;
  readonly representativeImageUrl: string | null;
  readonly cards: readonly DeckBuilderCard[];
  readonly quantity: number;
  readonly limit: number | null;
}

export function DeckBuilder({
  cards,
  deck,
  cardLimits,
  onChange
}: DeckBuilderProps) {
  const [query, setQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(new Set());

  const quantityByCardId = useMemo(() => {
    const quantities = new Map<string, number>();
    for (const entry of deck) {
      quantities.set(entry.cardId, Math.max(0, entry.quantity));
    }
    return quantities;
  }, [deck]);

  const groups = useMemo(
    () => buildDeckGroups(cards, quantityByCardId, cardLimits, query),
    [cards, quantityByCardId, cardLimits, query]
  );

  useEffect(() => {
    setExpandedGroups(current =>
      expandedGroupsForSearch(
        current,
        groups.map(group => group.canonicalCardId),
        query
      )
    );
  }, [groups, query]);

  const toggleGroup = (canonicalCardId: string) => {
    setExpandedGroups(current => {
      const next = new Set(current);
      if (next.has(canonicalCardId)) next.delete(canonicalCardId);
      else next.add(canonicalCardId);
      return next;
    });
  };

  return (
    <section className="deck-builder" aria-label="组卡搜索">
      <header className="deck-builder-header">
        <div>
          <h2>组卡搜索</h2>
          <p>{`${totalQuantity(deck)} 张已选 · ${groups.length} 个匹配结果`}</p>
        </div>
        <label className="deck-search-field">
          <Search size={16} aria-hidden />
          <span className="visually-hidden">搜索卡名或规则身份</span>
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="搜索卡名或规则身份"
          />
        </label>
      </header>

      {groups.length === 0 ? (
        <p className="deck-empty">没有匹配的卡牌</p>
      ) : (
        <ul className="deck-result-list">
          {groups.map(group => (
            <DeckGroup
              key={group.canonicalCardId}
              group={group}
              quantityByCardId={quantityByCardId}
              expanded={expandedGroups.has(group.canonicalCardId)}
              onToggle={() => toggleGroup(group.canonicalCardId)}
              onAdd={card => onChange(addCard(deck, cards, card.id, cardLimits))}
              onRemove={card => onChange(removeCard(deck, card.id))}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function DeckGroup({
  group,
  quantityByCardId,
  expanded,
  onToggle,
  onAdd,
  onRemove
}: {
  readonly group: CardGroup;
  readonly quantityByCardId: ReadonlyMap<string, number>;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onAdd: (card: DeckBuilderCard) => void;
  readonly onRemove: (card: DeckBuilderCard) => void;
}) {
  const addDisabled = isAddDisabled(group.quantity, group.limit);
  const atLimit = group.limit !== null && addDisabled;

  return (
    <li className={`deck-group ${atLimit ? "at-limit" : ""}`}>
      <button
        type="button"
        className="deck-group-toggle"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown size={17} aria-hidden /> : <ChevronRight size={17} aria-hidden />}
        <CardArtThumbnail
          className="deck-group-thumbnail"
          imageUrl={group.representativeImageUrl}
        />
        <span className="deck-group-title">{group.title}</span>
        <span className={`deck-count ${atLimit ? "full" : ""}`}>
          {`${group.quantity}/${group.limit ?? "-"}`}
        </span>
      </button>

      {expanded ? (
        <ul className="deck-variant-list">
          {group.cards.map(card => (
            <DeckVariant
              key={card.id}
              card={card}
              quantity={quantityByCardId.get(card.id) ?? 0}
              addDisabled={addDisabled || !isCardAvailable(card)}
              onAdd={() => onAdd(card)}
              onRemove={() => onRemove(card)}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function DeckVariant({
  card,
  quantity,
  addDisabled,
  onAdd,
  onRemove
}: {
  readonly card: DeckBuilderCard;
  readonly quantity: number;
  readonly addDisabled: boolean;
  readonly onAdd: () => void;
  readonly onRemove: () => void;
}) {
  const label = displayCardTitle(card);
  const variantLabel =
    card.variant === "alternate"
      ? "异画"
      : card.variant === "standard"
        ? "普通版"
        : "未知版本";

  return (
    <li className="deck-variant">
      <CardArtPreview
        imageUrl={card.imageUrl}
        title={label}
        printingLabel={variantLabel}
      />

      <div className="deck-variant-info">
        <h3>{label}</h3>
        <p>
          <span>{`${card.setCode} · ${card.cardNumber}`}</span>
          {card.variant === "alternate" ? <Sparkles size={12} aria-hidden /> : null}
          <span>{variantLabel}</span>
          {!isCardAvailable(card) ? (
            <span className="state-unavailable">
              {formatAvailabilityReason(card.availabilityReason)}
            </span>
          ) : null}
        </p>
      </div>

      <div className="deck-variant-actions">
        <button
          type="button"
          onClick={onRemove}
          disabled={quantity === 0}
          aria-label={`移除 ${label} ${card.id}`}
        >
          <Minus size={16} aria-hidden />
          <span className="visually-hidden">移除</span>
        </button>
        <output className="deck-variant-count">{quantity}</output>
        <button
          type="button"
          onClick={onAdd}
          disabled={addDisabled}
          aria-label={`添加 ${label} ${card.id}`}
        >
          <Plus size={16} aria-hidden />
          <span className="visually-hidden">添加</span>
        </button>
      </div>
    </li>
  );
}

export function addCard(
  deck: readonly DeckBuilderEntry[],
  cards: readonly DeckBuilderCard[],
  cardId: string,
  cardLimits: ReadonlyMap<string, number>
): readonly DeckBuilderEntry[] {
  const card = cards.find(candidate => candidate.id === cardId);
  if (!card || card.banned === true || card.available === false) return deck;

  const limit = cardLimits.get(card.canonicalCardId);
  if (limit === undefined) return deck;

  const nextQuantity = totalQuantity(deck, card.canonicalCardId, cards) + 1;
  if (nextQuantity > limit) return deck;

  const current = deck.find(entry => entry.cardId === cardId);
  if (current) {
    return deck.map(entry =>
      entry.cardId === cardId ? { ...entry, quantity: entry.quantity + 1 } : entry
    );
  }

  return [...deck, { cardId, quantity: 1 }];
}

export function isAddDisabled(quantity: number, limit: number | null): boolean {
  return limit === null || quantity >= limit;
}

export function expandedGroupsForSearch(
  current: ReadonlySet<string>,
  matchedCanonicalCardIds: readonly string[],
  query: string
): ReadonlySet<string> {
  if (!query.trim()) return current;

  let changed = false;
  const next = new Set(current);
  for (const canonicalCardId of matchedCanonicalCardIds) {
    if (next.has(canonicalCardId)) continue;
    next.add(canonicalCardId);
    changed = true;
  }
  return changed ? next : current;
}

export function isCardAvailable(card: DeckBuilderCard): boolean {
  return card.available !== false && card.banned !== true;
}

function formatAvailabilityReason(reason: string | undefined): string {
  if (reason === "previewNotReleased") return "未发布";
  if (reason === "banned") return "禁用";
  if (reason === "unavailable") return "不可用";
  return "暂不可用";
}

export function removeCard(
  deck: readonly DeckBuilderEntry[],
  cardId: string
): readonly DeckBuilderEntry[] {
  return deck.flatMap(entry => {
    if (entry.cardId !== cardId) return [entry];
    if (entry.quantity <= 1) return [];
    return [{ ...entry, quantity: entry.quantity - 1 }];
  });
}

export function buildDeckGroups(
  cards: readonly DeckBuilderCard[],
  quantityByCardId: ReadonlyMap<string, number>,
  cardLimits: ReadonlyMap<string, number>,
  query: string
): CardGroup[] {
  const grouped = new Map<string, DeckBuilderCard[]>();
  for (const card of cards) {
    const existing = grouped.get(card.canonicalCardId);
    if (existing) existing.push(card);
    else grouped.set(card.canonicalCardId, [card]);
  }

  const trimmedQuery = query.trim().toLocaleLowerCase();
  const groups: CardGroup[] = [];
  for (const [canonicalCardId, groupCards] of grouped) {
    const representative = groupCards[0];
    if (!representative) continue;
    if (trimmedQuery && !groupCards.some(card => matchesQuery(card, trimmedQuery))) continue;

    groups.push({
      canonicalCardId,
      title: displayCardTitle(representative),
      subtitle: representative.localizedSubtitle || representative.subtitle,
      representativeImageUrl: selectRepresentativeImageUrl(groupCards, quantityByCardId),
      cards: [...groupCards].sort(compareCards),
      quantity: totalQuantityForCards(groupCards, quantityByCardId),
      limit: cardLimits.get(canonicalCardId) ?? null
    });
  }

  return groups.sort(
    (left, right) =>
      left.title.toLocaleLowerCase().localeCompare(right.title.toLocaleLowerCase()) ||
      left.canonicalCardId.localeCompare(right.canonicalCardId)
  );
}

function displayCardTitle(card: DeckBuilderCard): string {
  const name = card.localizedName || card.name;
  const subtitle = card.localizedSubtitle || card.subtitle;
  const localizedTitle = [name, subtitle].filter(Boolean).join(" · ");
  return localizedTitle || card.fullName;
}

function selectRepresentativeImageUrl(
  cards: readonly DeckBuilderCard[],
  quantityByCardId: ReadonlyMap<string, number>
): string | null {
  const selectedWithImage = cards.find(
    card => (quantityByCardId.get(card.id) ?? 0) > 0 && card.imageUrl !== null
  );
  return selectedWithImage?.imageUrl ?? cards.find(card => card.imageUrl !== null)?.imageUrl ?? null;
}

function matchesQuery(card: DeckBuilderCard, query: string): boolean {
  return [
    card.id,
    card.canonicalCardId,
    card.name,
    card.subtitle,
    card.fullName,
    card.localizedName,
    card.localizedSubtitle,
    card.cardType,
    ...card.domains,
    ...card.tags,
    card.setCode,
    card.cardNumber
  ].some(value => value.toLocaleLowerCase().includes(query));
}

function compareCards(left: DeckBuilderCard, right: DeckBuilderCard): number {
  if (left.variant !== right.variant) {
    if (left.variant === "standard") return -1;
    if (right.variant === "standard") return 1;
  }
  return left.id.localeCompare(right.id);
}

function totalQuantityForCards(
  cards: readonly DeckBuilderCard[],
  quantityByCardId: ReadonlyMap<string, number>
): number {
  return cards.reduce((total, card) => total + (quantityByCardId.get(card.id) ?? 0), 0);
}

function totalQuantity(
  deck: readonly DeckBuilderEntry[],
  canonicalCardId?: string,
  cards?: readonly DeckBuilderCard[]
): number {
  if (!canonicalCardId || !cards) {
    return deck.reduce((total, entry) => total + Math.max(0, entry.quantity), 0);
  }

  const printingIds = new Set(
    cards.filter(card => card.canonicalCardId === canonicalCardId).map(card => card.id)
  );
  return deck.reduce(
    (total, entry) => total + (printingIds.has(entry.cardId) ? Math.max(0, entry.quantity) : 0),
    0
  );
}
