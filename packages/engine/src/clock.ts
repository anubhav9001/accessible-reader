/**
 * Parses a SMIL clock value into seconds. Handles SMIL 3 full and partial clocks
 * ("0:01:02.5", "01:02.5"), timecounts ("12.5s", "500ms", "2min", "1h", "12"),
 * and the DAISY 2.02 "npt=12.345s" form.
 */
export function parseClock(value: string | undefined | null): number | undefined {
  if (!value) return undefined;
  let v = value.trim();
  if (v.toLowerCase().startsWith('npt=')) v = v.slice(4);

  const count = /^(\d+(?:\.\d+)?)\s*(h|min|s|ms)?$/i.exec(v);
  if (count) {
    const n = parseFloat(count[1]!);
    switch (count[2]?.toLowerCase()) {
      case 'h':
        return n * 3600;
      case 'min':
        return n * 60;
      case 'ms':
        return n / 1000;
      default:
        return n;
    }
  }

  const parts = v.split(':');
  if ((parts.length === 2 || parts.length === 3) && parts.every((p) => /^\d+(?:\.\d+)?$/.test(p))) {
    return parts.reduce((total, p) => total * 60 + parseFloat(p), 0);
  }
  return undefined;
}
