/**
 * Which agent the studio's Board mode uses (server design 8, R7.2): the server's, when `GET /v1/health` answers and a
 * model is ready, else the scripted demo agent labelled "no AI". The board opens at once with the demo agent; when the
 * probe finds a ready server, `connectBoardAgent` gives the board the HTTP transport (same origin: the dev server proxies
 * `/v1`, so the address is empty) and changes the label. A circle sends a picture of the circled area (the board draws it
 * 512 pixels at most), which the server hands to its vision models; the demo agent ignores it.
 */
import { httpAgentTransport } from '@incantly/board';
import type { AgentOption, BoardView } from '@incantly/board';
import { DEMO_LABEL, demoAgentTransport } from './board-demo-agent';
import type { ServerHealth } from './server';

/** The line under the panel's title when the server's AI is the agent. */
export const AI_LABEL = 'Free AI models; check what it draws';

/** The `agent` option the board is made with: the scripted demo agent, labelled as such. */
export function boardAgentOption(): AgentOption {
  return { transport: demoAgentTransport, vision: true, label: DEMO_LABEL };
}

/** Gives a board the server's agent when the probe found a model ready; otherwise the demo agent stays. */
export function connectBoardAgent(view: BoardView, health: ServerHealth | undefined): void {
  if (health?.ready !== true) return;
  view.agent.service.setTransport(httpAgentTransport(''));
  const label = view.element.querySelector('.ib-agent-demo');
  if (label !== null) label.textContent = AI_LABEL;
}
