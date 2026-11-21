/**
 * The SDK as the agent's `FigureHost` (agent.md 2, `figure`): a figure's lines are run in a headless app of the card's
 * mode, as Tiptap does, so the lines that fail come back in the kernel's own error format and only the lines that ran go
 * into the card. The same app tells `board_read` what a figure holds.
 */
import { createHeadlessApp } from '@incantly/sdk';
import type { AppModeId } from '@incantly/sdk';
import type { FigureHost } from '../core/agent-read';

/** The kernel's own words for a mode the SDK does not have, in the shape of a line error. */
const badMode = (mode: string, line: number): unknown => ({
  ok: false,
  kind: 'bad_mode',
  line,
  message: `There is no figure mode "${mode}".`,
  hint: 'Use graphing, geometry, 3d or another mode of the app.',
});

/** Runs the lines in a fresh figure; the app is always destroyed, and nothing here throws. */
export function sdkFigureHost(): FigureHost {
  return {
    run(mode, lines) {
      let app: ReturnType<typeof createHeadlessApp> | undefined;
      try {
        app = createHeadlessApp({ mode: mode as AppModeId });
        const results = app.run(lines);
        const good: string[] = [];
        const errors: unknown[] = [];
        const okAt = new Set<number>();
        for (const r of results) if (r.ok && 'line' in r) okAt.add(r.line);
        lines.forEach((l, i) => {
          if (okAt.has(i + 1)) good.push(l);
        });
        for (const r of results) if (!r.ok) errors.push(r);
        return { good, errors };
      } catch {
        // an unknown mode throws in the SDK; every line then failed
        return { good: [], errors: lines.map((_l, i) => badMode(mode, i + 1)) };
      } finally {
        try {
          app?.destroy();
        } catch {
          // nothing to free
        }
      }
    },
    summary(mode, script) {
      let app: ReturnType<typeof createHeadlessApp> | undefined;
      try {
        app = createHeadlessApp({ mode: mode as AppModeId, script });
        const s = app.figureSummary();
        const names = s.sample.slice(0, 8).map((o) => o.name).join(', ');
        const lost = s.undefined.length > 0 ? `; ${s.undefined.length} undefined` : '';
        return `${s.mode} figure, ${s.objects} ${s.objects === 1 ? 'object' : 'objects'}${names !== '' ? ` (${names})` : ''}${lost}`;
      } catch {
        return undefined;
      } finally {
        try {
          app?.destroy();
        } catch {
          // nothing to free
        }
      }
    },
  };
}
