import type { ZoneTable } from "../interpreter";

/**
 * SVU05 family — claim → strike → list → focus + data + mechanism.
 *
 * Suitable narratives: 误区翻转 / 数据揭示 / 机制 + 警示
 * Coordinates are in 1080x1920 canvas, anchor = center.
 * Safe zones:
 *   - right column >= 940 reserved for platform UI
 *   - bottom 1490-1620 reserved for subtitle band
 *   - bottom 1620-1920 reserved for platform title bar
 */
export const SVU05_ZONES: ZoneTable = {
  stage_center: { x: 540, y: 960 },

  hero_left: { x: 320, y: 620 },
  hero_right: { x: 700, y: 620 },
  hero_center: { x: 540, y: 620 },

  below_hero_left: { x: 320, y: 900 },
  below_hero_right: { x: 700, y: 900 },
  below_hero_center: { x: 540, y: 900 },
  above_hero_center: { x: 540, y: 300 },

  left_top_small: { x: 270, y: 380 },
  right_top_small: { x: 760, y: 380 },

  left_panel: { x: 270, y: 800 },
  right_panel: { x: 760, y: 800 },
  right_panel_overlay: { x: 760, y: 800 },

  left_number_band: { x: 270, y: 1080 },
  right_number_band: { x: 760, y: 1080 },

  left_bottom_band: { x: 270, y: 1380 },
  right_bottom_band: { x: 720, y: 1430 },

  off_stage_bottom: { x: 540, y: 2000 },
  off_stage_top: { x: 540, y: -120 },
};
