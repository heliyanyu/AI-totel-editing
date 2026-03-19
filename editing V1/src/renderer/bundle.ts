import { bundle } from "@remotion/bundler";
import { resolve } from "path";

export interface RemotionBundleOptions {
  publicDir?: string;
}

const bundleCache = new Map<string, Promise<string>>();

export function getRemotionEntryPoint(): string {
  return resolve("src/remotion/index.ts");
}

export function getBundleCacheKey(options?: RemotionBundleOptions): string {
  return resolve(options?.publicDir ?? ".") + "::" + getRemotionEntryPoint();
}

export async function bundleRemotionProject(
  options?: RemotionBundleOptions
): Promise<string> {
  const key = getBundleCacheKey(options);
  const cached = bundleCache.get(key);
  if (cached) {
    return cached;
  }

  const promise = bundle({
    entryPoint: getRemotionEntryPoint(),
    ...(options?.publicDir ? { publicDir: resolve(options.publicDir) } : {}),
    webpackOverride: (config: any) => config,
  }).catch((error) => {
    bundleCache.delete(key);
    throw error;
  });

  bundleCache.set(key, promise);
  return promise;
}

export function clearRemotionBundleCache(options?: RemotionBundleOptions): void {
  if (!options) {
    bundleCache.clear();
    return;
  }
  bundleCache.delete(getBundleCacheKey(options));
}
