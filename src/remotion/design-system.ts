/**
 * Design System — 单一权威视觉 Token 文件
 *
 * 所有模板组件、动画、布局的视觉参数都从这里读取。
 * 四大支柱：配色 · 字体层级 · 间距与安全区 · 动效语言
 *
 * 目标画布: 1080 × 1920 竖版, 30fps
 * 目标观众: 中老年人（字大、颜色语义清晰、动效克制但不呆板）
 */

// ============================================================
// 1. 配色系统 (Semantic Colors)
// ============================================================

/** 语义色 — 每种颜色有且仅有一个用途 */
export const SEMANTIC_COLORS = {
  /** 品牌蓝 — 标题、链接、主要交互 */
  brand: "#2563EB",
  /** 正向 — 正确、推荐、完成 */
  positive: "#16A34A",
  /** 负向 — 错误、危害、禁止 */
  negative: "#DC2626",
  /** 强调 — 高亮、行动建议、关键数字 */
  highlight: "#F59E0B",
  /** 信息 — 术语、中性提示 */
  info: "#0EA5E9",
} as const;

/** 分类色板 — 列举/对比中区分不同条目 */
export const CATEGORICAL_COLORS = [
  "#3B82F6", // cat-1  蓝
  "#22C55E", // cat-2  绿
  "#F59E0B", // cat-3  琥珀
  "#EF4444", // cat-4  红
  "#8B5CF6", // cat-5  紫
] as const;

/** 文本透明度层级 (基于浅色背景 #0F172A) */
export const TEXT_OPACITY = {
  /** 主文本 */
  primary: 0.88,
  /** 副文本、描述 */
  secondary: 0.65,
  /** 注释、标签 */
  tertiary: 0.45,
  /** 分隔线、placeholder */
  quaternary: 0.25,
} as const;

/** 背景渐变 — 浅色系 */
export const BACKGROUND = {
  /** 默认画布背景 */
  canvas: "linear-gradient(160deg, #F6FAFF 0%, #ECF4FF 50%, #FBFEFF 100%)",
  /** 毛玻璃卡片背景 */
  glass: "rgba(255, 255, 255, 0.78)",
  /** 毛玻璃模糊值 */
  glassBlur: 12,
  /** 卡片边框 */
  glassBorder: "rgba(255, 255, 255, 0.5)",
} as const;

// ============================================================
// 2. 字体层级 (Typography)
// ============================================================

/**
 * 字号系统 — 4 个层级
 *
 * 设计原则:
 * - body 72px 是"看得清"的基准线（中老年人在手机上阅读）
 * - title 比 body 大 33%，但不用于长句
 * - caption 是 body 的 67%，仅用于辅助信息
 * - heroNumber 是视觉锚点，整个屏幕最大元素
 */
export const TYPOGRAPHY = {
  /** 标题 — 场景标题、核心结论大字 */
  title: {
    fontSize: 78,
    fontWeight: 700 as const,
    lineHeight: 1.25,
  },
  /** 正文 — 列表项、链条节点、卡片主文本 */
  body: {
    fontSize: 58,
    fontWeight: 500 as const,
    lineHeight: 1.35,
  },
  /** 注释 — 单位、来源、次要说明 */
  caption: {
    fontSize: 38,
    fontWeight: 400 as const,
    lineHeight: 1.3,
  },
  /** 大数字 — 关键数值、百分比 */
  heroNumber: {
    fontSize: 128,
    fontWeight: 800 as const,
    lineHeight: 1.0,
  },
} as const;

/** 字体栈 */
export const FONT_FAMILY = {
  /** 无衬线 — 正文、列表、默认 */
  sans: '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif',
  /** 数字专用 — 大数字、数据、单位 */
  number: '"DIN Alternate", "Bahnschrift", "Noto Sans SC", sans-serif',
} as const;

// ============================================================
// 3. 间距与安全区 (Spacing & Safe Areas)
// ============================================================

/**
 * 安全区定义
 *
 * 画布: 1080 × 1920
 *
 * ┌──────────────────────┐ ← 0px
 * │   TopProgressBar     │ ← 78px ~ 150px (height=72)
 * │   ↓ SAFE_TOP 200px   │
 * ├──────────────────────┤ ← 200px
 * │                      │
 * │   内容可用区域        │   height ≈ 1144px
 * │   (Content Zone)     │
 * │                      │
 * ├──────────────────────┤ ← 1344px
 * │   ↓ 字幕安全区       │   576px (30% of 1920)
 * │   (Subtitle Zone)    │
 * └──────────────────────┘ ← 1920px
 *
 * 水平方向:
 * ←86px→ [内容 908px] ←86px→  (8% 左右留白)
 */
export const SAFE_AREA = {
  /** 顶部安全区 — 进度条下方(78+72=150px) + 呼吸间距 */
  top: 200,
  /** 底部字幕区 — 30% 屏幕高度 */
  bottom: 576,
  /** 水平安全区 — 8% 屏幕宽度 */
  horizontal: 86,
  /** 内容可用高度 */
  contentHeight: 1144, // 1920 - 200 - 576
  /** 内容可用宽度 */
  contentWidth: 908,   // 1080 - 86 × 2
} as const;

/** 画布尺寸 */
export const CANVAS = {
  width: 1080,
  height: 1920,
  fps: 30,
} as const;

/** 间距尺度 — 组件内部使用 */
export const SPACING = {
  /** 4px  — 紧凑元素内间距 */
  xs: 4,
  /** 8px  — 行内元素间距 */
  sm: 8,
  /** 16px — 段落间、卡片内上下 */
  md: 16,
  /** 24px — 列表项之间、卡片组间 */
  lg: 24,
  /** 32px — 标题与内容、区域间 */
  xl: 32,
  /** 48px — 大区域间分隔 */
  xxl: 48,
} as const;

/** 圆角 */
export const BORDER_RADIUS = {
  /** 小圆角 — 徽章、标签 */
  sm: 8,
  /** 中圆角 — 卡片 */
  md: 16,
  /** 大圆角 — 容器、弹窗 */
  lg: 24,
  /** 全圆 — 圆形指示器 */
  full: 9999,
} as const;

// ============================================================
// 4. 阴影系统 (Shadows)
// ============================================================

/** AntV 三层阴影体系 */
export const SHADOWS = {
  /** 微阴影 — 普通内容层 */
  subtle: "0 1px 2px rgba(0,0,0,0.04), 0 2px 4px rgba(0,0,0,0.03)",
  /** 卡片阴影 — 毛玻璃卡片默认 */
  card: "0 2px 4px -2px rgba(0,0,0,0.08), 0 4px 8px rgba(0,0,0,0.06)",
  /** 弹出阴影 — 浮层、模态 */
  popup: "0 4px 6px -2px rgba(0,0,0,0.08), 0 10px 20px -2px rgba(0,0,0,0.1), 0 20px 40px -4px rgba(0,0,0,0.08)",
} as const;

// ============================================================
// 5. 动效语言 (Animation Language)
// ============================================================

/**
 * Spring 预设 — 减少到 3 个核心预设
 *
 * Remotion useSpring 参数: { mass, damping, stiffness }
 */
export const SPRING_PRESETS = {
  /** 入场 — 从下方滑入 + 微弹 overshoot */
  enter: { mass: 1, damping: 15, stiffness: 120 },
  /** 强调 — 弹性十足的注意力吸引 */
  emphasis: { mass: 1, damping: 10, stiffness: 180 },
  /** 退出 — 平滑消退，无弹性 */
  exit: { mass: 1, damping: 25, stiffness: 100 },
} as const;

/** 入场动画参数 */
export const ENTER_ANIMATION = {
  /** 上滑距离 */
  slideDistance: 50,
  /** 元素间 stagger 间隔 (帧) */
  staggerFrames: 3,
  /** 最大 overshoot 量 (scale) */
  overshoot: 1.02,
  /** 模糊从多少开始淡入 */
  blurStart: 8,
} as const;

/** 退出动画参数 */
export const EXIT_ANIMATION = {
  /** 下滑距离 */
  slideDistance: 30,
  /** 退出透明度持续帧数 */
  fadeFrames: 8,
} as const;

/**
 * 强调动画 — 8 种类型
 *
 * 每种有明确的语义用途，LLM 在 Step 2 根据内容语义选择。
 * 框架确保同一场景内不重复使用同一类型。
 */
export const EMPHASIS_TYPES = {
  /** ① 弹性缩放 — 通用金句、核心观点 */
  scalePop: {
    id: "scale_pop",
    scaleTarget: 1.15,
    overshoot: 0.97,
    rebound: 1.03,
    durationMs: 400,
  },
  /** ② 颜色弹出 — 术语首次出现、关键名词 */
  colorPop: {
    id: "color_pop",
    color: SEMANTIC_COLORS.brand,
    scaleTarget: 1.06,
    durationMs: 500,
  },
  /** ③ 下划线绘制 — 要点标记、分论点 */
  underlineDraw: {
    id: "underline_draw",
    lineHeight: 4,
    gradient: [SEMANTIC_COLORS.brand, SEMANTIC_COLORS.info],
    durationMs: 350,
  },
  /** ④ 背景高亮弹出 — 行动建议、操作指引 */
  bgPop: {
    id: "bg_pop",
    bgColor: SEMANTIC_COLORS.highlight,
    bgOpacity: 0.2,
    scaleTarget: 1.04,
    durationMs: 400,
  },
  /** ⑤ 警示抖动 — 危害后果、误区警告 */
  shake: {
    id: "shake",
    amplitude: 6,
    oscillations: 4,
    color: SEMANTIC_COLORS.negative,
    durationMs: 350,
  },
  /** ⑥ 卡片脉冲 — 术语卡片、定义框 */
  cardPulse: {
    id: "card_pulse",
    glowColor: SEMANTIC_COLORS.brand,
    glowSpread: 6,
    scaleTarget: 1.02,
    durationMs: 500,
  },
  /** ⑦ 数字弹跳 — 关键数值、百分比 */
  numBounce: {
    id: "num_bounce",
    bounceHeight: 18,
    scaleTarget: 1.08,
    secondBounce: 0.4,   // 二次弹跳比例
    durationMs: 450,
  },
  /** ⑧ 渐变流动 — 正面结论、积极总结 */
  gradientFlow: {
    id: "gradient_flow",
    colors: [SEMANTIC_COLORS.brand, "#7C3AED", "#EC4899"],
    durationMs: 2000,
  },
} as const;

/** 强调类型 ID 联合类型 */
export type EmphasisTypeId =
  | "scale_pop"
  | "color_pop"
  | "underline_draw"
  | "bg_pop"
  | "shake"
  | "card_pulse"
  | "num_bounce"
  | "gradient_flow";

// ============================================================
// 6. 模板矩阵 (Template Matrix)
// ============================================================

/**
 * 逻辑类型 — 由原子类型 (atom type) 规则映射决定
 *
 * 原子类型 → 逻辑类型的映射在 template-matrix.ts 中定义。
 * 同一逻辑类型下有多个视觉变体 (variant)。
 */
export type LogicType =
  | "emphasis"      // 叙述强调
  | "enumeration"   // 列举
  | "causal_chain"  // 因果链
  | "comparison"    // 对比
  | "process";      // 流程步骤

/** 视觉变体 ID — 14 个模板 */
export type VariantId =
  // 叙述强调 × 5
  | "hero_text"          // 全屏大字（核心结论、金句）
  | "number_center"      // 大数字居中（关键数据）
  | "warning_alert"      // 警示卡片（危害、禁忌）
  | "term_card"          // 术语卡片（名词解释）
  // 列举 × 3
  | "list_fade"          // 逐条弹入列表（有序列举）
  | "color_grid"         // 多色块网格（并列分类）
  | "body_annotate"      // 人体/图示标注（部位症状）
  // 因果链 × 3
  | "step_arrow"         // 逐步点亮链（因→果流程）
  | "branch_path"        // 双路径分叉（对立结果）
  | "brick_stack"        // 砖墙累积（多因素汇聚）
  // 对比 × 3
  | "split_column"       // 左右分栏（A vs B 对照）
  | "myth_buster"        // 误区翻转（❌ → ✅）
  | "category_table"     // 分类表格（等级/分级）
  // 流程步骤 × 1
  | "vertical_timeline"; // 纵向时间线（时间序列）

/** 逻辑类型 → 可用变体的映射 */
export const LOGIC_TYPE_VARIANTS: Record<LogicType, VariantId[]> = {
  emphasis: ["hero_text", "number_center", "warning_alert", "term_card"],
  enumeration: ["list_fade", "color_grid", "body_annotate"],
  causal_chain: ["step_arrow", "branch_path", "brick_stack"],
  comparison: ["split_column", "myth_buster", "category_table"],
  process: ["vertical_timeline"],
};

/**
 * 原子类型 → 逻辑类型 映射
 *
 * 这是规则层，不需要 LLM 决策。
 * Step 2 LLM 只需要选择 variant（在逻辑类型确定后）。
 */
export const ATOM_TO_LOGIC: Record<string, LogicType> = {
  // → emphasis
  em: "emphasis",        // emphasis
  nu: "emphasis",        // numeric
  is: "emphasis",        // icon_spotlight
  sd: "emphasis",        // scene_description

  // → enumeration
  es: "enumeration",     // enumeration_simple
  ee: "enumeration",     // enumeration_explained

  // → causal_chain
  cc: "causal_chain",    // causal_chain
  cd: "causal_chain",    // conditional

  // → comparison
  cp: "comparison",      // comparison
  dd: "comparison",      // do_dont
  an: "comparison",      // analogy

  // → process
  tl: "process",         // timeline

  // → enumeration (data-heavy atoms)
  dc: "enumeration",     // data_chart
  pc: "enumeration",     // pie_chart
};

// ============================================================
// 7. 卡片系统 (Card System)
// ============================================================

/** 毛玻璃卡片基础样式 */
export const GLASS_CARD = {
  background: BACKGROUND.glass,
  backdropFilter: `blur(${BACKGROUND.glassBlur}px)`,
  border: `1px solid ${BACKGROUND.glassBorder}`,
  borderRadius: BORDER_RADIUS.md,
  boxShadow: SHADOWS.card,
} as const;

/** 卡片 padding 预设 */
export const CARD_PADDING = {
  /** 标准 — 列表项、链条节点 */
  normal: { padding: "20px 24px" },
  /** 紧凑 — 密集列表 */
  compact: { padding: "14px 18px" },
  /** 宽松 — 强调卡片、术语 */
  spacious: { padding: "28px 32px" },
} as const;

/** 左侧色条装饰 */
export function accentLeftBar(color: string, thickness = 4) {
  return { borderLeft: `${thickness}px solid ${color}` };
}

/** 顶部色条装饰 */
export function accentTopBar(color: string, thickness = 4) {
  return { borderTop: `${thickness}px solid ${color}` };
}

// ============================================================
// 8. 工具函数 (Utilities)
// ============================================================

/**
 * 颜色 + 透明度
 * @example withAlpha("#2563EB", 0.2) → "#2563EB33"
 */
export function withAlpha(hexColor: string, alpha: number): string {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hexColor}${a}`;
}

/**
 * 获取分类色（循环取色）
 * @example categoryColor(0) → "#3B82F6"
 * @example categoryColor(7) → "#22C55E"
 */
export function categoryColor(index: number): string {
  return CATEGORICAL_COLORS[index % CATEGORICAL_COLORS.length];
}

/**
 * 文本颜色 — 基于深色文本 + 透明度
 * @param level 1=主文本 2=副文本 3=注释 4=占位
 */
export function textColor(level: 1 | 2 | 3 | 4 = 1): string {
  const opacities: Record<number, number> = {
    1: TEXT_OPACITY.primary,
    2: TEXT_OPACITY.secondary,
    3: TEXT_OPACITY.tertiary,
    4: TEXT_OPACITY.quaternary,
  };
  return `rgba(15, 23, 42, ${opacities[level]})`;
}

/**
 * 列表项徽章渐变色
 * @example badgeGradient(0) → "linear-gradient(135deg, #3B82F6, #60A5FA)"
 */
export function badgeGradient(index: number): string {
  const base = categoryColor(index);
  // 生成更亮的变体作为渐变终点
  return `linear-gradient(135deg, ${base}, ${withAlpha(base, 0.7)})`;
}

/**
 * 语义色对应的淡背景
 * @example tintBg("#DC2626", 0.06) → "rgba(220, 38, 38, 0.06)"
 */
export function tintBg(hexColor: string, opacity = 0.08): string {
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
