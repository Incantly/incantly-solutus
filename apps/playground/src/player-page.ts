import {
  anchorFor,
  applyBeatCues,
  applyStyle,
  AskReturnStack,
  askContextLine,
  attachAudio,
  beginShowMe,
  CAPTION_SCALES,
  compileFilm,
  compileTrusted,
  FilmController,
  FilmMixer,
  fontsReady,
  InsertPlayer,
  loadKitModules,
  mountTrusted,
  PlayerModel,
  probeFilmAsync,
  probeScene,
  resolveStyle,
  routeQuestion,
  solveCaption,
  validateInsertClip,
  validateScene,
  WebAudioMixerBackend,
  FILM_BEAT_HOLD_SECONDS,
  FILM_FIXTURES,
  type AskAnchor,
  type CompiledBeat,
  type CompiledFilm,
  type FilmFailure,
  type FilmFixture,
  type FilmReport,
  type KitRegistry,
  type PlayerState,
  type ProbeReport,
  type RuntimeUpdate,
  type SceneRuntime,
  type ShowMeSession,
  type StylePreset,
} from '@incantly/core';

/**
 * The film player: a silent fixture film through the real controller, player
 * and probe path. `?film=thirty|sixty` picks the film; `?preset=` and
 * `?theme=` style the figure as an integrator would; `?hide=` (comma
 * separated: captions, transcript, chapters, timeline) turns chrome off.
 * A generic consumer: no scene-specific code.
 */
export function mountPlayerPage(root: HTMLElement, params: URLSearchParams): void {
  const key = params.get('film') ?? 'thirty';
  const fixture = FILM_FIXTURES[key];
  if (!fixture) {
    root.textContent = `Unknown film "${params.get('film')}". Try one of: ${Object.keys(FILM_FIXTURES).join(', ')}`;
    return;
  }
  const status = document.createElement('p');
  status.textContent = `Loading ${fixture.storyboard.film.title}…`;
  root.append(status);
  void start(root, params, fixture).catch((error: unknown) => {
    status.textContent = `The film could not start: ${error instanceof Error ? error.message : 'unknown error'}`;
  });
}

async function start(root: HTMLElement, params: URLSearchParams, fixture: FilmFixture): Promise<void> {
  const scene = fixture.scenes[0]!;
  const validation = validateScene({ html: scene.html, css: scene.css, js: scene.js });
  if (!validation.ok || !validation.scene) throw new Error(validation.diagnostics.map((d) => d.message).join('; '));
  const kits = await loadKitModules(validation.scene.kits);
  root.textContent = '';

  const theme = params.get('theme');
  const preset = params.get('preset') as StylePreset | null;
  const hide = new Set((params.get('hide') ?? '').split(',').map((part) => part.trim()).filter(Boolean));

  // The player chrome is styled as FigureStyle slots and show flags, through
  // the same resolveStyle/applyStyle helpers and dataset convention as figures.
  const player = document.createElement('div');
  player.className = 'inc-player';
  applyStyle(player, resolveStyle({ ...(preset ? { preset } : {}), show: { captions: !hide.has('captions'), transcript: !hide.has('transcript'), chapters: !hide.has('chapters'), timeline: !hide.has('timeline') } }));
  root.append(player);

  const heading = document.createElement('h2');
  heading.textContent = fixture.storyboard.film.title;
  player.append(heading);

  // The film owns play, pause, speed and steps; the figure keeps its controls,
  // readouts, legend and description for exploring.
  const figureBox = document.createElement('div');
  figureBox.className = 'inc-player-figure';
  player.append(figureBox);
  const figure = mountTrusted(figureBox, { html: scene.html, css: scene.css, js: scene.js }, {
    kits,
    film: true,
    autoplay: false,
    theme: theme === 'light' || theme === 'dark' ? theme : 'auto',
    figureId: 'film',
    style: { ...(preset ? { preset } : {}), show: { transport: false, speed: false, steps: false, settings: false, undo: false, fullscreen: false } },
  });
  const steps = figure.runtime.beats();
  if (!steps) throw new Error('The scene has no steps');
  const compiled = compileFilm(JSON.parse(JSON.stringify(fixture.storyboard)) as unknown, [{ id: scene.id, js: scene.js, steps }]);
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

  const controller = new FilmController({
    runtime: figure.runtime,
    film,
    transport: { send: (message) => figure.renderer.send(message), apply: (update) => figure.renderer.apply(update) },
  });
  const model = new PlayerModel(controller, film);

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

  let openAsk = (): void => undefined;
  const transport = buildTransport(player, model, film, mixer, () => openAsk());
  const transcript = buildTranscript(player, model);
  buildChapters(player, model);
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

  const askUi = buildAskSheet(player, {
    model,
    controller,
    film: () => film,
    figure,
    sceneJs: scene.js,
  });
  openAsk = askUi.open;

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
  const sync = (): void => {
    const frameNow = performance.now();
    askUi.tick(Math.min(0.25, Math.max(0, (frameNow - lastFrame) / 1000)));
    lastFrame = frameNow;
    controller.poll();
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

  window.__playground = {
    ready: true,
    page: 'player',
    figure,
    controller,
    model,
    film,
    mixer,
    ask: () => askUi.state(),
    narration: () => ({ source: narrationSource, timed: film.beats.filter((beat) => beat.timed).length, beats: film.beats.length }),
    mixerEvents: () => [...mixBackend.events],
    stats: () => ({ time: controller.time, beat: controller.currentBeat?.id ?? null, playing: controller.isPlaying, controller: { ...controller.stats } }),
  };

  const runChecks = async (): Promise<void> => {
    const report = await probeFilmAsync({ film, scenes: [{ id: scene.id, scene: compileTrusted(scene.js), kits }], onProgress: (beat, beats) => badges.progress(beat, beats) });
    badges.checks(report, report.failures);
    timeline.checks(report);
  };

  // Thumbnails, the probe and the film checks run after the first paint, so the film is playable at once.
  setTimeout(() => void buildThumbs(transport.thumbs, model, film, { html: scene.html, css: scene.css, js: scene.js }, kits), 50);
  setTimeout(() => {
    void (async () => {
      // The probe measures captions on a canvas; wait for the fonts it measures in.
      await fontsReady();
      const probe = probeScene(compileTrusted(scene.js), { spec: { parts: [...scene.probe.parts], steps: scene.probe.steps }, runtime: { kits } });
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
 * both ends, never saved; empty means the server's CARTESIA_API_KEY.
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
  voice.placeholder = 'From the Voice Library or List Voices';
  voice.setAttribute('autocomplete', 'off');
  voice.setAttribute('spellcheck', 'false');
  const hint = document.createElement('p');
  hint.className = 'inc-narration-hint';
  hint.textContent = 'The key goes to the dev server only, is kept in memory on both ends, and is never saved. Without it the film stays on the stub’s silent timing.';
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
      const entered = key.value.trim();
      const answer = await fetch('/api/dev/narration-key', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...(entered ? { apiKey: entered } : {}) }),
      });
      const result = (await answer.json()) as { ok?: boolean; message?: string; source?: string };
      testStatus.textContent = `${result.ok ? '✓' : '✗'} ${result.message ?? answer.statusText} (key source: ${result.source ?? 'unknown'})`;
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
  wrap.append(summary, hint, keyLabel, voiceLabel, test, testStatus, narrate, narrateStatus);
  player.append(wrap);
}

function formatTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const minutes = Math.floor(total / 60);
  const rest = total - minutes * 60;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

function buildTransport(
  player: HTMLElement,
  model: PlayerModel,
  film: CompiledFilm,
  mixer: FilmMixer,
  onAsk: () => void,
): { syncTime(time: number, playing: boolean): void; setDuration(seconds: number): void; thumbs: HTMLElement } {
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
  const thumbs = document.createElement('div');
  thumbs.className = 'inc-player-thumbs';
  bar.append(play, ask, time, scrubWrap, speed, volume, sound, captions, size);
  player.append(bar, thumbs);
  return {
    thumbs,
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
  state(): { sheet: boolean; answer: string; markers: number; stack: number; insert: string | null; remaining: number; showme: string | null };
}

function buildAskSheet(
  player: HTMLElement,
  ctx: {
    model: PlayerModel;
    controller: FilmController;
    film: () => CompiledFilm;
    figure: { runtime: SceneRuntime; renderer: { apply(update: RuntimeUpdate): void } };
    sceneJs: string;
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
  const speakStatus = document.createElement('span');
  speakStatus.className = 'inc-ask-speak-status';
  const status = document.createElement('p');
  status.className = 'inc-ask-status';
  const row = document.createElement('div');
  row.className = 'inc-ask-row';
  row.append(input, send, close);
  const speakRow = document.createElement('div');
  speakRow.className = 'inc-ask-row';
  speakRow.append(hear, speakStatus);
  sheet.append(context, row, chips, answer, speakRow, status);

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
  player.append(sheet, showmeBanner, insertBanner);

  let anchor: AskAnchor | null = null;
  let beat: CompiledBeat | null = null;
  let lastAnswer = '';
  let showme: ShowMeSession | null = null;
  const thread: Array<{ q: string; a: string }> = [];
  const stack = new AskReturnStack();
  const players: InsertPlayer[] = [];

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
  };

  const assemblyBody = (question: string): Record<string, unknown> => {
    const film = ctx.film();
    const lines = controller.transcript();
    const at = lines.findIndex((line) => line.beat === anchor?.beat);
    const neighbours = lines.slice(Math.max(0, at - 1), at + 2).filter((line) => line.beat !== anchor?.beat);
    const jsLines = ctx.sceneJs.split('\n');
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
    };
  };

  const askAnswer = async (question: string): Promise<void> => {
    status.textContent = 'Answering…';
    answer.textContent = '';
    hear.disabled = true;
    speakStatus.textContent = '';
    try {
      const token = await devToken();
      const full = await streamAsk(token, assemblyBody(question), (delta) => {
        answer.textContent += delta;
      });
      lastAnswer = full.text;
      hear.disabled = full.text === '';
      thread.push({ q: question, a: full.text });
      while (thread.length > 6) thread.shift();
      status.textContent = `First words in ${Math.round(full.firstChunkMs)} ms.`;
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

  const askDeeper = async (question: string): Promise<void> => {
    status.textContent = 'Writing the insert…';
    try {
      const token = await devToken();
      const params = Object.keys(figure.runtime.values());
      const posted = await fetch('/api/v1/ask/insert', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ...assemblyBody(question), params }),
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
      if (!stack.push(anchor)) {
        status.textContent = 'Finish this question first — questions nest two deep.';
        return;
      }
      const nested = players.length > 0;
      const clip = { ...validated.clip, anchor };
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
        status.textContent = 'The film moved on — ask again where you are.';
        return;
      }
      status.textContent = '';
      sheet.hidden = true;
      insertBanner.hidden = false;
    } catch {
      status.textContent = 'No insert came back — the film is still paused where you asked.';
    }
  };

  const submit = (text: string, rung?: 'answer' | 'showme' | 'deeper'): void => {
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
    else void askAnswer(question);
  };
  send.addEventListener('click', () => submit(input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit(input.value);
  });
  for (const [label, lane] of [['Explain this step', 'answer'], ['Show me', 'showme'], ['Explain deeper', 'deeper']] as const) {
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
          body: JSON.stringify({ text: lastAnswer }),
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
    tick(dt: number): void {
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

async function buildThumbs(thumbs: HTMLElement, model: PlayerModel, film: CompiledFilm, fragments: { html: string; css: string; js: string }, kits: KitRegistry): Promise<void> {
  const box = document.createElement('div');
  box.hidden = true;
  document.body.append(box);
  try {
    const figure = mountTrusted(box, fragments, { kits, film: true, autoplay: false, figureId: 'thumbs' });
    figure.runtime.setReducedMotion(true);
    for (const at of model.thumbTimes(5)) {
      // Each thumbnail seeks the scene to its time and applies the beat there, as the checks do.
      let beat = film.beats[0]!;
      for (const candidate of film.beats) if (at + 1e-9 >= candidate.start) beat = candidate;
      const update = figure.runtime.seek(at);
      figure.runtime.step('goto', beat.index);
      applyBeatCues(figure.runtime, beat.step, { sfx: false });
      figure.runtime.redraw();
      const extra = figure.runtime.flush();
      figure.renderer.apply({ ...update, commands: [...update.commands, ...extra.commands] });
      const svg = box.querySelector('svg.inc-stage');
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
    figure.destroy();
  } finally {
    box.remove();
  }
}
