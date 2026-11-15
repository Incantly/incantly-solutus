/**
 * The simulation strip (docs/features/probability/ui.md 6): a thin strip under the graph while the figure has a random
 * object, or once the probability panel's Simulate button opens it. It sets the seed, rerolls, moves the `n` of each
 * `Sample(…, n)`, runs `n` up one draw at a time, and shows the tally of a sample next to its distribution with the gap
 * between them. The Simulate menu writes coin, die, two-dice and spinner lines.
 *
 * Everything it changes goes through lines or `setFree`, so the script stays the file.
 */
import { Figure, isDist } from '@incantly/kernel';
import type { CommandRegistry, DistributionValue } from '@incantly/kernel';
import { el, fmt } from './datalab';
import type { KernelSession } from './session';

/** Commands whose result is random (probability design 6). */
const RANDOM_CALL = /(?<![\w.])(?:Sample|Draw|RandomInt|RandomReal|RandomElement|RandomPolynomial)\s*\(/;

/** True when some object of the figure is drawn at random. */
export function hasRandom(figure: Figure): boolean {
  return figure.objects().some((o) => RANDOM_CALL.test(o.definition));
}

/** The figure seed written by `@seed N`, 1 when there is none. */
export function seedOf(script: string): number {
  const m = /^@seed (\d+)/m.exec(script);
  return m ? Number(m[1]) : 1;
}

/** Splits a call's argument text at its top-level commas. */
function topArgs(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let str = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (str) {
      if (c === '\\') i++;
      else if (c === '"') str = false;
      continue;
    }
    if (c === '"') str = true;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(text.slice(start).trim());
  return out;
}

/** A `name = Sample(d, n)` object: the sample, the distribution's source text and the count's source text. */
export interface SampleInfo {
  readonly name: string;
  readonly dist: string;
  readonly count: string;
}

/** The samples of a distribution in the figure (not samples of a list). */
export function samplesOf(figure: Figure): SampleInfo[] {
  const out: SampleInfo[] = [];
  for (const o of figure.objects()) {
    const m = /=\s*Sample\s*\((.*)\)\s*(?:with\b.*)?$/.exec(o.definition);
    if (!m) continue;
    const args = topArgs(m[1] as string).filter((a) => !/^\w+\s*=/.test(a));
    if (args.length < 2) continue;
    out.push({ name: o.name, dist: args[0] as string, count: args[1] as string });
  }
  return out;
}

/** A slider for the `n` of a sample: shown when the count is a free number (ui.md 6). */
export interface CountSlider {
  readonly name: string;
  readonly samples: readonly string[];
  readonly value: number;
  readonly min: number;
  readonly max: number;
}

export function countSliders(figure: Figure): CountSlider[] {
  const by = new Map<string, string[]>();
  for (const s of samplesOf(figure)) {
    if (!/^[A-Za-z_]\w*$/.test(s.count)) continue;
    const o = figure.get(s.count);
    if (!o || !o.free || o.type !== 'Number' || !o.cell.defined || typeof o.cell.value !== 'number') continue;
    by.set(s.count, [...(by.get(s.count) ?? []), s.name]);
  }
  const out: CountSlider[] = [];
  for (const [name, samples] of by) {
    const o = figure.get(name);
    const value = o?.cell.defined ? (o.cell.value as number) : 1;
    const min = o?.range?.min ?? 1;
    const max = o?.range?.max ?? Math.max(100, value * 2);
    out.push({ name, samples, value, min, max });
  }
  return out;
}

/** One bar of the tally: a value (or a bin), how often it came up, and how often it should. */
export interface TallyBar {
  readonly lo: number;
  readonly hi: number;
  readonly seen: number;
  readonly expected: number;
}

export interface Tally {
  readonly bars: readonly TallyBar[];
  readonly discrete: boolean;
  /** Discrete: the largest gap between a bar and its probability. Continuous: the Kolmogorov distance. */
  readonly distance: number;
  readonly label: string;
}

/** The Kolmogorov distance between the empirical cdf of `xs` and the distribution's cdf. */
export function kolmogorov(xs: ArrayLike<number>, d: DistributionValue): number {
  const sorted = Float64Array.from(xs).sort();
  const n = sorted.length;
  let D = 0;
  for (let i = 0; i < n; ) {
    const x = sorted[i] as number;
    let j = i;
    while (j < n && sorted[j] === x) j++;
    const F = d.spec.cdf(d.params, x);
    const below = d.spec.discrete ? d.spec.cdf(d.params, x - 1) : F;
    D = Math.max(D, Math.abs(j / n - F), Math.abs(i / n - below));
    i = j;
  }
  return D;
}

/** The empirical versus theoretical display of a sample (ui.md 6): proportions next to probabilities. */
export function tallyOf(xs: ArrayLike<number>, d: DistributionValue): Tally {
  const n = xs.length;
  if (n === 0) return { bars: [], discrete: d.spec.discrete, distance: 0, label: 'no draws yet' };
  if (d.spec.discrete) {
    const counts = new Map<number, number>();
    for (let i = 0; i < n; i++) counts.set(xs[i] as number, (counts.get(xs[i] as number) ?? 0) + 1);
    const keys = [...counts.keys()].sort((a, b) => a - b);
    // every value with mass between the smallest and largest draw, so a missing value shows as a gap
    const lo = keys[0] as number;
    const hi = keys[keys.length - 1] as number;
    const atoms = d.spec.atoms?.values;
    const values = atoms ? Array.from(atoms).filter((v) => v >= lo && v <= hi) : hi - lo <= 200 ? Array.from({ length: hi - lo + 1 }, (_, i) => lo + i) : keys;
    let gap = 0;
    const bars = values.map((v) => {
      const seen = (counts.get(v) ?? 0) / n;
      const expected = d.spec.pdf(d.params, v);
      gap = Math.max(gap, Math.abs(seen - expected));
      return { lo: v - 0.5, hi: v + 0.5, seen, expected };
    });
    return { bars, discrete: true, distance: gap, label: `largest bar gap ${fmt(gap)}` };
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    lo = Math.min(lo, xs[i] as number);
    hi = Math.max(hi, xs[i] as number);
  }
  if (!(hi > lo)) hi = lo + 1;
  const bins = Math.max(5, Math.min(40, Math.round(Math.sqrt(n))));
  const w = (hi - lo) / bins;
  const seen = new Array<number>(bins).fill(0);
  for (let i = 0; i < n; i++) seen[Math.min(bins - 1, Math.floor(((xs[i] as number) - lo) / w))]! += 1;
  const bars = seen.map((c, i) => {
    const a = lo + i * w;
    const b = a + w;
    return { lo: a, hi: b, seen: c / n, expected: Math.max(0, d.spec.cdf(d.params, b) - d.spec.cdf(d.params, a)) };
  });
  const D = kolmogorov(xs, d);
  return { bars, discrete: false, distance: D, label: `Kolmogorov distance ${fmt(D)}` };
}

/** The Simulate menu's helpers (ui.md 6): each writes a free `n` and one `Sample(Discrete(…), n)` line. */
export type Helper = 'coin' | 'die' | 'dice' | 'spinner';

export function helperLines(kind: Helper, names: { sample: string; n: string }, sectors = 8): string[] {
  const n = `${names.n} = 10 in 1..1000 step 1`;
  const list = (k: number, from = 1): string => `[${Array.from({ length: k }, (_, i) => i + from).join(', ')}]`;
  const ones = (k: number): string => `[${new Array<string>(k).fill('1').join(', ')}]`;
  switch (kind) {
    case 'coin':
      // 0 is tails, 1 is heads
      return [n, `${names.sample} = Sample(Discrete([0, 1], [0.5, 0.5]), ${names.n})`];
    case 'die':
      return [n, `${names.sample} = Sample(Discrete(${list(6)}, ${ones(6)} / 6), ${names.n})`];
    case 'dice':
      return [n, `${names.sample} = Sample(Discrete(${list(11, 2)}, [1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1] / 36), ${names.n})`];
    case 'spinner': {
      const k = Math.max(2, Math.min(36, Math.round(sectors)));
      return [n, `${names.sample} = Sample(Discrete(${list(k)}, ${ones(k)} / ${k}), ${names.n})`];
    }
  }
}

/** Die faces for a die sample of fewer than 12 draws (ui.md 6). */
const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
export function dieFaces(xs: ArrayLike<number>): string | undefined {
  if (xs.length === 0 || xs.length >= 12) return undefined;
  const out: string[] = [];
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i] as number;
    if (!Number.isInteger(v) || v < 1 || v > 6) return undefined;
    out.push(FACES[v - 1] as string);
  }
  return out.join(' ');
}

/* ------------------------------ the strip ------------------------------ */

export interface SimStripOptions {
  readonly session: KernelSession;
  readonly registry: CommandRegistry;
  readonly say: (text: string) => void;
  /** Timer for Run; a test passes its own. */
  readonly every?: (ms: number, fn: () => void) => () => void;
  /** The studio's selection: with a random object selected, Reroll rerolls only it (ui.md 6). */
  readonly selected?: () => readonly string[];
}

export interface SimStrip {
  readonly element: HTMLElement;
  /** Shows the strip even with no random object (the panel's Simulate button). */
  open(): void;
  close(): void;
  isShown(): boolean;
  /** Re-reads the figure; called after every change. */
  refresh(): void;
  /** True while Run is advancing a count. */
  running(): boolean;
  dispose(): void;
}

const defaultEvery = (ms: number, fn: () => void): (() => void) => {
  const h = setInterval(fn, ms);
  return () => clearInterval(h);
};

export function mountSimStrip(opts: SimStripOptions): SimStrip {
  const { session, registry, say } = opts;
  const every = opts.every ?? defaultEvery;
  const element = el('section', 'sim-strip');
  element.setAttribute('aria-label', 'Simulation');
  element.hidden = true;
  const tallyHost = el('div', 'sim-tally-host');
  let forced = false;
  let stopRun: (() => void) | undefined;
  let runName = '';
  let speed = 0.1;
  let focus = '';
  let lastLen = new Map<string, number>();
  let pulseOff: ReturnType<typeof setTimeout> | undefined;

  const freeName = (base: string): string => {
    let k = 1;
    while (session.figure.get(`${base}${k}`)) k++;
    return `${base}${k}`;
  };

  /** The distribution a sample draws from: the object it names, or its expression in a scratch copy of the figure. */
  const distOf = (s: SampleInfo): DistributionValue | undefined => {
    const named = /^[A-Za-z_]\w*$/.test(s.dist) ? session.figure.get(s.dist) : undefined;
    if (named) return named.cell.defined && isDist(named.cell.value) ? named.cell.value : undefined;
    const name = freeName('simDist');
    const { figure } = Figure.fromScript(`${session.save()}\n${name} = ${s.dist}`, { commands: registry });
    const v = figure.get(name);
    return v?.cell.defined && isDist(v.cell.value) ? v.cell.value : undefined;
  };

  const stop = (): void => {
    stopRun?.();
    stopRun = undefined;
    runName = '';
  };

  const run = (slider: CountSlider): void => {
    if (stopRun) {
      stop();
      render();
      return;
    }
    runName = slider.name;
    stopRun = every(Math.round(speed * 1000), () => {
      const o = session.figure.get(runName);
      const v = o?.cell.defined ? (o.cell.value as number) : NaN;
      const max = countSliders(session.figure).find((c) => c.name === runName)?.max ?? v;
      if (!(v < max)) {
        stop();
        say(`${runName} reached ${fmt(max)}.`);
        render();
        return;
      }
      const r = session.slide(runName, v + 1, true);
      if (!r.ok) {
        stop();
        say(r.error.message);
      }
    });
    render();
  };

  function render(): void {
    const shown = forced || hasRandom(session.figure);
    element.hidden = !shown;
    if (!shown) {
      stop();
      return;
    }
    element.replaceChildren();
    const row = el('div', 'sim-row');
    // seed and reroll
    const seed = seedOf(session.save());
    const seedField = el('label', 'field small');
    const seedInput = el('input');
    seedInput.type = 'number';
    seedInput.min = '0';
    seedInput.step = '1';
    seedInput.value = String(seed);
    seedInput.setAttribute('aria-label', 'Seed');
    seedInput.addEventListener('change', () => {
      const s = Math.max(0, Math.round(Number(seedInput.value) || 0));
      const r = session.applyLines([`@seed ${s}`], 'Seed');
      say(r.ok ? `Seed ${s}.` : r.error.message);
    });
    seedField.append(el('span', 'field-label', 'Seed'), seedInput);
    const picked = (opts.selected?.() ?? []).filter((n) => {
      const o = session.figure.get(n);
      return o !== undefined && RANDOM_CALL.test(o.definition);
    });
    const reroll = el('button', 'secondary', picked.length > 0 ? `↻ Reroll ${picked.join(', ')}` : '↻ Reroll');
    reroll.type = 'button';
    reroll.title = picked.length > 0 ? `New numbers for ${picked.join(', ')} only (Reroll adds one to their re-roll count)` : 'Add one to the figure seed: every random object draws new numbers';
    reroll.addEventListener('click', () => {
      if (picked.length > 0) {
        const r = session.applyLines(picked.map((n) => `Reroll(${n})`), 'Reroll');
        say(r.ok ? `New random numbers for ${picked.join(', ')}.` : r.error.message);
        return;
      }
      const r = session.applyLines([`@seed ${seed + 1}`], 'Reroll');
      say(r.ok ? `Seed ${seed + 1}: new random numbers.` : r.error.message);
    });
    row.append(seedField, reroll);

    // one slider per free count, with Run
    for (const c of countSliders(session.figure)) {
      const box = el('label', 'field sim-count');
      const range = el('input');
      range.type = 'range';
      range.min = String(c.min);
      range.max = String(c.max);
      range.step = '1';
      range.value = String(c.value);
      range.setAttribute('aria-label', `Samples ${c.name}`);
      const out = el('output', 'readout', String(c.value));
      range.addEventListener('input', () => {
        out.textContent = range.value;
        session.slide(c.name, Number(range.value), false);
      });
      range.addEventListener('change', () => {
        const r = session.slide(c.name, Number(range.value), true);
        if (!r.ok) say(r.error.message);
      });
      box.append(el('span', 'field-label', `Samples ${c.name}`), range, out);
      const go = el('button', 'secondary', runName === c.name ? '⏸' : '▶ Run');
      go.type = 'button';
      go.title = runName === c.name ? 'Pause' : `Add one draw every ${speed} s up to ${c.max}`;
      go.addEventListener('click', () => run(c));
      row.append(box, go);
    }
    const speedField = el('label', 'field small');
    const speedInput = el('input');
    speedInput.type = 'number';
    speedInput.min = '0.02';
    speedInput.max = '1';
    speedInput.step = '0.02';
    speedInput.value = String(speed);
    speedInput.setAttribute('aria-label', 'Seconds per draw');
    speedInput.addEventListener('change', () => {
      speed = Math.min(1, Math.max(0.02, Number(speedInput.value) || 0.1));
      const was = countSliders(session.figure).find((c) => c.name === runName);
      if (was) {
        stop();
        run(was);
      }
    });
    speedField.append(el('span', 'field-label', 's / draw'), speedInput);
    row.append(speedField);

    // the Simulate menu
    const menu = el('select', 'sim-menu');
    menu.setAttribute('aria-label', 'Simulate');
    for (const [v, t] of [['', 'Simulate…'], ['coin', 'Coin'], ['die', 'Die'], ['dice', 'Two dice (sum)'], ['spinner', 'Spinner (8 sectors)']] as const) {
      const o = el('option', '', t);
      o.value = v;
      menu.append(o);
    }
    menu.addEventListener('change', () => {
      const kind = menu.value as Helper | '';
      menu.value = '';
      if (!kind) return;
      const sample = freeName(kind === 'dice' ? 'sums' : kind === 'spinner' ? 'spins' : kind === 'coin' ? 'flips' : 'rolls');
      focus = sample;
      const r = session.applyLines(helperLines(kind, { sample, n: freeName('n') }), 'Simulate');
      say(r.ok ? r.message : r.error.message);
    });
    row.append(menu);
    element.append(row, tallyHost);
    renderTally();
  }

  /** The tally of one sample next to its distribution. */
  function renderTally(): void {
    tallyHost.replaceChildren();
    const samples = samplesOf(session.figure);
    if (samples.length === 0) return;
    const pick = samples.find((s) => s.name === focus) ?? (samples[samples.length - 1] as SampleInfo);
    focus = pick.name;
    const cell = session.figure.get(pick.name)?.cell;
    const d = distOf(pick);
    const tallyRow = el('div', 'sim-tally');
    if (samples.length > 1) {
      const which = el('select');
      which.setAttribute('aria-label', 'Sample to tally');
      for (const s of samples) {
        const o = el('option', '', s.name);
        o.value = s.name;
        which.append(o);
      }
      which.value = pick.name;
      which.addEventListener('change', () => {
        focus = which.value;
        render();
      });
      tallyRow.append(which);
    }
    if (!cell?.defined || !d) {
      tallyRow.append(el('span', 'muted', cell && !cell.defined ? `${pick.name} is undefined: ${cell.reason.replace(/_/g, ' ')}` : 'No distribution to compare with.'));
      tallyHost.append(tallyRow);
      return;
    }
    const xs = cell.value as ArrayLike<number>;
    const t = tallyOf(xs, d);
    const faces = dieFaces(xs);
    if (faces) tallyRow.append(el('span', 'sim-faces', faces));
    tallyRow.append(bars(t, xs.length > 0 ? (xs[xs.length - 1] as number) : undefined, (lastLen.get(pick.name) ?? xs.length) < xs.length));
    tallyRow.append(el('span', 'sim-gap', `${xs.length} draws · ${t.label}`));
    lastLen = new Map(samples.map((s) => {
      const v = session.figure.get(s.name)?.cell;
      return [s.name, v?.defined ? (v.value as ArrayLike<number>).length : 0] as const;
    }));
    tallyHost.append(tallyRow);
  }

  /** Bars of the tally with the theoretical outline; the newest draw's bar pulses for 300 ms. */
  function bars(t: Tally, last: number | undefined, grew: boolean): HTMLElement {
    const box = el('div', 'sim-bars');
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', `Tally against the distribution, ${t.label}`);
    const top = Math.max(1e-12, ...t.bars.map((b) => Math.max(b.seen, b.expected)));
    for (const b of t.bars) {
      const bar = el('div', 'sim-bar');
      bar.title = `${t.discrete ? fmt((b.lo + b.hi) / 2) : `${fmt(b.lo)} to ${fmt(b.hi)}`}: seen ${fmt(b.seen)}, expected ${fmt(b.expected)}`;
      const seen = el('div', 'sim-seen');
      seen.style.height = `${(100 * b.seen) / top}%`;
      const exp = el('div', 'sim-expected');
      exp.style.height = `${(100 * b.expected) / top}%`;
      bar.append(seen, exp);
      if (grew && last !== undefined && last >= b.lo && (last < b.hi || b === t.bars[t.bars.length - 1])) {
        bar.classList.add('pulse');
        if (pulseOff) clearTimeout(pulseOff);
        pulseOff = setTimeout(() => bar.classList.remove('pulse'), 300);
      }
      box.append(bar);
    }
    return box;
  }

  const api: SimStrip = {
    element,
    open() {
      forced = true;
      render();
    },
    close() {
      forced = false;
      render();
    },
    isShown: () => !element.hidden,
    refresh: () => {
      // while a count slider is held, only the tally follows: rebuilding would drop the slider from under the pointer
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      if (!element.hidden && active instanceof HTMLInputElement && active.type === 'range' && element.contains(active)) renderTally();
      else render();
    },
    running: () => stopRun !== undefined,
    dispose() {
      stop();
      if (pulseOff) clearTimeout(pulseOff);
    },
  };
  render();
  return api;
}
