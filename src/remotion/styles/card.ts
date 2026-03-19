/**
 * 向后兼容 shim — NavigationMap 等旧组件导入用
 *
 * 新模板不再使用此文件，请使用 design-system.ts 中的 GLASS_CARD 等。
 */

import type React from "react";
import { GLASS_CARD, SHADOWS } from "../design-system";

/** 卡片基础样式 */
export const cardBase: React.CSSProperties = {
  ...GLASS_CARD,
};

/** 发光阴影 */
export function glowShadow(color: string, spread: number = 12): string {
  return `0 0 ${spread}px ${color}40, 0 0 ${spread * 2}px ${color}20`;
}
