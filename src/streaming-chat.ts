/**
 * Forge MCP — Streaming Chat Support
 *
 * Implements polling-based streaming chat for the Forge API.
 * Since the Forge API doesn't natively support SSE streaming,
 * this module provides a polling-based approach that simulates
 * token-by-token streaming by repeatedly polling the session
 * for new assistant messages.
 *
 * Also contains the model routing system for multi-model support.
 */

import logger from "./logger.js";

// ─── Model Routing ─────────────────────────────────────────────────────

/**
 * Default model fallback chain.
 * When no model is specified, tools will try models in this order
 * until one is available or all fail.
 */
export const DEFAULT_MODEL_FALLBACKS: string[] = [
  "hermes-agent",
  "hermes-3",
  "hermes-pro",
  "gpt-4o-mini",
];

/**
 * Map of well-known model aliases to their canonical API names.
 */
export const MODEL_ALIASES: Record<string, string> = {
  "hermes": "hermes-agent",
  "hermes2": "hermes-3",
  "hermes3": "hermes-3",
  "hermes-pro": "hermes-pro",
  "gpt4o-mini": "gpt-4o-mini",
  "gpt4o": "gpt-4o",
  "gpt-4o": "gpt-4o",
  "claude-sonnet": "claude-3-sonnet",
  "claude-haiku": "claude-3-haiku",
};

/**
 * Resolve a model identifier to its canonical name, with alias support.
 * Returns the original value if no alias is found.
 */
export function resolveModel(model?: string): string {
  if (!model) return DEFAULT_MODEL_FALLBACKS[0];
  const trimmed = model.trim().toLowerCase();
  return MODEL_ALIASES[trimmed] ?? model;
}

/**
 * Build the model routing chain for a tool call.
 * Returns an array of models to try, starting with the explicitly
 * specified model (if any), followed by the default fallbacks.
 */
export function getModelChain(model?: string): string[] {
  if (!model) return [...DEFAULT_MODEL_FALLBACKS];
  const resolved = resolveModel(model);
  // Deduplicate: start with resolved, then fallbacks that aren't already in chain
  const chain = [resolved];
  for (const fb of DEFAULT_MODEL_FALLBACKS) {
    if (!chain.includes(fb)) {
      chain.push(fb);
    }
  }
  return chain;
}

// ─── Polling-Based Streaming ───────────────────────────────────────────

export interface StreamChunk {
  /** Incremental chunk index (0-based) */
  index: number;
  /** The content in this chunk */
  content: string;
  /** Whether this is the final chunk */
  done: boolean;
  /** Elapsed time since start in ms */
  elapsedMs: number;
  /** Current session ID */
  sessionId: string;
}

export interface PollingStreamOptions {
  /** Interval between polls in ms (default: 1000) */
  pollIntervalMs?: number;
  /** Maximum polling duration in ms (default: 60000) */
  maxPollDurationMs?: number;
  /** Maximum number of polling iterations (default: 60) */
  maxPolls?: number;
}

const DEFAULT_POLL_OPTIONS: Required<PollingStreamOptions> = {
  pollIntervalMs: 1000,
  maxPollDurationMs: 60_000,
  maxPolls: 60,
};

/**
 * Poll the session endpoint until an assistant response is detected.
 * Simulates streaming by checking for new messages at intervals.
 *
 * @param sessionId - The chat session ID
 * @param fetchSession - Async function that fetches session data and returns
 *   the list of messages
 * @param options - Polling options
 * @returns Async generator of StreamChunk objects
 */
export async function* pollForAssistantResponse(
  sessionId: string,
  fetchSession: () => Promise<{ messages: Array<{ role: string; content: string }> }>,
  options: PollingStreamOptions = {},
): AsyncGenerator<StreamChunk> {
  const opts = { ...DEFAULT_POLL_OPTIONS, ...options };
  const startTime = Date.now();
  let previousContentLength = 0;
  let chunkIndex = 0;

  for (let poll = 0; poll < opts.maxPolls; poll++) {
    // Check timeout
    const elapsed = Date.now() - startTime;
    if (elapsed >= opts.maxPollDurationMs) {
      logger.warn("Streaming poll timeout", {
        sessionId,
        elapsedMs: elapsed,
        maxDurationMs: opts.maxPollDurationMs,
      });
      yield {
        index: chunkIndex++,
        content: "[Stream timeout — response may be incomplete]",
        done: true,
        elapsedMs: elapsed,
        sessionId,
      };
      return;
    }

    try {
      const session = await fetchSession();
      const messages = session.messages ?? [];

      // Find assistant messages (including streaming partials)
      const assistantMessages = messages.filter(
        (m) => m.role === "assistant",
      );

      if (assistantMessages.length > 0) {
        // Get the latest assistant message
        const latestAssistant = assistantMessages[assistantMessages.length - 1];
        const currentContent = latestAssistant.content || "";

        // Stream any new content since last poll
        if (currentContent.length > previousContentLength) {
          const newContent = currentContent.slice(previousContentLength);
          previousContentLength = currentContent.length;

          yield {
            index: chunkIndex++,
            content: newContent,
            done: false,
            elapsedMs: Date.now() - startTime,
            sessionId,
          };
        } else if (poll > 0 && currentContent.length > 0) {
          // Content hasn't changed since last poll — response is complete
          yield {
            index: chunkIndex++,
            content: "",
            done: true,
            elapsedMs: Date.now() - startTime,
            sessionId,
          };
          return;
        }
      }

      // Wait before next poll
      await sleep(opts.pollIntervalMs);
    } catch (err) {
      logger.warn("Streaming poll error", {
        sessionId,
        error: String(err),
        poll,
      });

      yield {
        index: chunkIndex++,
        content: `[Poll error: ${String(err)}]`,
        done: true,
        elapsedMs: Date.now() - startTime,
        sessionId,
      };
      return;
    }
  }

  // Max polls reached — yield final chunk
  yield {
    index: chunkIndex++,
    content: "",
    done: true,
    elapsedMs: Date.now() - startTime,
    sessionId,
  };
}

/**
 * Collect all chunks from a polling stream into a single result.
 * Useful for non-streaming consumers that want to see the polling history.
 */
export async function collectStreamChunks(
  generator: AsyncGenerator<StreamChunk>,
): Promise<{
  chunks: StreamChunk[];
  content: string;
  sessionId: string;
  totalElapsedMs: number;
}> {
  const chunks: StreamChunk[] = [];
  let fullContent = "";
  let sessionId = "";
  let totalElapsedMs = 0;

  for await (const chunk of generator) {
    chunks.push(chunk);
    fullContent += chunk.content;
    sessionId = chunk.sessionId;
    totalElapsedMs = chunk.elapsedMs;
  }

  return { chunks, content: fullContent, sessionId, totalElapsedMs };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
