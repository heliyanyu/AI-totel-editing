/**
 * Remotion 工具函数
 *
 * ms ↔ frame 转换等通用工具
 */

/** 毫秒 → 帧数（四舍五入） */
export const msToFrame = (ms: number, fps: number): number =>
  Math.round((ms / 1000) * fps);

/** 帧数 → 毫秒 */
export const frameToMs = (frame: number, fps: number): number =>
  Math.round((frame / fps) * 1000);

/** 视频参数常量 */
export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;
export const VIDEO_FPS = 30;

/** Normal 布局：信息图区域高度（上方 70%，人物抠像放左下角，不占大面积） */
export const NORMAL_LAYOUT_HEIGHT = Math.round(VIDEO_HEIGHT * 0.70);
