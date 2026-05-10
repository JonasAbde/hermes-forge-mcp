/**
 * Forge MCP — API Resilience Layer.
 *
 * Ported from forge_mcp_registry/api_resilience.py:
 * - Response shape validation (catches API contract drift)
 * - Exponential backoff retry (handles transient failures)
 * - Health tracking (monitors error rates)
 *
 * Source: integrations/mcp-forge-registry/forge_mcp_registry/api_resilience.py
 */

// ─── Expected API Response Shapes ────────────────────────────────────

/** Keys expected in a Forge Pack detail object (from TypeScript types). */
export const EXPECTED_PACK_KEYS: string[] = [
  "pack_id", "slug", "name", "status", "version",
  "entrypoint", "capabilities_json", "card_name", "card_title",
  "card_theme", "visibility", "summary_md", "docs_url",
  "trust_score", "rarity_tier", "rarity_label",
  "verification_state", "install_count",
];

/** Keys expected in a Forge Metrics object. */
export const EXPECTED_METRICS_KEYS: string[] = [
  "runs", "failures", "success_rate", "avg_latency_ms",
  "trust_score", "last_verified_at",
];

/** Critical keys that MUST be present on a pack object. */
const CRITICAL_PACK_KEYS: string[] = ["pack_id", "slug", "name", "status"];

// ─── Validation ──────────────────────────────────────────────────────

export interface ValidationResult {
  isValid: boolean;
  warnings: string[];
}

function isPlainObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate the shape of a pack object.
 * Returns { isValid, warnings } where warnings includes unexpected/missing keys.
 */
export function validatePackShape(pack: unknown): ValidationResult {
  if (!isPlainObject(pack)) {
    return { isValid: false, warnings: [`pack is not a plain object: ${typeof pack}`] };
  }

  const keys = Object.keys(pack as Record<string, unknown>);
  const warnings: string[] = [];

  // Check for missing critical keys
  const missing = CRITICAL_PACK_KEYS.filter((k) => !keys.includes(k));
  if (missing.length > 0) {
    warnings.push(`Missing critical pack keys: ${missing.join(", ")}`);
  }

  // Check for unexpected keys (indicates API shape drift)
  const unknownKeys = [...keys].filter((k) => !EXPECTED_PACK_KEYS.includes(k));
  if (unknownKeys.length > 0) {
    warnings.push(`Unexpected keys in pack: ${unknownKeys.join(", ")}`);
  }

  return { isValid: missing.length === 0, warnings };
}

/**
 * Validate that a Forge detail response has the expected structure.
 * Expected: { status: "ok", pack: { pack_id, slug, name, status, ... }, metrics?: { ... } }
 */
export function validateDetailResponseShape(data: unknown): ValidationResult {
  if (!isPlainObject(data)) {
    return { isValid: false, warnings: [`Response is not a plain object: ${typeof data}`] };
  }

  const d = data as Record<string, unknown>;
  const warnings: string[] = [];

  // Check status
  if (d.status !== "ok") {
    warnings.push(`Unexpected status in response: ${String(d.status)}`);
  }

  // Check pack key exists
  if (!("pack" in d)) {
    return { isValid: false, warnings: ["pack key missing from response"] };
  }

  // Validate the pack object
  const packResult = validatePackShape(d.pack);
  if (!packResult.isValid) {
    return { isValid: false, warnings: packResult.warnings };
  }
  warnings.push(...packResult.warnings);

  // Validate metrics if present
  if ("metrics" in d && d.metrics !== null && d.metrics !== undefined) {
    if (isPlainObject(d.metrics)) {
      const metricKeys = Object.keys(d.metrics as Record<string, unknown>);
      const unexpectedMetrics = metricKeys.filter((k) => !EXPECTED_METRICS_KEYS.includes(k));
      if (unexpectedMetrics.length > 0) {
        warnings.push(`Unexpected metrics keys: ${unexpectedMetrics.join(", ")}`);
      }
    } else {
      warnings.push(`metrics is not a plain object: ${typeof d.metrics}`);
    }
  }

  return { isValid: true, warnings };
}

/**
 * Validate and log warnings if the response shape diverges.
 * Returns the validated data (or null if critical failure).
 */
export function validateAndLog(
  response: unknown,
  context: string,
): { isValid: boolean; data: Record<string, unknown> | null; warnings: string[] } {
  const { isValid, warnings } = validateDetailResponseShape(response);

  if (!isValid) {
    console.error(`[Forge MCP] ${context} failed validation: ${warnings.join("; ")}`);
    return { isValid: false, data: null, warnings };
  }

  if (warnings.length > 0) {
    console.warn(`[Forge MCP] ${context} shape drift detected: ${warnings.join("; ")}`);
  }

  return { isValid: true, data: response as Record<string, unknown>, warnings };
}

// ─── Exponential Backoff Retry ──────────────────────────────────────

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

/**
 * Retry a function with exponential backoff.
 * Delays: baseDelay * (2 ^ attempt), capped at maxDelayMs.
 *
 * Ported from forge_mcp_registry.api_resilience.exponential_backoff_retry.
 */
export async function exponentialBackoffRetry<T>(
  func: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 100, maxDelayMs = 5000 } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await func();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < maxRetries) {
        const delayMs = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
        console.warn(
          `[Forge MCP] Attempt ${attempt + 1}/${maxRetries + 1} failed ` +
          `(${lastError.name}). Retrying in ${delayMs}ms...`,
        );
        await sleep(delayMs);
      } else {
        console.error(
          `[Forge MCP] All ${maxRetries + 1} attempts failed: ${lastError.message}`,
        );
      }
    }
  }

  throw lastError!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Health Tracking ─────────────────────────────────────────────────

export interface HealthStats {
  requests: number;
  errors: number;
  errorRatePercent: number;
  validationWarnings: number;
}

class ApiHealthTracker {
  private requestCount = 0;
  private errorCount = 0;
  private validationWarningCount = 0;

  recordRequest(success: boolean, validationWarnings = 0): void {
    this.requestCount++;
    if (!success) {
      this.errorCount++;
    }
    if (validationWarnings > 0) {
      this.validationWarningCount += validationWarnings;
    }
  }

  getStats(): HealthStats {
    const errorRate = this.requestCount > 0
      ? (this.errorCount / this.requestCount) * 100
      : 0;

    return {
      requests: this.requestCount,
      errors: this.errorCount,
      errorRatePercent: Math.round(errorRate * 100) / 100,
      validationWarnings: this.validationWarningCount,
    };
  }
}

/** Global health tracker instance. */
const healthTracker = new ApiHealthTracker();

/** Get current API health statistics. */
export function getHealthStats(): HealthStats {
  return healthTracker.getStats();
}

/** Record an API request outcome. */
export function recordHealth(success: boolean, validationWarnings = 0): void {
  healthTracker.recordRequest(success, validationWarnings);
}
