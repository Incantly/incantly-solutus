import type { LearnerRequest } from '../context';
import type {
  ChangeRequest,
  ChangeResponse,
  GalleryCard,
  GalleryFigure,
  GalleryReceipt,
  GallerySubmission,
  ProbeResponse,
  ProbeResult,
  RepairRequest,
  RepairResponse,
  ServiceEvent,
} from '../protocol';

/**
 * The browser's side of the generation service: start a generation and read
 * its event stream, report the device's probe result, and ask for a figure's
 * background repair. Browser-safe.
 */

export interface GenerationClientOptions {
  /** Where the service is mounted, e.g. https://generate.example.com/v1 or /api/v1. */
  readonly baseUrl: string;
  /** The learner's current token, minted by the host's backend. */
  readonly token: () => string | Promise<string>;
  readonly fetch?: typeof fetch;
}

/** The service refused or failed before a generation could start. */
export class ServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

const EVENT_TYPES = new Set(['accepted', 'plan', 'fragment', 'scene', 'fallback']);

export class GenerationClient {
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: GenerationClientOptions) {
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  }

  private async headers(): Promise<Record<string, string>> {
    return { authorization: `Bearer ${await this.options.token()}`, 'content-type': 'application/json' };
  }

  private async refusal(response: Response): Promise<ServiceError> {
    let code = 'error';
    let message = `The service answered ${response.status}`;
    try {
      const body = (await response.json()) as { code?: unknown; message?: unknown };
      if (typeof body.code === 'string') code = body.code;
      if (typeof body.message === 'string') message = body.message;
    } catch {
      // Not JSON.
    }
    const retry = Number(response.headers.get('retry-after'));
    return new ServiceError(response.status, code, message, Number.isFinite(retry) && retry > 0 ? retry : null);
  }

  /** Starts a generation and yields its events as they arrive. */
  async *generate(request: LearnerRequest, signal?: AbortSignal): AsyncGenerator<ServiceEvent> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.options.baseUrl}/generations`, {
        method: 'POST',
        headers: await this.headers(),
        body: JSON.stringify(request),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ServiceError(0, 'network', 'The figure service could not be reached');
    }
    if (!response.ok) throw await this.refusal(response);
    if (!response.body) throw new ServiceError(response.status, 'protocol', 'The service sent no events');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const event = parseEvent(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          if (event) yield event;
          boundary = buffer.indexOf('\n\n');
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /** Asks for a background repair of a figure that hit a problem while live (RP-7). */
  async repair(request: RepairRequest, signal?: AbortSignal): Promise<RepairResponse> {
    return this.postJson<RepairResponse>('repairs', request, signal);
  }

  /** Asks for a change to a figure the learner has, in their words (HO-8). */
  async change(request: ChangeRequest, signal?: AbortSignal): Promise<ChangeResponse> {
    return this.postJson<ChangeResponse>('changes', request, signal);
  }

  /** Publishes a finished figure to the community gallery, where it waits for a reviewer (GL-1). */
  async publish(submission: GallerySubmission, signal?: AbortSignal): Promise<GalleryReceipt> {
    return this.postJson<GalleryReceipt>('gallery', submission, signal);
  }

  /** The figures reviewers accepted, newest first. */
  async gallery(signal?: AbortSignal): Promise<readonly GalleryCard[]> {
    return (await this.getJson<{ figures: GalleryCard[] }>('gallery', signal)).figures;
  }

  /** One accepted figure, with its fragments and a ticket of its own, to add to a note. */
  async galleryFigure(id: string, signal?: AbortSignal): Promise<GalleryFigure> {
    return this.getJson<GalleryFigure>(`gallery/${encodeURIComponent(id)}`, signal);
  }

  private async getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.options.baseUrl}/${path}`, { method: 'GET', headers: await this.headers(), ...(signal ? { signal } : {}) });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ServiceError(0, 'network', 'The figure service could not be reached');
    }
    if (!response.ok) throw await this.refusal(response);
    return (await response.json()) as T;
  }

  private async postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.options.baseUrl}/${path}`, {
        method: 'POST',
        headers: await this.headers(),
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ServiceError(0, 'network', 'The figure service could not be reached');
    }
    if (!response.ok) throw await this.refusal(response);
    return (await response.json()) as T;
  }

  /** Reports what the device's probe found, and gets back the next step. */
  async reportProbe(generationId: string, result: ProbeResult, signal?: AbortSignal): Promise<ProbeResponse> {
    const response = await this.fetcher(`${this.options.baseUrl}/generations/${encodeURIComponent(generationId)}/probe`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify(result),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw await this.refusal(response);
    return (await response.json()) as ProbeResponse;
  }
}

function parseEvent(block: string): ServiceEvent | null {
  let type = '';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) type = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (!EVENT_TYPES.has(type) || data.length === 0) return null;
  try {
    return { type, ...(JSON.parse(data.join('\n')) as object) } as ServiceEvent;
  } catch {
    return null;
  }
}
