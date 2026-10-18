export function environment(context, options = {}) {
  return {
    context,
    linked: (id, key) => context.linked(key === undefined ? id : `${id}.${key}`),
    canLookBack: () => false,
    isIgnored: () => false,
    ...options
  };
}

export const property = (property, player) => ({ kind: "player-property", property, ...(player === undefined ? {} : { player }) });
