const TECHNICAL_APPENDIX_MARKERS = [
  /\breviewer summary\s*:/i,
  /\n\s*[-•]\s*action taken\s*:/i,
  /\n\s*[-•]\s*current state\s*:/i,
];

export function conciseDecisionSummary(
  value: unknown,
  fallback = "No decision summary is available.",
  maxLength = 180,
): string {
  if (typeof value !== "string" || !value.trim()) return fallback;

  let summary = value.trim();
  for (const marker of TECHNICAL_APPENDIX_MARKERS) {
    const markerIndex = summary.search(marker);
    if (markerIndex >= 0) summary = summary.slice(0, markerIndex);
  }

  summary = summary.replace(/\s+/g, " ").trim();
  if (!summary) return fallback;
  if (summary.length <= maxLength) return summary;

  const clipped = summary.slice(0, maxLength + 1);
  const sentenceEnd = Math.max(
    clipped.lastIndexOf(". "),
    clipped.lastIndexOf("! "),
    clipped.lastIndexOf("? "),
  );
  if (sentenceEnd >= Math.min(60, maxLength / 2)) {
    return clipped.slice(0, sentenceEnd + 1).trim();
  }

  const lastSpace = clipped.lastIndexOf(" ");
  const safeEnd = lastSpace >= Math.min(40, maxLength / 2) ? lastSpace : maxLength;
  return `${clipped.slice(0, safeEnd).trimEnd()}…`;
}
