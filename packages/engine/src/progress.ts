/** A size for people: "850 KB", "12.3 MB", "1.2 GB". */
export function sizeText(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  // "12 MB", not "12.0 MB": it is spoken.
  const short = (n: number, digits: number) => n.toFixed(digits).replace(/\.0$/, '');
  if (bytes < 1_000_000_000) return `${short(bytes / 1_000_000, bytes < 100_000_000 ? 1 : 0)} MB`;
  return `${short(bytes / 1_000_000_000, 1)} GB`;
}

/** How far a download is: "40 percent, 12 MB of 30 MB", or "12 MB so far" when the size isn't known. */
export function downloadProgressText(received: number, total: number): string {
  if (total > 0) return `${Math.min(100, Math.floor((received * 100) / total))} percent, ${sizeText(received)} of ${sizeText(total)}`;
  return `${sizeText(received)} so far`;
}

/**
 * Changes when the reader should hear how a download is going: every 10 percent, or every
 * 10 MB when the size isn't known. Starts at 0.
 */
export function downloadStep(received: number, total: number): number {
  return total > 0 ? Math.min(10, Math.floor((received * 10) / total)) : Math.floor(received / 10_000_000);
}
