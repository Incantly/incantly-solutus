import { inThreadAdapter, presentScene, sandboxAdapter, type ErrorView, type FigureHandle } from '@incantly/core';
import { referenceScene } from '@incantly/core/scenes';
import { mountUnvalidated, probeUnvalidated } from '@incantly/core/testing';
import { ATTACK_FIXTURES, SCENE_FIXTURES, type FixtureScene } from './scene-fixtures';

/** State the browser tests read. */
interface SandboxState {
  ready: boolean;
  page: string;
  states: string[];
  errors: ErrorView[];
  values: Array<Record<string, number>>;
  steps: Array<number | null>;
  outcome?: unknown;
  figure?: FigureHandle;
  figures?: Record<string, FigureHandle>;
  hostTicks: number;
  [key: string]: unknown;
}

function state(page: string): SandboxState {
  const s: SandboxState = { ready: false, page, states: [], errors: [], values: [], steps: [], hostTicks: 0 };
  window.__playground = s;
  // A host heartbeat the tests watch to prove the editor stays responsive.
  setInterval(() => s.hostTicks++, 50);
  return s;
}

function callbacks(s: SandboxState) {
  return {
    onState: (value: string) => s.states.push(value),
    onError: (error: ErrorView) => s.errors.push(error),
    onValues: (values: Readonly<Record<string, number>>) => s.values.push({ ...values }),
    onStep: (step: number | null) => s.steps.push(step),
  };
}

function sceneFrom(params: URLSearchParams): FixtureScene | undefined {
  const fixture = params.get('fixture');
  if (fixture) return SCENE_FIXTURES[fixture];
  const scene = referenceScene(params.get('scene') ?? 'sine-wave');
  return scene ? { html: scene.html, css: scene.css, js: scene.js } : undefined;
}

/** Mounts a scene through the sandbox adapter, probing it first when asked. */
export function mountSandboxPage(root: HTMLElement, params: URLSearchParams): void {
  const s = state('sandbox');
  const scene = sceneFrom(params);
  if (!scene) {
    root.textContent = 'Unknown scene';
    return;
  }
  const container = document.createElement('div');
  container.className = 'figure-slot';
  root.append(container);
  const options = {
    ...callbacks(s),
    autoplay: params.get('autoplay') !== '0',
    title: 'Interactive figure',
  };
  if (params.get('probe') === '1') {
    const id = params.get('scene');
    const plan = id ? referenceScene(id)?.plan : undefined;
    void presentScene(container, scene, {
      ...options,
      ...(plan ? { spec: { parts: plan.parts, steps: plan.steps.length, singularPoints: plan.singularPoints ?? [] } } : {}),
    }).then((result) => {
      s.outcome = { status: result.status, ok: result.probe.ok, report: result.probe.report, diagnostics: result.probe.validation.diagnostics };
      if (result.status === 'live') {
        s.figure = result.figure;
        void result.figure.ready.then(() => (s.ready = true));
      } else {
        const fallback = document.createElement('p');
        fallback.className = 'figure-fallback';
        fallback.textContent = 'This figure could not be built.';
        container.append(fallback);
        s.ready = true;
      }
    });
    return;
  }
  const figure = sandboxAdapter.mount(container, scene, options);
  s.figure = figure;
  void figure.ready.then(() => (s.ready = true));
}

/** The same scene source on both adapters, side by side. */
export function mountComparePage(root: HTMLElement, params: URLSearchParams): void {
  const s = state('compare');
  const scene = sceneFrom(params);
  if (!scene) return;
  const figures: Record<string, FigureHandle> = {};
  for (const adapter of [inThreadAdapter, sandboxAdapter]) {
    const slot = document.createElement('section');
    slot.className = 'figure-slot';
    slot.dataset.adapter = adapter.name;
    root.append(slot);
    figures[adapter.name] = adapter.mount(slot, scene, { autoplay: false, ...callbacks(s) });
  }
  s.figures = figures;
  void Promise.all(Object.values(figures).map((f) => f.ready)).then(() => (s.ready = true));
}

/** Hostile scenes, mounted without the validator. */
export function mountAttackPage(root: HTMLElement, params: URLSearchParams): void {
  const s = state('attack');
  const name = params.get('case') ?? '';
  const fixture = ATTACK_FIXTURES[name];
  if (!fixture) {
    root.textContent = `Unknown case. Try: ${Object.keys(ATTACK_FIXTURES).join(', ')}`;
    return;
  }
  const button = document.createElement('button');
  button.id = 'host-button';
  button.textContent = 'Host button';
  let clicks = 0;
  button.addEventListener('click', () => (s.hostClicks = ++clicks));
  const container = document.createElement('div');
  container.className = 'figure-slot';
  root.append(button, container);
  if (fixture.probe) {
    const started = performance.now();
    void probeUnvalidated(fixture, { container }).then((outcome) => {
      s.outcome = { ok: outcome.ok, report: outcome.report, ms: performance.now() - started };
      s.ready = true;
    });
    s.ready = false;
    return;
  }
  const figure = mountUnvalidated(container, fixture, { ...callbacks(s), autoplay: true });
  s.figure = figure;
  s.ready = true;
}
