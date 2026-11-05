import {
  anchorFor,
  applyBeatCues,
  applyFilmPatch,
  applySlotClasses,
  applyStyle,
  bindPlayerFullscreen,
  AskReturnStack,
  askContextLine,
  attachAudio,
  beginShowMe,
  buildStubScene,
  CAPTION_SCALES,
  compileFilm,
  compileTrusted,
  createBrowserFallbackRig,
  createSandboxedFallbackRig,
  ExportCancellation,
  ExportCancelledError,
  ExportError,
  exportAvSyncBound,
  exportFrameSize,
  exportSlideFilename,
  exportTimelineFallback,
  exportTimelineMp4,
  exportVideoFilename,
  FilmController,
  FilmMixer,
  FilmVersionStore,
  flattenFilm,
  flattenInsert,
  flattenTranscript,
  fontsReady,
  formatFilmLink,
  InsertPlayer,
  meanPixelDifference,
  mountStubRuntime,
  openBrowserCapture,
  openSandboxedCapture,
  openWebCodecsAudio,
  openWebCodecsVideo,
  planDeckSlides,
  planExportFilm,
  PrivateInsertStore,
  probeExportCodecs,
  promoteInsertClip,
  reanchorAskAnchor,
  renderExportChunk,
  renderLiveExportPixels,
  loadKitModules,
  mountTrusted,
  parseFilmLink,
  PlayerModel,
  probeFilmAsync,
  probeFilmStatic,
  probeSandboxed,
  probeScene,
  pushAbsoluteState,
  refreshPlayerFullscreenVisibility,
  renderSandboxedLivePixels,
  resolveFilmLink,
  resolveFilmPosition,
  resolveStyle,
  ResumeStore,
  routeQuestion,
  sandboxAdapter,
  sanitizeExportFilenameSegment,
  sanitizeFilmPatch,
  sanitizeProbedSnapshot,
  SandboxFilmMirror,
  shortcutFor,
  SHORTCUTS,
  SideClipPlayer,
  solveCaption,
  validateExampleClip,
  validateInsertClip,
  validateScene,
  VersionPicker,
  WebAudioMixerBackend,
  EXPORT_FPS_DEFAULT,
  FILM_BEAT_HOLD_SECONDS,
  FILM_FIXTURES,
  type AskAnchor,
  type CompiledBeat,
  type CompiledFilm,
  type ExportFrameSize,
  type ExportPlan,
  type FigureHandle,
  type FilmFailure,
  type FilmFixture,
  type FilmReport,
  type FilmSceneSource,
  type FilmVersionPatch,
  type FlattenedTimeline,
  type InsertClip,
  type MixerClip,
  type StoredInsert,
  type KitRegistry,
  type PlayerState,
  type ProbeReport,
  type RendererMessage,
  type ResumeStorage,
  type RuntimeUpdate,
  type SanitizedSceneSnapshot,
  type SceneFunction,
  type SceneRuntime,
  type ShowMeSession,
  type StylePreset,
} from '@incantly/core';
import { resolveFilmSource, storedAsFixture, type StoredFilm } from '@incantly/generation/client';

/**
 * The film player: a silent fixture film through the real controller, player
 * and probe path. `?film=thirty|sixty` picks the film, or a generated film's
 * id from the dev store; `?preset=` and `?theme=` style the figure as an
 * integrator would; `?hide=` (comma separated: captions, transcript,
 * chapters, timeline, deck, playerFullscreen) turns chrome off; `?deck=1`
 * opens in deck mode, where beats hold until clicked. A generic consumer:
 * no scene-specific code.
 */
export function mountPlayerPage(root: HTMLElement, params: URLSearchParams): void {
  const key = params.get('film') ?? 'thirty';
  const status = document.createElement('p');
  status.textContent = 'Loading film…';
  root.append(status);
  void (async () => {
    const resolved = await resolveFilmSource(key, {
      loadStored: async (id): Promise<StoredFilm | FilmFixture | null> => {
        try {
          const answer = await fetch(`/api/dev/films/${encodeURIComponent(id)}`);
          if (!answer.ok) return null;
          return (await answer.json()) as StoredFilm;
        } catch {
          return null;
        }
      },
      fixtures: FILM_FIXTURES,
    });
    if (!resolved) {
      root.textContent = `Unknown film "${params.get('film')}". Try one of: ${Object.keys(FILM_FIXTURES).join(', ')}`;
      return;
    }
    const fixture = storedAsFixture(resolved.film);
    status.textContent = `Loading ${fixture.storyboard.film.title}…`;
    await start(root, params, fixture, resolved.source === 'store');
  })().catch((error: unknown) => {
    status.textContent = `The film could not start: ${error instanceof Error ? error.message : 'unknown error'}`;
    // A failure past the first paint clears the loading line with it; the
    // refusal still shows, so a rejected film never idles blank.
    if (!status.isConnected) root.append(status);
  });
}

async function start(root: HTMLElement, params: URLSearchParams, fixture: FilmFixture, isolated: boolean): Promise<void> {
  const scene = fixture.scenes[0]!;
  const multi = fixture.scenes.length > 1;
  // Every scene validates; single-scene films take the same path as today.
  const validations = fixture.scenes.map((candidate) => validateScene({ html: candidate.html, css: candidate.css, js: candidate.js }));
  const firstInvalid = validations.findIndex((validation) => !validation.ok || !validation.scene);
  if (firstInvalid >= 0) {
    const invalid = validations[firstInvalid]!;
    throw new Error(invalid.diagnostics.map((d) => d.message).join('; '));
  }
  const kits = await loadKitModules([...new Set(validations.flatMap((v) => v.scene!.kits))]);
  root.textContent = '';

  const theme = params.get('theme');
  const preset = params.get('preset') as StylePreset | null;
  const hide = new Set((params.get('hide') ?? '').split(',').map((part) => part.trim()).filter(Boolean));
  // Reduced motion, the same convention as figures: the media query, unless
  // ?reduced-motion=0 forces motion or =1 forces stillness. The film then
  // starts on a still beat with its caption instead of autoplaying.
  const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const reducedMotion = params.get('reduced-motion') === '1' || (params.get('reduced-motion') !== '0' && prefersReduced);

  // The player chrome is styled as FigureStyle slots and show flags, through
  // the same resolveStyle/applyStyle helpers and dataset convention as figures.
  const player = document.createElement('div');
  player.className = 'inc-player';
  const playerStyle = resolveStyle({
    ...(preset ? { preset } : {}),
    show: {
      captions: !hide.has('captions'),
      transcript: !hide.has('transcript'),
      chapters: !hide.has('chapters'),
      timeline: !hide.has('timeline'),
      deck: !hide.has('deck'),
      playerFullscreen: !hide.has('playerFullscreen'),
    },
  });
  applyStyle(player, playerStyle);
  root.append(player);

  const heading = document.createElement('h2');
  heading.textContent = fixture.storyboard.film.title;
  player.append(heading);

  // The film owns play, pause, speed and steps; the figure keeps its controls,
  // readouts, legend and description for exploring.
  const figureBox = document.createElement('div');
  figureBox.className = 'inc-player-figure';
  player.append(figureBox);
  // One figure per scene, in film order; single-scene films mount exactly as
  // today, multi-scene films stack theirs with only the active one shown.
  const sceneBoxes: HTMLElement[] = [];
  for (const [index, candidate] of fixture.scenes.entries()) {
    const box = multi ? document.createElement('div') : figureBox;
    if (multi) {
      box.className = 'inc-player-scene';
      box.dataset.scene = candidate.id;
      box.hidden = index !== 0;
      figureBox.append(box);
      sceneBoxes.push(box);
    }
  }
  const boxes: readonly HTMLElement[] = multi ? sceneBoxes : [figureBox];
  const figureStyle = { ...(preset ? { preset } : {}), show: { transport: false, speed: false, steps: false, settings: false, undo: false, fullscreen: false } };
  const figureTheme = theme === 'light' || theme === 'dark' ? theme : 'auto';
  // Generated scenes from the dev store never run on the host: each is
  // probed in a hidden sandbox, its beats compile from the checked
  // snapshot, a stand-in keeps the film clock, and the sandboxed figure
  // draws. Anything that fails its checks refuses the film before the
  // first frame. Trusted static fixtures keep their direct mount.
  const figures: Array<ReturnType<typeof mountTrusted>> = [];
  let sandboxed: {
    readonly snapshots: readonly SanitizedSceneSnapshot[];
    readonly stubs: readonly SceneRuntime[];
    readonly handles: readonly FigureHandle[];
    readonly probes: readonly ProbeReport[];
    mirror: SandboxFilmMirror | null;
  } | null = null;
  if (isolated) {
    const snapshots: SanitizedSceneSnapshot[] = [];
    const probes: ProbeReport[] = [];
    for (const candidate of fixture.scenes) {
      const fragments = { html: candidate.html, css: candidate.css, js: candidate.js };
      const probed = await probeSandboxed(fragments, { spec: { parts: [...candidate.probe.parts], steps: candidate.probe.steps } });
      if (!probed.ok || !probed.report || !probed.report.snapshot) {
        const first = probed.report && !probed.report.ok ? probed.report.failures[0]?.message : probed.validation.diagnostics[0]?.message;
        throw new Error(first ?? 'A stored scene did not pass its checks, so the film cannot start.');
      }
      const snapshot = sanitizeProbedSnapshot(probed.report.snapshot);
      if (!snapshot) throw new Error('A stored scene did not pass its checks, so the film cannot start.');
      probes.push(probed.report);
      snapshots.push(snapshot);
    }
    const stubs = snapshots.map((snapshot) => mountStubRuntime(snapshot));
    const title = fixture.storyboard.film.title;
    const handles = fixture.scenes.map((candidate, index) =>
      sandboxAdapter.mount(
        boxes[index]!,
        { html: candidate.html, css: candidate.css, js: candidate.js },
        { title: multi ? `${title} (${candidate.id})` : title, film: true, autoplay: false, reducedMotion, theme: figureTheme, style: { ...figureStyle } },
      ),
    );
    const states = await Promise.all(handles.map((handle) => handle.ready));
    if (states.some((state) => state !== 'live')) {
      for (const handle of handles) handle.destroy();
      throw new Error('A stored scene did not start, so the film cannot start.');
    }
    sandboxed = { snapshots, stubs, handles, probes, mirror: null };
  } else {
    fixture.scenes.forEach((candidate, index) => {
      figures.push(
        mountTrusted(boxes[index]!, { html: candidate.html, css: candidate.css, js: candidate.js }, {
          kits,
          film: true,
          autoplay: false,
          reducedMotion,
          theme: figureTheme,
          figureId: multi ? `film-${candidate.id}` : 'film',
          style: { ...figureStyle },
        }),
      );
    });
  }
  const session = sandboxed;
  const runtimes: readonly SceneRuntime[] = session ? session.stubs : figures.map((mounted) => mounted.runtime);
  const snapshotFor = (sceneId: string): SanitizedSceneSnapshot | null => {
    if (!session) return null;
    const at = fixture.scenes.findIndex((candidate) => candidate.id === sceneId);
    return at < 0 ? null : (session.snapshots[at] ?? null);
  };
  const sources: FilmSceneSource[] = [];
  for (let index = 0; index < fixture.scenes.length; index++) {
    const candidate = fixture.scenes[index]!;
    const steps = runtimes[index]!.beats();
    if (!steps) throw new Error(multi ? `Scene "${candidate.id}" has no steps` : 'The scene has no steps');
    sources.push({ id: candidate.id, js: candidate.js, steps });
  }
  const compiled = compileFilm(JSON.parse(JSON.stringify(fixture.storyboard)) as unknown, sources);
  if (!compiled.ok || !compiled.film) throw new Error(compiled.diagnostics.map((d) => d.message).join('; '));
  let film = compiled.film;

  // Narration arrives before the first frame: the stub times every beat
  // through the same endpoint Cartesia would use. A failure leaves the film
  // estimated and silent; narration never blocks a film.
  const mixBackend = new WebAudioMixerBackend();
  const mixer = new FilmMixer(mixBackend);
  let narrationSource = 'estimated';
  try {
    const narrated = await narrateBeats(
      film.beats.map((beat) => ({ id: beat.id, text: beat.step.say })),
      { source: 'stub' },
    );
    if (narrated) {
      for (const beat of narrated.beats) {
        if (beat.estimated || !beat.audioBase64 || !beat.audioHash) continue;
        film = attachAudio(film, beat.id, { seconds: beat.seconds, words: beat.starts });
        mixer.attach({ beatId: beat.id, hash: beat.audioHash, pcm: base64ToBytes(beat.audioBase64), sampleRate: beat.sampleRate, seconds: beat.seconds });
      }
      narrationSource = narrated.source;
    }
  } catch {
    // Estimated and silent.
  }

  // Version storage: the film as narrated is the immutable base, and the
  // service's patches rebuild every version on load — validated, so a
  // tampered record never plays. Without the service the film is v1 alone.
  let versionStore = new FilmVersionStore(film, sources);
  try {
    const token = await devToken();
    const headers = { authorization: `Bearer ${token}` };
    const listed = await fetch(`/api/v1/films/${film.id}/versions`, { headers });
    if (listed.ok) {
      const body = (await listed.json()) as { versions?: Array<{ version: number }> };
      const patches: unknown[] = [];
      for (const entry of body.versions ?? []) {
        const one = await fetch(`/api/v1/films/${film.id}/versions/${entry.version}`, { headers });
        if (!one.ok) throw new Error(`version ${entry.version} did not load`);
        patches.push(((await one.json()) as { patch: unknown }).patch);
      }
      const loaded = FilmVersionStore.load(film, patches, sources);
      if (loaded.ok) {
        versionStore = loaded.store;
        film = versionStore.get(versionStore.latest) ?? film;
        for (const card of versionStore.list().slice(1)) {
          const patch = versionStore.patch(card.version);
          const parent = versionStore.get(card.parent ?? 0);
          const at = versionStore.get(card.version);
          if (patch && parent && at) attachPatchAudio(patch, parent, at, mixer);
        }
      }
    }
  } catch {
    // Base only: the film plays on without its stored versions.
  }
  const picker = new VersionPicker(versionStore);

  // Single-scene films drive one runtime as today; multi-scene films sequence
  // across one runtime per scene, routing the transport to the active figure.
  // Sandboxed films drive their stand-ins with no transport instead — the
  // frame loop ticks the controller, and the mirror plays every cue into
  // the sandboxed figures, which draw.
  let controller: FilmController;
  if (!multi) {
    controller = session
      ? new FilmController({ runtime: runtimes[0]!, film, reducedMotion })
      : new FilmController({
          runtime: runtimes[0]!,
          film,
          reducedMotion,
          transport: { send: (message) => figures[0]!.renderer.send(message), apply: (update) => figures[0]!.renderer.apply(update) },
        });
  } else {
    let active = 0;
    const routed = {
      send: (message: RendererMessage): void => {
        figures[active]?.renderer.send(message);
      },
      apply: (update: RuntimeUpdate): void => {
        figures[active]?.renderer.apply(update);
      },
    };
    controller = session
      ? new FilmController({ runtime: runtimes[0]!, runtimes: [...runtimes], film, reducedMotion })
      : new FilmController({
          runtime: runtimes[0]!,
          runtimes: figures.map((f) => f.runtime),
          film,
          reducedMotion,
          transport: routed,
        });
    const showScene = (sceneId: string, cut: string): void => {
      const index = film.scenes.findIndex((candidate) => candidate.id === sceneId);
      if (index < 0) return;
      active = index;
      sceneBoxes.forEach((box, i) => {
        box.hidden = i !== index;
      });
      figureBox.dataset.cut = cut;
      figureBox.dataset.scene = sceneId;
    };
    controller.on((event) => {
      if (event.type === 'cut') {
        const to = film.scenes.find((candidate) => candidate.id === event.to);
        showScene(event.to, to?.cut ?? 'cut');
      } else if (event.type === 'seek') {
        const to = film.scenes.find((candidate) => candidate.id === event.beat.sceneId);
        showScene(event.beat.sceneId, to?.cut ?? 'cut');
      }
    });
    figureBox.dataset.scene = film.scenes[0]?.id ?? '';
    figureBox.dataset.cut = 'cut';
  }
  if (session) {
    session.mirror = new SandboxFilmMirror(
      controller,
      fixture.scenes.map((candidate, index) => ({ id: candidate.id, stub: session.stubs[index]!, handle: session.handles[index]! })),
      () => film,
    );
  }
  const mirror = session?.mirror ?? null;
  const model = new PlayerModel(controller, film);
  // Deck mode: a click-authored film, or ?deck=1 on any film. The toggle
  // below flips it at any time, with no narration required.
  if (params.get('deck') === '1' || film.advance === 'click') model.setAdvance('click');

  // The mixer follows the film's events: beats play their line, seeks and
  // pauses stop it. Sound stays off until the viewer turns it on.
  const beatOffset = (): number => {
    const beat = controller.currentBeat;
    return beat ? controller.time - beat.start : 0;
  };
  model.on((event) => {
    if (event.type === 'beat' || event.type === 'play') {
      const beat = controller.currentBeat;
      if (beat) mixer.onBeat(beat.id, beatOffset());
    } else if (event.type === 'pause' || event.type === 'pausePoint' || event.type === 'end' || event.type === 'seek') {
      mixer.onInterrupt();
      if (controller.isPlaying) {
        const beat = controller.currentBeat;
        if (beat) mixer.onBeat(beat.id, beatOffset());
      }
    }
  });

  const card = document.createElement('div');
  card.className = 'inc-player-card';
  card.hidden = true;
  figureBox.append(card);

  const caption = document.createElement('div');
  caption.className = 'inc-caption';
  caption.setAttribute('role', 'status');
  player.append(caption);

  // Resume positions: per-film keys in localStorage, position/ids/numbers
  // only — never question or note text. Memory-backed where storage is gone.
  const resume = new ResumeStore(memoryLocalStorage());
  const saveResume = (): void => {
    const beat = controller.currentBeat;
    if (!beat) return;
    resume.save(film.id, { v: film.version, beat: beat.id, w: Math.max(0, model.currentWordIndex), t: controller.time });
  };
  model.on((event) => {
    if (event.type === 'pause' || event.type === 'seek') saveResume();
  });

  const toggleLoop = (): void => {
    if (model.loopedBeat) model.loopBeat(null);
    else {
      const beat = controller.currentBeat ?? film.beats[0];
      if (beat) {
        if (!controller.currentBeat) model.seek(beat.start);
        model.loopBeat(beat.id);
      }
    }
  };
  const copyLink = (): string => {
    const beat = controller.currentBeat ?? film.beats[0];
    if (!beat) return 'Play the film first.';
    const hash = formatFilmLink({ film: film.id, version: film.version, beat: beat.id, word: Math.max(0, model.currentWordIndex) });
    window.location.hash = hash;
    try {
      // The hash is set either way; the clipboard is a courtesy.
      void navigator.clipboard?.writeText(window.location.href).catch(() => undefined);
    } catch {
      // No clipboard here at all.
    }
    return `Link to ${beat.id} copied.`;
  };

  let openAsk = (): void => undefined;
  const transport = buildTransport(player, model, film, mixer, () => openAsk(), { toggleLoop, copyLink }, playerStyle.show.playerFullscreen);
  // The player root goes fullscreen; figures mirror the same chrome-aware growth — trusted directly,
  // sandboxed through the bridge — with playback untouched, so exiting restores layout and position.
  bindPlayerFullscreen(player, transport.fullscreen, (on) => {
    for (const mounted of figures) mounted.renderer.setFullscreenMirror(on);
    for (const handle of session?.handles ?? []) handle.setFullscreen?.(on);
  });
  // Slot classes land on the built chrome too, so the fullscreen button styles like its siblings.
  applySlotClasses(player, playerStyle);
  // Switching versions re-resolves the position by beat id — the same beat
  // and word on the new version, never carried seconds — and plays it.
  const showFilm = (next: CompiledFilm): void => {
    film = next;
    controller.retime(film);
    model.retime(film);
    transport.setDuration(film.seconds);
    player.querySelector('.inc-timeline')?.remove();
    timeline = buildTimeline(player, model, film);
    versionUi.refresh();
    window.__playground!.film = film;
  };
  const switchVersion = (version: number): boolean => {
    const next = picker.switchTo(version);
    if (!next) return false;
    const beat = controller.currentBeat;
    const word = Math.max(0, model.currentWordIndex);
    showFilm(next);
    if (beat) {
      const moved = reanchorAskAnchor(film, { film: film.id, version: film.version, scene: beat.sceneId, beat: beat.id, wordIndex: word, controlValues: {}, readouts: [] });
      model.seek(moved ? moved.seconds : 0);
    }
    model.play();
    void runChecks();
    return true;
  };
  const versionUi = buildVersionPicker(player, () => picker.choices(), (version) => void switchVersion(version));
  const bookmarkUi = buildBookmarks(player, model);
  const transcript = buildTranscript(player, model);
  buildChapters(player, model);
  const deckUi = buildDeck(player, model);
  let timeline = buildTimeline(player, model, film);
  const inspector = buildInspector(player);
  const badges = buildBadges(player);
  buildNarration(player, {
    narrate: async (key, voice) => {
      const narrated = await narrateBeats(film.beats.map((beat) => ({ id: beat.id, text: beat.step.say })), {
        source: 'cartesia',
        ...(key ? { apiKey: key } : {}),
        ...(voice ? { voice } : {}),
      });
      if (!narrated) throw new Error('The dev server did not answer.');
      let next = film;
      for (const beat of narrated.beats) {
        if (beat.estimated || !beat.audioBase64 || !beat.audioHash) continue;
        next = attachAudio(next, beat.id, { seconds: beat.seconds, words: beat.starts });
        mixer.attach({ beatId: beat.id, hash: beat.audioHash, pcm: base64ToBytes(beat.audioBase64), sampleRate: beat.sampleRate, seconds: beat.seconds });
      }
      film = next;
      narrationSource = narrated.source;
      controller.retime(film);
      model.retime(film);
      transport.setDuration(film.seconds);
      player.querySelector('.inc-timeline')?.remove();
      timeline = buildTimeline(player, model, film);
      await runChecks();
      return narrated.beats.filter((beat) => !beat.estimated).length;
    },
  });

  // An explicit film edit, applied as version N+1: the patch applies
  // cleanly or not at all, the film checks re-run over the new narration and
  // timing (the scene is unchanged, so the validator and probe carry over),
  // the version persists to the service, and only a passing version plays.
  // Changes build on the tip: from an old version the picker switches first.
  const applyPatch = async (patch: FilmVersionPatch, options: { stored?: boolean } = {}): Promise<{ ok: true } | { ok: false; problems: readonly string[] }> => {
    if (patch.parent !== versionStore.latest || patch.version !== versionStore.latest + 1) {
      return { ok: false, problems: [`Version ${versionStore.latest} is the latest — switch to it first, then change the film.`] };
    }
    const applied = applyFilmPatch(film, patch, sources);
    if (!applied.ok) return applied;
    const next = applied.film;
    // Sandboxed films check without their scenes: mounting a stored scene
    // would run its script on the host. The geometry checks rode the
    // sandbox probe at mount instead.
    const filmJs = (): Record<string, string> => Object.fromEntries(fixture.scenes.map((candidate) => [candidate.id, candidate.js]));
    const report = session
      ? probeFilmStatic({ film: next, js: filmJs() })
      : await probeFilmAsync({ film: next, scenes: fixture.scenes.map((candidate) => ({ id: candidate.id, scene: compileTrusted(candidate.js), kits })) });
    if (!report.ok) {
      const first = report.failures[0];
      return { ok: false, problems: [`Version ${next.version} did not pass the film checks (${first?.check ?? 'checks'}), so the film stays on version ${film.version}.`] };
    }
    if (!options.stored) {
      // Persisted before it lands locally, so a conflict never forks the chain.
      try {
        const token = await devToken();
        const posted = await fetch(`/api/v1/films/${film.id}/versions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ patch, beats: film.beats.map((beat) => ({ beat: beat.id, scene: beat.sceneId })) }),
        });
        if (posted.status === 409) return { ok: false, problems: ['Another version landed first — reload to pick it up, then change the film.'] };
        // A service that does not keep films still leaves a playing version.
      } catch {
        // Local only: the film plays on without its stored versions.
      }
    }
    const appended = versionStore.putPatch(patch);
    if (!appended.ok) return appended;
    attachPatchAudio(patch, film, next, mixer);
    picker.switchTo(next.version);
    showFilm(versionStore.get(next.version) ?? next);
    badges.checks(report, report.failures);
    timeline.checks(report);
    return { ok: true };
  };

  // Private inserts: pinned by anchor, keyed by asker locally and on the
  // service, so one asker never lists another's. The asker id rides the dev
  // token; pins only, never scene state.
  const askerStore = new PrivateInsertStore(memoryLocalStorage());
  let askerId = 'playground-learner';
  // The Export section's insert selector, re-synced whenever inserts change; set once Export is built below.
  let syncExportInserts: (() => void) | null = null;
  void devToken()
    .then((token) => {
      askerId = token.split('.')[0] || 'playground-learner';
      return refreshInserts();
    })
    .catch(() => undefined);
  const sceneJsFor = (sceneId: string): string => fixture.scenes.find((candidate) => candidate.id === sceneId)?.js ?? scene.js;
  // Multi-scene Ask replays on the active scene's runtime; single-scene films
  // keep their one runtime. Getters keep later code unchanged. On the
  // sandboxed path the runtime is the stand-in, and applying carries its
  // state across the bridge, as the seek path does.
  const askFigure = multi
    ? {
        get runtime(): SceneRuntime {
          return runtimes[controller.sceneIndex] ?? runtimes[0]!;
        },
        get renderer(): { apply(update: RuntimeUpdate): void } {
          const at = controller.sceneIndex;
          if (mirror) return { apply: () => mirror.syncScene(at) };
          return figures[at]?.renderer ?? figures[0]!.renderer;
        },
      }
    : mirror
      ? { runtime: runtimes[0]!, renderer: { apply: () => mirror.syncScene(0) } }
      : figures[0]!;
  const askUi = buildAskSheet(player, {
    model,
    controller,
    film: () => film,
    figure: askFigure,
    sceneJsFor,
    reducedMotion,
    applyPatch,
    requestBeats: () => film.beats.map((beat) => ({ beat: beat.id, scene: beat.sceneId, say: beat.step.say })),
    keepInsert: (clip) => {
      const stored = {
        id: clip.id,
        anchor: { film: clip.anchor.film, version: clip.anchor.version, scene: clip.anchor.scene, beat: clip.anchor.beat, wordIndex: clip.anchor.wordIndex },
        lines: clip.lines.map((line) => ({ say: line.say, seconds: line.seconds, ...(line.set ? { set: { ...line.set } } : {}) })),
        askedAt: Date.now(),
      };
      askerStore.save(askerId, stored);
      insertsUi.refresh();
      syncExportInserts?.();
      // The service keeps the asker's own copy; a failure still leaves the local one.
      void (async () => {
        try {
          const token = await devToken();
          await fetch(`/api/v1/films/${film.id}/inserts`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify(stored),
          });
        } catch {
          // Local only.
        }
      })();
    },
  });
  openAsk = askUi.open;
  // Playing a saved insert switches to its version first, since pins are
  // beat ids on the version they were asked on.
  const playInsert = (id: string): string | null => {
    const record = askerStore.get(askerId, film.id, id);
    if (!record) return 'That insert is gone.';
    if (record.anchor.version !== film.version && !switchVersion(record.anchor.version)) {
      return `That insert was asked on version ${record.anchor.version}, which is gone.`;
    }
    const sceneIndex = multi ? Math.max(0, fixture.scenes.findIndex((candidate) => candidate.id === record.anchor.scene)) : 0;
    const params = new Set(Object.keys((runtimes[sceneIndex] ?? runtimes[0]!).values()));
    const validated = validateInsertClip({ anchor: record.anchor, lines: record.lines }, film, params);
    if (!validated.ok) return `That insert does not fit this film: ${validated.problems[0] ?? 'invalid'}.`;
    return askUi.playClip({ ...validated.clip, id: record.id });
  };
  // Promoting shares an insert as the next version. Author-only on the
  // service, where a missing insert and a forbidden one answer alike with
  // 404; the insert was just re-saved, so 404 means anyone-but-the-author,
  // and the page says so.
  const promoteInsert = async (id: string): Promise<string> => {
    const record = askerStore.get(askerId, film.id, id);
    if (!record) return 'That insert is gone.';
    const tip = versionStore.get(versionStore.latest) ?? film;
    const built = promoteInsertClip(tip, record, `Share the insert after ${record.anchor.beat}.`);
    if (!built.ok) return built.problems[0] ?? 'That insert does not fit this film.';
    try {
      const token = await devToken();
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
      // The promotion needs the service's copy; re-saving is idempotent.
      await fetch(`/api/v1/films/${tip.id}/inserts`, { method: 'POST', headers, body: JSON.stringify({ ...record, askedAt: record.askedAt }) }).catch(() => null);
      const posted = await fetch(`/api/v1/films/${tip.id}/promote`, { method: 'POST', headers, body: JSON.stringify({ insertId: id, patch: built.patch, beats: tip.beats.map((beat) => ({ beat: beat.id, scene: beat.sceneId })) }) });
      if (posted.status === 404) return 'Only the film\u2019s author can promote an insert.';
      if (!posted.ok) return 'The promotion did not land — try again.';
      const result = (await posted.json()) as { status?: string; patch?: FilmVersionPatch; version?: number };
      if (result.status !== 'promoted' || !result.patch) return 'The promotion did not land — try again.';
      const checked = sanitizeFilmPatch(result.patch);
      if (!checked.ok) return `The new version did not fit: ${checked.problems[0] ?? 'invalid'}.`;
      const applied = await applyPatch(checked.patch, { stored: true });
      if (!applied.ok) return applied.problems[0] ?? 'The new version did not fit.';
      insertsUi.refresh();
      return `Version ${result.version} is playing.`;
    } catch {
      return 'The promotion did not land — try again.';
    }
  };
  const insertsUi = buildInserts(player, {
    list: () => askerStore.list(askerId, film.id),
    play: playInsert,
    promote: promoteInsert,
  });
  const refreshInserts = async (): Promise<void> => {
    // The service's copies merge into the local list; failures leave it local-only.
    try {
      const token = await devToken();
      const listed = await fetch(`/api/v1/films/${film.id}/inserts`, { headers: { authorization: `Bearer ${token}` } });
      if (!listed.ok) return;
      const body = (await listed.json()) as { inserts?: Array<{ id: string; anchor: unknown; lines: unknown; askedAt: number }> };
      for (const entry of body.inserts ?? []) askerStore.save(askerId, entry);
      insertsUi.refresh();
      syncExportInserts?.();
    } catch {
      // Local only.
    }
  };
  // The export identity check keeps sampled frames from the last video
  // export (?export-debug=1) and compares them against live-rendered frames
  // at the same timestamps, in the page.
  const exportDebug: ExportVideoDebug = {
    last: null,
    compare: async (frame) => {
      const last = exportDebug.last;
      if (!last || last.plan.chunks.length !== 1) return null;
      const kept = last.kept.get(frame);
      if (!kept) return null;
      const chunk = last.plan.chunks[0]!;
      const fragments = fixture.scenes.find((candidate) => candidate.id === chunk.sceneId);
      if (!fragments) return null;
      if (session) {
        const snapshot = snapshotFor(chunk.sceneId);
        if (!snapshot) return null;
        const live = await renderSandboxedLivePixels(
          { document, fragments: { html: fragments.html, css: fragments.css, js: fragments.js }, snapshot, film: last.film, size: last.size },
          frame / last.fps,
        );
        return meanPixelDifference(kept, live);
      }
      const live = await renderLiveExportPixels(
        { document, fragments: { html: fragments.html, css: fragments.css, js: fragments.js }, kits, film: last.film, size: last.size },
        frame / last.fps,
      );
      return meanPixelDifference(kept, live);
    },
  };
  // The slide export keeps the last run's filenames, for the page's own
  // confirmation and the e2e suite: one still per beat, as a set.
  const slideDebug: { last: string[] | null } = { last: null };
  const exportUi = buildExport(
    player,
    {
      inserts: () => askerStore.list(askerId, film.id),
      film: () => film,
    },
    slideDebug,
    {
      pause: () => model.pause(),
      fragments: (sceneId) => {
        const found = fixture.scenes.find((candidate) => candidate.id === sceneId);
        return found ? { html: found.html, css: found.css, js: found.js } : null;
      },
      inputs: () =>
        session
          ? fixture.scenes.map((candidate) => ({ id: candidate.id, scene: buildStubScene(snapshotFor(candidate.id)!) }))
          : fixture.scenes.map((candidate) => ({ id: candidate.id, scene: compileTrusted(candidate.js), kits })),
      snapshots: session ? snapshotFor : undefined,
      kits: () => kits,
      clips: () => {
        const out: MixerClip[] = [];
        for (const beat of film.beats) {
          const clip = mixer.clipFor(beat.id);
          if (clip) out.push(clip);
        }
        return out;
      },
      stageSize: () => {
        if (session) {
          const sceneId = multi ? (film.scenes[controller.sceneIndex]?.id ?? fixture.scenes[0]!.id) : fixture.scenes[0]!.id;
          return snapshotFor(sceneId)?.stage ?? null;
        }
        const activeFigure = multi ? (figures[controller.sceneIndex] ?? figures[0]!) : figures[0]!;
        const stage = activeFigure.runtime.graph.stages[0];
        if (!stage) return null;
        const [, , width, height] = stage.viewBox;
        return { width, height };
      },
      debug: exportDebug,
      debugFrames: params.get('export-debug') === '1',
    },
  );
  syncExportInserts = exportUi.syncInserts;

  bindShortcuts({
    playPause: () => model.toggle(),
    back: () => model.seek(controller.time - 5),
    forward: () => model.seek(controller.time + 5),
    prevBeat: () => model.prevBeat(),
    nextBeat: () => model.nextBeat(),
    captions: () => model.setCaptions(!model.state.captionsOn),
    sound: () => transport.toggleSound(),
    ask: () => openAsk(),
    loop: () => toggleLoop(),
    bookmark: () => bookmarkUi.add(),
  });
  buildShortcutHelp(player);

  // The opening position: a deep link first, then resume, then — under
  // reduced motion — a still first beat with its caption.
  const resumeNotice = document.createElement('p');
  resumeNotice.className = 'inc-resume';
  resumeNotice.hidden = true;
  player.append(resumeNotice);
  let resumed = false;
  const linked = parseFilmLink(window.location.hash);
  const linkedSeconds = linked ? resolveFilmLink(film, linked) : null;
  if (linkedSeconds !== null) {
    model.seek(linkedSeconds);
  } else {
    const stored = resume.load(film.id);
    const at = stored ? resolveFilmPosition(film, stored) : null;
    if (at !== null && stored) {
      model.seek(at);
      resumed = true;
      resumeNotice.textContent = `Resumed where you left off: ${stored.beat}.`;
      resumeNotice.hidden = false;
    } else if (reducedMotion) {
      model.seek(0);
    }
  }

  let lastBeat: string | null = '__none__';
  let lastPlaying = false;
  let lastTime = -1;
  // Canvas measurement before the bundled fonts load mis-measures: captions
  // keep the stylesheet size until fonts arrive, then solve once.
  let fontsLoaded = false;
  void fontsReady().then(() => {
    fontsLoaded = true;
    lastBeat = '__none__';
  });
  // Karaoke captions: one span per word, the sounding one highlighted.
  let wordSpans: HTMLElement[] = [];
  const highlightWord = (index: number): void => {
    wordSpans.forEach((span, i) => span.classList.toggle('is-active', i === index));
  };
  const applyCaption = (state: PlayerState): void => {
    // An insert captions its own line over the paused film.
    const insertText = askUi.caption();
    if (insertText !== null) {
      card.hidden = true;
      caption.textContent = insertText;
      wordSpans = [];
      return;
    }
    const beat = film.beats.find((candidate) => candidate.id === state.beat);
    const marks = beat?.step.mark ?? [];
    player.dataset.mark = marks.some((mark) => mark.type === 'pulse') ? 'pulse' : '';
    const title = state.caption?.title;
    if (title?.kind === 'card') {
      card.textContent = title.text;
      card.hidden = false;
    } else card.hidden = true;
    caption.textContent = '';
    wordSpans = [];
    const say = state.caption?.say ?? '';
    if (say !== '') {
      if (title?.kind === 'lower') caption.append(document.createTextNode(`${title.text} — `));
      for (const word of state.caption?.words ?? []) {
        const span = document.createElement('span');
        span.className = 'inc-caption-word';
        span.textContent = word;
        caption.append(span, ' ');
        wordSpans.push(span);
      }
      highlightWord(model.currentWordIndex);
    }
    if (fontsLoaded) {
      const widthPx = Math.max(280, Math.min(960, player.clientWidth || 640));
      const captionLayout = solveCaption(say, { widthPx, stageHeightPx: widthPx * 0.5 });
      caption.style.fontSize = `${Math.round(captionLayout.fontPx * CAPTION_SCALES[state.captionSize])}px`;
    }
  };
  // Caption and size toggles apply at once, not on the next beat change.
  model.on((event) => {
    if (event.type === 'chrome') applyCaption(model.state);
  });
  let lastFrame = performance.now();
  let lastInsertCaption = '';
  let lastSaved = 0;
  const sync = (): void => {
    const frameNow = performance.now();
    const dt = Math.min(0.25, Math.max(0, (frameNow - lastFrame) / 1000));
    askUi.tick(dt);
    lastFrame = frameNow;
    // Sandboxed films tick their stand-ins here; trusted films poll while their renderer ticks.
    if (session) controller.tick(dt);
    else controller.poll();
    model.applyLoop();
    // Resume autosaves while playing, at most every five seconds.
    if (controller.isPlaying && frameNow - lastSaved > 5000) {
      lastSaved = frameNow;
      saveResume();
    }
    const state = model.state;
    const insertText = askUi.caption() ?? '';
    if (insertText !== lastInsertCaption) {
      lastInsertCaption = insertText;
      applyCaption(state);
    }
    if (state.beat !== lastBeat || state.playing !== lastPlaying) {
      applyCaption(state);
      transcript.sync(state.beat);
      timeline.sync(state.beat, state.time, film.seconds);
      inspector.show(model.selectedBeat, film);
      transport.syncTime(state.time, state.playing);
      deckUi.sync();
      lastBeat = state.beat;
      lastPlaying = state.playing;
    }
    if (Math.abs(state.time - lastTime) > 0.05) {
      transport.syncTime(state.time, state.playing);
      timeline.playhead(state.time, film.seconds);
      highlightWord(model.currentWordIndex);
      // Past the line's end (the beat holds after it), the bed comes back up.
      const beat = state.beat ? film.beats.find((candidate) => candidate.id === state.beat) : undefined;
      if (beat && state.time > beat.start + beat.seconds - FILM_BEAT_HOLD_SECONDS) mixer.onLineEnd();
      lastTime = state.time;
    }
    requestAnimationFrame(sync);
  };
  requestAnimationFrame(sync);

  const cuts: Array<{ from: string; to: string }> = [];
  controller.on((event) => {
    if (event.type === 'cut') cuts.push({ from: event.from, to: event.to });
  });
  window.__playground = {
    ready: true,
    page: 'player',
    figure: session ? { root: boxes[0]!, runtime: runtimes[0]!, handle: session.handles[0]! } : figures[0]!,
    figures: session ? session.handles.map((handle, index) => ({ root: boxes[index]!, runtime: runtimes[index]!, handle })) : figures,
    controller,
    model,
    film,
    mixer,
    scenes: () => ({ count: film.scenes.length, multi: controller.multiScene, active: controller.sceneIndex, cuts: [...cuts], chapters: model.chapters().map((chapter) => chapter.scene) }),
    ask: () => askUi.state(),
    full: () => ({
      version: film.version,
      history: versionStore.list().map((card) => card.summary),
      loop: model.loopedBeat,
      bookmarks: model.bookmarks.map((bookmark) => ({ id: bookmark.id, beat: bookmark.beat, word: bookmark.wordIndex })),
      resumed,
      hash: window.location.hash,
      reducedMotion,
    }),
    versions: () => ({
      current: film.version,
      list: versionStore.list().map((card) => ({ version: card.version, summary: card.summary, reason: card.reason, beats: [...card.beats] })),
      inserts: askerStore.list(askerId, film.id).map((entry) => ({ id: entry.id, beat: entry.anchor.beat, version: entry.anchor.version, lines: entry.lines.length })),
      flatten: {
        film: flattenFilm(film).beats.length,
        filmPlus: flattenFilm(film, askerStore.list(askerId, film.id).map((entry) => ({ id: entry.id, anchor: entry.anchor, lines: entry.lines, seconds: entry.seconds }))).beats.length,
        transcript: flattenTranscript(flattenFilm(film)).length,
      },
    }),
    narration: () => ({ source: narrationSource, timed: film.beats.filter((beat) => beat.timed).length, beats: film.beats.length }),
    mixerEvents: () => [...mixBackend.events],
    stats: () => ({ time: controller.time, beat: controller.currentBeat?.id ?? null, playing: controller.isPlaying, controller: { ...controller.stats } }),
    exportLast: () => {
      const last = exportDebug.last;
      if (!last) return null;
      return { url: last.url, width: last.width, height: last.height, fps: last.fps, frames: last.frames, seconds: last.seconds, codec: last.codec, hasAudio: last.hasAudio, fallback: last.fallback, speed: last.speed };
    },
    exportCompare: (frame: number) => exportDebug.compare(frame),
    deck: () => {
      const at = model.beatPosition();
      return { advance: model.advance, beat: controller.currentBeat?.id ?? null, playing: controller.isPlaying, index: at?.index ?? null, total: at?.total ?? film.beats.length };
    },
    slideLast: () => (slideDebug.last ? [...slideDebug.last] : null),
  };

  const runChecks = async (): Promise<void> => {
    if (session) {
      const report = probeFilmStatic({ film, js: Object.fromEntries(fixture.scenes.map((candidate) => [candidate.id, candidate.js])) });
      badges.checks(report, report.failures);
      timeline.checks(report);
      return;
    }
    const report = await probeFilmAsync({ film, scenes: fixture.scenes.map((candidate) => ({ id: candidate.id, scene: compileTrusted(candidate.js), kits })), onProgress: (beat, beats) => badges.progress(beat, beats) });
    badges.checks(report, report.failures);
    timeline.checks(report);
  };

  // Thumbnails, the probe and the film checks run after the first paint, so the film is playable at once.
  const fragmentsFor = (sceneId: string): { html: string; css: string; js: string } => {
    const found = fixture.scenes.find((candidate) => candidate.id === sceneId);
    return found ? { html: found.html, css: found.css, js: found.js } : { html: scene.html, css: scene.css, js: scene.js };
  };
  setTimeout(() => void (session ? buildSandboxedThumbs(transport.thumbs, model, film, fragmentsFor, snapshotFor) : buildThumbs(transport.thumbs, model, film, fragmentsFor, kits, isolated)), 50);
  setTimeout(() => {
    void (async () => {
      if (session) {
        // The mount already probed every scene in the sandbox; the badges show that report.
        badges.probe(combineProbes(session.probes));
        await runChecks();
        return;
      }
      // The probe measures captions on a canvas; wait for the fonts it measures in.
      await fontsReady();
      const probes = fixture.scenes.map((candidate) => probeScene(compileTrusted(candidate.js), { spec: { parts: [...candidate.probe.parts], steps: candidate.probe.steps }, runtime: { kits } }));
      const probe = probes.length === 1 ? probes[0]! : combineProbes(probes);
      badges.probe(probe);
      await runChecks();
    })();
  }, 100);
}

interface NarratedLine {
  readonly id: string;
  readonly seconds: number;
  readonly starts: readonly number[];
  readonly audioHash: string | null;
  readonly audioBase64: string | null;
  readonly sampleRate: number;
  readonly estimated: boolean;
  readonly error?: string;
}

interface NarratedBeats {
  readonly source: string;
  readonly beats: readonly NarratedLine[];
}

/** Narrates beats through the dev server, with the stub or with Cartesia. Null when the server does not answer. */
async function narrateBeats(beats: ReadonlyArray<{ id: string; text: string }>, options: { source: 'stub' | 'cartesia'; apiKey?: string; voice?: string }): Promise<NarratedBeats | null> {
  const answer = await fetch('/api/dev/narrate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ beats, source: options.source, ...(options.apiKey ? { apiKey: options.apiKey } : {}), ...(options.voice ? { voice: options.voice } : {}) }),
  });
  if (!answer.ok) return null;
  const result = (await answer.json()) as { ok?: boolean; source?: string; beats?: NarratedLine[] };
  if (!result.ok || !result.source || !result.beats) return null;
  return { source: result.source, beats: result.beats };
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * The narration settings: an optional Cartesia key and voice, following the
 * model-key pattern exactly — sent to the dev server only, memory-only on
 * both ends, never saved; empty means the server's CARTESIA_API_KEY and
 * CARTESIA_VOICE_ID. The connection line shows the key and voice sources at
 * a glance, without pressing Test connection.
 */
function buildNarration(player: HTMLElement, actions: { narrate(key: string | null, voice: string | null): Promise<number> }): void {
  const wrap = document.createElement('details');
  wrap.className = 'inc-narration';
  const summary = document.createElement('summary');
  summary.textContent = 'Narration';
  const keyLabel = document.createElement('label');
  keyLabel.textContent = 'Cartesia key';
  const key = document.createElement('input');
  key.type = 'password';
  key.className = 'inc-narration-key';
  key.placeholder = 'Paste key, or leave empty for the dev server’s key';
  key.setAttribute('autocomplete', 'off');
  key.setAttribute('spellcheck', 'false');
  const voiceLabel = document.createElement('label');
  voiceLabel.textContent = 'Cartesia voice id';
  const voice = document.createElement('input');
  voice.type = 'text';
  voice.className = 'inc-narration-voice';
  voice.placeholder = 'Paste voice id, or leave empty for the dev server’s voice';
  voice.setAttribute('autocomplete', 'off');
  voice.setAttribute('spellcheck', 'false');
  const hint = document.createElement('p');
  hint.className = 'inc-narration-hint';
  hint.textContent = 'The key goes to the dev server only, is kept in memory on both ends, and is never saved. Leave both fields empty to use the dev server’s key and voice; without them the film stays on the stub’s silent timing.';
  const connection = document.createElement('p');
  connection.className = 'inc-narration-connection';
  connection.textContent = 'Cartesia: checking the dev server…';
  const renderConnection = (result: { source?: string; voiceSource?: string; voiceTail?: string | null; connected?: boolean }): void => {
    const keySource = result.source ?? 'unknown';
    const voiceSource = result.voiceSource ?? 'unknown';
    const tail = typeof result.voiceTail === 'string' && result.voiceTail !== '' ? `, voice …${result.voiceTail}` : '';
    const ready = result.connected ?? (keySource !== 'none' && voiceSource !== 'none');
    connection.textContent = `Cartesia ${ready ? 'connected' : 'not connected'} (key source: ${keySource}, voice source: ${voiceSource}${tail})`;
  };
  const readConnection = async (
    enteredKey: string,
    enteredVoice: string,
  ): Promise<{ ok?: boolean; message?: string; source?: string; voiceSource?: string; voiceTail?: string | null; connected?: boolean }> => {
    const answer = await fetch('/api/dev/narration-key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...(enteredKey ? { apiKey: enteredKey } : {}), ...(enteredVoice ? { voice: enteredVoice } : {}) }),
    });
    return (await answer.json()) as { ok?: boolean; message?: string; source?: string; voiceSource?: string; voiceTail?: string | null; connected?: boolean };
  };
  // The env state, before anything is pressed: sources and the voice tail render even when the check itself fails.
  void readConnection('', '')
    .then(renderConnection)
    .catch(() => {
      connection.textContent = 'Cartesia: the dev server did not answer.';
    });
  const test = document.createElement('button');
  test.type = 'button';
  test.textContent = 'Test connection';
  const testStatus = document.createElement('p');
  testStatus.className = 'inc-narration-status';
  testStatus.hidden = true;
  test.addEventListener('click', async () => {
    test.disabled = true;
    testStatus.hidden = false;
    testStatus.textContent = 'Checking with Cartesia…';
    try {
      const answer = await readConnection(key.value.trim(), voice.value.trim());
      testStatus.textContent = `${answer.ok ? '✓' : '✗'} ${answer.message ?? 'The check gave no message.'} (key source: ${answer.source ?? 'unknown'})`;
      renderConnection(answer);
    } catch (error) {
      testStatus.textContent = `✗ The check itself failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      test.disabled = false;
    }
  });
  const narrate = document.createElement('button');
  narrate.type = 'button';
  narrate.textContent = 'Narrate with Cartesia';
  const narrateStatus = document.createElement('p');
  narrateStatus.className = 'inc-narration-status';
  narrateStatus.hidden = true;
  narrate.addEventListener('click', async () => {
    narrate.disabled = true;
    narrateStatus.hidden = false;
    narrateStatus.textContent = 'Narrating with Cartesia…';
    try {
      const entered = key.value.trim();
      const voiceId = voice.value.trim();
      const count = await actions.narrate(entered === '' ? null : entered, voiceId === '' ? null : voiceId);
      narrateStatus.textContent = `✓ ${count} beats carry Cartesia audio.`;
    } catch (error) {
      narrateStatus.textContent = `✗ ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      narrate.disabled = false;
    }
  });
  keyLabel.append(key);
  voiceLabel.append(voice);
  wrap.append(summary, hint, connection, keyLabel, voiceLabel, test, testStatus, narrate, narrateStatus);
  player.append(wrap);
}

function formatTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const minutes = Math.floor(total / 60);
  const rest = total - minutes * 60;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

/**
 * Deck mode: the toggle, click-advance controls, and the current-beat
 * indicator. FigureStyle-slotted through the `deck` show flag, like the
 * other chrome. Narration stays on the transport's Sound toggle: a deck
 * plays with it on or off, and speech never advances a click beat.
 */
function buildDeck(player: HTMLElement, model: PlayerModel): { sync(): void } {
  const wrap = document.createElement('div');
  wrap.className = 'inc-deck';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'inc-deck-toggle';
  toggle.setAttribute('aria-label', 'Deck mode');
  toggle.addEventListener('click', () => model.setAdvance(model.advance === 'click' ? 'time' : 'click'));
  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'inc-deck-prev';
  prev.textContent = '‹ Prev';
  prev.setAttribute('aria-label', 'Previous beat');
  prev.addEventListener('click', () => model.prevBeat());
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'inc-deck-next';
  next.textContent = 'Next ›';
  next.setAttribute('aria-label', 'Next beat');
  next.addEventListener('click', () => model.nextBeat());
  const position = document.createElement('span');
  position.className = 'inc-deck-position';
  position.setAttribute('role', 'status');
  const hint = document.createElement('p');
  hint.className = 'inc-deck-hint';
  hint.textContent = 'Deck: beats hold until you click Next (or press , and .). Sound toggles narration; Ask and Show me work the same.';
  const sync = (): void => {
    const deck = model.advance === 'click';
    toggle.textContent = deck ? 'Deck: on' : 'Deck: off';
    toggle.setAttribute('aria-pressed', deck ? 'true' : 'false');
    const at = model.beatPosition();
    position.textContent = at ? `${deck ? 'Slide' : 'Beat'} ${at.index + 1} of ${at.total}` : '—';
  };
  model.on((event) => {
    if (event.type === 'chrome') sync();
  });
  wrap.append(toggle, prev, position, next, hint);
  player.append(wrap);
  sync();
  return { sync };
}

function buildTransport(
  player: HTMLElement,
  model: PlayerModel,
  film: CompiledFilm,
  mixer: FilmMixer,
  onAsk: () => void,
  extra: { toggleLoop(): void; copyLink(): string },
  showFullscreen = true,
): {
  syncTime(time: number, playing: boolean): void;
  setDuration(seconds: number): void;
  toggleSound(): void;
  thumbs: HTMLElement;
  fullscreen: HTMLButtonElement;
} {
  const bar = document.createElement('div');
  bar.className = 'inc-transport inc-player-transport';
  const play = document.createElement('button');
  play.type = 'button';
  play.textContent = 'Play';
  play.addEventListener('click', () => model.toggle());
  const ask = document.createElement('button');
  ask.type = 'button';
  ask.className = 'inc-player-ask';
  ask.textContent = 'Ask';
  ask.setAttribute('aria-label', 'Ask about this moment');
  ask.addEventListener('click', onAsk);
  const time = document.createElement('span');
  time.className = 'inc-player-time';
  const scrubWrap = document.createElement('div');
  scrubWrap.className = 'inc-scrub-wrap';
  const scrub = document.createElement('input');
  scrub.type = 'range';
  scrub.min = '0';
  scrub.max = film.seconds.toFixed(2);
  scrub.step = (1 / 60).toFixed(4);
  scrub.value = '0';
  scrub.setAttribute('aria-label', 'Seek');
  scrub.addEventListener('input', () => model.seek(Number(scrub.value)));
  const scrubMarkers = document.createElement('div');
  scrubMarkers.className = 'inc-scrub-markers';
  scrubWrap.append(scrub, scrubMarkers);
  const renderMarkers = (): void => {
    scrubMarkers.textContent = '';
    const duration = Number(scrub.max);
    if (!(duration > 0)) return;
    for (const at of model.markerTimes()) {
      const dot = document.createElement('span');
      dot.className = 'inc-marker';
      dot.style.left = `${Math.min(100, Math.max(0, (at / duration) * 100))}%`;
      dot.title = 'Question asked here';
      scrubMarkers.append(dot);
    }
  };
  model.on((event) => {
    if (event.type === 'chrome') renderMarkers();
  });
  const speed = document.createElement('select');
  speed.setAttribute('aria-label', 'Speed');
  for (const value of [0.25, 0.5, 1, 2, 4]) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = `${value}×`;
    if (value === 1) option.selected = true;
    speed.append(option);
  }
  speed.addEventListener('change', () => model.setSpeed(Number(speed.value)));
  const volume = document.createElement('input');
  volume.type = 'range';
  volume.min = '0';
  volume.max = '1';
  volume.step = '0.05';
  volume.value = '0.5';
  volume.setAttribute('aria-label', 'Volume');
  volume.addEventListener('input', () => {
    model.setVolume(Number(volume.value));
    mixer.setVolume(Number(volume.value));
  });
  const sound = document.createElement('button');
  sound.type = 'button';
  sound.textContent = 'Sound: off';
  sound.setAttribute('aria-label', 'Sound');
  sound.addEventListener('click', () => {
    mixer.setEnabled(!mixer.isOn);
    sound.textContent = mixer.isOn ? 'Sound: on' : 'Sound: off';
    if (mixer.isOn && model.state.playing && model.state.beat) mixer.onBeat(model.state.beat, Math.max(0, model.state.time - (model.state.caption?.start ?? 0)));
  });
  const captions = document.createElement('label');
  const captionsBox = document.createElement('input');
  captionsBox.type = 'checkbox';
  captionsBox.checked = true;
  captionsBox.addEventListener('change', () => model.setCaptions(captionsBox.checked));
  captions.append(captionsBox, ' Captions');
  const size = document.createElement('select');
  size.setAttribute('aria-label', 'Caption size');
  for (const value of ['sm', 'md', 'lg'] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    if (value === 'md') option.selected = true;
    size.append(option);
  }
  size.addEventListener('change', () => model.setCaptionSize(size.value as 'sm' | 'md' | 'lg'));
  const loop = document.createElement('button');
  loop.type = 'button';
  loop.className = 'inc-player-loop';
  loop.textContent = 'Loop: off';
  loop.setAttribute('aria-label', 'Loop the beat');
  loop.addEventListener('click', () => extra.toggleLoop());
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'inc-player-link';
  link.textContent = 'Copy link';
  link.setAttribute('aria-label', 'Copy a link to this moment');
  const linkNote = document.createElement('span');
  linkNote.className = 'inc-player-link-note';
  link.addEventListener('click', () => {
    linkNote.textContent = extra.copyLink();
  });
  model.on((event) => {
    if (event.type !== 'chrome') return;
    const looped = model.loopedBeat;
    loop.textContent = looped ? `Loop: ${looped}` : 'Loop: off';
    loop.setAttribute('aria-pressed', looped ? 'true' : 'false');
  });
  const thumbs = document.createElement('div');
  thumbs.className = 'inc-player-thumbs';
  const fullscreen = document.createElement('button');
  fullscreen.type = 'button';
  fullscreen.className = 'inc-player-fullscreen';
  fullscreen.textContent = '⛶';
  fullscreen.setAttribute('aria-label', 'Full screen');
  fullscreen.setAttribute('aria-pressed', 'false');
  fullscreen.title = 'Full screen';
  refreshPlayerFullscreenVisibility(fullscreen, showFullscreen);
  bar.append(play, ask, time, scrubWrap, speed, volume, sound, captions, size, loop, link, linkNote, fullscreen);
  player.append(bar, thumbs);
  return {
    thumbs,
    fullscreen,
    toggleSound(): void {
      sound.click();
    },
    syncTime(current: number, playing: boolean): void {
      play.textContent = playing ? 'Pause' : 'Play';
      time.textContent = `${formatTime(current)} / ${formatTime(scrub.max === '' ? film.seconds : Number(scrub.max))}`;
      if (document.activeElement !== scrub) scrub.value = current.toFixed(2);
    },
    setDuration(seconds: number): void {
      scrub.max = seconds.toFixed(2);
      renderMarkers();
    },
  };
}

/** The version badge and picker: which version plays, how it came to be, and the choice of any version. */
function buildVersionPicker(player: HTMLElement, choices: () => ReadonlyArray<{ version: number; summary: string; reason: string; current: boolean }>, onSwitch: (version: number) => void): { refresh(): void } {
  const wrap = document.createElement('div');
  wrap.className = 'inc-version-wrap';
  const badge = document.createElement('p');
  badge.className = 'inc-version';
  const label = document.createElement('label');
  label.className = 'inc-version-label';
  label.textContent = 'Version ';
  const select = document.createElement('select');
  select.className = 'inc-version-picker';
  select.setAttribute('aria-label', 'Version');
  select.addEventListener('change', () => onSwitch(Number(select.value)));
  label.append(select);
  const refresh = (): void => {
    const options = choices();
    const at = options.find((choice) => choice.current) ?? options[options.length - 1];
    badge.textContent = `Version ${at?.version ?? 1} · ${options.map((choice) => choice.summary).join(' → ')}`;
    select.textContent = '';
    for (const choice of options) {
      const option = document.createElement('option');
      option.value = String(choice.version);
      option.textContent = choice.version === options[0]!.version ? `v${choice.version} · base` : `${choice.summary} — ${choice.reason}`;
      if (choice.current) option.selected = true;
      select.append(option);
    }
  };
  refresh();
  wrap.append(badge, label);
  player.append(wrap);
  return { refresh };
}

/** The asker's own inserts: what was asked where, replayable and promotable. */
function buildInserts(
  player: HTMLElement,
  actions: { list(): readonly StoredInsert[]; play(id: string): string | null; promote(id: string): Promise<string> },
): { refresh(): void } {
  const wrap = document.createElement('details');
  wrap.className = 'inc-inserts';
  const summary = document.createElement('summary');
  summary.textContent = 'My inserts';
  const list = document.createElement('ul');
  const status = document.createElement('p');
  status.className = 'inc-inserts-status';
  status.hidden = true;
  const refresh = (): void => {
    list.textContent = '';
    const entries = actions.list();
    if (entries.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'inc-inserts-empty';
      empty.textContent = 'No inserts yet — ask for an explanation to keep one.';
      list.append(empty);
      return;
    }
    for (const entry of entries) {
      const item = document.createElement('li');
      item.dataset.insert = entry.id;
      const text = document.createElement('span');
      const first = entry.lines[0]?.say ?? '';
      text.textContent = `${entry.anchor.beat} (v${entry.anchor.version}) · “${first.length > 60 ? `${first.slice(0, 60)}…` : first}”`;
      const play = document.createElement('button');
      play.type = 'button';
      play.textContent = 'Play';
      play.setAttribute('aria-label', `Play insert at ${entry.anchor.beat}`);
      play.addEventListener('click', () => {
        const problem = actions.play(entry.id);
        status.hidden = problem === null;
        if (problem) status.textContent = problem;
      });
      const promote = document.createElement('button');
      promote.type = 'button';
      promote.className = 'inc-insert-promote';
      promote.textContent = 'Promote';
      promote.setAttribute('aria-label', `Promote the insert at ${entry.anchor.beat} to a shared version`);
      promote.addEventListener('click', () => {
        promote.disabled = true;
        status.hidden = false;
        status.textContent = 'Promoting…';
        void actions.promote(entry.id).then((message) => {
          status.textContent = message;
          promote.disabled = false;
        });
      });
      item.append(text, ' ', play, ' ', promote);
      list.append(item);
    }
  };
  refresh();
  wrap.append(summary, list, status);
  player.append(wrap);
  return { refresh };
}

/** What the export identity check keeps from the last video export (?export-debug=1): sampled frames and their plan. */
interface ExportVideoDebug {
  last: {
    readonly url: string;
    readonly width: number;
    readonly height: number;
    readonly fps: number;
    readonly frames: number;
    readonly seconds: number;
    readonly codec: string;
    readonly hasAudio: boolean;
    readonly fallback: boolean;
    readonly speed: number;
    readonly kept: ReadonlyMap<number, ImageData>;
    readonly size: ExportFrameSize;
    readonly plan: ExportPlan;
    readonly film: CompiledFilm;
  } | null;
  compare(frame: number): Promise<number | null>;
}

interface ExportVideoSources {
  pause(): void;
  fragments(sceneId: string): { html: string; css: string; js: string } | null;
  inputs(): ReadonlyArray<{ readonly id: string; readonly scene: SceneFunction; readonly kits?: KitRegistry }>;
  /** Checked snapshots for generated films: present exactly when the scenes must not run on the host. */
  readonly snapshots?: (sceneId: string) => SanitizedSceneSnapshot | null;
  kits(): KitRegistry;
  clips(): MixerClip[];
  stageSize(): { width: number; height: number } | null;
  readonly debug: ExportVideoDebug;
  readonly debugFrames: boolean;
}

/** Export: flattened timelines and transcripts as data, the film as offline MP4 video, and a deck as slide stills. */
function buildExport(
  player: HTMLElement,
  sources: { film(): CompiledFilm; inserts(): readonly StoredInsert[] },
  slides: { last: string[] | null },
  video: ExportVideoSources,
): { syncInserts(): void } {
  const wrap = document.createElement('details');
  wrap.className = 'inc-export';
  const summary = document.createElement('summary');
  summary.textContent = 'Export';
  const hint = document.createElement('p');
  hint.className = 'inc-export-hint';
  hint.textContent = 'Timelines and transcripts as data; the film itself as MP4, rendered offline on the fixed film clock.';
  const clipOf = (entry: StoredInsert): InsertClip => ({ id: entry.id, anchor: entry.anchor, lines: entry.lines, seconds: entry.seconds });
  const filmButton = document.createElement('button');
  filmButton.type = 'button';
  filmButton.className = 'inc-export-film';
  filmButton.textContent = 'Film (JSON)';
  filmButton.addEventListener('click', () => {
    const film = sources.film();
    downloadFile(`${sanitizeExportFilenameSegment(film.id)}-v${film.version}.json`, JSON.stringify(flattenFilm(film), null, 2), 'application/json');
  });
  const plusButton = document.createElement('button');
  plusButton.type = 'button';
  plusButton.className = 'inc-export-plus';
  plusButton.textContent = 'Film + my inserts (JSON)';
  plusButton.addEventListener('click', () => {
    const film = sources.film();
    const clips = sources.inserts().map(clipOf);
    downloadFile(`${sanitizeExportFilenameSegment(film.id)}-v${film.version}-with-inserts.json`, JSON.stringify(flattenFilm(film, clips), null, 2), 'application/json');
  });
  const oneButton = document.createElement('button');
  oneButton.type = 'button';
  oneButton.className = 'inc-export-insert';
  oneButton.textContent = 'Insert (JSON)';
  const select = document.createElement('select');
  select.className = 'inc-export-select';
  select.setAttribute('aria-label', 'Insert to export');
  const syncOptions = (): void => {
    select.textContent = '';
    for (const entry of sources.inserts()) {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = `${entry.anchor.beat} · ${entry.lines.length} lines`;
      select.append(option);
    }
    oneButton.disabled = sources.inserts().length === 0;
  };
  wrap.addEventListener('toggle', () => {
    if (wrap.open) syncOptions();
  });
  syncOptions();
  oneButton.addEventListener('click', () => {
    const entry = sources.inserts().find((candidate) => candidate.id === select.value);
    if (!entry) return;
    downloadFile(`${sanitizeExportFilenameSegment(entry.id)}.json`, JSON.stringify(flattenInsert(sources.film(), clipOf(entry)), null, 2), 'application/json');
  });
  const transcriptButton = document.createElement('button');
  transcriptButton.type = 'button';
  transcriptButton.className = 'inc-export-transcript';
  transcriptButton.textContent = 'Transcript (text)';
  transcriptButton.addEventListener('click', () => {
    const film = sources.film();
    downloadFile(`${sanitizeExportFilenameSegment(film.id)}-v${film.version}-transcript.txt`, `${flattenTranscript(flattenFilm(film)).join('\n')}\n`, 'text/plain');
  });
  const row = document.createElement('div');
  row.className = 'inc-ask-row';
  row.append(filmButton, plusButton, transcriptButton);
  const insertRow = document.createElement('div');
  insertRow.className = 'inc-ask-row';
  insertRow.append(select, oneButton);
  wrap.append(summary, hint, row, insertRow);
  buildExportVideo(wrap, sources, select, video);
  buildExportSlides(wrap, sources, select, video, slides);
  player.append(wrap);
  // Inserts created while Export is open re-sync the selector at once, instead
  // of waiting for the next section toggle.
  return { syncInserts: syncOptions };
}

const EXPORT_VIDEO_CODEC_NAMES: Readonly<Record<string, string>> = { avc: 'H.264', vp09: 'VP9', vp08: 'VP8' };

/**
 * The film as video: the slice-6 selection (film, film plus inserts, one
 * insert) rendered offline to MP4 at the chosen height, with progress,
 * cancellation and a download. Where WebCodecs is missing the same timeline
 * records in realtime through MediaRecorder instead, labelled fallback.
 * Single inserts reuse the insert picked above.
 */
function buildExportVideo(
  wrap: HTMLElement,
  sources: { film(): CompiledFilm; inserts(): readonly StoredInsert[] },
  insertSelect: HTMLSelectElement,
  video: ExportVideoSources,
): void {
  const doc = wrap.ownerDocument;
  const title = doc.createElement('h4');
  title.className = 'inc-export-video-title';
  title.textContent = 'Video';
  const hint = doc.createElement('p');
  hint.className = 'inc-export-hint';
  hint.textContent = 'Offline MP4 on the fixed film clock, with narration where the beats have it.';
  const selection = doc.createElement('select');
  selection.className = 'inc-export-video-selection';
  selection.setAttribute('aria-label', 'What to export');
  for (const [value, text] of [
    ['film', 'Film'],
    ['plus', 'Film + my inserts'],
    ['insert', 'Single insert'],
  ] as const) {
    const option = doc.createElement('option');
    option.value = value;
    option.textContent = text;
    selection.append(option);
  }
  const resolution = doc.createElement('select');
  resolution.className = 'inc-export-video-resolution';
  resolution.setAttribute('aria-label', 'Export height');
  for (const height of [480, 720, 1080]) {
    const option = doc.createElement('option');
    option.value = String(height);
    option.textContent = `${height}p`;
    if (height === 720) option.selected = true;
    resolution.append(option);
  }
  const go = doc.createElement('button');
  go.type = 'button';
  go.className = 'inc-export-video-go';
  go.textContent = 'Export MP4';
  const cancelButton = doc.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'inc-export-video-cancel';
  cancelButton.textContent = 'Cancel';
  cancelButton.hidden = true;
  const progress = doc.createElement('progress');
  progress.className = 'inc-export-video-progress';
  progress.max = 100;
  progress.value = 0;
  progress.hidden = true;
  const status = doc.createElement('p');
  status.className = 'inc-export-video-status';
  status.setAttribute('role', 'status');
  const download = doc.createElement('a');
  download.className = 'inc-export-video-download';
  download.textContent = 'Download the video';
  download.hidden = true;
  const controls = doc.createElement('div');
  controls.className = 'inc-ask-row';
  controls.append(selection, resolution, go, cancelButton);
  wrap.append(title, hint, controls, progress, status, download);

  let running = false;
  let cancel: ExportCancellation | null = null;
  cancelButton.addEventListener('click', () => cancel?.cancel());

  const clipOf = (entry: StoredInsert): InsertClip => ({ id: entry.id, anchor: entry.anchor, lines: entry.lines, seconds: entry.seconds });

  go.addEventListener('click', () => {
    if (running) return;
    void run();
  });

  async function run(): Promise<void> {
    const film = sources.film();
    let timeline: FlattenedTimeline;
    let insertId: string | null;
    if (selection.value === 'insert') {
      const entry = sources.inserts().find((candidate) => candidate.id === insertSelect.value);
      if (!entry) {
        status.textContent = 'Pick one of your inserts above first.';
        return;
      }
      timeline = flattenInsert(film, clipOf(entry));
      insertId = entry.id;
    } else if (selection.value === 'plus') {
      timeline = flattenFilm(film, sources.inserts().map(clipOf));
      insertId = 'with-inserts';
    } else {
      timeline = flattenFilm(film);
      insertId = null;
    }
    const stage = video.stageSize();
    if (!stage) {
      status.textContent = 'The figure draws no stage to export.';
      return;
    }
    let size: ExportFrameSize;
    try {
      size = exportFrameSize(stage.width, stage.height, Number(resolution.value));
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'The export size is out of range.';
      return;
    }
    const planned = planExportFilm(film, timeline, video.inputs(), {});
    if (!planned.ok) {
      status.textContent = planned.problems.join('; ');
      return;
    }
    const plan = planned.plan;
    running = true;
    go.disabled = true;
    cancelButton.hidden = false;
    progress.hidden = false;
    progress.value = 0;
    download.hidden = true;
    video.pause();
    try {
      await fontsReady();
    } catch {
      // Measuring falls back deterministically without loaded fonts.
    }
    const started = performance.now();
    cancel = new ExportCancellation();
    const support = await probeExportCodecs(size.frameWidth, size.frameHeight, EXPORT_FPS_DEFAULT);
    const showProgress = (frame: number, frames: number, extra: string): void => {
      progress.value = frames === 0 ? 0 : Math.round((100 * frame) / frames);
      status.textContent = `${extra} frame ${frame} of ${frames}…`;
    };
    try {
      if (support.video && support.videoCodecString) {
        const codecName = EXPORT_VIDEO_CODEC_NAMES[support.video] ?? support.video;
        status.textContent = `Exporting with ${codecName}…`;
        const keepFrames = video.debugFrames ? new Set([0, Math.floor(plan.frames / 2), plan.frames - 1]) : undefined;
        const kept = new Map<number, ImageData>();
        const offsets: number[] = [];
        let at = 0;
        for (const chunk of plan.chunks) {
          offsets.push(at);
          at += chunk.frames;
        }
        const fragments = (sceneId: string): { html: string; css: string; js: string } => {
          const found = video.fragments(sceneId);
          if (!found) throw new Error(`Scene "${sceneId}" has no source to export`);
          return found;
        };
        const result = await exportTimelineMp4({
          film,
          timeline,
          scenes: video.inputs(),
          clips: video.clips(),
          size,
          drivers: {
            openCapture: (chunk) =>
              video.snapshots
                ? openSandboxedCapture(chunk, { document: doc, fragments, kits: video.kits(), size, keepFrames, kept, globalOffset: offsets[chunk.chunk] ?? 0, snapshots: video.snapshots })
                : openBrowserCapture(chunk, { document: doc, fragments, kits: video.kits(), size, keepFrames, kept, globalOffset: offsets[chunk.chunk] ?? 0 }),
            openVideo: (width, height, fps) => openWebCodecsVideo(width, height, fps, support.video!, support.videoCodecString!),
            openAudio: () => (support.audio ? openWebCodecsAudio() : Promise.resolve(null)),
          },
          cancel,
          onProgress: (event) => showProgress(event.frame, event.frames, event.phase === 'video' ? 'Exporting' : event.phase === 'audio' ? 'Encoding narration,' : 'Muxing,'),
        });
        const wall = Math.max(1e-3, (performance.now() - started) / 1000);
        const speed = result.seconds / wall;
        const url = URL.createObjectURL(new Blob([result.bytes.slice()], { type: 'video/mp4' }));
        download.href = url;
        download.download = exportVideoFilename(film.id, film.version, insertId, resolution.value, 'mp4', false);
        download.hidden = false;
        const boundMs = Math.round(exportAvSyncBound(result.fps) * 1000);
        status.textContent =
          `Done · ${Math.round(result.bytes.length / 1024)} KB · ${speed.toFixed(1)}× realtime · ${codecName}${result.hasAudio ? ' + AAC' : ', silent'} · narration within ${boundMs} ms of its beat`;
        if (video.debugFrames) {
          video.debug.last = {
            url,
            width: result.width,
            height: result.height,
            fps: result.fps,
            frames: result.frames,
            seconds: result.seconds,
            codec: codecName,
            hasAudio: result.hasAudio,
            fallback: false,
            speed,
            kept,
            size,
            plan,
            film,
          };
        }
      } else {
        status.textContent = 'Recording the fallback in realtime…';
        const fragments = (sceneId: string): { html: string; css: string; js: string } => {
          const found = video.fragments(sceneId);
          if (!found) throw new Error(`Scene "${sceneId}" has no source to export`);
          return found;
        };
        const rig = video.snapshots
          ? createSandboxedFallbackRig({ document: doc, fragments, kits: video.kits(), size, fps: 24, snapshots: video.snapshots })
          : createBrowserFallbackRig({ document: doc, fragments, kits: video.kits(), size, fps: 24 });
        const result = await exportTimelineFallback({
          film,
          timeline,
          scenes: video.inputs(),
          openSession: rig.openSession,
          recorder: rig.recorder,
          clock: rig.clock,
          cancel,
          onProgress: (event) => showProgress(event.frame, event.frames, 'Recording the fallback,'),
        });
        const wall = Math.max(1e-3, (performance.now() - started) / 1000);
        const speed = result.seconds / wall;
        const url = URL.createObjectURL(new Blob([result.bytes.slice()], { type: result.mimeType }));
        download.href = url;
        const extension = result.mimeType.includes('mp4') ? 'mp4' : 'webm';
        download.download = exportVideoFilename(film.id, film.version, insertId, resolution.value, extension, true);
        download.hidden = false;
        status.textContent = `Done · fallback · realtime · video-only · ${Math.round(result.bytes.length / 1024)} KB · ${speed.toFixed(1)}× realtime`;
      }
    } catch (error) {
      if (error instanceof ExportCancelledError || cancel?.cancelled) status.textContent = 'Cancelled.';
      else status.textContent = `The export failed: ${error instanceof Error ? error.message : 'unknown error'}`;
    } finally {
      running = false;
      go.disabled = false;
      cancelButton.hidden = true;
      cancel = null;
    }
  }
}

/**
 * Slides: one still per timeline beat, captured through the same offscreen
 * session the video export encodes with, so a slide is the video frame the
 * deck shows. Every frame renders in order (captures are deltas); the beats'
 * opening frames download as PNGs, one per beat, as a set.
 */
function buildExportSlides(
  wrap: HTMLElement,
  sources: { film(): CompiledFilm; inserts(): readonly StoredInsert[] },
  insertSelect: HTMLSelectElement,
  video: Pick<ExportVideoSources, 'pause' | 'fragments' | 'inputs' | 'kits' | 'snapshots' | 'stageSize'>,
  slides: { last: string[] | null },
): void {
  const doc = wrap.ownerDocument;
  const title = doc.createElement('h4');
  title.className = 'inc-export-slides-title';
  title.textContent = 'Slides';
  const hint = doc.createElement('p');
  hint.className = 'inc-export-hint';
  hint.textContent = 'One still per beat, through the same capture the video export uses.';
  const selection = doc.createElement('select');
  selection.className = 'inc-export-slides-selection';
  selection.setAttribute('aria-label', 'What to export as slides');
  for (const [value, text] of [
    ['film', 'Film'],
    ['plus', 'Film + my inserts'],
    ['insert', 'Single insert'],
  ] as const) {
    const option = doc.createElement('option');
    option.value = value;
    option.textContent = text;
    selection.append(option);
  }
  const resolution = doc.createElement('select');
  resolution.className = 'inc-export-slides-resolution';
  resolution.setAttribute('aria-label', 'Slide height');
  for (const height of [480, 720, 1080]) {
    const option = doc.createElement('option');
    option.value = String(height);
    option.textContent = `${height}p`;
    if (height === 720) option.selected = true;
    resolution.append(option);
  }
  const go = doc.createElement('button');
  go.type = 'button';
  go.className = 'inc-export-slides-go';
  go.textContent = 'Export slides';
  const cancelButton = doc.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'inc-export-slides-cancel';
  cancelButton.textContent = 'Cancel';
  cancelButton.hidden = true;
  const progress = doc.createElement('progress');
  progress.className = 'inc-export-slides-progress';
  progress.max = 100;
  progress.value = 0;
  progress.hidden = true;
  const status = doc.createElement('p');
  status.className = 'inc-export-slides-status';
  status.setAttribute('role', 'status');
  const controls = doc.createElement('div');
  controls.className = 'inc-ask-row';
  controls.append(selection, resolution, go, cancelButton);
  wrap.append(title, hint, controls, progress, status);

  let running = false;
  let cancel: ExportCancellation | null = null;
  cancelButton.addEventListener('click', () => cancel?.cancel());

  const clipOf = (entry: StoredInsert): InsertClip => ({ id: entry.id, anchor: entry.anchor, lines: entry.lines, seconds: entry.seconds });

  go.addEventListener('click', () => {
    if (running) return;
    void run();
  });

  async function run(): Promise<void> {
    const film = sources.film();
    let timeline: FlattenedTimeline;
    let insertId: string | null;
    if (selection.value === 'insert') {
      const entry = sources.inserts().find((candidate) => candidate.id === insertSelect.value);
      if (!entry) {
        status.textContent = 'Pick one of your inserts above first.';
        return;
      }
      timeline = flattenInsert(film, clipOf(entry));
      insertId = entry.id;
    } else if (selection.value === 'plus') {
      timeline = flattenFilm(film, sources.inserts().map(clipOf));
      insertId = 'with-inserts';
    } else {
      timeline = flattenFilm(film);
      insertId = null;
    }
    const stage = video.stageSize();
    if (!stage) {
      status.textContent = 'The figure draws no stage to export.';
      return;
    }
    let size: ExportFrameSize;
    try {
      size = exportFrameSize(stage.width, stage.height, Number(resolution.value));
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'The export size is out of range.';
      return;
    }
    const inputs = video.inputs();
    const planned = planExportFilm(film, timeline, inputs, {});
    if (!planned.ok) {
      status.textContent = planned.problems.join('; ');
      return;
    }
    const plan = planned.plan;
    let refs: ReturnType<typeof planDeckSlides>;
    try {
      refs = planDeckSlides(plan);
    } catch (error) {
      // Over-long decks are refused before any frame renders, as over-long videos are.
      status.textContent = error instanceof Error ? error.message : 'The deck is too long to export as slides.';
      return;
    }
    const byScene = new Map(inputs.map((scene) => [scene.id, scene]));
    const wanted = new Map<number, Map<number, (typeof refs)[number]>>();
    for (const ref of refs) {
      const frames = wanted.get(ref.chunk) ?? new Map<number, (typeof refs)[number]>();
      frames.set(ref.frame, ref);
      wanted.set(ref.chunk, frames);
    }
    running = true;
    go.disabled = true;
    cancelButton.hidden = false;
    progress.hidden = false;
    progress.value = 0;
    video.pause();
    try {
      await fontsReady();
    } catch {
      // Measuring falls back deterministically without loaded fonts.
    }
    cancel = new ExportCancellation();
    const fragments = (sceneId: string): { html: string; css: string; js: string } => {
      const found = video.fragments(sceneId);
      if (!found) throw new Error(`Scene "${sceneId}" has no source to export`);
      return found;
    };
    const names: string[] = [];
    try {
      let done = 0;
      for (const chunk of plan.chunks) {
        cancel.throwIfCancelled();
        const scene = byScene.get(chunk.sceneId);
        if (!scene) throw new ExportError(`Scene "${chunk.sceneId}" has no source to export`);
        const session = video.snapshots
          ? await openSandboxedCapture(chunk, { document: doc, fragments, kits: video.kits(), size, snapshots: video.snapshots })
          : await openBrowserCapture(chunk, { document: doc, fragments, kits: video.kits(), size });
        try {
          for (const frame of renderExportChunk(chunk, scene, cancel)) {
            const image = await session.capture(frame, frame.frame === 0);
            const ref = wanted.get(chunk.chunk)?.get(frame.frame);
            if (!ref) continue;
            cancel.throwIfCancelled();
            done++;
            progress.value = refs.length === 0 ? 0 : Math.round((100 * done) / refs.length);
            status.textContent = `Slide ${done} of ${refs.length}…`;
            const name = exportSlideFilename(film.id, film.version, insertId, ref.index + 1, refs.length, ref.beat);
            names.push(name);
            await downloadCanvas(image as HTMLCanvasElement, name);
          }
        } finally {
          session.destroy();
        }
      }
      slides.last = names;
      status.textContent = `Done · ${names.length} slide${names.length === 1 ? '' : 's'}`;
    } catch (error) {
      if (error instanceof ExportCancelledError || cancel?.cancelled) status.textContent = 'Cancelled.';
      else status.textContent = `The export failed: ${error instanceof Error ? error.message : 'unknown error'}`;
    } finally {
      running = false;
      go.disabled = false;
      cancelButton.hidden = true;
      progress.hidden = true;
      cancel = null;
    }
  }
}

/** Downloads a canvas as a PNG through a blob link; the click is the gesture the browser needs. */
function downloadCanvas(canvas: HTMLCanvasElement, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      try {
        if (!blob) {
          reject(new Error('The slide did not rasterize.'));
          return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        resolve();
      } catch (error) {
        reject(error instanceof Error ? error : new Error('The slide did not download.'));
      }
    }, 'image/png');
  });
}

/** Downloads text through a blob link; the click is the gesture the browser needs. */
function downloadFile(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Attaches a patch's audio to the mixer: only beats the patch changed or
 * spliced may sound. Audio riding along for an unchanged beat is ignored,
 * never attached to the mixer.
 */
function attachPatchAudio(patch: FilmVersionPatch, parent: CompiledFilm, at: CompiledFilm, mixer: FilmMixer): void {
  const fresh = new Set(at.beats.map((beat) => beat.id));
  const changed = new Set(patch.beats.map((beat) => beat.beat));
  for (const beat of parent.beats) {
    if (!changed.has(beat.id)) fresh.delete(beat.id);
  }
  for (const line of patch.audio) {
    if (!line.audioBase64 || !fresh.has(line.beat)) continue;
    mixer.attach({ beatId: line.beat, hash: `v${at.version}-${line.beat}`, pcm: base64ToBytes(line.audioBase64), sampleRate: line.sampleRate ?? 8000, seconds: line.seconds });
  }
}

function buildBookmarks(player: HTMLElement, model: PlayerModel): { add(label?: string): void } {
  const wrap = document.createElement('div');
  wrap.className = 'inc-bookmarks';
  const heading = document.createElement('h3');
  heading.textContent = 'Bookmarks';
  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'inc-bookmark-add';
  addButton.textContent = 'Bookmark this moment';
  const list = document.createElement('ul');
  const render = (): void => {
    list.textContent = '';
    const bookmarks = model.bookmarks;
    if (bookmarks.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'inc-bookmarks-empty';
      empty.textContent = 'No bookmarks yet.';
      list.append(empty);
      return;
    }
    for (const bookmark of bookmarks) {
      const item = document.createElement('li');
      item.dataset.bookmark = bookmark.id;
      const jump = document.createElement('button');
      jump.type = 'button';
      jump.textContent = `${bookmark.label} (${formatTime(model.bookmarkTime(bookmark.id) ?? 0)})`;
      jump.setAttribute('aria-label', `Jump to bookmark ${bookmark.label}`);
      jump.addEventListener('click', () => model.jumpBookmark(bookmark.id));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove bookmark ${bookmark.label}`);
      remove.addEventListener('click', () => model.removeBookmark(bookmark.id));
      item.append(jump, ' ', remove);
      list.append(item);
    }
  };
  const add = (label?: string): void => {
    model.addBookmark(label);
  };
  addButton.addEventListener('click', () => add());
  model.on((event) => {
    if (event.type === 'chrome') render();
  });
  render();
  wrap.append(heading, addButton, list);
  player.append(wrap);
  return { add };
}

/** Binds the documented shortcuts, firing only outside fields and key-consuming controls. */
function bindShortcuts(actions: Record<string, () => void>): void {
  document.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button' || target?.isContentEditable) return;
    const shortcut = shortcutFor(event.key);
    if (!shortcut) return;
    const action = actions[shortcut.action];
    if (!action) return;
    event.preventDefault();
    action();
  });
}

/** The documented shortcut list, rendered from the same table the keys match. */
function buildShortcutHelp(player: HTMLElement): void {
  const wrap = document.createElement('details');
  wrap.className = 'inc-shortcuts';
  const summary = document.createElement('summary');
  summary.textContent = 'Keyboard shortcuts';
  const list = document.createElement('ul');
  for (const shortcut of SHORTCUTS) {
    const item = document.createElement('li');
    const key = document.createElement('kbd');
    key.textContent = shortcut.key;
    item.append(key, ` ${shortcut.label}`);
    list.append(item);
  }
  const note = document.createElement('p');
  note.className = 'inc-shortcuts-note';
  note.textContent = 'Shortcuts work when focus is not in a field or a button, so screen readers and text fields keep their keys.';
  wrap.append(summary, list, note);
  player.append(wrap);
}

/** localStorage, or a memory stand-in where storage is gone: the film plays on without resume. */
function memoryLocalStorage(): ResumeStorage {
  try {
    const storage = window.localStorage;
    storage.getItem('incantly.probe');
    return storage;
  } catch {
    const data = new Map<string, string>();
    return {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
      removeItem: (key) => void data.delete(key),
    };
  }
}

function buildTranscript(player: HTMLElement, model: PlayerModel): { sync(beat: string | null): void } {
  const wrap = document.createElement('div');
  wrap.className = 'inc-transcript';
  const heading = document.createElement('h3');
  heading.textContent = 'Transcript';
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Search the transcript';
  search.setAttribute('aria-label', 'Search the transcript');
  const list = document.createElement('ol');
  let active = '';
  const render = (): void => {
    list.textContent = '';
    const query = search.value.trim().toLowerCase();
    for (const line of model.transcript()) {
      if (query && !line.say.toLowerCase().includes(query)) continue;
      const item = document.createElement('li');
      item.dataset.beat = line.beat;
      item.classList.toggle('is-active', line.beat === active);
      const jump = document.createElement('button');
      jump.type = 'button';
      jump.textContent = formatTime(line.start);
      jump.addEventListener('click', () => model.seek(line.start));
      const text = document.createElement('span');
      text.textContent = line.say;
      item.append(jump, ' ', text);
      const marks = model.markersForBeat(line.beat);
      if (marks.length > 0) {
        const dot = document.createElement('span');
        dot.className = 'inc-marker';
        dot.textContent = `● ${marks.length}`;
        dot.title = marks.map((mark) => mark.question || 'Question').join('\n');
        item.append(' ', dot);
      }
      list.append(item);
    }
  };
  search.addEventListener('input', render);
  model.on((event) => {
    if (event.type === 'chrome') render();
  });
  render();
  wrap.append(heading, search, list);
  player.append(wrap);
  return {
    sync(beat: string | null): void {
      active = beat ?? '';
      for (const item of list.querySelectorAll('li')) {
        const on = item instanceof HTMLElement && item.dataset.beat === beat;
        item.classList.toggle('is-active', on);
        if (on) item.scrollIntoView({ block: 'nearest' });
      }
    },
  };
}

function buildChapters(player: HTMLElement, model: PlayerModel): void {
  const wrap = document.createElement('div');
  wrap.className = 'inc-chapters';
  const heading = document.createElement('h3');
  heading.textContent = 'Chapters';
  const list = document.createElement('ul');
  for (const chapter of model.chapters()) {
    const item = document.createElement('li');
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.textContent = `${chapter.title} (${formatTime(chapter.start)})`;
    jump.addEventListener('click', () => model.seek(chapter.start));
    item.append(jump);
    list.append(item);
  }
  wrap.append(heading, list);
  player.append(wrap);
}

function buildTimeline(
  player: HTMLElement,
  model: PlayerModel,
  film: CompiledFilm,
): { sync(beat: string | null, time: number, duration: number): void; playhead(time: number, duration: number): void; checks(report: FilmReport | null): void } {
  const wrap = document.createElement('div');
  wrap.className = 'inc-timeline';
  const heading = document.createElement('h3');
  heading.textContent = 'Timeline (debug)';
  wrap.append(heading);
  const lanes: Record<string, HTMLElement> = {};
  const blocks: HTMLElement[] = [];
  const playheads: HTMLElement[] = [];
  const lane = (name: string, label: string): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'inc-timeline-lane';
    const tag = document.createElement('span');
    tag.className = 'inc-timeline-tag';
    tag.textContent = label;
    const track = document.createElement('div');
    track.className = 'inc-timeline-track';
    const head = document.createElement('div');
    head.className = 'inc-timeline-playhead';
    track.append(head);
    playheads.push(head);
    row.append(tag, track);
    wrap.append(row);
    lanes[name] = track;
    return track;
  };
  // V1: the base film, one clip per beat.
  const v1 = lane('v1', 'V1 base');
  for (const beat of film.beats) {
    const clip = document.createElement('button');
    clip.type = 'button';
    clip.className = 'inc-timeline-clip';
    clip.dataset.beat = beat.id;
    clip.style.left = `${(beat.start / film.seconds) * 100}%`;
    clip.style.width = `${(beat.seconds / film.seconds) * 100}%`;
    clip.textContent = `${beat.id} ${beat.step.short ?? ''}`.trim();
    clip.title = beat.step.say;
    clip.addEventListener('click', () => model.seek(beat.start));
    v1.append(clip);
    blocks.push(clip);
  }
  // V2: learner inserts pinned by anchor; slice 2 has the anchors, not the inserts.
  const v2 = lane('v2', 'V2 inserts');
  for (const beat of film.beats) {
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'inc-timeline-pin';
    pin.style.left = `${(beat.start / film.seconds) * 100}%`;
    pin.textContent = '⚓';
    pin.title = `Anchor ${beat.id} (no inserts in slice 2)`;
    pin.addEventListener('click', () => {
      const anchor = anchorFor(film, beat.id);
      if (anchor) model.seekAnchor(anchor);
    });
    v2.append(pin);
  }
  // A1: narration with a tick per word, estimated until audio arrives.
  const a1 = lane('a1', 'A1 narration');
  for (const beat of film.beats) {
    for (const [i, tick] of model.wordTicks(beat.id).entries()) {
      const mark = document.createElement('span');
      mark.className = 'inc-timeline-tick';
      mark.style.left = `${(tick / film.seconds) * 100}%`;
      mark.title = beat.words[i] ?? '';
      a1.append(mark);
    }
  }
  // FX: sfx cues, marks, titles and pause points.
  const fx = lane('fx', 'FX cues');
  for (const beat of film.beats) {
    const cues: string[] = [];
    if (beat.step.sfx) cues.push(`♪ ${beat.step.sfx}`);
    for (const mark of beat.step.mark ?? []) cues.push(`${mark.type} ${mark.part}`);
    if (beat.step.title) cues.push('title');
    if (beat.step.explore) cues.push('explore');
    if (beat.step.predict) cues.push('predict');
    if (beat.step.hold) cues.push('hold');
    if (cues.length === 0) continue;
    const cue = document.createElement('button');
    cue.type = 'button';
    cue.className = 'inc-timeline-cue';
    cue.dataset.beat = beat.id;
    cue.style.left = `${(beat.start / film.seconds) * 100}%`;
    cue.textContent = cues.join(' · ');
    cue.addEventListener('click', () => model.seek(beat.start));
    fx.append(cue);
  }
  const status = document.createElement('p');
  status.className = 'inc-timeline-checks';
  status.textContent = 'Film checks: running…';
  wrap.append(status);
  player.append(wrap);
  return {
    sync(beat: string | null, time: number, duration: number): void {
      for (const block of blocks) block.classList.toggle('is-active', block.dataset.beat === beat);
      for (const head of playheads) head.style.left = `${(time / duration) * 100}%`;
    },
    playhead(time: number, duration: number): void {
      for (const head of playheads) head.style.left = `${(time / duration) * 100}%`;
    },
    checks(report: FilmReport | null): void {
      if (!report) {
        status.textContent = 'Film checks: running…';
        return;
      }
      const bad = new Set(report.failures.map((failure) => failure.beat));
      status.textContent = report.ok
        ? `Film checks: all ${report.stats.beats} beats pass (${report.stats.msPerBeat.toFixed(1)} ms/beat)`
        : `Film checks: ${bad.size} of ${report.stats.beats} beats fail (${report.failures.length} failures)`;
      for (const block of blocks) block.classList.toggle('is-failing', bad.has(block.dataset.beat ?? ''));
    },
  };
}

function buildInspector(player: HTMLElement): { show(beat: CompiledBeat | null, film: CompiledFilm): void } {
  const wrap = document.createElement('div');
  wrap.className = 'inc-player-inspector';
  const heading = document.createElement('h3');
  heading.textContent = 'Clip inspector';
  const body = document.createElement('dl');
  wrap.append(heading, body);
  player.append(wrap);
  return {
    show(beat, film) {
      body.textContent = '';
      if (!beat) {
        body.textContent = 'No beat selected.';
        return;
      }
      const rows: Array<[string, string]> = [
        ['beat', beat.id],
        ['scene', beat.sceneId],
        ['start', `${beat.start.toFixed(2)} s for ${beat.seconds.toFixed(2)} s${beat.timed ? ' (audio)' : ' (estimated)'}`],
        ['say', beat.step.say],
      ];
      const step = beat.step;
      if (step.focus) rows.push(['focus', step.focus]);
      if (step.set) rows.push(['set', JSON.stringify(step.set)]);
      if (step.ease !== undefined) rows.push(['ease', `${step.ease} s`]);
      if (step.cam) rows.push(['cam', JSON.stringify(step.cam)]);
      if (step.show) rows.push(['show', step.show.join(', ')]);
      if (step.hide) rows.push(['hide', step.hide.join(', ')]);
      for (const mark of step.mark ?? []) rows.push(['mark', `${mark.type} ${mark.part}`]);
      if (step.title) rows.push(['title', typeof step.title === 'string' ? step.title : `${step.title.kind ?? 'lower'}: ${step.title.text}`]);
      if (step.short) rows.push(['short', step.short]);
      if (step.sfx) rows.push(['sfx', step.sfx]);
      if (step.explore) rows.push(['explore', `${step.explore.control}${step.explore.hint ? ` — ${step.explore.hint}` : ''}`]);
      if (step.predict) rows.push(['predict', step.predict.question]);
      const map = film.sourceMap[beat.id];
      if (map) {
        rows.push(['lines', map.lines.join(', ') || '—']);
        rows.push(['parts', map.parts.join(', ') || '—']);
      }
      for (const [term, value] of rows) {
        const dt = document.createElement('dt');
        dt.textContent = term;
        const dd = document.createElement('dd');
        dd.textContent = value;
        body.append(dt, dd);
      }
    },
  };
}

function buildBadges(player: HTMLElement): { probe(report: ProbeReport): void; checks(report: FilmReport, failures: readonly FilmFailure[]): void; progress(beat: number, beats: number): void } {
  const wrap = document.createElement('div');
  wrap.className = 'inc-player-badges';
  const probe = document.createElement('span');
  probe.className = 'inc-player-badge';
  probe.textContent = 'probe: running…';
  const seek = document.createElement('span');
  seek.className = 'inc-player-badge';
  seek.textContent = 'seek=play: running…';
  const checks = document.createElement('span');
  checks.className = 'inc-player-badge';
  checks.textContent = 'checks: running…';
  const failures = document.createElement('details');
  failures.className = 'inc-player-failures';
  const summary = document.createElement('summary');
  summary.textContent = 'Check failures';
  failures.append(summary);
  failures.hidden = true;
  wrap.append(probe, seek, checks, failures);
  player.append(wrap);
  return {
    probe(report: ProbeReport) {
      probe.textContent = report.ok ? 'probe: pass' : `probe: ${report.failures.length} failures`;
      probe.dataset.state = report.ok ? 'pass' : 'fail';
      const drifted = report.failures.filter((failure) => failure.check === 'seek');
      seek.textContent = drifted.length === 0 ? 'seek=play: pass' : `seek=play: ${drifted.length} failures`;
      seek.dataset.state = drifted.length === 0 ? 'pass' : 'fail';
    },
    checks(report: FilmReport, list: readonly FilmFailure[]) {
      checks.textContent = report.ok ? `checks: all ${report.stats.beats} beats pass` : `checks: ${list.length} failures`;
      checks.dataset.state = report.ok ? 'pass' : 'fail';
      failures.hidden = list.length === 0;
      summary.textContent = `Check failures (${list.length})`;
      failures.querySelectorAll('p').forEach((p) => p.remove());
      for (const failure of list.slice(0, 20)) {
        const p = document.createElement('p');
        p.textContent = `${failure.beat} ${failure.point ?? ''} ${failure.width ?? ''}${failure.theme ?? ''} [${failure.check}] ${failure.message}`;
        failures.append(p);
      }
    },
    progress(beat: number, beats: number) {
      checks.textContent = `checks: beat ${beat + 1} of ${beats}…`;
    },
  };
}

interface AskSheet {
  open(): void;
  tick(dt: number): void;
  caption(): string | null;
  /** Plays a clip over the paused film: a saved insert, or the deeper rung's. Null when it plays, else why not. */
  playClip(clip: InsertClip): string | null;
  state(): {
    sheet: boolean;
    answer: string;
    markers: number;
    stack: number;
    insert: string | null;
    remaining: number;
    showme: string | null;
    example: string | null;
    depth: string;
    language: string;
  };
}

function buildAskSheet(
  player: HTMLElement,
  ctx: {
    model: PlayerModel;
    controller: FilmController;
    film: () => CompiledFilm;
    figure: { runtime: SceneRuntime; renderer: { apply(update: RuntimeUpdate): void } };
    sceneJsFor(sceneId: string): string;
    reducedMotion: boolean;
    applyPatch(patch: FilmVersionPatch): Promise<{ ok: true } | { ok: false; problems: readonly string[] }>;
    requestBeats(): ReadonlyArray<{ beat: string; scene: string; say: string }>;
    keepInsert(clip: InsertClip): void;
  },
): AskSheet {
  const { model, controller, figure } = ctx;
  const sheet = document.createElement('div');
  sheet.className = 'inc-ask';
  sheet.hidden = true;
  const context = document.createElement('p');
  context.className = 'inc-ask-context';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inc-ask-input';
  input.placeholder = 'Ask about this moment';
  input.setAttribute('aria-label', 'Ask about this moment');
  const send = document.createElement('button');
  send.type = 'button';
  send.textContent = 'Ask';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.addEventListener('click', () => {
    sheet.hidden = true;
  });
  const chips = document.createElement('div');
  chips.className = 'inc-ask-chips';
  const answer = document.createElement('div');
  answer.className = 'inc-ask-answer';
  answer.setAttribute('aria-live', 'polite');
  const hear = document.createElement('button');
  hear.type = 'button';
  hear.textContent = 'Hear answer';
  hear.disabled = true;
  // The voice choice: the stub voice list until a Cartesia voice id is entered in Narration.
  const voice = document.createElement('select');
  voice.className = 'inc-ask-voice';
  voice.setAttribute('aria-label', 'Voice for the spoken answer');
  const voiceDefault = document.createElement('option');
  voiceDefault.value = '';
  voiceDefault.textContent = 'Default voice';
  voice.append(voiceDefault);
  let voicesLoaded = false;
  const loadVoices = async (): Promise<void> => {
    if (voicesLoaded) return;
    voicesLoaded = true;
    try {
      const token = await devToken();
      const answer = await fetch('/api/v1/voices', { headers: { authorization: `Bearer ${token}` } });
      const result = (await answer.json()) as { voices?: Array<{ id: string; name: string }> };
      for (const entry of result.voices ?? []) {
        if (typeof entry.id !== 'string' || typeof entry.name !== 'string') continue;
        const option = document.createElement('option');
        option.value = entry.id;
        option.textContent = entry.name;
        voice.append(option);
      }
    } catch {
      // The default voice speaks; the choice is a courtesy.
    }
  };
  const speakStatus = document.createElement('span');
  speakStatus.className = 'inc-ask-speak-status';
  // Simpler / Deeper re-runs the last question at another depth.
  const simpler = document.createElement('button');
  simpler.type = 'button';
  simpler.className = 'inc-ask-simpler';
  simpler.textContent = 'Simpler';
  const deeper = document.createElement('button');
  deeper.type = 'button';
  deeper.className = 'inc-ask-deeper';
  deeper.textContent = 'Deeper';
  // The language choice, mirroring the service's ASK_LANGUAGES: the model translates.
  const language = document.createElement('select');
  language.className = 'inc-ask-language';
  language.setAttribute('aria-label', 'Answer language');
  for (const [code, name] of [
    ['en', 'English'],
    ['es', 'Spanish'],
    ['fr', 'French'],
    ['de', 'German'],
    ['it', 'Italian'],
    ['pt', 'Portuguese'],
  ] as const) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = name;
    language.append(option);
  }
  const status = document.createElement('p');
  status.className = 'inc-ask-status';
  const row = document.createElement('div');
  row.className = 'inc-ask-row';
  row.append(input, send, close);
  const depthRow = document.createElement('div');
  depthRow.className = 'inc-ask-row';
  depthRow.append(simpler, deeper, language);
  const speakRow = document.createElement('div');
  speakRow.className = 'inc-ask-row';
  speakRow.append(hear, voice, speakStatus);
  // Change the film: an explicit edit, never routed. The input stays hidden
  // until the learner asks to change the film itself.
  const changeButton = document.createElement('button');
  changeButton.type = 'button';
  changeButton.className = 'inc-change-open';
  changeButton.textContent = 'Change the film';
  const changeRow = document.createElement('div');
  changeRow.className = 'inc-ask-row inc-change-row';
  changeRow.hidden = true;
  const changeInput = document.createElement('input');
  changeInput.type = 'text';
  changeInput.className = 'inc-change-input';
  changeInput.placeholder = 'Say what the film should change';
  changeInput.setAttribute('aria-label', 'What the film should change');
  const changeSend = document.createElement('button');
  changeSend.type = 'button';
  changeSend.className = 'inc-change-send';
  changeSend.textContent = 'Make version';
  changeRow.append(changeInput, changeSend);
  sheet.append(context, row, chips, answer, depthRow, speakRow, changeButton, changeRow, status);

  const showmeBanner = document.createElement('div');
  showmeBanner.className = 'inc-showme';
  showmeBanner.hidden = true;
  const showmeText = document.createElement('span');
  const showmeBack = document.createElement('button');
  showmeBack.type = 'button';
  showmeBack.textContent = 'Back to film';
  showmeBanner.append(showmeText, showmeBack);

  const insertBanner = document.createElement('div');
  insertBanner.className = 'inc-insert';
  insertBanner.hidden = true;
  const insertText = document.createElement('span');
  const insertBack = document.createElement('button');
  insertBack.type = 'button';
  insertBack.textContent = 'Back now';
  insertBanner.append(insertText, insertBack);

  // The side clip: its own figure playing independently beside the film,
  // pinned to the anchor, with a return to the film.
  const exampleWrap = document.createElement('div');
  exampleWrap.className = 'inc-example';
  exampleWrap.hidden = true;
  const exampleCaption = document.createElement('p');
  exampleCaption.className = 'inc-example-caption';
  const exampleFigure = document.createElement('div');
  exampleFigure.className = 'inc-example-figure';
  const exampleRow = document.createElement('div');
  exampleRow.className = 'inc-ask-row';
  const exampleToggle = document.createElement('button');
  exampleToggle.type = 'button';
  exampleToggle.className = 'inc-example-toggle';
  exampleToggle.textContent = 'Pause example';
  const exampleReturn = document.createElement('button');
  exampleReturn.type = 'button';
  exampleReturn.className = 'inc-example-return';
  exampleReturn.textContent = 'Return to film';
  exampleRow.append(exampleToggle, exampleReturn);
  exampleWrap.append(exampleCaption, exampleFigure, exampleRow);
  player.append(sheet, showmeBanner, insertBanner, exampleWrap);

  let anchor: AskAnchor | null = null;
  let beat: CompiledBeat | null = null;
  let lastAnswer = '';
  let lastQuestion = '';
  let lastDepthRung: 'answer' | 'deeper' | null = null;
  let showme: ShowMeSession | null = null;
  const thread: Array<{ q: string; a: string }> = [];
  const stack = new AskReturnStack();
  const players: InsertPlayer[] = [];
  let sideClip: { player: SideClipPlayer; figure: FigureHandle; caption: string; playing: boolean } | null = null;

  /** Pushes direct runtime writes to the live figure, as the seek path does. */
  const touch = (fn: () => void): void => {
    fn();
    figure.renderer.apply(figure.runtime.flush());
  };

  const open = (): void => {
    if (!sheet.hidden) {
      input.focus();
      return;
    }
    let pinned = model.anchorNow();
    if (!pinned) {
      model.seek(0);
      pinned = model.anchorNow();
    }
    if (!pinned) {
      status.textContent = 'Play the film first, then ask.';
      sheet.hidden = false;
      return;
    }
    anchor = pinned;
    beat = ctx.film().beats.find((candidate) => candidate.id === pinned.beat) ?? null;
    context.textContent = askContextLine(ctx.film(), pinned);
    answer.textContent = '';
    status.textContent = '';
    input.value = '';
    sheet.hidden = false;
    input.focus();
    void loadVoices();
  };

  const assemblyBody = (question: string, depth?: 'simpler' | 'standard' | 'deeper'): Record<string, unknown> => {
    const film = ctx.film();
    const lines = controller.transcript();
    const at = lines.findIndex((line) => line.beat === anchor?.beat);
    const neighbours = lines.slice(Math.max(0, at - 1), at + 2).filter((line) => line.beat !== anchor?.beat);
    const jsLines = ctx.sceneJsFor(anchor?.scene ?? '').split('\n');
    const sceneLines = (film.sourceMap[anchor?.beat ?? '']?.lines ?? [])
      .map((n) => ({ n, text: jsLines[n - 1] ?? '' }))
      .filter((line) => line.text !== '');
    const scene = film.scenes.find((candidate) => candidate.id === anchor?.scene);
    return {
      question,
      anchor: anchor ? { film: anchor.film, version: anchor.version, scene: anchor.scene, beat: anchor.beat, wordIndex: anchor.wordIndex } : null,
      beat: beat ? { beat: beat.id, say: beat.step.say } : null,
      neighbours: neighbours.map((line) => ({ beat: line.beat, say: line.say })),
      sceneLines,
      sceneSummary: scene?.title ?? '',
      values: anchor?.controlValues ?? {},
      readouts: anchor?.readouts ?? [],
      thread: thread.map((turn) => ({ ...turn })),
      depth: depth ?? 'standard',
      language: language.value === '' ? 'en' : language.value,
    };
  };

  const askAnswer = async (question: string, depth: 'simpler' | 'standard' | 'deeper' = 'standard'): Promise<void> => {
    status.textContent = 'Answering…';
    answer.textContent = '';
    hear.disabled = true;
    speakStatus.textContent = '';
    try {
      const token = await devToken();
      const full = await streamAsk(token, assemblyBody(question, depth), (delta) => {
        answer.textContent += delta;
      });
      lastAnswer = full.text;
      lastQuestion = question;
      lastDepthRung = 'answer';
      hear.disabled = full.text === '';
      thread.push({ q: question, a: full.text });
      while (thread.length > 6) thread.shift();
      status.textContent = `First words in ${Math.round(full.firstChunkMs)} ms${depth === 'standard' ? '' : ` (${depth})`}.`;
    } catch {
      status.textContent = 'The answer did not arrive — the film is still paused where you asked.';
    }
  };

  const askShowMe = (): void => {
    if (!beat) return;
    if (showme) touch(() => showme?.restore());
    touch(() => {
      showme = beginShowMe(figure.runtime, beat!);
    });
    showmeText.textContent = `Showing ${beat.id} — the beat replays on the scene. `;
    showmeBanner.hidden = false;
    sheet.hidden = true;
  };
  showmeBack.addEventListener('click', () => {
    if (showme) touch(() => showme?.restore());
    showme = null;
    showmeBanner.hidden = true;
  });

  const askDeeper = async (question: string, depth: 'simpler' | 'standard' | 'deeper' = 'standard'): Promise<void> => {
    status.textContent = 'Writing the insert…';
    try {
      const token = await devToken();
      const params = Object.keys(figure.runtime.values());
      const posted = await fetch('/api/v1/ask/insert', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ...assemblyBody(question, depth), params }),
      });
      const result = (await posted.json()) as { status?: string; clip?: { anchor: AskAnchor; lines: Array<{ say: string; seconds: number; set?: Record<string, number> }> } };
      if (!posted.ok || result.status !== 'clip' || !result.clip || !anchor || !beat) {
        status.textContent = 'No insert came back — the film is still paused where you asked.';
        return;
      }
      const validated = validateInsertClip({ anchor: result.clip.anchor, lines: result.clip.lines }, ctx.film(), new Set(params));
      if (!validated.ok) {
        status.textContent = `The insert did not fit this scene: ${validated.problems[0] ?? 'invalid'}.`;
        return;
      }
      const problem = startClip({ ...validated.clip, anchor });
      if (problem) {
        status.textContent = problem;
        return;
      }
      ctx.keepInsert({ ...validated.clip, anchor });
      lastQuestion = question;
      lastDepthRung = 'deeper';
      status.textContent = '';
      sheet.hidden = true;
    } catch {
      status.textContent = 'No insert came back — the film is still paused where you asked.';
    }
  };

  // One insert player for the deeper rung and saved inserts alike: lines in
  // order, the back-to-film beat, then an auto-resume at the anchor word.
  const startClip = (clip: InsertClip): string | null => {
    if (!stack.push(clip.anchor)) return 'Finish this question first — questions nest two deep.';
    const nested = players.length > 0;
    const playing = new InsertPlayer(controller, ctx.film(), clip, {
      applySet: (set) => touch(() => figure.runtime.setValues(set)),
      ...(nested ? { resumeToFilm: false as const } : {}),
      onEvent: (event) => {
        if (event.type !== 'resume') return;
        stack.pop();
        players.pop();
        if (players.length === 0) insertBanner.hidden = true;
      },
    });
    players.push(playing);
    if (!playing.play()) {
      stack.pop();
      players.pop();
      if (players.length === 0) insertBanner.hidden = true;
      return 'The film moved on — ask again where you are.';
    }
    insertBanner.hidden = false;
    return null;
  };

  const askExample = async (question: string): Promise<void> => {
    if (sideClip) returnFromExample();
    status.textContent = 'Writing the side clip…';
    try {
      const token = await devToken();
      const posted = await fetch('/api/v1/ask/example', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(assemblyBody(question)),
      });
      const result = (await posted.json()) as { status?: string; clip?: { anchor: AskAnchor; html: string; css: string; js: string; caption: string } };
      if (!posted.ok || result.status !== 'clip' || !result.clip || !anchor || !beat) {
        status.textContent = 'No side clip came back — the film is still paused where you asked.';
        return;
      }
      const validated = validateExampleClip({ anchor: result.clip.anchor, html: result.clip.html, css: result.clip.css, js: result.clip.js, caption: result.clip.caption }, ctx.film());
      if (!validated.ok) {
        status.textContent = `The side clip did not fit this film: ${validated.problems[0] ?? 'invalid'}.`;
        return;
      }
      // A generated scene: probed in a hidden sandbox like any generated
      // scene, and mounted in the sandbox — never trusted on the page thread.
      // The service already spent the one repair; what still fails its probe
      // is rejected before playback, so a runaway clip cannot hang the page.
      const fragments = { html: validated.clip.html, css: validated.clip.css, js: validated.clip.js };
      const scene = validateScene(fragments);
      const probed = await probeSandboxed(fragments, {
        spec: { parts: [...scene.info.parts], ...(scene.info.stepCount === null ? {} : { steps: scene.info.stepCount }) },
      });
      if (!probed.ok || !probed.report || !probed.report.ok) {
        const first = probed.report?.failures[0]?.message ?? probed.validation.diagnostics[0]?.message ?? 'invalid';
        status.textContent = `The side clip did not pass its checks: ${first}.`;
        return;
      }
      if (!stack.push(anchor)) {
        status.textContent = 'Finish this question first — questions nest two deep.';
        return;
      }
      exampleFigure.textContent = '';
      const side = sandboxAdapter.mount(exampleFigure, fragments, { title: `Example: ${validated.clip.caption}`, reducedMotion: ctx.reducedMotion });
      const clip = { ...validated.clip, anchor };
      const playing = new SideClipPlayer(controller, ctx.film(), clip);
      if (!playing.open()) {
        stack.pop();
        side.destroy();
        exampleFigure.textContent = '';
        status.textContent = 'The film moved on — ask again where you are.';
        return;
      }
      sideClip = { player: playing, figure: side, caption: validated.clip.caption, playing: !ctx.reducedMotion };
      exampleCaption.textContent = validated.clip.caption;
      exampleToggle.textContent = 'Pause example';
      exampleWrap.hidden = false;
      sheet.hidden = true;
      status.textContent = '';
    } catch {
      status.textContent = 'No side clip came back — the film is still paused where you asked.';
    }
  };

  const returnFromExample = (): void => {
    if (!sideClip) return;
    const { player: playing, figure: side } = sideClip;
    sideClip = null;
    side.destroy();
    exampleFigure.textContent = '';
    exampleWrap.hidden = true;
    stack.pop();
    // An insert owns the film while it runs; the clip then just closes.
    if (players.length === 0) playing.closeToFilm();
  };
  exampleReturn.addEventListener('click', returnFromExample);
  exampleToggle.addEventListener('click', () => {
    if (!sideClip) return;
    if (sideClip.playing) {
      sideClip.figure.pause();
      sideClip.playing = false;
      exampleToggle.textContent = 'Play example';
    } else {
      sideClip.figure.resume();
      sideClip.playing = true;
      exampleToggle.textContent = 'Pause example';
    }
  });

  const askChange = async (prompt: string): Promise<void> => {
    status.textContent = 'Writing the new version…';
    try {
      const token = await devToken();
      const film = ctx.film();
      const posted = await fetch('/api/v1/ask/change', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, film: film.id, version: film.version, beats: ctx.requestBeats() }),
      });
      const result = (await posted.json()) as { status?: string; patch?: FilmVersionPatch };
      if (!posted.ok || result.status !== 'patch' || !result.patch) {
        status.textContent = 'No new version came back — the film is unchanged.';
        return;
      }
      // A patch is untrusted input until it passes here: the service checked
      // it too, but anything tampered with on the way is rejected client-side.
      const checked = sanitizeFilmPatch(result.patch);
      if (!checked.ok) {
        status.textContent = `The new version did not fit: ${checked.problems[0] ?? 'invalid'}.`;
        return;
      }
      const applied = await ctx.applyPatch(checked.patch);
      if (!applied.ok) {
        status.textContent = applied.problems[0] ?? 'The new version did not fit.';
        return;
      }
      thread.length = 0;
      status.textContent = `Version ${result.patch.version} is playing.`;
      sheet.hidden = true;
    } catch {
      status.textContent = 'No new version came back — the film is unchanged.';
    }
  };
  changeButton.addEventListener('click', () => {
    changeRow.hidden = !changeRow.hidden;
    if (!changeRow.hidden) changeInput.focus();
  });
  changeSend.addEventListener('click', () => {
    const prompt = changeInput.value.trim();
    if (prompt === '') {
      status.textContent = 'Say what the film should change.';
      return;
    }
    void askChange(prompt);
  });
  changeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const prompt = changeInput.value.trim();
      if (prompt === '') status.textContent = 'Say what the film should change.';
      else void askChange(prompt);
    }
  });

  const rerunDepth = (depth: 'simpler' | 'deeper'): void => {
    if (lastQuestion === '') {
      status.textContent = 'Ask something first, then run it simpler or deeper.';
      return;
    }
    if (!anchor || !beat) {
      status.textContent = 'Play the film first, then ask.';
      return;
    }
    if (lastDepthRung === 'deeper') void askDeeper(lastQuestion, depth);
    else void askAnswer(lastQuestion, depth);
  };
  simpler.addEventListener('click', () => rerunDepth('simpler'));
  deeper.addEventListener('click', () => rerunDepth('deeper'));

  const submit = (text: string, rung?: 'answer' | 'showme' | 'deeper' | 'example'): void => {
    const question = text.trim();
    if (question === '') {
      status.textContent = 'Ask something first.';
      return;
    }
    if (!anchor || !beat) {
      status.textContent = 'Play the film first, then ask.';
      return;
    }
    model.addMarker(anchor, question);
    const lane = rung ?? routeQuestion(question);
    if (lane === 'showme') askShowMe();
    else if (lane === 'deeper') void askDeeper(question);
    else if (lane === 'example') void askExample(question);
    else void askAnswer(question);
  };
  send.addEventListener('click', () => submit(input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit(input.value);
  });
  for (const [label, lane] of [['Explain this step', 'answer'], ['Show me', 'showme'], ['Explain deeper', 'deeper'], ['Another example', 'example']] as const) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.textContent = label;
    chip.addEventListener('click', () => submit(input.value.trim() === '' ? label : input.value, lane));
    chips.append(chip);
  }
  hear.addEventListener('click', () => {
    if (lastAnswer === '') return;
    hear.disabled = true;
    speakStatus.textContent = 'Speaking…';
    void (async () => {
      try {
        const token = await devToken();
        const posted = await fetch('/api/v1/ask/speak', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ text: lastAnswer, ...(voice.value !== '' ? { voice: voice.value } : {}) }),
        });
        const result = (await posted.json()) as { seconds?: number; audioBase64?: string | null; sampleRate?: number };
        if (!posted.ok) {
          speakStatus.textContent = (result as { message?: string }).message ?? 'Speech is capped for today.';
          return;
        }
        if (result.audioBase64) playPcm(base64ToBytes(result.audioBase64), result.sampleRate ?? 8000);
        speakStatus.textContent = `Answer speech: ${(result.seconds ?? 0).toFixed(1)} s.`;
      } catch {
        speakStatus.textContent = 'Audio is not available here.';
      } finally {
        hear.disabled = lastAnswer === '';
      }
    })();
  });
  insertBack.addEventListener('click', () => {
    players[players.length - 1]?.skipToFilm();
  });

  return {
    open,
    playClip: (clip) => startClip(clip),
    tick(dt: number): void {
      sideClip?.player.tick(dt);
      const top = players[players.length - 1];
      if (!top || top.currentPhase === 'done') return;
      top.tick(dt);
      const depth = players.length > 1 ? ` · follow-up ${players.length}` : '';
      insertText.textContent = `Explaining deeper · ${Math.max(0, Math.ceil(top.remaining))} s${depth} `;
    },
    caption(): string | null {
      const top = players[players.length - 1];
      if (!top || top.currentPhase === 'done') return null;
      if (top.currentPhase === 'back') return 'Back to the film…';
      return top.currentLine?.say ?? null;
    },
    state() {
      const top = players[players.length - 1];
      return {
        sheet: !sheet.hidden,
        answer: answer.textContent ?? '',
        markers: model.markers.length,
        stack: stack.depth,
        insert: top && top.currentPhase !== 'done' ? top.currentPhase : null,
        remaining: top?.remaining ?? 0,
        showme: showme && !showme.restored ? showme.beat.id : null,
        example: sideClip ? sideClip.caption : null,
        depth: lastDepthRung ?? 'standard',
        language: language.value === '' ? 'en' : language.value,
      };
    },
  };
}

/** The dev token, fetched once: the ask endpoints authenticate like generation. */
let askToken: string | null = null;

async function devToken(): Promise<string> {
  askToken ??= ((await (await fetch('/api/dev/token')).json()) as { token: string }).token;
  return askToken;
}

/** Streams an Answer, appending each delta as it arrives. */
async function streamAsk(token: string, body: Record<string, unknown>, onDelta: (delta: string) => void): Promise<{ text: string; firstChunkMs: number }> {
  const posted = await fetch('/api/v1/ask', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!posted.ok || !posted.body) throw new Error(`The service answered ${posted.status}`);
  const reader = posted.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (block.startsWith('event: ')) {
        const [first, ...rest] = block.split('\n');
        const data = JSON.parse(rest.join('\n').slice('data: '.length)) as { text?: string; firstChunkMs?: number; message?: string };
        if (first === 'event: delta' && data.text) {
          text += data.text;
          onDelta(data.text);
        } else if (first === 'event: done') {
          reader.releaseLock();
          return { text: data.text ?? text, firstChunkMs: data.firstChunkMs ?? 0 };
        } else if (first === 'event: error') {
          throw new Error(data.message ?? 'The model failed');
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
  throw new Error('The stream ended without an answer');
}

/** Plays mono 16-bit PCM through a fresh context; the Hear button is the gesture autoplay rules need. */
function playPcm(pcm: Uint8Array, sampleRate: number): void {
  const view = globalThis as unknown as { AudioContext?: typeof AudioContext };
  if (!view.AudioContext || pcm.length < 2) return;
  const context = new view.AudioContext();
  const buffer = context.createBuffer(1, Math.floor(pcm.length / 2), sampleRate);
  const data = buffer.getChannelData(0);
  const words = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  for (let i = 0; i < data.length; i++) data[i] = words.getInt16(i * 2, true) / 32768;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.onended = () => void context.close();
  source.start();
}

/** Combines per-scene probe reports: passing only when every scene passes. */
function combineProbes(probes: readonly ProbeReport[]): ProbeReport {
  const failures = probes.flatMap((probe) => [...probe.failures]);
  const frames = probes.reduce((sum, probe) => sum + probe.stats.frames, 0);
  const elements = probes.reduce((sum, probe) => sum + probe.stats.elements, 0);
  const durationMs = probes.reduce((sum, probe) => sum + probe.stats.durationMs, 0);
  const averageFrameMs = probes.length > 0 ? probes.reduce((sum, probe) => sum + probe.stats.averageFrameMs, 0) / probes.length : 0;
  return {
    ok: probes.every((probe) => probe.ok),
    failures,
    stats: { configurations: probes.reduce((sum, probe) => sum + probe.stats.configurations, 0), frames, averageFrameMs, elements, durationMs },
  };
}

async function buildThumbs(
  thumbs: HTMLElement,
  model: PlayerModel,
  film: CompiledFilm,
  fragmentsFor: (sceneId: string) => { html: string; css: string; js: string },
  kits: KitRegistry,
  isolated: boolean,
): Promise<void> {
  const box = document.createElement('div');
  box.hidden = true;
  document.body.append(box);
  try {
    // One hidden figure per scene in its own box; each thumbnail seeks its own
    // scene to its film time, as the checks do. Single-scene films keep the
    // same figure id and box as today.
    const single = film.scenes.length === 1;
    const mounted = new Map<string, { box: HTMLElement; figure: ReturnType<typeof mountTrusted> }>();
    for (const scene of film.scenes) {
      const sceneBox = single ? box : document.createElement('div');
      if (!single) {
        sceneBox.hidden = true;
        box.append(sceneBox);
      }
      mounted.set(scene.id, { box: sceneBox, figure: mountTrusted(sceneBox, fragmentsFor(scene.id), { kits, film: true, autoplay: false, ...(isolated ? { isolate: true as const } : {}), figureId: single ? 'thumbs' : `thumbs-${scene.id}` }) });
    }
    for (const { figure } of mounted.values()) figure.runtime.setReducedMotion(true);
    for (const at of model.thumbTimes(5)) {
      let beat = film.beats[0]!;
      for (const candidate of film.beats) if (at + 1e-9 >= candidate.start) beat = candidate;
      const scene = film.scenes.find((candidate) => candidate.id === beat.sceneId) ?? film.scenes[0]!;
      const entry = mounted.get(scene.id) ?? [...mounted.values()][0]!;
      const figure = entry.figure;
      const update = figure.runtime.seek(Math.max(0, at - scene.start));
      figure.runtime.step('goto', beat.index);
      applyBeatCues(figure.runtime, beat.step, { sfx: false });
      figure.runtime.redraw();
      const extra = figure.runtime.flush();
      figure.renderer.apply({ ...update, commands: [...update.commands, ...extra.commands] });
      const svg = entry.figure.root.querySelector('svg.inc-stage');
      const thumb = document.createElement('button');
      thumb.type = 'button';
      thumb.className = 'inc-player-thumb';
      thumb.title = formatTime(at);
      thumb.setAttribute('aria-label', `Seek to ${formatTime(at)}`);
      if (svg) thumb.innerHTML = svg.outerHTML;
      else thumb.textContent = formatTime(at);
      thumb.addEventListener('click', () => model.seek(at));
      thumbs.append(thumb);
    }
    for (const entry of mounted.values()) entry.figure.destroy();
  } finally {
    box.remove();
  }
}

async function buildSandboxedThumbs(
  thumbs: HTMLElement,
  model: PlayerModel,
  film: CompiledFilm,
  fragmentsFor: (sceneId: string) => { html: string; css: string; js: string },
  snapshotFor: (sceneId: string) => SanitizedSceneSnapshot | null,
): Promise<void> {
  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = 'position:fixed;left:-100000px;top:0;width:760px;visibility:hidden;pointer-events:none;';
  document.body.append(box);
  try {
    // One hidden sandboxed figure per scene; each thumbnail seeks its own
    // scene to its film time on a stand-in, lands the absolute state, and
    // pictures it — the stored scene never runs on the host.
    const mounted = new Map<string, { handle: FigureHandle; stub: SceneRuntime; controller: FilmController }>();
    for (const scene of film.scenes) {
      const snapshot = snapshotFor(scene.id);
      if (!snapshot) continue;
      const sceneBox = document.createElement('div');
      box.append(sceneBox);
      const handle = sandboxAdapter.mount(sceneBox, fragmentsFor(scene.id), { title: `Thumbnail: ${scene.id}`, film: true, autoplay: false, reducedMotion: true });
      if ((await handle.ready) !== 'live') {
        handle.destroy();
        sceneBox.remove();
        continue;
      }
      const stub = mountStubRuntime(snapshot);
      mounted.set(scene.id, { handle, stub, controller: new FilmController({ runtime: stub, film, sceneIndex: Math.max(0, film.scenes.findIndex((candidate) => candidate.id === scene.id)), now: () => 0 }) });
    }
    for (const at of model.thumbTimes(5)) {
      let beat = film.beats[0]!;
      for (const candidate of film.beats) if (at + 1e-9 >= candidate.start) beat = candidate;
      const scene = film.scenes.find((candidate) => candidate.id === beat.sceneId) ?? film.scenes[0]!;
      const entry = mounted.get(scene.id) ?? [...mounted.values()][0];
      const thumb = document.createElement('button');
      thumb.type = 'button';
      thumb.className = 'inc-player-thumb';
      thumb.title = formatTime(at);
      thumb.setAttribute('aria-label', `Seek to ${formatTime(at)}`);
      if (entry) {
        entry.controller.seek(at);
        pushAbsoluteState(entry.handle, entry.stub, entry.controller.currentBeat?.step.cam ?? null);
        const svg = await entry.handle.exportSvg();
        if (svg) {
          const img = document.createElement('img');
          img.src = svg;
          img.alt = '';
          thumb.append(img);
        } else thumb.textContent = formatTime(at);
      } else thumb.textContent = formatTime(at);
      thumb.addEventListener('click', () => model.seek(at));
      thumbs.append(thumb);
    }
    for (const entry of mounted.values()) {
      entry.controller.destroy();
      entry.stub.destroy();
      entry.handle.destroy();
    }
  } finally {
    box.remove();
  }
}
