import { sandboxAdapter, VALIDATOR_VERSION } from '@incantly/core';
import { GenerationClient, Telemetry, figureGenerator, type TelemetryEvent } from '@incantly/generation/client';
import { FigureGeneration, FigureNode, MemoryFigureStore, flushFigures, newFigureId, type FigureGenerate, type FigureGenerationResult, type FigureRequest, type GenerationStageView, type SkeletonView } from '@incantly/tiptap';
import { Editor, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

interface Turn { editor: Editor; readonly host: HTMLElement; readonly generate: FigureGenerate }
interface Chat {
  id: string;
  title: string;
  createdAt: Date;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

function sourcePanel(result: Extract<FigureGenerationResult, { kind: 'figure' }>): HTMLElement {
  const details = document.createElement('details');
  details.className = 'agent-source';
  const summary = document.createElement('summary');
  summary.textContent = 'Inspect generated source';
  details.append(summary);
  for (const [name, source] of Object.entries(result.figure.fragments)) {
    const section = document.createElement('section');
    const heading = document.createElement('h4');
    heading.textContent = name.toUpperCase();
    const code = document.createElement('code');
    code.textContent = source;
    section.append(heading, code);
    details.append(section);
  }
  return details;
}

export function mountGeneratePage(root: HTMLElement, params: URLSearchParams): void {
  const signals: TelemetryEvent[] = [];
  const telemetry = new Telemetry({ sink: (events) => void signals.push(...events), batchSize: 1 });
  const store = new MemoryFigureStore();
  const turns: Turn[] = [];
  const chats: Chat[] = [];
  let currentChatId: string | null = null;
  let sessionId: string | null = null;
  let latest: Turn | null = null;
  let token: string | null = null;
  let client: GenerationClient | null = null;

  const sidebar = document.createElement('aside');
  sidebar.className = 'sidebar';
  sidebar.innerHTML = `
    <div class="sidebar-header">
      <button class="new-chat-btn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        New chat
      </button>
    </div>
    <div class="chat-list"></div>
    <div class="sidebar-footer">
      <button class="settings-btn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
        Settings
      </button>
    </div>
  `;

  const settingsModal = document.createElement('div');
  settingsModal.className = 'settings-modal';
  settingsModal.hidden = true;
  settingsModal.innerHTML = `
    <div class="settings-content">
      <div class="settings-header">
        <h2>Settings</h2>
        <button class="close-settings-btn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="settings-body">
        <div class="setting-group">
          <label for="planning-model">Planning Model</label>
          <p class="setting-description">A fast model that plans what the figure will teach (default: Haiku)</p>
          <select id="planning-model" class="setting-select">
            <option value="claude-haiku-5-5">Claude Haiku 5.5</option>
            <option value="claude-sonnet-5-5">Claude Sonnet 5.5</option>
            <option value="claude-opus-5-5">Claude Opus 5.5</option>
          </select>
        </div>
        <div class="setting-group">
          <label for="scene-model">Scene Generation Model</label>
          <p class="setting-description">A capable model that builds the interactive scene (default: Sonnet)</p>
          <select id="scene-model" class="setting-select">
            <option value="claude-haiku-5-5">Claude Haiku 5.5</option>
            <option value="claude-sonnet-5-5" selected>Claude Sonnet 5.5</option>
            <option value="claude-opus-5-5">Claude Opus 5.5</option>
          </select>
        </div>
        <div class="setting-group">
          <label for="api-key">API Key (Optional)</label>
          <p class="setting-description">Your Anthropic API key. Leave empty to use the dev server's ANTHROPIC_API_KEY.</p>
          <input type="password" id="api-key" class="setting-input" placeholder="sk-ant-..." autocomplete="off">
          <button type="button" class="test-key-btn">Test connection</button>
          <p class="test-key-status" hidden></p>
        </div>
      </div>
    </div>
  `;
  root.append(settingsModal);

  const mainContent = document.createElement('main');
  mainContent.className = 'main-content';

  const chatHeader = document.createElement('header');
  chatHeader.className = 'chat-header';
  const chatTitleEl = document.createElement('div');
  chatTitleEl.className = 'chat-title';
  chatTitleEl.textContent = 'Generate and inspect scenes';
  const galleryBtn = document.createElement('button');
  galleryBtn.type = 'button';
  galleryBtn.className = 'gallery-btn';
  galleryBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg><span>Gallery of generations</span>';
  galleryBtn.addEventListener('click', () => {
    location.href = '/?page=gallery';
  });
  chatHeader.append(chatTitleEl, galleryBtn);

  const messagesContainer = document.createElement('div');
  messagesContainer.className = 'messages-container';

  const welcomeScreen = document.createElement('div');
  welcomeScreen.className = 'welcome-screen';
  welcomeScreen.innerHTML = `
    <h1 class="welcome-title">Incantly SDK Playground</h1>
    <p class="welcome-subtitle">Generate interactive teaching scenes with the SDK contract</p>
  `;
  messagesContainer.append(welcomeScreen);

  const inputContainer = document.createElement('div');
  inputContainer.className = 'input-container';
  inputContainer.innerHTML = `
    <div class="input-wrapper">
      <textarea class="input-box" placeholder="Describe the teaching scene you want..." rows="1"></textarea>
      <button class="send-btn" disabled>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
      </button>
    </div>
  `;

  mainContent.append(chatHeader, messagesContainer, inputContainer);
  root.append(sidebar, mainContent);

  const inputBox = inputContainer.querySelector('.input-box') as HTMLTextAreaElement;
  const sendBtn = inputContainer.querySelector('.send-btn') as HTMLButtonElement;
  const newChatBtn = sidebar.querySelector('.new-chat-btn') as HTMLButtonElement;
  const chatList = sidebar.querySelector('.chat-list') as HTMLDivElement;
  const settingsBtn = sidebar.querySelector('.settings-btn') as HTMLButtonElement;
  const closeSettingsBtn = settingsModal.querySelector('.close-settings-btn') as HTMLButtonElement;
  const planningModelSelect = settingsModal.querySelector('#planning-model') as HTMLSelectElement;
  const sceneModelSelect = settingsModal.querySelector('#scene-model') as HTMLSelectElement;
  const apiKeyInput = settingsModal.querySelector('#api-key') as HTMLInputElement;

  settingsBtn.addEventListener('click', () => {
    settingsModal.hidden = false;
  });

  closeSettingsBtn.addEventListener('click', () => {
    settingsModal.hidden = true;
  });

  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.hidden = true;
    }
  });

  const testKeyBtn = settingsModal.querySelector('.test-key-btn') as HTMLButtonElement;
  const testKeyStatus = settingsModal.querySelector('.test-key-status') as HTMLParagraphElement;
  testKeyBtn.addEventListener('click', async () => {
    testKeyBtn.disabled = true;
    testKeyStatus.hidden = false;
    testKeyStatus.className = 'test-key-status pending';
    testKeyStatus.textContent = 'Checking with Anthropic…';
    try {
      const answer = await fetch('/api/dev/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKeyInput.value || undefined }),
      });
      const result = (await answer.json()) as { ok?: boolean; message?: string; source?: string };
      testKeyStatus.className = `test-key-status ${result.ok ? 'ok' : 'fail'}`;
      testKeyStatus.textContent = `${result.ok ? '✓' : '✗'} ${result.message ?? answer.statusText} (key source: ${result.source ?? 'unknown'})`;
    } catch (error) {
      testKeyStatus.className = 'test-key-status fail';
      testKeyStatus.textContent = `✗ The check itself failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      testKeyBtn.disabled = false;
    }
  });

  inputBox.addEventListener('input', () => {
    sendBtn.disabled = !inputBox.value.trim();
    inputBox.style.height = 'auto';
    inputBox.style.height = Math.min(inputBox.scrollHeight, 200) + 'px';
  });

  inputBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (inputBox.value.trim() && !sendBtn.disabled) {
        handleSend();
      }
    }
  });

  function startNewChat(): void {
    const chatId = crypto.randomUUID();
    const chat: Chat = {
      id: chatId,
      title: 'New chat',
      createdAt: new Date(),
      messages: [],
    };
    chats.unshift(chat);
    currentChatId = chatId;
    renderChatList();
    messagesContainer.innerHTML = '';
    messagesContainer.append(welcomeScreen);
    inputBox.value = '';
    sendBtn.disabled = true;
    chatTitleEl.textContent = 'New chat';
    welcomeScreen.querySelector('.welcome-title')!.textContent = 'Incantly SDK Playground';
    welcomeScreen.querySelector('.welcome-subtitle')!.textContent = 'Generate interactive teaching scenes with the SDK contract';
  }

  newChatBtn.addEventListener('click', startNewChat);

  function renderChatList(): void {
    chatList.innerHTML = '';
    chats.forEach((chat) => {
      const chatItem = document.createElement('div');
      chatItem.className = `chat-item ${chat.id === currentChatId ? 'active' : ''}`;
      chatItem.innerHTML = `
        <svg class="chat-item-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        <span>${chat.title}</span>
      `;
      chatItem.addEventListener('click', () => selectChat(chat.id));
      chatList.append(chatItem);
    });
  }

  function selectChat(chatId: string): void {
    currentChatId = chatId;
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;
    chatTitleEl.textContent = chat.title;
    renderChatList();
    renderMessages(chat);
  }

  function renderMessages(chat: Chat): void {
    messagesContainer.innerHTML = '';
    if (chat.messages.length === 0) {
      messagesContainer.append(welcomeScreen);
      return;
    }
    chat.messages.forEach((msg) => {
      const messageEl = document.createElement('div');
      messageEl.className = `message ${msg.role}`;
      messageEl.innerHTML = `
        <div class="message-avatar">${msg.role === 'user' ? 'U' : 'AI'}</div>
        <div class="message-content"><p>${msg.content}</p></div>
      `;
      messagesContainer.append(messageEl);
    });
  }

  function createEditor(host: HTMLElement, content: JSONContent | string, generate: FigureGenerate): Editor {
    return new Editor({
      element: host,
      extensions: [
        StarterKit,
        FigureNode.configure({
          adapter: sandboxAdapter,
          store,
          signals: telemetry.emit,
          onError: (report) => telemetry.emit({ type: 'figure-failure', figureId: report.figureId, ...(report.generationId ? { generationId: report.generationId } : {}), kind: report.error.phase, fatal: report.fatal, values: report.values }),
        }),
        FigureGeneration.configure({ generate }),
      ],
      content,
      editorProps: { attributes: { class: 'editor', 'aria-label': 'Generated figure' } },
    });
  }

  function useClient(baseUrl: string, _label: string): void {
    token = null;
    client = new GenerationClient({ baseUrl, token: async () => (token ??= ((await (await fetch('/api/dev/token')).json()) as { token: string }).token) });
    inputBox.disabled = false;
    sendBtn.disabled = !inputBox.value.trim();
  }

  const handle = {
    ready: true,
    page: 'generate',
    editor: undefined as Editor | undefined,
    signals,
    reopen: () => {
      if (!latest) return;
      flushFigures(latest.editor);
      const saved = latest.editor.getJSON();
      latest.editor.destroy();
      latest.host.replaceChildren();
      latest.editor = createEditor(latest.host, saved, latest.generate);
      handle.editor = latest.editor;
    },
    records: async () => {
      const records = (await (await fetch('/api/dev/records')).json()) as Array<{ id?: unknown }>;
      const generationId = latest?.editor.getJSON().content?.find((node) => node.type === 'incantlyFigure')?.attrs?.meta?.generationId;
      return typeof generationId === 'string' ? records.filter((record) => record.id === generationId) : records;
    },
    setGeneration: async (on: boolean) => fetch(`/api/dev/switch?on=${on ? 1 : 0}`),
  };
  window.__playground = handle as unknown as typeof window.__playground;

  /** Everything that failed before or during the launch, shown as one assistant line. */
  function showAssistantError(message: string): void {
    const errorMessage = document.createElement('div');
    errorMessage.className = 'message assistant';
    errorMessage.innerHTML = `
      <div class="message-avatar">AI</div>
      <div class="message-content"><p class="generation-error"></p></div>
    `;
    (errorMessage.querySelector('.generation-error') as HTMLElement).textContent = message;
    if (welcomeScreen.parentNode) welcomeScreen.remove();
    messagesContainer.append(errorMessage);
    errorMessage.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }

  function settleStages(plan: HTMLElement, scene: HTMLElement, outputs: Array<HTMLDivElement>): void {
    for (const stage of [plan, scene]) {
      const indicator = stage.querySelector('.stage-indicator');
      if (indicator) (indicator as HTMLElement).hidden = true;
    }
    for (const output of outputs) output.classList.add('finished');
  }

  async function launchGeneration(): Promise<void> {
    const request = inputBox.value.trim();
    if (!request) return;

    if (!currentChatId) startNewChat();
    const chat: Chat | undefined = chats.find(c => c.id === currentChatId);
    if (!chat) return;
    const activeChat: Chat = chat;

    if (!client) {
      const setupResponse = await fetch('/api/dev/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ 
          apiKey: apiKeyInput.value || undefined, 
          planModel: planningModelSelect.value, 
          sceneModel: sceneModelSelect.value 
        }),
      });
      const answer = (await setupResponse.json()) as { id?: string; baseUrl?: string; message?: string };
      if (!setupResponse.ok || !answer.id || !answer.baseUrl) throw new Error(answer.message ?? 'Failed to start session');
      sessionId = answer.id;
      useClient(answer.baseUrl, sceneModelSelect.selectedOptions[0]?.textContent ?? sceneModelSelect.value);
    }

    activeChat.messages.push({ role: 'user', content: request });
    if (activeChat.messages.length === 1) {
      const title = request.slice(0, 30) + (request.length > 30 ? '...' : '');
      activeChat.title = title;
      chatTitleEl.textContent = title;
      renderChatList();
    }

    const userMessage = document.createElement('div');
    userMessage.className = 'message user';
    userMessage.innerHTML = `
      <div class="message-avatar">U</div>
      <div class="message-content"><p>${request}</p></div>
    `;
    if (welcomeScreen.parentNode) welcomeScreen.remove();
    messagesContainer.append(userMessage);

    const assistantMessage = document.createElement('div');
    assistantMessage.className = 'message assistant';
    assistantMessage.innerHTML = `
      <div class="message-avatar">AI</div>
      <div class="message-content">
        <div class="generation-stage">
          <div class="stage-header">
            <p class="stage-label">Planning</p>
            <div class="stage-indicator"></div>
          </div>
          <div class="plan-output streaming-text"></div>
        </div>
        <div class="generation-stage" hidden>
          <div class="stage-header">
            <p class="stage-label">Building Scene</p>
            <div class="stage-indicator"></div>
          </div>
          <div class="scene-output streaming-text"></div>
        </div>
        <div class="generation-stage" hidden>
          <div class="stage-header">
            <p class="stage-label">Validating</p>
          </div>
          <p class="validation-status"></p>
        </div>
      </div>
    `;
    messagesContainer.append(assistantMessage);
    
    const planStage = assistantMessage.querySelectorAll('.generation-stage')[0] as HTMLElement;
    const sceneStage = assistantMessage.querySelectorAll('.generation-stage')[1] as HTMLElement;
    const validationStage = assistantMessage.querySelectorAll('.generation-stage')[2] as HTMLElement;
    const planOutput = planStage.querySelector('.plan-output') as HTMLDivElement;
    const sceneOutput = sceneStage.querySelector('.scene-output') as HTMLDivElement;
    const validationStatus = validationStage.querySelector('.validation-status') as HTMLParagraphElement;

    inputBox.value = '';
    sendBtn.disabled = true;
    inputBox.style.height = 'auto';

    const baseGenerate = figureGenerator({ client: client!, signals: telemetry.emit });
    async function generate(figureRequest: FigureRequest, hooks: Parameters<FigureGenerate>[1]): Promise<FigureGenerationResult> {
      let planText = '';
      let sceneText = '';
      
      const result = await baseGenerate(figureRequest, {
        ...hooks,
        onText: (purpose, delta) => {
          if (purpose === 'plan') {
            planText += delta;
            planOutput.textContent = planText;
            planOutput.scrollTop = planOutput.scrollHeight;
          } else if (purpose === 'scene') {
            sceneText += delta;
            sceneOutput.textContent = sceneText;
            sceneOutput.scrollTop = sceneOutput.scrollHeight;
          }
        },
        onSkeleton: (skeleton: SkeletonView) => {
          hooks.onSkeleton(skeleton);
          const summary = document.createElement('div');
          summary.className = 'plan-summary';
          summary.innerHTML = `
            <div class="skeleton-header">
              <strong>📋 ${skeleton.concept}</strong>
            </div>
            <div class="skeleton-details">
              <span>${skeleton.parameters.length} parameters</span>
              <span>•</span>
              <span>${skeleton.steps} steps</span>
            </div>
          `;
          planOutput.insertBefore(summary, planOutput.firstChild);
        },
        onStage: (stage: GenerationStageView) => {
          hooks.onStage(stage);
          if (stage === 'planning') {
            planStage.hidden = false;
            sceneStage.hidden = true;
            validationStage.hidden = true;
          } else if (stage === 'building') {
            planStage.hidden = false;
            sceneStage.hidden = false;
            sceneStage.querySelector('.stage-label')!.textContent = 'Building Scene';
          } else if (stage === 'checking') {
            validationStage.hidden = false;
            validationStatus.textContent = 'Running device probe...';
          } else if (stage === 'repairing') {
            validationStatus.textContent = 'Repairing scene...';
          }
        },
      });
      
      if (result.kind === 'figure') {
        settleStages(planStage, sceneStage, [planOutput, sceneOutput]);
        validationStatus.textContent = result.notice ?? '✓ Probe passed';
        validationStatus.style.color = 'green';

        const host = document.createElement('div');
        host.className = 'figure-container';
        assistantMessage.querySelector('.message-content')!.append(host);
        const sourceEl = sourcePanel(result);
        assistantMessage.querySelector('.message-content')!.append(sourceEl);
        const editor = createEditor(host, '<p></p>', generate);
        const turn = { editor, host, generate };
        turns.push(turn);
        latest = turn;
        handle.editor = editor;
        // The figure is already approved; insert it with its fragments. The
        // generateFigure command would run this checker flow all over again.
        editor.commands.insertFigure({
          figureId: newFigureId(),
          concept: result.figure.concept,
          fragments: result.figure.fragments,
          description: result.figure.description,
          meta: {
            ...(result.figure.generationId ? { generationId: result.figure.generationId } : {}),
            approvedAt: result.figure.approvedAt,
            validatorVersion: VALIDATOR_VERSION,
          },
        });
        activeChat.messages.push({ role: 'assistant', content: 'Generated interactive figure.' });
      } else {
        // The fallback is the outcome: it never reaches the 'checking' stage,
        // so reveal the validation stage and stop the pulsing indicators —
        // otherwise the failure would sit hidden under a forever-pulsing plan.
        settleStages(planStage, sceneStage, [planOutput, sceneOutput]);
        validationStage.hidden = false;
        sceneStage.hidden = true;
        validationStatus.textContent = `✗ ${result.message}`;
        validationStatus.style.color = 'red';
        activeChat.messages.push({ role: 'assistant', content: result.message });
      }
      return result;
    };

    // Kick the run off: the wrapper above is also the editor's regeneration
    // hook, but the first run starts here — waiting for an editor command
    // meant the request was never sent at all.
    void generate({ prompt: request }, {
      onSkeleton: () => {},
      onStage: () => {},
      signal: new AbortController().signal,
    }).catch((error: unknown) => {
      settleStages(planStage, sceneStage, [planOutput, sceneOutput]);
      showAssistantError(error instanceof Error ? error.message : String(error));
    });

    assistantMessage.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }

  async function handleSend(): Promise<void> {
    try {
      await launchGeneration();
    } catch (error) {
      // A throw here means nothing was generated at all — the learner must
      // see why instead of a composer that silently swallows the send.
      showAssistantError(error instanceof Error ? error.message : String(error));
    }
  }

  sendBtn.addEventListener('click', handleSend);

  const fault = params.get('fault');
  if (params.get('reference') === '1' || fault) {
    useClient(fault && /^[a-z-]+$/.test(fault) ? `/api/fault/${fault}/v1` : '/api/v1', 'Reference model');
  }

  void (async () => {
    try {
      const setupResponse = await fetch('/api/dev/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKeyInput.value || undefined,
          planModel: planningModelSelect.value,
          sceneModel: sceneModelSelect.value
        }),
      });
      const answer = (await setupResponse.json()) as { id?: string; baseUrl?: string; message?: string };
      if (setupResponse.ok && answer.id && answer.baseUrl) {
        sessionId = answer.id;
        useClient(answer.baseUrl, sceneModelSelect.selectedOptions[0]?.textContent ?? sceneModelSelect.value);
      }
    } catch (_e) {
      // Fail silently if no session is available
    }
    // A prompt handed over from the gallery generates on arrival.
    const handed = params.get('prompt');
    if (handed) {
      inputBox.value = handed;
      inputBox.dispatchEvent(new Event('input'));
      await handleSend();
      // Clean the address so a reload does not start the same generation twice.
      history.replaceState(null, '', '/?page=generate');
    }
  })();

  window.addEventListener('pagehide', () => {
    for (const turn of turns) turn.editor.destroy();
    if (sessionId) void fetch(`/api/dev/session/${sessionId}`, { method: 'DELETE', keepalive: true });
  }, { once: true });
}
