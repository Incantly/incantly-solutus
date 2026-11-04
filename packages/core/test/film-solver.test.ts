import { describe, expect, it } from 'vitest';
import { fallbackWidth, fontsReady, measureFilmText, solveCallouts, solveCaption, titleCardRect, wrapText } from '../src/index';

const fixed: (text: string, fontPx: number) => number = (text, fontPx) => text.length * fontPx * 0.5;

describe('film solver: measuring', () => {
  it('falls back deterministically without a canvas', () => {
    expect(fallbackWidth('Hello', 10)).toBe(fallbackWidth('Hello', 10));
    expect(fallbackWidth('WWW', 10)).toBeGreaterThan(fallbackWidth('iii', 10));
    expect(fallbackWidth('', 10)).toBe(0);
  });

  it('uses an injected measure when given', () => {
    expect(measureFilmText('Hello', 10, fixed)).toBe(25);
  });

  it('resolves fontsReady without a document', async () => {
    await expect(fontsReady()).resolves.toBe(undefined);
  });

  it('waits for the bundled fonts before resolving', async () => {
    const global = globalThis as { document?: unknown };
    const prior = global.document;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    global.document = { fonts: { ready } };
    try {
      let settled = false;
      const pending = fontsReady().then(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(settled).toBe(false);
      release();
      await pending;
      expect(settled).toBe(true);
    } finally {
      if (prior === undefined) delete global.document;
      else global.document = prior;
    }
  });

  it('wraps greedily and keeps a long word on its own line', () => {
    expect(wrapText('one two three', 1000, 10, fixed)).toEqual(['one two three']);
    expect(wrapText('one two three', 40, 10, fixed)).toEqual(['one two', 'three']);
    expect(wrapText('supercalifragilistic', 10, 10, fixed)).toEqual(['supercalifragilistic']);
  });
});

describe('film solver: captions', () => {
  it('lays a short line out in one line with a band to hold it', () => {
    const caption = solveCaption('A pendulum swings.', { widthPx: 640, stageHeightPx: 427, measure: fixed });
    expect(caption.lines).toEqual(['A pendulum swings.']);
    expect(caption.overflow).toBe(false);
    expect(caption.fontPx).toBeGreaterThanOrEqual(12);
    expect(caption.bandHeightPx).toBeGreaterThan(caption.lineHeightPx);
  });

  it('shrinks a long line to two lines before it overflows', () => {
    const say = 'A wave carries energy forward, while the water itself only bobs gently up and down in place.';
    const narrow = solveCaption(say, { widthPx: 360, stageHeightPx: 240, measure: fixed });
    expect(narrow.lines.length).toBeLessThanOrEqual(2);
    expect(narrow.overflow).toBe(false);
    expect(narrow.fontPx).toBeGreaterThanOrEqual(12);
  });

  it('overflows what cannot fit even at the floor', () => {
    const say = 'word '.repeat(200).trim();
    const caption = solveCaption(say, { widthPx: 360, stageHeightPx: 240, measure: fixed });
    expect(caption.overflow).toBe(true);
    expect(caption.lines.length).toBe(2);
  });
});

describe('film solver: callouts', () => {
  const viewBox = [0, 0, 600, 400] as const;

  it('places a chip above its anchor clear of the parts', () => {
    const part = { minX: 250, minY: 200, maxX: 350, maxY: 300 };
    const { placed, failed } = solveCallouts([{ id: 'c1', at: [300, 200], text: 'Bob' }], {
      viewBox: [...viewBox],
      stageWidthPx: 600,
      occupied: [part],
      measure: fixed,
    });
    expect(failed).toEqual([]);
    expect(placed.length).toBe(1);
    const rect = placed[0]!.rect;
    expect(rect.maxY).toBeLessThanOrEqual(part.minY);
    expect(rect.minX).toBeGreaterThanOrEqual(0);
    expect(rect.maxY).toBeGreaterThanOrEqual(0);
  });

  it('rejects every slot when the drawing is full', () => {
    const whole = { minX: 0, minY: 0, maxX: 600, maxY: 400 };
    const { placed, failed } = solveCallouts([{ id: 'c1', at: [300, 200], text: 'Bob' }], {
      viewBox: [...viewBox],
      stageWidthPx: 600,
      occupied: [whole],
      measure: fixed,
    });
    expect(placed).toEqual([]);
    expect(failed).toEqual(['c1']);
  });

  it('never stacks two chips on each other', () => {
    const { placed, failed } = solveCallouts(
      [
        { id: 'c1', at: [300, 300], text: 'First' },
        { id: 'c2', at: [300, 300], text: 'Second' },
      ],
      { viewBox: [...viewBox], stageWidthPx: 600, occupied: [], measure: fixed },
    );
    expect(failed).toEqual([]);
    expect(placed.length).toBe(2);
    const [a, b] = [placed[0]!.rect, placed[1]!.rect];
    const overlaps = a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
    expect(overlaps).toBe(false);
  });
});

describe('film solver: titles', () => {
  it('cards the top center inside the safe margin', () => {
    const rect = titleCardRect([0, 0, 600, 400]);
    expect(rect.minX).toBeGreaterThan(0);
    expect(rect.maxX).toBeLessThan(600);
    expect(rect.minY).toBeGreaterThan(0);
    expect(rect.maxY - rect.minY).toBeCloseTo(400 * 0.22, 9);
    expect((rect.minX + rect.maxX) / 2).toBeCloseTo(300, 9);
  });
});
