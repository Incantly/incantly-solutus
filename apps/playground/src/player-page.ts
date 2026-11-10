import {
  anchorFor,
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
  defaultShowMeBinding,
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
  LiveDriver,
  meanPixelDifference,
  mountStubRuntime,
  NOTES_STACK_BELOW_PX,
  openBrowserCapture,
  openSandboxedCapture,
  openWebCodecsAudio,
  openWebCodecsVideo,
  pageCaptionWords,
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
  renderMathText,
  SideClipPlayer,
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
  type LiveDriverEvent,
  type LiveEvent,
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
import {
  createPcmPlayer,
  GeminiLiveVoice,
  resolveFilmSource,
  startMicrophone,
  storedAsFixture,
  type MicrophoneHandle,
  type PcmPlayer,
  type StoredFilm,
} from '@incantly/generation/client';

/**
 * The film player: a silent fixture film through the real controller, player
 * and probe path. `?film=thirty|sixty|pythagoras` picks the film, or a generated film's
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

  // The film title reads as a video heading, with the chapter and beat count
  // as a small subtitle.
  const subtitle = document.createElement('p');
  subtitle.className = 'inc-player-sub';
  player.append(subtitle);

  // The screen is a 16:9 dark surface holding only the stage drawing; the
  // side panel tabs Teacher, Transcript and Chapters beside it.
  const main = document.createElement('div');
  main.className = 'inc-player-main';
  const screen = document.createElement('section');
  screen.className = 'inc-screen';
  screen.setAttribute('aria-label', `${fixture.storyboard.film.title} film`);
  const side = document.createElement('aside');
  side.className = 'inc-side';
  side.setAttribute('aria-label', 'Film panel');
  main.append(screen, side);
  player.append(main);

  // The film owns play, pause, speed and steps; the figure keeps its controls,
  // readouts, legend and description for exploring in the Controls strip.
  const figureBox = document.createElement('div');
  figureBox.className = 'inc-player-figure';
  screen.append(figureBox);
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
  // In film mode the screen shows only the stage: the figure's own title,
  // idea, zoom bar and part hint hide, and the panel moves to the Controls
  // strip below the transport. Sandboxed frames get the same flags, so their
  // in-frame chrome matches (their panel stays in the frame).
  const figureStyle = {
    ...(preset ? { preset } : {}),
    show: {
      transport: false,
      speed: false,
      steps: false,
      settings: false,
      undo: false,
      fullscreen: false,
      header: false,
      idea: false,
      zoom: false,
      partInfo: false,
    },
  };
  // The screen is always dark, in either page theme, so the film's figure
  // always renders its dark theme: light strokes stay visible on the dark
  // stage. (`theme` still selects the figure's own theme on other pages.)
  const figureTheme = 'dark';
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
      // The Controls strip follows the active scene: only its relocated
      // panel shows.
      for (const slot of player.querySelectorAll('.inc-controls-scene')) {
        if (slot instanceof HTMLElement) slot.hidden = slot.dataset.scene !== sceneId;
      }
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
  figureBox.append(card);

  // Explainer layers: generic engine overlays any film can use. The write-on
  // sits top-left, the notes list edges the screen's right side (or its
  // bottom when narrow) only once the first note arrives, and the section
  // card dims the stage while the scene keeps playing behind it.
  // Layer overlays fade instead of popping: visibility flips with the
  // fade (`.is-on`), so show/hide never shifts layout mid-playback.
  const writeEl = document.createElement('div');
  writeEl.className = 'inc-player-write';
  figureBox.append(writeEl);

  const notesEl = document.createElement('aside');
  notesEl.className = 'inc-player-notes';
  figureBox.append(notesEl);

  // Subtitles overlay the bottom of the screen, not a box under the figure.
  const caption = document.createElement('div');
  caption.className = 'inc-caption';
  caption.setAttribute('role', 'status');
  figureBox.append(caption);

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
  // Play owns the teacher: starting it live, holding it on pause, resuming
  // it on play. Assigned once live voice exists, below.
  let playPauseLive = (): void => {
    model.toggle();
  };
  let flipTeacherVoice = (): void => undefined;
  /** Remembered per browser: Play starts the teacher unless switched off. */
  const TEACHER_VOICE_KEY = 'incantly-teacher-voice';
  let teacherVoiceOn = true;
  try {
    teacherVoiceOn = localStorage.getItem(TEACHER_VOICE_KEY) !== 'off';
  } catch {
    teacherVoiceOn = true;
  }
  /** A failed live start falls back once per visit instead of retrying every Play. */
  let liveFailedThisVisit = false;
  const transport = buildTransport(
    player,
    model,
    film,
    mixer,
    () => openAsk(),
    { toggleLoop, copyLink, playPause: () => playPauseLive() },
    playerStyle.show.playerFullscreen,
  );
  // The player root goes fullscreen; figures mirror the same chrome-aware growth — trusted directly,
  // sandboxed through the bridge — with playback untouched, so exiting restores layout and position.
  bindPlayerFullscreen(player, transport.fullscreen, (on) => {
    for (const mounted of figures) mounted.renderer.setFullscreenMirror(on);
    for (const handle of session?.handles ?? []) handle.setFullscreen?.(on);
  });
  // Slot classes land on the built chrome too, so the fullscreen button styles like its siblings.
  applySlotClasses(player, playerStyle);
  // Below 640 px the notes leave the screen and sit under it, above the
  // transport, instead of covering the picture. The move runs on resize and
  // on every caption pass; only an actual mode change moves the node.
  let notesBelow = false;
  const transportBar = player.querySelector('.inc-player-transport');
  const placeNotes = (): void => {
    const narrow = player.clientWidth < NOTES_STACK_BELOW_PX;
    if (narrow === notesBelow) return;
    notesBelow = narrow;
    if (narrow && transportBar) transportBar.before(notesEl);
    else figureBox.append(notesEl);
  };
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      placeNotes();
      applyCaption(model.state);
    }).observe(player);
  }
  placeNotes();
  // Switching versions re-resolves the position by beat id — the same beat
  // and word on the new version, never carried seconds — and plays it.
  const showFilm = (next: CompiledFilm): void => {
    film = next;
    controller.retime(film);
    model.retime(film);
    transport.setDuration(film.seconds);
    player.querySelector('.inc-timeline')?.remove();
    if (debug) timeline = buildTimeline(player, model, film);
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
  // Developer tools (timeline, inspector, badges, narration details) build
  // only behind ?debug=1; the learner surface never shows them.
  const debug = params.get('debug') === '1';
  const versionUi = buildVersionPicker(player, () => picker.choices(), (version) => void switchVersion(version));
  const bookmarkUi = buildBookmarks(player, model);
  const transcript = buildTranscript(player, model);
  buildChapters(player, model);
  const deckUi = buildDeck(player, model);
  const NO_TIMELINE = { sync: (_beat: string | null, _time: number, _duration: number): void => {}, playhead: (_time: number, _duration: number): void => {}, checks: (_report: FilmReport | null): void => {} };
  let timeline: ReturnType<typeof buildTimeline> | typeof NO_TIMELINE = debug ? buildTimeline(player, model, film) : NO_TIMELINE;
  const NO_INSPECTOR = { show: (_beat: CompiledBeat | null, _film: CompiledFilm): void => {} };
  const inspector: ReturnType<typeof buildInspector> | typeof NO_INSPECTOR = debug ? buildInspector(player) : NO_INSPECTOR;
  const NO_BADGES = { probe: (_report: ProbeReport): void => {}, checks: (_report: FilmReport, _list: readonly FilmFailure[]): void => {}, progress: (_beat: number, _beats: number): void => {} };
  const badges: ReturnType<typeof buildBadges> | typeof NO_BADGES = debug ? buildBadges(player) : NO_BADGES;
  if (debug) buildNarration(player, {
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
      if (debug) timeline = buildTimeline(player, model, film);
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
    reference: params.get('reference') === '1',
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
    playPause: () => playPauseLive(),
    back: () => model.seek(controller.time - 5),
    forward: () => model.seek(controller.time + 5),
    prevBeat: () => model.prevBeat(),
    nextBeat: () => model.nextBeat(),
    captions: () => model.setCaptions(!model.state.captionsOn),
    sound: () => transport.toggleSound(),
    ask: () => openAsk(),
    loop: () => toggleLoop(),
    bookmark: () => bookmarkUi.add(),
    live: () => flipTeacherVoice(),
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
  // Karaoke captions: one span per word, the sounding one highlighted. Long
  // lines page instead of truncating: each page holds at most two lines, and
  // the page follows the sounding word's timings — never an ellipsis.
  let wordSpans: HTMLElement[] = [];
  let captionWords: readonly string[] = [];
  let captionPrefix = '';
  let captionPages: ReadonlyArray<{ readonly start: number; readonly end: number }> = [];
  let captionPage = 0;
  // Live and insert captions own the band outright: paging only runs for
  // beat captions, which carry word timings.
  let captionMode: 'beat' | 'other' = 'beat';
  const renderCaptionPage = (page: number): void => {
    captionPage = page;
    const bounds = captionPages[page] ?? { start: 0, end: 0 };
    caption.textContent = '';
    if (captionPrefix !== '') caption.append(document.createTextNode(captionPrefix));
    wordSpans = [];
    for (let i = bounds.start; i < bounds.end; i++) {
      const span = document.createElement('span');
      span.className = 'inc-caption-word';
      span.textContent = captionWords[i]!;
      caption.append(span, ' ');
      wordSpans.push(span);
    }
  };
  const pageForWord = (index: number): number => {
    let page = 0;
    captionPages.forEach((bounds, i) => {
      if (bounds.start <= index) page = i;
    });
    return page;
  };
  // While live voice owns the film, the caption band shows what the teacher
  // actually said for the current beat, not the beat's script line.
  let liveCaptionText: string | null = null;
  const highlightWord = (index: number): void => {
    const at = Math.max(0, index);
    const page = pageForWord(at);
    if (page !== captionPage) renderCaptionPage(page);
    const start = captionPages[captionPage]?.start ?? 0;
    wordSpans.forEach((span, i) => span.classList.toggle('is-active', start + i === at));
  };
  /** Fades a screen overlay in or out; visibility flips with the fade, so showing and hiding never shift layout. */
  const showOverlay = (el: HTMLElement, on: boolean): void => {
    el.classList.toggle('is-on', on);
  };
  /** Renders a write-on layer's shown prefix; math renders readably. */
  const renderWrite = (write: { readonly text: string; readonly math: boolean; readonly shown: string } | null | undefined): void => {
    if (!write || write.shown === '') {
      showOverlay(writeEl, false);
      return;
    }
    const shown = write.math ? renderMathText(write.shown) : write.shown;
    if (writeEl.textContent !== shown) writeEl.textContent = shown;
    writeEl.dataset.live = write.shown.length < write.text.length ? 'writing' : 'done';
    showOverlay(writeEl, true);
  };
  const applyCaption = (state: PlayerState): void => {
    // An insert captions its own line over the paused film.
    const insertText = askUi.caption();
    if (insertText !== null) {
      showOverlay(card, false);
      showOverlay(writeEl, false);
      showOverlay(notesEl, false);
      delete figureBox.dataset.split;
      caption.textContent = insertText;
      wordSpans = [];
      captionWords = [];
      captionMode = 'other';
      return;
    }
    if (liveCaptionText !== null && state.caption !== null) {
      showOverlay(card, false);
      caption.textContent = liveCaptionText;
      wordSpans = [];
      captionWords = [];
      captionMode = 'other';
      return;
    }
    const beat = film.beats.find((candidate) => candidate.id === state.beat);
    const marks = beat?.step.mark ?? [];
    player.dataset.mark = marks.some((mark) => mark.type === 'pulse') ? 'pulse' : '';
    const title = state.caption?.title;
    if (title?.kind === 'card') {
      if (card.textContent !== title.text) card.textContent = title.text;
      showOverlay(card, true);
    } else showOverlay(card, false);
    renderWrite(state.caption?.write);
    // Split scenes lay out once from the first frame: the notes column sits
    // beside the stage or under it when narrow, and the notes reveal beat by
    // beat inside it — but never as an empty box.
    const split = state.caption?.split ?? false;
    const widthPx = Math.max(280, Math.min(960, player.clientWidth || 640));
    if (split && widthPx >= NOTES_STACK_BELOW_PX) figureBox.dataset.split = 'side';
    else delete figureBox.dataset.split;
    placeNotes();
    const notes = state.caption?.notes ?? [];
    if (notes.length === 0) {
      showOverlay(notesEl, false);
    } else {
      notesEl.dataset.layout = notesBelow ? 'below' : figureBox.dataset.split === 'side' ? 'side' : 'stack';
      notesEl.textContent = '';
      const fresh = beat?.step.notes?.length ?? 0;
      const list = document.createElement('ul');
      notes.forEach((line, index) => {
        const item = document.createElement('li');
        item.textContent = line;
        if (index >= notes.length - fresh) item.className = 'is-new';
        list.append(item);
      });
      notesEl.append(list);
      showOverlay(notesEl, true);
    }
    captionWords = state.caption?.words ?? [];
    captionPrefix = title?.kind === 'lower' ? `${title.text} — ` : '';
    captionMode = 'beat';
    const say = state.caption?.say ?? '';
    // Subtitle type scales with the screen (about 2.4%), clamped, times the
    // learner's caption size. The box holds 90% of the screen minus its
    // padding, with a little slack for the bold sounding word; longer lines
    // page in word-timed chunks instead of truncating — never an ellipsis.
    const screenPx = Math.max(280, figureBox.clientWidth || 640);
    const fontPx = Math.min(26, Math.max(15, screenPx * 0.024)) * CAPTION_SCALES[state.captionSize];
    if (say !== '' && captionWords.length > 0) {
      // A split scene reads its pages in the stage column, not the screen.
      const stagePx = figureBox.dataset.split === 'side' ? screenPx * 0.66 : screenPx;
      const boxW = Math.max(40, (stagePx * 0.9 - 28) * 0.95);
      captionPages = pageCaptionWords(captionWords, { maxWidthPx: boxW, fontPx });
      captionPage = -1;
      highlightWord(model.currentWordIndex);
    } else {
      caption.textContent = '';
      wordSpans = [];
      captionPages = [];
      captionPage = 0;
    }
    if (fontsLoaded) caption.style.fontSize = `${Math.round(fontPx)}px`;
  };
  // Caption and size toggles apply at once, not on the next beat change.
  model.on((event) => {
    if (event.type === 'chrome') applyCaption(model.state);
  });
  // Live voice: the transport toggle, the mic, the teacher's audio and the
  // voice panel. Beside the film, generic over whatever film plays.
  const live = buildLiveVoice(player, {
    model,
    controller,
    film: () => film,
    figure: askFigure,
    ask: askUi,
    mixer,
    renderCaption: () => applyCaption(model.state),
    liveCaption: (text) => {
      liveCaptionText = text;
    },
    onLiveActive: (active) => {
      talkPrimary.textContent = active ? 'Stop' : 'Talk to the teacher';
      talkPrimary.setAttribute('aria-pressed', active ? 'true' : 'false');
      // The Teacher tab opens only once a live session actually starts — a
      // failed start leaves the learner where they were reading.
      if (active) activateSideTab(teacherTab);
    },
  });
  // One reading of "playing" for the transport label and the Play press, so
  // they can never disagree: the film clock, or the teacher reading while
  // click-advance holds the clock. A Pause label must always pause and hold,
  // never silently take the Play path.
  const liveReading = (): boolean => live.state().active && !live.state().paused;
  const isPlayingNow = (): boolean => model.state.playing || liveReading();
  // Assigned with the Teacher voice switch below: Play consults the switch
  // itself, so the visible control is the source of truth.
  flipTeacherVoice = (): void => setTeacherVoice(!teacherVoiceOn);
  // Side panel: Teacher (live voice), Transcript and Chapters as tabs. The
  // transcript and chapters move in from the page flow; the live panel moves
  // in from beside the transport. Tab order sets the reading order.
  const sideTabs = document.createElement('div');
  sideTabs.className = 'inc-side-tabs';
  sideTabs.setAttribute('role', 'tablist');
  sideTabs.setAttribute('aria-label', 'Film panel');
  const teacherPanel = document.createElement('section');
  teacherPanel.className = 'inc-side-panel';
  teacherPanel.id = 'inc-side-teacher';
  teacherPanel.setAttribute('role', 'tabpanel');
  teacherPanel.setAttribute('aria-labelledby', 'inc-side-tab-teacher');
  teacherPanel.setAttribute('tabindex', '0');
  const transcriptPanel = document.createElement('section');
  transcriptPanel.className = 'inc-side-panel';
  transcriptPanel.id = 'inc-side-transcript';
  transcriptPanel.setAttribute('role', 'tabpanel');
  transcriptPanel.setAttribute('aria-labelledby', 'inc-side-tab-transcript');
  transcriptPanel.setAttribute('tabindex', '0');
  const chaptersPanel = document.createElement('section');
  chaptersPanel.className = 'inc-side-panel';
  chaptersPanel.id = 'inc-side-chapters';
  chaptersPanel.setAttribute('role', 'tabpanel');
  chaptersPanel.setAttribute('aria-labelledby', 'inc-side-tab-chapters');
  chaptersPanel.setAttribute('tabindex', '0');
  const makeTab = (id: string, panelId: string, label: string): HTMLButtonElement => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.id = id;
    tab.className = 'inc-side-tab';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false');
    tab.setAttribute('aria-controls', panelId);
    tab.textContent = label;
    tab.addEventListener('click', () => activateSideTab(tab));
    return tab;
  };
  const teacherTab = makeTab('inc-side-tab-teacher', 'inc-side-teacher', 'Teacher');
  const transcriptTab = makeTab('inc-side-tab-transcript', 'inc-side-transcript', 'Transcript');
  const chaptersTab = makeTab('inc-side-tab-chapters', 'inc-side-chapters', 'Chapters');
  const sidePanels: ReadonlyArray<{ tab: HTMLButtonElement; panel: HTMLElement }> = [
    { tab: teacherTab, panel: teacherPanel },
    { tab: transcriptTab, panel: transcriptPanel },
    { tab: chaptersTab, panel: chaptersPanel },
  ];
  const activateSideTab = (tab: HTMLButtonElement): void => {
    for (const entry of sidePanels) {
      const on = entry.tab === tab;
      entry.tab.setAttribute('aria-selected', on ? 'true' : 'false');
      entry.panel.hidden = !on;
    }
  };
  sideTabs.append(teacherTab, transcriptTab, chaptersTab);
  side.append(sideTabs, teacherPanel, transcriptPanel, chaptersPanel);
  const talkPrimary = document.createElement('button');
  talkPrimary.type = 'button';
  talkPrimary.className = 'inc-live-primary';
  talkPrimary.textContent = 'Talk to the teacher';
  talkPrimary.setAttribute('aria-pressed', 'false');
  talkPrimary.addEventListener('click', () => playPauseLive());
  teacherPanel.append(talkPrimary);
  const livePanel = player.querySelector('.inc-live-panel');
  if (livePanel) teacherPanel.append(livePanel);
  // The Teacher voice switch lives in the ⋯ menu: on by default, remembered
  // per browser. Off means silent playback: Play never opens a socket.
  const voiceRow = document.createElement('label');
  voiceRow.className = 'inc-menu-row';
  const voiceBox = document.createElement('input');
  voiceBox.type = 'checkbox';
  voiceBox.className = 'inc-teacher-voice';
  voiceBox.checked = teacherVoiceOn;
  voiceBox.setAttribute('aria-label', 'Teacher voice');
  const setTeacherVoice = (on: boolean): void => {
    teacherVoiceOn = on;
    voiceBox.checked = on;
    try {
      localStorage.setItem(TEACHER_VOICE_KEY, on ? 'on' : 'off');
    } catch {
      // A blocked store just forgets the choice next visit.
    }
    // An explicit choice to hear the teacher retries on the next Play.
    if (on) liveFailedThisVisit = false;
    // Switching off mid-film closes the session; the film keeps its place,
    // playing on silently or staying paused.
    if (!on && live.state().active) {
      const wasPlaying = isPlayingNow();
      live.stop(false);
      if (wasPlaying) model.play();
    }
  };
  voiceBox.addEventListener('change', () => setTeacherVoice(voiceBox.checked));
  voiceRow.append(voiceBox, document.createTextNode(' Teacher voice'));
  transport.menuPop.append(voiceRow);
  playPauseLive = (): void => {
    if (isPlayingNow()) {
      // Pause holds the teacher where it stands, then the film. The button
      // answers the press at once instead of waiting for the next frame.
      live.pauseForPlayback();
      transport.syncTime(model.state.time, false);
      return;
    }
    // The switch itself is the source of truth: reconcile first, so Play
    // honors what the learner sees even if a change event was ever missed.
    if (voiceBox.checked !== teacherVoiceOn) setTeacherVoice(voiceBox.checked);
    void (async () => {
      if (teacherVoiceOn && !liveFailedThisVisit && !live.state().active) {
        // One failed start per visit: the panel keeps the reason, and Play
        // just plays silently from then on.
        if (!(await live.startForPlayback())) liveFailedThisVisit = true;
      } else if (live.state().active && live.state().paused) {
        live.resumePlayback();
      }
      model.play();
      // The button answers the press at once: the film is playing, or the
      // teacher is reading while click-advance holds its clock.
      transport.syncTime(model.state.time, isPlayingNow());
    })();
  };
  const transcriptWrap = player.querySelector('.inc-transcript');
  if (transcriptWrap) transcriptPanel.append(transcriptWrap);
  const chaptersWrap = player.querySelector('.inc-chapters');
  if (chaptersWrap) chaptersPanel.append(chaptersWrap);
  activateSideTab(transcriptTab);

  // Reduced motion as a styling hook as well as a playback one: no layer
  // fades or transitions when still.
  player.dataset.reducedMotion = reducedMotion ? 'still' : 'move';

  // Video order: heading, screen and side panel, transport, the Controls
  // strip, the deck strip, Ask and its banners, inserts, resume, shortcuts,
  // then any debug sections.
  subtitle.textContent = `${model.chapters().length} ${model.chapters().length === 1 ? 'chapter' : 'chapters'} · ${film.beats.length} beats`;
  const menuPop = transport.menuPop;
  for (const selector of ['.inc-bookmarks', '.inc-version-wrap', '.inc-export']) {
    const wrap = player.querySelector(selector);
    if (wrap) menuPop.append(wrap);
  }
  const deckToggle = player.querySelector('.inc-deck .inc-deck-toggle');
  if (deckToggle) menuPop.append(deckToggle);
  // The Controls strip: one collapsed line while playing, opened while
  // paused, on an explore beat, or by the learner. Each scene's relocated
  // figure panel (sliders, readouts, legend, description) gets a slot; only
  // the active scene's shows. Sandboxed films keep their chrome in-frame, so
  // the strip hides when nothing relocated.
  const controlsStrip = document.createElement('details');
  controlsStrip.className = 'inc-controls';
  const controlsSummary = document.createElement('summary');
  controlsSummary.className = 'inc-controls-summary';
  controlsSummary.textContent = 'Controls';
  const controlsBody = document.createElement('div');
  controlsBody.className = 'inc-controls-body';
  controlsStrip.append(controlsSummary, controlsBody);
  const controlSlots: HTMLElement[] = [];
  boxes.forEach((box, index) => {
    const slot = document.createElement('div');
    slot.className = 'inc-controls-scene';
    slot.dataset.scene = fixture.scenes[index]?.id ?? '';
    slot.hidden = multi ? index !== 0 : false;
    controlsBody.append(slot);
    controlSlots.push(slot);
  });
  // Theme tokens travel with the relocated panels, so sliders and readouts
  // keep the figure's own styling outside the figure root.
  applyStyle(controlsBody, resolveStyle(figureStyle));
  let relocatedPanels = 0;
  if (!session) {
    boxes.forEach((box, index) => {
      const slot = controlSlots[index];
      if (!slot) return;
      // One figure per box, so the first panel is its own; it lives inside
      // .inc-body, not as a direct child of the box.
      const panel = box.querySelector('.inc-panel');
      if (panel) {
        slot.append(panel);
        relocatedPanels += 1;
      }
      const description = box.querySelector('.inc-description');
      if (description) slot.append(description);
    });
  }
  if (relocatedPanels === 0) controlsStrip.hidden = true;
  const deckStrip = player.querySelector('.inc-deck');
  const sheetNode = player.querySelector('.inc-ask');
  const banners = ['.inc-showme', '.inc-insert', '.inc-example'].map((selector) => player.querySelector(selector));
  const insertsWrap = player.querySelector('.inc-inserts');
  const resumeNote = player.querySelector('.inc-resume');
  const shortcutHelp = player.querySelector('.inc-shortcuts');
  const debugNodes = ['.inc-timeline', '.inc-player-inspector', '.inc-player-badges', '.inc-narration'].map((selector) =>
    player.querySelector(selector),
  );
  for (const node of [controlsStrip, deckStrip, sheetNode, ...banners, insertsWrap, resumeNote, shortcutHelp, ...debugNodes]) {
    if (node) player.append(node);
  }
  window.addEventListener('pagehide', () => {
    live.stop(false);
    // A model session belongs to this page: dropping it here mirrors the
    // generations page, so idle sessions never linger on the dev server.
    if (askSession?.id) void fetch(`/api/dev/session/${askSession.id}`, { method: 'DELETE', keepalive: true });
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
    // The transport answers presses, not just frames: while the teacher reads
    // the film counts as playing even when click-advance holds its clock, and
    // a held beat counts as paused. Same reading as the Play press, above.
    const playing = isPlayingNow();
    const insertText = askUi.caption() ?? '';
    if (insertText !== lastInsertCaption) {
      lastInsertCaption = insertText;
      applyCaption(state);
    }
    if (state.beat !== lastBeat || playing !== lastPlaying) {
      applyCaption(state);
      transcript.sync(state.beat);
      timeline.sync(state.beat, state.time, film.seconds);
      inspector.show(model.selectedBeat, film);
      transport.syncTime(state.time, playing);
      deckUi.sync();
      // The Controls strip: a collapsed one-line summary while playing,
      // opened while paused, on an explore beat, or by the learner — a manual
      // toggle holds until the next beat or play-state change.
      const exploreBeat = state.beat ? film.beats.some((candidate) => candidate.id === state.beat && candidate.step.explore) : false;
      const wantOpen = !playing || exploreBeat;
      if (controlsStrip.open !== wantOpen) controlsStrip.open = wantOpen;
      lastBeat = state.beat;
      lastPlaying = playing;
    }
    {
      const values = askFigure.runtime.values();
      const summary = Object.entries(values)
        .map(([name, value]) => `${name} ${Math.round(value * 100) / 100}`)
        .join(' · ');
      const summaryText = summary ? `Controls: ${summary}` : 'Controls';
      if (controlsSummary.textContent !== summaryText) controlsSummary.textContent = summaryText;
    }
    if (Math.abs(state.time - lastTime) > 0.05) {
      transport.syncTime(state.time, playing);
      timeline.playhead(state.time, film.seconds);
      if (captionMode === 'beat') highlightWord(model.currentWordIndex);
      // The write-on reveal follows the film clock, never a timer: seeking to
      // t draws exactly what playing to t draws.
      renderWrite(state.caption?.write);
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
    live: () => live.state(),
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

  // The probe and the film checks run after the first paint, so the film is
  // playable at once.
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
    // The strip (previous/next buttons and position) shows only in deck mode;
    // its toggle lives in the transport's "more" menu.
    wrap.hidden = !deck;
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

/**
 * An inline icon: decorative SVG plus a visually-hidden label, so the button
 * reads as an icon while its text content — and accessible name — stay words.
 */
function transportIcon(paths: string, label: string): { icon: SVGSVGElement; text: HTMLSpanElement } {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 16 16');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = paths;
  const text = document.createElement('span');
  text.className = 'inc-vh';
  text.textContent = label;
  return { icon, text };
}

function buildTransport(
  player: HTMLElement,
  model: PlayerModel,
  film: CompiledFilm,
  mixer: FilmMixer,
  onAsk: () => void,
  extra: { toggleLoop(): void; copyLink(): string; playPause(): void },
  showFullscreen = true,
): {
  syncTime(time: number, playing: boolean): void;
  setDuration(seconds: number): void;
  toggleSound(): void;
  fullscreen: HTMLButtonElement;
  menuPop: HTMLElement;
} {
  const bar = document.createElement('div');
  bar.className = 'inc-transport inc-player-transport';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Film transport');
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'inc-play';
  const setPlaying = (playing: boolean): void => {
    const label = playing ? 'Pause' : 'Play';
    const paths = playing
      ? '<rect x="3" y="2" width="4" height="12" fill="currentColor"/><rect x="9" y="2" width="4" height="12" fill="currentColor"/>'
      : '<path d="M4 2l9 6-9 6z" fill="currentColor"/>';
    play.textContent = '';
    const { icon, text } = transportIcon(paths, label);
    play.append(icon, text);
    play.setAttribute('aria-label', label);
    play.title = label;
  };
  let lastPlaying = false;
  setPlaying(false);
  // Play starts the live teacher (or falls back silently); Pause holds it.
  play.addEventListener('click', () => extra.playPause());
  const ask = document.createElement('button');
  ask.type = 'button';
  ask.className = 'inc-player-ask';
  ask.textContent = 'Ask';
  ask.setAttribute('aria-label', 'Ask about this moment');
  ask.title = 'Ask about this moment';
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
  scrub.addEventListener('mousemove', (event) => {
    // Hovering the scrubber previews the beat under the pointer instead of a
    // thumbnail strip: the caption text, which names the moment.
    const duration = Number(scrub.max);
    if (!(duration > 0)) {
      scrub.removeAttribute('title');
      return;
    }
    const rect = scrub.getBoundingClientRect();
    const at = rect.width > 0 ? ((event.clientX - rect.left) / rect.width) * duration : 0;
    const beat = film.beats.find((candidate) => at >= candidate.start && at < candidate.start + candidate.seconds);
    if (beat) scrub.title = `${beat.id}: ${beat.step.say}`;
    else scrub.removeAttribute('title');
  });
  const scrubMarkers = document.createElement('div');
  scrubMarkers.className = 'inc-scrub-markers';
  scrubWrap.append(scrub, scrubMarkers);
  const renderMarkers = (): void => {
    scrubMarkers.textContent = '';
    const duration = Number(scrub.max);
    if (!(duration > 0)) return;
    for (const beat of film.beats) {
      const tick = document.createElement('span');
      tick.className = 'inc-tick-beat';
      tick.style.left = `${Math.min(100, Math.max(0, (beat.start / duration) * 100))}%`;
      tick.title = beat.id;
      scrubMarkers.append(tick);
    }
    for (const chapter of model.chapters()) {
      const tick = document.createElement('span');
      tick.className = 'inc-tick-chapter';
      tick.style.left = `${Math.min(100, Math.max(0, (chapter.start / duration) * 100))}%`;
      tick.title = chapter.title;
      scrubMarkers.append(tick);
    }
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
  speed.className = 'inc-speed';
  speed.setAttribute('aria-label', 'Speed');
  speed.title = 'Speed';
  for (const value of [0.25, 0.5, 1, 2, 4]) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = `${value}×`;
    if (value === 1) option.selected = true;
    speed.append(option);
  }
  speed.addEventListener('change', () => model.setSpeed(Number(speed.value)));
  const captions = document.createElement('button');
  captions.type = 'button';
  captions.className = 'inc-cc';
  captions.textContent = 'CC';
  captions.setAttribute('aria-label', 'Captions');
  captions.setAttribute('aria-pressed', 'true');
  captions.title = 'Captions on / off';
  const syncCaptions = (): void => {
    captions.setAttribute('aria-pressed', model.state.captionsOn ? 'true' : 'false');
  };
  captions.addEventListener('click', () => {
    model.setCaptions(!model.state.captionsOn);
    syncCaptions();
  });
  const volumeWrap = document.createElement('div');
  volumeWrap.className = 'inc-volume';
  const volume = document.createElement('input');
  volume.type = 'range';
  volume.min = '0';
  volume.max = '1';
  volume.step = '0.05';
  volume.value = '0.5';
  volume.setAttribute('aria-label', 'Volume');
  volume.title = 'Volume';
  volume.addEventListener('input', () => {
    model.setVolume(Number(volume.value));
    mixer.setVolume(Number(volume.value));
  });
  const sound = document.createElement('button');
  sound.type = 'button';
  sound.className = 'inc-player-sound';
  const syncSound = (): void => {
    const label = mixer.isOn ? 'Sound: on' : 'Sound: off';
    sound.textContent = '';
    const { icon, text } = transportIcon(
      '<path d="M2 6h3l4-3v10L5 10H2z" fill="currentColor"/><path d="M11 5c1.5 1.5 1.5 4.5 0 6M13 3c2.5 2.5 2.5 7.5 0 10" stroke="currentColor" fill="none"/>',
      label,
    );
    sound.append(icon, text);
    sound.setAttribute('aria-label', label);
    sound.title = label;
  };
  syncSound();
  sound.addEventListener('click', () => {
    mixer.setEnabled(!mixer.isOn);
    syncSound();
    if (mixer.isOn && model.state.playing && model.state.beat) mixer.onBeat(model.state.beat, Math.max(0, model.state.time - (model.state.caption?.start ?? 0)));
  });
  volumeWrap.append(sound, volume);
  const fullscreen = document.createElement('button');
  fullscreen.type = 'button';
  fullscreen.className = 'inc-player-fullscreen';
  const { icon: fullIcon, text: fullText } = transportIcon(
    '<path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" stroke="currentColor" stroke-width="2" fill="none"/>',
    'Full screen',
  );
  fullscreen.append(fullIcon, fullText);
  fullscreen.setAttribute('aria-label', 'Full screen');
  fullscreen.setAttribute('aria-pressed', 'false');
  fullscreen.title = 'Full screen';
  refreshPlayerFullscreenVisibility(fullscreen, showFullscreen);
  // Secondary controls live in the "more" menu: caption size, loop and link
  // are built here; bookmarks, versions, export and the deck toggle move in
  // after their builders run.
  const menu = document.createElement('div');
  menu.className = 'inc-menu';
  const menuButton = document.createElement('button');
  menuButton.type = 'button';
  menuButton.className = 'inc-menu-button';
  menuButton.textContent = '⋯';
  menuButton.setAttribute('aria-label', 'More options');
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-haspopup', 'true');
  const menuPop = document.createElement('div');
  menuPop.className = 'inc-menu-pop';
  menuPop.hidden = true;
  const setMenu = (open: boolean): void => {
    menuPop.hidden = !open;
    menuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  menuButton.addEventListener('click', () => setMenu(menuPop.hidden === true));
  document.addEventListener('keydown', (event) => {
    // Escape closes the menu from anywhere — the switch, a row, the film.
    if (event.key === 'Escape' && !menuPop.hidden) setMenu(false);
  });
  // An outside click closes the menu but never swallows the click: closing
  // happens in the click's capture phase, before the target's own handler,
  // with no gesture disturbed in between. (Closing on pointerdown used to
  // eat the click that dismissed the menu, so Play never started.)
  document.addEventListener(
    'click',
    (event) => {
      if (!menuPop.hidden && event.target instanceof Node && !menu.contains(event.target)) setMenu(false);
    },
    { capture: true },
  );
  const sizeRow = document.createElement('label');
  sizeRow.className = 'inc-menu-row';
  sizeRow.textContent = 'Caption size ';
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
  sizeRow.append(size);
  const loop = document.createElement('button');
  loop.type = 'button';
  loop.className = 'inc-player-loop';
  const syncLoop = (): void => {
    const looped = model.loopedBeat;
    const label = looped ? `Loop: ${looped}` : 'Loop: off';
    loop.textContent = '';
    const { icon, text } = transportIcon(
      '<path d="M3 8a5 5 0 0 1 9-3M13 8a5 5 0 0 1-9 3M12 2v3H9M4 14v-3h3" stroke="currentColor" fill="none"/>',
      label,
    );
    loop.append(icon, text);
    loop.setAttribute('aria-label', label);
    loop.title = label;
    loop.setAttribute('aria-pressed', looped ? 'true' : 'false');
  };
  syncLoop();
  loop.addEventListener('click', () => extra.toggleLoop());
  const linkRow = document.createElement('div');
  linkRow.className = 'inc-menu-row';
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'inc-player-link';
  const { icon: linkIcon, text: linkText } = transportIcon('<path d="M6 10l4-4M8 4l1-1a3 3 0 0 1 4 4l-1 1M8 12l-1 1a3 3 0 0 1-4-4l1-1" stroke="currentColor" fill="none"/>', 'Copy link');
  link.append(linkIcon, linkText);
  link.setAttribute('aria-label', 'Copy a link to this moment');
  link.title = 'Copy a link to this moment';
  const linkNote = document.createElement('span');
  linkNote.className = 'inc-player-link-note';
  link.addEventListener('click', () => {
    linkNote.textContent = extra.copyLink();
  });
  linkRow.append(link, linkNote);
  menuPop.append(sizeRow, loop, linkRow);
  menu.append(menuButton, menuPop);
  model.on((event) => {
    if (event.type !== 'chrome') return;
    syncLoop();
    syncCaptions();
  });
  bar.append(play, ask, time, scrubWrap, speed, captions, volumeWrap, fullscreen, menu);
  player.append(bar);
  return {
    fullscreen,
    menuPop,
    toggleSound(): void {
      sound.click();
    },
    syncTime(current: number, playing: boolean): void {
      // Rebuilding the icon every frame would churn the button and cut off
      // screen-reader announcements; only the state flip rebuilds it.
      if (playing !== lastPlaying) {
        setPlaying(playing);
        lastPlaying = playing;
      }
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
      let current: HTMLElement | null = null;
      for (const item of list.querySelectorAll('li')) {
        const on = item instanceof HTMLElement && item.dataset.beat === beat;
        item.classList.toggle('is-active', on);
        if (on && item instanceof HTMLElement) current = item;
      }
      // The list scrolls inside its own panel; the page itself never moves.
      // Hidden tabs have no boxes, so there is nothing to scroll to. Only
      // the list scrolls, and only when the sounding line is outside its
      // scrollport, so the learner's (or a test's) own scroll is never fought
      // and every line stays clickable.
      if (!current || current.offsetHeight <= 0) return;
      const listBox = list.getBoundingClientRect();
      const itemBox = current.getBoundingClientRect();
      if (itemBox.top < listBox.top) list.scrollTop += itemBox.top - listBox.top;
      else if (itemBox.bottom > listBox.bottom) list.scrollTop += itemBox.bottom - listBox.bottom;
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
  /**
   * The live voice's make_example rung: the same insert flow as Explain
   * deeper, pinned as a private insert and played as a detour. Resolves with
   * the insert id when it starts playing; onDone runs when it resumes the
   * film, so the driver can read on from the anchor.
   */
  makeExample(request: string, anchor: AskAnchor, onDone: () => void): Promise<unknown>;
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
    /** Pins the reference model, skipping the model session, for tests. */
    reference: boolean;
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
  // Which model answers, once the first Ask use resolves the session (or the
  // reference fallback): the same line the voice panel carries, kept in sync
  // through the shared registry.
  const modelLine = document.createElement('p');
  modelLine.className = 'inc-ask-model';
  modelLine.hidden = true;
  askModelLines.add(modelLine);
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
  sheet.append(context, row, chips, answer, depthRow, speakRow, changeButton, changeRow, status, modelLine);

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

  // The Ask assembly for one anchor and beat: the sheet's own for typed
  // questions, the caller's for live voice inserts that never open it.
  const assemblyBody = (question: string, anchorAt: AskAnchor | null, beatAt: CompiledBeat | null, depth?: 'simpler' | 'standard' | 'deeper'): Record<string, unknown> => {
    const film = ctx.film();
    const lines = controller.transcript();
    const at = lines.findIndex((line) => line.beat === anchorAt?.beat);
    const neighbours = lines.slice(Math.max(0, at - 1), at + 2).filter((line) => line.beat !== anchorAt?.beat);
    const jsLines = ctx.sceneJsFor(anchorAt?.scene ?? '').split('\n');
    const sceneLines = (film.sourceMap[anchorAt?.beat ?? '']?.lines ?? [])
      .map((n) => ({ n, text: jsLines[n - 1] ?? '' }))
      .filter((line) => line.text !== '');
    const scene = film.scenes.find((candidate) => candidate.id === anchorAt?.scene);
    return {
      question,
      anchor: anchorAt ? { film: anchorAt.film, version: anchorAt.version, scene: anchorAt.scene, beat: anchorAt.beat, wordIndex: anchorAt.wordIndex } : null,
      beat: beatAt ? { beat: beatAt.id, say: beatAt.step.say } : null,
      neighbours: neighbours.map((line) => ({ beat: line.beat, say: line.say })),
      sceneLines,
      sceneSummary: scene?.title ?? '',
      values: anchorAt?.controlValues ?? {},
      readouts: anchorAt?.readouts ?? [],
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
      const session = await askSessionInfo(ctx.reference);
      const full = await streamAsk(session.base, token, assemblyBody(question, anchor, beat, depth), (delta) => {
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

  // The insert flow for one anchor and beat: Explain deeper from the sheet,
  // or live voice's make_example, which never opens it. Throws once the
  // status line already says why, so live voice can show it in its panel.
  // Resolves with what the insert actually says and sets, so the teacher
  // describes the real result instead of the request; an empty flow rejects.
  const runInsert = async (
    question: string,
    anchorAt: AskAnchor,
    beatAt: CompiledBeat,
    depth: 'simpler' | 'standard' | 'deeper' = 'standard',
    onDone?: () => void,
  ): Promise<{ kind: 'insert'; says: readonly string[]; sets: Readonly<Record<string, number>> }> => {
    status.textContent = 'Writing the insert…';
    const fail = (message: string): Error => {
      status.textContent = message;
      return new Error(message);
    };
    let clip: InsertClip;
    try {
      const token = await devToken();
      const session = await askSessionInfo(ctx.reference);
      const params = Object.keys(figure.runtime.values());
      const posted = await fetch(`${session.base}/ask/insert`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ...assemblyBody(question, anchorAt, beatAt, depth), params }),
      });
      const result = (await posted.json()) as { status?: string; clip?: { anchor: AskAnchor; lines: Array<{ say: string; seconds: number; set?: Record<string, number> }> } };
      if (!posted.ok || result.status !== 'clip' || !result.clip) {
        throw fail('No insert came back — the film is still paused where you asked.');
      }
      const validated = validateInsertClip({ anchor: result.clip.anchor, lines: result.clip.lines }, ctx.film(), new Set(params));
      if (!validated.ok) {
        throw fail(`The insert did not fit this scene: ${validated.problems[0] ?? 'invalid'}.`);
      }
      clip = { ...validated.clip, anchor: anchorAt };
    } catch (error) {
      if (status.textContent === 'Writing the insert…') fail('No insert came back — the film is still paused where you asked.');
      throw error;
    }
    if (clip.lines.length === 0) throw fail('The example came back empty — the film is still paused where you asked.');
    const problem = startClip(clip, onDone);
    if (problem) throw fail(problem);
    ctx.keepInsert(clip);
    status.textContent = '';
    sheet.hidden = true;
    const sets: Record<string, number> = {};
    for (const line of clip.lines) Object.assign(sets, line.set);
    return { kind: 'insert', says: clip.lines.map((line) => line.say), sets };
  };

  const askDeeper = async (question: string, depth: 'simpler' | 'standard' | 'deeper' = 'standard'): Promise<void> => {
    if (!anchor || !beat) {
      status.textContent = 'Play the film first, then ask.';
      return;
    }
    try {
      await runInsert(question, anchor, beat, depth);
      lastQuestion = question;
      lastDepthRung = 'deeper';
    } catch {
      // runInsert already said why on the status line.
    }
  };

  // One insert player for the deeper rung and saved inserts alike: lines in
  // order, the back-to-film beat, then an auto-resume at the anchor word.
  // onDone runs after that resume, for live voice's return to the anchor.
  const startClip = (clip: InsertClip, onDone?: () => void): string | null => {
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
        onDone?.();
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
      const session = await askSessionInfo(ctx.reference);
      const posted = await fetch(`${session.base}/ask/example`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(assemblyBody(question, anchor, beat)),
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
      const session = await askSessionInfo(ctx.reference);
      const film = ctx.film();
      const posted = await fetch(`${session.base}/ask/change`, {
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
    makeExample: async (request, anchorAt, onDone) => {
      const beatAt = ctx.film().beats.find((candidate) => candidate.id === anchorAt.beat) ?? null;
      if (!beatAt) throw new Error(`The pinned beat "${anchorAt.beat}" is no longer in this film.`);
      model.addMarker(anchorAt, request);
      return runInsert(request, anchorAt, beatAt, 'standard', onDone);
    },
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

/** What the page shows while live voice owns the film, for the panel and e2e. */
export interface LiveVoiceState {
  readonly active: boolean;
  /** True while the driver holds the film paused (a pause or interruption), until resume. */
  readonly paused: boolean;
  readonly status: string;
  readonly learner: string;
  readonly teacher: string;
  readonly tools: ReadonlyArray<{ readonly name: string; readonly phase: 'working' | 'done'; readonly detail: string }>;
  readonly error: string | null;
}

/**
 * The page's handle on live voice. Transport Play starts the teacher through
 * startForPlayback (or falls back to silent playback); Pause holds it through
 * pauseForPlayback and Play resumes it through resumePlayback.
 */
export interface LiveVoiceControls {
  /** The full start path (mic first, token, connect, driver): true when the teacher is live, false on fallback. */
  startForPlayback(): Promise<boolean>;
  /** Holds the teacher where it stands and pauses the film; silent when live never started. */
  pauseForPlayback(): void;
  /** Reads on from the held word through the driver's resume path. */
  resumePlayback(): void;
  /** Stops live voice; resumes normal playback unless the page is going away. */
  stop(resume?: boolean): void;
  state(): LiveVoiceState;
}

/** Shown when the server has no live voice: the operator never accepted retention or set no key. */
export const LIVE_VOICE_OFF_MESSAGE = 'Live voice is off on this server (set GEMINI_LIVE_RETENTION_ACCEPTED=1 with a Gemini key)';
/** The whole start sequence gets this long before the toggle gives up cleanly. */
export const LIVE_START_TIMEOUT_MS = 15000;

/** Mints one short-lived Live token through the dev server, like the ask calls. Throws plain words, never the key. */
async function mintLiveToken(): Promise<{ token: string; model: string }> {
  const token = await devToken();
  let answer: Response;
  try {
    answer = await fetch('/api/v1/live/token', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  } catch {
    throw new Error('Live voice did not answer — the dev server may be down.');
  }
  if (answer.status === 404) throw new Error(LIVE_VOICE_OFF_MESSAGE);
  if (!answer.ok) throw new Error(`Live voice did not start (the server answered ${answer.status}).`);
  const body = (await answer.json()) as { token?: unknown; model?: unknown };
  if (typeof body.token !== 'string' || body.token === '' || typeof body.model !== 'string' || body.model === '') {
    throw new Error('Live voice did not start (the token was missing).');
  }
  return { token: body.token, model: body.model };
}

/** One tool line for the voice panel, in the teacher's words. */
function liveToolLabel(name: string, args: unknown): string {
  if (name === 'show_me') {
    const set = typeof args === 'object' && args !== null ? (args as Record<string, unknown>).set : undefined;
    if (typeof set === 'object' && set !== null && !Array.isArray(set)) {
      const parts = Object.entries(set as Record<string, unknown>)
        .map(([key, value]) => `${key} = ${typeof value === 'number' ? String(value) : JSON.stringify(value) ?? '?'}`)
        .filter((part) => part !== '');
      if (parts.length > 0) return `Showing ${parts.join(', ')}`;
    }
    return 'Showing…';
  }
  switch (name) {
    case 'make_example':
      return 'Making another example…';
    case 'pause':
      return 'Pausing…';
    case 'resume':
      return 'Resuming…';
    case 'seek_beat':
      return 'Jumping to a beat…';
    case 'get_context':
      return 'Reading the scene…';
    default:
      return `${name}…`;
  }
}

/**
 * Live voice on the film page: the transport toggle, the mic, the teacher's
 * audio, the driver and the voice panel. Generic: it works for any film the
 * page plays, with no film-specific code. Leaving live mode returns the film
 * to normal playback at the current position.
 */
function buildLiveVoice(
  page: HTMLElement,
  ctx: {
    model: PlayerModel;
    controller: FilmController;
    film(): CompiledFilm;
    figure: { runtime: SceneRuntime; renderer: { apply(update: RuntimeUpdate): void } };
    ask: Pick<AskSheet, 'makeExample'>;
    mixer: FilmMixer;
    renderCaption(): void;
    liveCaption(text: string | null): void;
    /** Fires when live mode turns on or off, for the Teacher tab. */
    onLiveActive?(active: boolean): void;
  },
): LiveVoiceControls {
  // No transport button: the transport Play owns the teacher, and the ⋯
  // menu's Teacher voice switch silences it. The panel below carries the
  // status, transcripts, tool lines, typed questions and errors.
  const bar = page.querySelector('.inc-player-transport');
  const panel = document.createElement('section');
  panel.className = 'inc-live-panel';
  panel.hidden = true;
  const status = document.createElement('p');
  status.className = 'inc-live-status';
  status.setAttribute('role', 'status');
  status.textContent = 'Off';
  // A one-line note under the transport, visible whatever side tab is open:
  // why Play fell back to silent playback. The panel error says the same
  // thing for whoever has the Teacher tab open.
  const note = document.createElement('p');
  note.className = 'inc-player-livenote';
  note.setAttribute('role', 'status');
  note.hidden = true;
  if (bar) bar.after(note);
  else page.append(note);
  const setNote = (text: string | null): void => {
    note.textContent = text ?? '';
    note.hidden = text === null;
  };
  // Which model answers the live tools, once the first Ask use resolves the
  // session (or the reference fallback): the same line the sheet carries.
  const modelNote = document.createElement('p');
  modelNote.className = 'inc-live-model';
  modelNote.hidden = true;
  askModelLines.add(modelNote);
  const learnerLine = document.createElement('p');
  learnerLine.className = 'inc-live-learner';
  learnerLine.setAttribute('aria-live', 'polite');
  learnerLine.hidden = true;
  const teacherLine = document.createElement('p');
  teacherLine.className = 'inc-live-teacher';
  teacherLine.setAttribute('aria-live', 'polite');
  teacherLine.hidden = true;
  const toolList = document.createElement('ul');
  toolList.className = 'inc-live-tools';
  // Listen-and-type mode: the mic never started, so the learner writes.
  const micNote = document.createElement('p');
  micNote.className = 'inc-live-mic';
  micNote.textContent = 'Microphone is off: type your question below.';
  micNote.hidden = true;
  const askForm = document.createElement('form');
  askForm.className = 'inc-live-ask';
  const askInput = document.createElement('input');
  askInput.type = 'text';
  askInput.className = 'inc-live-input';
  askInput.setAttribute('aria-label', 'Type a question for the teacher');
  askInput.placeholder = 'Type a question…';
  askInput.autocomplete = 'off';
  const askButton = document.createElement('button');
  askButton.type = 'submit';
  askButton.className = 'inc-live-send';
  askButton.textContent = 'Ask';
  askForm.append(askInput, askButton);
  const errorLine = document.createElement('p');
  errorLine.className = 'inc-live-error';
  errorLine.setAttribute('role', 'alert');
  errorLine.hidden = true;
  panel.append(status, modelNote, micNote, learnerLine, teacherLine, toolList, askForm, errorLine);
  if (bar && bar.parentElement) bar.after(panel);
  else page.append(panel);

  let driver: LiveDriver | null = null;
  let voice: GeminiLiveVoice | null = null;
  let mic: MicrophoneHandle | null = null;
  let speaker: PcmPlayer | null = null;
  let offs: Array<() => void> = [];
  let busy = false;
  let active = false;
  let mixerWasOn = false;
  let statusText = 'Off';
  let learnerText = '';
  let teacherText = '';
  let errorText: string | null = null;
  const toolLines = new Map<string, { name: string; label: string; phase: 'working' | 'done'; item: HTMLLIElement }>();

  const setStatus = (text: string): void => {
    statusText = text;
    status.textContent = text;
  };
  const setError = (text: string | null): void => {
    errorText = text;
    errorLine.hidden = text === null;
    errorLine.textContent = text ?? '';
  };
  const setLearner = (text: string): void => {
    learnerText = text;
    learnerLine.hidden = text === '';
    learnerLine.textContent = text === '' ? '' : `Learner: ${text}`;
  };
  const setTeacher = (text: string): void => {
    teacherText = text;
    teacherLine.hidden = text === '';
    teacherLine.textContent = text === '' ? '' : `Teacher: ${text}`;
  };
  const refreshCaption = (): void => {
    ctx.liveCaption(driver ? driver.caption() : null);
    ctx.renderCaption();
  };

  const stop = (resume = true): void => {
    // A failed start still mutes the mixer, so every stop restores it; only
    // a session that owned the film resumes playback, and only clean stops
    // hide the panel — an error keeps it up with its message.
    const hadSession = active || driver !== null || mic !== null;
    active = false;
    ctx.onLiveActive?.(false);
    for (const off of offs) {
      try {
        off();
      } catch {
        // Tearing down a half-started session still restores the film.
      }
    }
    offs = [];
    try {
      driver?.stop();
    } catch {
      // The film still restores its advance mode below.
    }
    driver = null;
    voice = null;
    try {
      mic?.stop();
    } catch {
      // The mic is already gone.
    }
    mic = null;
    speaker?.close();
    speaker = null;
    toolLines.clear();
    toolList.textContent = '';
    ctx.liveCaption(null);
    ctx.renderCaption();
    ctx.mixer.setEnabled(mixerWasOn);
    setStatus('Off');
    setLearner('');
    setTeacher('');
    micNote.hidden = true;
    // A stop after a recorded failure keeps its note (a late cancel lands
    // here after the timeout already explained itself); a clean stop clears.
    if (errorText === null) setNote(null);
    if (errorText === null) panel.hidden = true;
    if (resume && hadSession) ctx.model.play();
  };

  const onVoiceEvent = (event: LiveEvent): void => {
    switch (event.type) {
      case 'speaking':
        if (event.turnId === null) setTeacher('');
        return;
      case 'transcript':
        // The beat's own lines caption the film through the driver; the
        // panel carries the teacher's own replies.
        if (event.turnId === null) setTeacher(event.text);
        refreshCaption();
        return;
      case 'learner-transcript':
        setLearner(event.text);
        setStatus('Listening…');
        return;
      case 'tool-call': {
        const label = liveToolLabel(event.name, event.args);
        const item = document.createElement('li');
        item.dataset.tool = event.name;
        item.textContent = label;
        toolList.append(item);
        while (toolList.children.length > 8) toolList.firstElementChild?.remove();
        toolLines.set(event.callId, { name: event.name, label, phase: 'working', item });
        setStatus(label);
        return;
      }
      case 'interrupted':
        // The teacher goes silent at once; the film holds where it was cut.
        speaker?.flush();
        refreshCaption();
        setStatus('Interrupted — listening…');
        return;
      case 'error':
        setError(event.message);
        stop(true);
        return;
      case 'closed':
        if (active) {
          setError('The live session closed.');
          stop(true);
        }
        return;
      default:
        return;
    }
  };

  const onDriverEvent = (event: LiveDriverEvent): void => {
    switch (event.type) {
      case 'started':
      case 'said':
        refreshCaption();
        setStatus(`Live · ${event.beat}`);
        return;
      case 'tool': {
        const line = toolLines.get(event.callId);
        if (line) {
          line.phase = 'done';
          line.item.textContent = event.result.ok ? `${line.label.replace(/…$/, '')} — done` : `${line.label.replace(/…$/, '')} — needs another try`;
        }
        return;
      }
      case 'anchor':
        refreshCaption();
        return;
      case 'done':
        setStatus('Live · the film is finished');
        return;
      case 'stopped':
        return;
      default:
        return;
    }
  };

  const start = async (): Promise<void> => {
    if (busy || active) return;
    busy = true;
    panel.hidden = false;
    setError(null);
    micNote.hidden = true;
    setStatus('Starting…');
    setNote('Starting live voice…');
    // A hung connect (or a mic prompt left open) must not strand the toggle:
    // the whole sequence gets one budget, then stops cleanly with its message.
    let cancel = false;
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      timer = null;
      cancel = true;
      stop(false);
      setError('Live voice could not connect in time.');
      setNote('Live voice could not connect in time.');
      panel.hidden = false;
    }, LIVE_START_TIMEOUT_MS);
    const done = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    try {
      const minted = await mintLiveToken();
      if (cancel) {
        stop(false);
        return;
      }
      mixerWasOn = ctx.mixer.isOn;
      ctx.mixer.setEnabled(false);
      const live = new GeminiLiveVoice({
        token: minted.token,
        model: minted.model,
        refreshToken: async () => (await mintLiveToken()).token,
      });
      voice = live;
      // The mic comes before the paid session: a denied or missing mic drops
      // into listen-and-type instead of failing the whole feature.
      let micHandle: MicrophoneHandle | null = null;
      try {
        micHandle = await startMicrophone((chunk) => {
          try {
            live.sendAudio(chunk);
          } catch {
            // A dropped socket stops the session through its own close event.
          }
        });
      } catch {
        micHandle = null;
      }
      if (cancel) {
        try {
          micHandle?.stop();
        } catch {
          // A half-started capture still stops the tracks.
        }
        stop(false);
        return;
      }
      const useDriver = new LiveDriver({
        controller: ctx.controller,
        film: ctx.film(),
        voice: live,
        runtime: ctx.figure.runtime,
        // The active scene's runtime at call time, as the Ask sheet replays:
        // cuts while live move the scene under the tools.
        showMe: (set, beat) => {
          const shown = defaultShowMeBinding(ctx.figure.runtime)(set, beat);
          ctx.figure.renderer.apply(ctx.figure.runtime.flush());
          return shown;
        },
        makeExample: (request, anchor) =>
          ctx.ask.makeExample(request, anchor, () => {
            driver?.resume();
          }),
      });
      driver = useDriver;
      offs.push(live.on(onVoiceEvent));
      offs.push(useDriver.on(onDriverEvent));
      const player = createPcmPlayer({ volume: ctx.model.state.volume });
      speaker = player;
      offs.push(live.onAudio((chunk) => player.push(chunk)));
      if (micHandle === null) micNote.hidden = false;
      await useDriver.start();
      if (cancel) {
        stop(false);
        return;
      }
      mic = micHandle;
      active = true;
      ctx.onLiveActive?.(true);
      setStatus(`Live · ${useDriver.currentBeat?.id ?? ''}`);
      setNote(null);
      refreshCaption();
      done();
    } catch (error) {
      done();
      if (cancel) return;
      const message = error instanceof Error ? error.message : 'Live voice did not start.';
      stop(false);
      setError(message);
      setNote(message);
      panel.hidden = false;
    } finally {
      busy = false;
    }
  };

  askForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = askInput.value.trim();
    const session = voice;
    const useDriver = driver;
    if (text === '' || !active || !session || !useDriver) return;
    askInput.value = '';
    // A typed cut-in pauses the film exactly like a spoken interruption,
    // then the text goes out as a learner turn for the teacher to answer.
    setLearner(text);
    useDriver.interrupt();
    session.ask(text);
  });

  // One Play owns one start: a second Play while the first connects waits
  // for it instead of failing the visit's single fallback.
  let startPromise: Promise<boolean> | null = null;
  const startForPlayback = async (): Promise<boolean> => {
    // start() never rejects: its failures land in the panel instead.
    if (active) return true;
    if (startPromise) return startPromise;
    const run = (async (): Promise<boolean> => {
      await start();
      return active;
    })();
    startPromise = run;
    try {
      return await run;
    } finally {
      if (startPromise === run) startPromise = null;
    }
  };

  return {
    startForPlayback,
    pauseForPlayback: (): void => {
      // The teacher goes silent at once and the film holds where it stands;
      // without a session this is a plain pause.
      speaker?.flush();
      try {
        driver?.interrupt();
      } catch {
        // A half-started session still pauses the film below.
      }
      ctx.model.pause();
    },
    resumePlayback: (): void => {
      if (!active) return;
      try {
        driver?.resume();
      } catch {
        // A closing session leaves the film paused where it held.
      }
    },
    stop,
    state: () => ({
      active,
      paused: driver?.isPaused() ?? false,
      status: statusText,
      learner: learnerText,
      teacher: teacherText,
      tools: [...toolLines.values()].map((line) => ({ name: line.name, phase: line.phase, detail: line.item.textContent ?? '' })),
      error: errorText,
    }),
  };
};

/** The dev token, fetched once: the ask endpoints authenticate like generation. */
let askToken: string | null = null;

async function devToken(): Promise<string> {
  askToken ??= ((await (await fetch('/api/dev/token')).json()) as { token: string }).token;
  return askToken;
}

/**
 * The model session the player's Ask lanes use, created lazily on first
 * need: the same POST the generations page makes, so a server env key
 * connects without the learner entering one. Falls back to the reference
 * path when no session can be created; `reference` pins that fallback for
 * tests that assert the reference model's answers.
 */
interface AskSession {
  readonly id: string | null;
  readonly base: string;
  readonly planModel: string | null;
  readonly sceneModel: string | null;
  readonly keySource: 'entered' | 'env' | null;
}

let askSession: AskSession | null = null;

/** Small "which model answers" lines in the Ask sheet and the voice panel. */
const askModelLines = new Set<HTMLElement>();

function showAskModel(session: AskSession): void {
  const text =
    session.sceneModel === null
      ? 'Models: reference (no model session)'
      : `Models: ${session.planModel ?? 'unknown'} (answers) · ${session.sceneModel} (examples) · ${session.keySource === 'env' ? 'server key' : 'entered key'}`;
  for (const line of askModelLines) {
    line.textContent = text;
    line.hidden = false;
  }
}

async function askSessionInfo(reference: boolean): Promise<AskSession> {
  if (askSession) return askSession;
  if (!reference) {
    try {
      let saved: { provider?: string; planModel?: string; sceneModel?: string } | null;
      try {
        saved = JSON.parse(localStorage.getItem('incantly-playground-models') ?? 'null') as {
          provider?: string;
          planModel?: string;
          sceneModel?: string;
        } | null;
      } catch {
        saved = null;
      }
      const provider = saved?.provider ?? 'anthropic';
      const planModel = saved?.planModel ?? 'claude-haiku-5-5';
      const sceneModel = saved?.sceneModel ?? 'claude-sonnet-5-5';
      const answer = await fetch('/api/dev/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider, planModel, sceneModel }),
      });
      const body = (await answer.json()) as { id?: string; baseUrl?: string; keySource?: 'entered' | 'env' };
      if (!answer.ok || !body.id || !body.baseUrl) throw new Error('The model session did not start.');
      askSession = { id: body.id, base: body.baseUrl, planModel, sceneModel, keySource: body.keySource ?? 'env' };
    } catch {
      // No key on the server, or no server at all: the reference model still
      // answers on the dev path, and the label below says so.
      askSession = { id: null, base: '/api/v1', planModel: null, sceneModel: null, keySource: null };
    }
  } else {
    askSession = { id: null, base: '/api/v1', planModel: null, sceneModel: null, keySource: null };
  }
  showAskModel(askSession);
  return askSession;
}

/** Streams an Answer, appending each delta as it arrives. */
async function streamAsk(base: string, token: string, body: Record<string, unknown>, onDelta: (delta: string) => void): Promise<{ text: string; firstChunkMs: number }> {
  const posted = await fetch(`${base}/ask`, {
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


