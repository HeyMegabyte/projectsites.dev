/**
 * Embedded mode detection and postMessage bridge for bolt.diy.
 *
 * When bolt.diy is loaded inside an iframe on projectsites.dev,
 * this module handles communication between the parent (Angular admin)
 * and the child (bolt.diy React app) via postMessage.
 *
 * @module embed/embedded-mode
 */

// ── Types ────────────────────────────────────────────────────

/** Parent → Child messages */
export interface SubmitPromptMessage {
  type: 'PS_SUBMIT_PROMPT';
  prompt: string;
  siteId: string;
  slug: string;
  correlationId: string;
}

export interface ImportFilesMessage {
  type: 'PS_IMPORT_FILES';
  files: Record<string, string>; // path → content (text only)
  siteId: string;
  slug: string;
  correlationId: string;
}

export interface RequestFilesMessage {
  type: 'PS_REQUEST_FILES';
  includeChat?: boolean;
  correlationId: string;
}

export interface LoadBuildContextMessage {
  type: 'PS_LOAD_BUILD_CONTEXT';
  contextUrl: string;
  siteId: string;
  slug: string;
  correlationId: string;
}

/** Child → Parent messages */
export interface BoltReadyMessage {
  type: 'PS_BOLT_READY';
}

export interface FilesReadyMessage {
  type: 'PS_FILES_READY';
  files: Record<string, string>;
  chat?: { messages: unknown[]; description?: string; exportDate: string };
  correlationId: string;
}

export interface GenerationStatusMessage {
  type: 'PS_GENERATION_STATUS';
  status: 'idle' | 'generating' | 'complete' | 'error';
  error?: string;
  correlationId: string;
}

export type ParentToChildMessage = SubmitPromptMessage | ImportFilesMessage | RequestFilesMessage | LoadBuildContextMessage;
export type ChildToParentMessage = BoltReadyMessage | FilesReadyMessage | GenerationStatusMessage;

// ── Allowed origins ──────────────────────────────────────────

const ALLOWED_ORIGINS = new Set([
  'https://projectsites.dev',
  'http://localhost:4200',
  'http://localhost:4300',
]);

// ── Detection (synchronous — must run before WebContainer boot) ──

function detectEmbedded(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    const inIframe = window.parent !== window;
    const hasParam = new URLSearchParams(window.location.search).has('embedded');

    return inIframe && hasParam;
  } catch {
    // Cross-origin access to window.parent may throw
    return false;
  }
}

/** True when bolt.diy is loaded inside a projectsites.dev iframe */
export const isEmbedded: boolean = detectEmbedded();

// ── postMessage helpers ──────────────────────────────────────

/** Send a message to the parent frame (projectsites.dev admin). */
export function postToParent(message: ChildToParentMessage): void {
  if (!isEmbedded || typeof window === 'undefined') {
    return;
  }

  // Post to all allowed origins (parent origin is unknown at send time)
  window.parent.postMessage(message, '*');
}

/** Validate that a MessageEvent comes from an allowed origin. */
function isAllowedOrigin(event: MessageEvent): boolean {
  return ALLOWED_ORIGINS.has(event.origin);
}

/** Check if a message has the PS_ prefix (our protocol). */
function isPSMessage(data: unknown): data is ParentToChildMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    typeof (data as { type: unknown }).type === 'string' &&
    (data as { type: string }).type.startsWith('PS_')
  );
}

// ── Message listener ─────────────────────────────────────────

type MessageHandler = (message: ParentToChildMessage) => void;
const handlers: MessageHandler[] = [];

/** Register a handler for incoming parent messages. Returns an unsubscribe function. */
export function onParentMessage(handler: MessageHandler): () => void {
  handlers.push(handler);

  return () => {
    const idx = handlers.indexOf(handler);

    if (idx >= 0) {
      handlers.splice(idx, 1);
    }
  };
}

function handleMessage(event: MessageEvent): void {
  // Debug: log all messages when embedded
  if (isEmbedded && event.data?.type?.startsWith?.('PS_')) {
    console.warn('[embed] Received postMessage:', event.data.type, 'from', event.origin);
  }

  if (!isAllowedOrigin(event)) {
    if (isEmbedded && event.data?.type?.startsWith?.('PS_')) {
      console.warn('[embed] REJECTED — origin not allowed:', event.origin, 'Allowed:', [...ALLOWED_ORIGINS]);
    }
    return;
  }

  if (!isPSMessage(event.data)) {
    return;
  }

  for (const handler of handlers) {
    try {
      handler(event.data);
    } catch (err) {
      console.warn('[embed] Handler error:', err);
    }
  }
}

// ── Initialize ───────────────────────────────────────────────

if (isEmbedded && typeof window !== 'undefined') {
  window.addEventListener('message', handleMessage);

  // Notify parent that bolt.diy is ready
  // Delay slightly to allow React to mount
  requestAnimationFrame(() => {
    postToParent({ type: 'PS_BOLT_READY' });
  });
}
