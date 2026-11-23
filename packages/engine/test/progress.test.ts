import { describe, expect, it } from 'vitest';
import { downloadProgressText, downloadStep, sizeText } from '../src/index.js';

describe('download progress', () => {
  it('says sizes for people', () => {
    expect(sizeText(273_140)).toBe('273 KB');
    expect(sizeText(12_340_000)).toBe('12.3 MB');
    expect(sizeText(156_000_000)).toBe('156 MB');
    expect(sizeText(1_250_000_000)).toBe('1.3 GB');
  });

  it('says how far a download is', () => {
    expect(downloadProgressText(12_000_000, 30_000_000)).toBe('40 percent, 12 MB of 30 MB');
    expect(downloadProgressText(30_000_000, 30_000_000)).toBe('100 percent, 30 MB of 30 MB');
    expect(downloadProgressText(12_000_000, 0)).toBe('12 MB so far');
  });

  it('steps every 10 percent, or every 10 MB without a size', () => {
    expect([0, 9, 10, 55, 100].map((p) => downloadStep(p * 1000, 100_000))).toEqual([0, 0, 1, 5, 10]);
    expect([0, 9_999_999, 10_000_000, 25_000_000].map((b) => downloadStep(b, 0))).toEqual([0, 0, 1, 2]);
  });
});
