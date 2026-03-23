import { availableParallelism, cpus } from "node:os";
import type { TimingMap } from "../schemas/blueprint.js";

const DEFAULT_RENDER_CONCURRENCY_FRACTION = 0.8;
const DEFAULT_RENDER_RESERVED_THREADS = 2;
const DEFAULT_RENDER_MIN_CONCURRENCY = 2;
const SOURCE_DIRECT_MAX_CONCURRENCY = 4;

function detectCpuParallelism(): number {
  try {
    return Math.max(1, availableParallelism());
  } catch {
    return Math.max(1, cpus().length || 1);
  }
}

export function parseRenderConcurrencyOverride(
  value: string | undefined
): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`无效的并发参数: ${value}`);
  }

  return parsed;
}

export function resolveRenderConcurrency(
  mode: TimingMap["mode"],
  override?: number,
  cpuCount = detectCpuParallelism()
): number | null {
  if (typeof override === "number") {
    return Math.max(1, Math.floor(override));
  }

  const fractionalTarget = Math.floor(
    cpuCount * DEFAULT_RENDER_CONCURRENCY_FRACTION
  );
  const reservedTarget = Math.max(
    1,
    cpuCount - DEFAULT_RENDER_RESERVED_THREADS
  );
  const resolved = Math.min(cpuCount, Math.max(fractionalTarget, reservedTarget));

  if (mode === "source_direct") {
    return Math.max(
      DEFAULT_RENDER_MIN_CONCURRENCY,
      Math.min(resolved, SOURCE_DIRECT_MAX_CONCURRENCY)
    );
  }

  return Math.max(
    DEFAULT_RENDER_MIN_CONCURRENCY,
    Math.min(resolved, Math.max(DEFAULT_RENDER_MIN_CONCURRENCY, cpuCount - 1))
  );
}
