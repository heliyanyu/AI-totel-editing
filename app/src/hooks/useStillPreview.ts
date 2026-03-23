import { useState, useEffect, useRef } from "react";

interface StillPreviewPayload {
  segment: unknown;
  parentScene: unknown;
}

/**
 * 防抖 renderStill 请求 hook
 *
 * 选中 segment 后 500ms 发起请求，避免快速切换产生大量渲染。
 * 支持 AbortController 取消过期请求。
 * 服务器返回 202 时 2 秒后自动重试。
 *
 * contentKey: 当 segment 内容（items / template / template_props）变化时
 *   立即清除旧 still，暴露底层 CSS 即时预览，然后重新请求渲染。
 */
export function useStillPreview(
  segmentId: string | null,
  previewPayload?: StillPreviewPayload | null,
  contentKey?: string
) {
  const [stillUrl, setStillUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    if (!segmentId) {
      setStillUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setLoading(false);
      return;
    }

    setStillUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setLoading(true);

    const reqId = ++requestIdRef.current;
    const abortController = new AbortController();

    const fetchStill = async (retry = 0) => {
      if (reqId !== requestIdRef.current) return;

      try {
        const res = previewPayload
          ? await fetch(`/api/still?t=${Date.now()}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(previewPayload),
              signal: abortController.signal,
            })
          : await fetch(`/api/still?segment=${segmentId}&t=${Date.now()}`, {
              signal: abortController.signal,
            });

        if (reqId !== requestIdRef.current) return;

        if (res.status === 202 && retry < 5) {
          retryTimerRef.current = setTimeout(() => fetchStill(retry + 1), 2000);
          return;
        }

        if (!res.ok) {
          setLoading(false);
          return;
        }

        const blob = await res.blob();
        if (reqId !== requestIdRef.current) return;

        setStillUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
        setLoading(false);
      } catch (err: any) {
        if (err.name === "AbortError") return;
        if (reqId === requestIdRef.current) {
          setLoading(false);
        }
      }
    };

    const timer = setTimeout(fetchStill, 500);

    return () => {
      clearTimeout(timer);
      abortController.abort();
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
    };
  }, [segmentId, previewPayload, contentKey]);

  return { stillUrl, loading };
}
