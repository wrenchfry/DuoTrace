export function parseRiotId(value) {
  const normalized = String(value ?? '').trim();
  const parts = normalized.split('#');

  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
    throw new Error('Use Riot ID format GameName#TAG for both players.');
  }

  return {
    gameName: parts[0].trim(),
    tagLine: parts[1].trim()
  };
}
