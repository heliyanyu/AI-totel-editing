import React from "react";
import type { LucideIcon } from "lucide-react";
import * as LucideIcons from "lucide-react";
import * as HealthIcons from "healthicons-react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Apple,
  ArrowDown,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  Atom,
  Award,
  Ban,
  BarChart3,
  Bath,
  BedDouble,
  Bike,
  BookOpen,
  Brain,
  Building2,
  Calendar,
  CalendarDays,
  Carrot,
  CheckSquare,
  CircleCheck,
  CircleDot,
  ClipboardList,
  Clock,
  Cloud,
  CloudRain,
  Compass,
  Crown,
  Dna,
  Droplet,
  Droplets,
  Dumbbell,
  Ear,
  Egg,
  Eye,
  FileText,
  Fish,
  Flame,
  FlaskConical,
  GitBranch,
  Globe,
  GraduationCap,
  Heart,
  HeartPulse,
  HelpCircle,
  Hospital,
  Info,
  Key,
  Layers,
  Leaf,
  Lightbulb,
  LineChart,
  List,
  ListChecks,
  Lock,
  MapPin,
  Medal,
  MessageCircle,
  Microscope,
  Moon,
  Network,
  PersonStanding,
  PieChart,
  Pill,
  Pizza,
  RefreshCw,
  Route,
  Sandwich,
  Scale,
  Search,
  Share2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sofa,
  Sparkles,
  Star,
  Stethoscope,
  Sun,
  Syringe,
  Target,
  TestTube,
  TestTubes,
  Thermometer,
  ThumbsDown,
  ThumbsUp,
  Timer,
  TrendingDown,
  TrendingUp,
  Trophy,
  Unlock,
  User,
  UserCheck,
  UserPlus,
  Users,
  Waves,
  Wheat,
  Workflow,
  Wind,
  TreePine,
  Zap,
} from "lucide-react";

export interface IconEntry {
  id: string;
  component: LucideIcon;
  tags: string[];
  category: string;
  source: "lucide" | "healthicons" | "custom";
}

type HealthIconSvg = React.ComponentType<React.SVGProps<SVGSVGElement>>;

function wrapHealthicon(HiComp: HealthIconSvg, displayName?: string): LucideIcon {
  const Wrapped = React.forwardRef<SVGSVGElement, any>(
    ({ size = 24, color, ...rest }, ref) =>
      React.createElement(HiComp, {
        width: size,
        height: size,
        color,
        ref,
        ...rest,
      }),
  );
  Wrapped.displayName = displayName ?? "HealthIcon";
  return Wrapped as unknown as LucideIcon;
}

const icon = (
  id: string,
  component: LucideIcon,
  tags: string[],
  category: string,
): IconEntry => ({
  id,
  component,
  tags,
  category,
  source: "lucide",
});

const MANUAL_ICON_REGISTRY: IconEntry[] = [
  icon("heart-pulse", HeartPulse, ["heart", "pulse", "心脏", "心率", "生命体征"], "medical"),
  icon("heart", Heart, ["heart", "心脏", "心血管"], "medical"),
  icon("activity", Activity, ["ecg", "vital", "活跃", "监测"], "medical"),
  icon("stethoscope", Stethoscope, ["doctor", "听诊器", "诊断"], "medical"),
  icon("thermometer", Thermometer, ["temperature", "发热", "体温"], "medical"),
  icon("pill", Pill, ["medicine", "药片", "药物"], "medical"),
  icon("syringe", Syringe, ["vaccine", "injection", "注射", "疫苗"], "medical"),
  icon("brain", Brain, ["brain", "神经", "大脑"], "medical"),
  icon("eye", Eye, ["eye", "vision", "眼睛"], "body"),
  icon("ear", Ear, ["ear", "hearing", "耳朵"], "body"),
  icon("droplets", Droplets, ["fluid", "water", "体液", "血液"], "medical"),
  icon("droplet", Droplet, ["drop", "liquid", "水滴"], "medical"),
  icon("waves", Waves, ["wave", "flow", "波动"], "medical"),
  icon("alert-triangle", AlertTriangle, ["warning", "危险", "提醒"], "warning"),
  icon("alert-circle", AlertCircle, ["alert", "警示", "风险"], "warning"),
  icon("shield-alert", ShieldAlert, ["shield", "protect", "防护", "风险"], "warning"),
  icon("ban", Ban, ["forbidden", "禁止", "避免"], "warning"),
  icon("flame", Flame, ["inflammation", "hot", "火", "炎症"], "warning"),
  icon("zap", Zap, ["energy", "快速", "冲击"], "warning"),
  icon("shield", Shield, ["protection", "防护", "安全"], "safety"),
  icon("shield-check", ShieldCheck, ["safe", "免疫", "通过"], "safety"),
  icon("circle-check", CircleCheck, ["done", "正确", "完成"], "safety"),
  icon("thumbs-up", ThumbsUp, ["good", "推荐", "正确"], "safety"),
  icon("thumbs-down", ThumbsDown, ["bad", "错误", "不推荐"], "safety"),
  icon("lightbulb", Lightbulb, ["idea", "tips", "建议", "知识点"], "generic"),
  icon("scale", Scale, ["balance", "compare", "对比", "平衡"], "generic"),
  icon("arrow-left-right", ArrowLeftRight, ["compare", "swap", "双向", "对照"], "generic"),
  icon("bar-chart-3", BarChart3, ["data", "chart", "统计", "柱状图"], "data"),
  icon("trending-up", TrendingUp, ["increase", "上升", "增长"], "data"),
  icon("trending-down", TrendingDown, ["decrease", "下降", "减少"], "data"),
  icon("line-chart", LineChart, ["trend", "line", "趋势", "折线图"], "data"),
  icon("pie-chart", PieChart, ["ratio", "portion", "占比", "饼图"], "data"),
  icon("clock", Clock, ["time", "时钟", "定时"], "time"),
  icon("timer", Timer, ["duration", "计时", "时间"], "time"),
  icon("calendar", Calendar, ["date", "日程", "日期"], "time"),
  icon("calendar-days", CalendarDays, ["schedule", "计划", "日历"], "time"),
  icon("sun", Sun, ["day", "sunlight", "白天", "阳光"], "nature"),
  icon("moon", Moon, ["night", "sleep", "夜晚", "睡眠"], "nature"),
  icon("wind", Wind, ["air", "breath", "风", "呼吸"], "nature"),
  icon("cloud", Cloud, ["weather", "云", "环境"], "nature"),
  icon("cloud-rain", CloudRain, ["rain", "潮湿", "气候"], "nature"),
  icon("leaf", Leaf, ["nature", "plant", "自然", "植物"], "nature"),
  icon("tree-pine", TreePine, ["tree", "户外", "森林"], "nature"),
  icon("workflow", Workflow, ["process", "流程", "步骤"], "structure"),
  icon("git-branch", GitBranch, ["branch", "分支", "条件"], "structure"),
  icon("route", Route, ["path", "路径", "路线"], "structure"),
  icon("layers", Layers, ["layers", "层级", "结构"], "structure"),
  icon("network", Network, ["network", "关联", "连接"], "structure"),
  icon("share-2", Share2, ["share", "传播", "关系"], "structure"),
  icon("list", List, ["list", "枚举", "清单"], "structure"),
  icon("list-checks", ListChecks, ["checklist", "列表", "核对"], "structure"),
  icon("check-square", CheckSquare, ["task", "todo", "任务", "勾选"], "structure"),
  icon("clipboard-list", ClipboardList, ["record", "记录", "表单"], "structure"),
  icon("book-open", BookOpen, ["knowledge", "教程", "知识"], "learning"),
  icon("graduation-cap", GraduationCap, ["education", "学习", "课程"], "learning"),
  icon("file-text", FileText, ["document", "文本", "说明"], "learning"),
  icon("info", Info, ["info", "提示", "信息"], "learning"),
  icon("message-circle", MessageCircle, ["talk", "沟通", "问答"], "learning"),
  icon("help-circle", HelpCircle, ["help", "问题", "疑问"], "learning"),
  icon("target", Target, ["goal", "目标", "重点"], "generic"),
  icon("star", Star, ["highlight", "重点", "亮点"], "generic"),
  icon("sparkles", Sparkles, ["shine", "注意", "强调"], "generic"),
  icon("circle-dot", CircleDot, ["point", "节点", "圆点"], "generic"),
  icon("dumbbell", Dumbbell, ["exercise", "健身", "力量"], "lifestyle"),
  icon("person-standing", PersonStanding, ["stand", "姿势", "人体"], "lifestyle"),
  icon("bike", Bike, ["cycling", "骑行", "有氧"], "lifestyle"),
  icon("bed-double", BedDouble, ["sleep", "休息", "睡觉"], "lifestyle"),
  icon("bath", Bath, ["clean", "卫生", "洗浴"], "lifestyle"),
  icon("sofa", Sofa, ["rest", "静坐", "久坐"], "lifestyle"),
  icon("apple", Apple, ["fruit", "健康饮食", "苹果"], "food"),
  icon("carrot", Carrot, ["vegetable", "蔬菜", "营养"], "food"),
  icon("fish", Fish, ["protein", "鱼类", "饮食"], "food"),
  icon("egg", Egg, ["egg", "蛋白质", "鸡蛋"], "food"),
  icon("wheat", Wheat, ["grain", "谷物", "主食"], "food"),
  icon("pizza", Pizza, ["junk food", "高热量", "披萨"], "food"),
  icon("sandwich", Sandwich, ["meal", "三明治", "餐食"], "food"),
  icon("microscope", Microscope, ["lab", "实验", "微观"], "science"),
  icon("test-tube", TestTube, ["test", "检测", "化验"], "science"),
  icon("test-tubes", TestTubes, ["samples", "实验室", "样本"], "science"),
  icon("atom", Atom, ["science", "分子", "原子"], "science"),
  icon("dna", Dna, ["gene", "遗传", "DNA"], "science"),
  icon("flask-conical", FlaskConical, ["chemistry", "试剂", "化学"], "science"),
  icon("users", Users, ["group", "人群", "多人"], "people"),
  icon("user", User, ["person", "用户", "单人"], "people"),
  icon("user-check", UserCheck, ["approved", "符合", "筛查"], "people"),
  icon("user-plus", UserPlus, ["add", "新增", "人群"], "people"),
  icon("hospital", Hospital, ["hospital", "医院", "就医"], "places"),
  icon("building-2", Building2, ["building", "场所", "机构"], "places"),
  icon("search", Search, ["find", "搜索", "查询"], "generic"),
  icon("globe", Globe, ["global", "世界", "范围"], "generic"),
  icon("map-pin", MapPin, ["location", "地点", "定位"], "places"),
  icon("compass", Compass, ["direction", "方向", "导航"], "places"),
  icon("lock", Lock, ["lock", "隐私", "安全"], "safety"),
  icon("unlock", Unlock, ["unlock", "开放", "解锁"], "safety"),
  icon("key", Key, ["key", "关键", "权限"], "safety"),
  icon("award", Award, ["achievement", "成就", "表彰"], "generic"),
  icon("trophy", Trophy, ["win", "冠军", "成果"], "generic"),
  icon("medal", Medal, ["medal", "奖章", "等级"], "generic"),
  icon("crown", Crown, ["best", "顶级", "优先"], "generic"),
  icon("arrow-right", ArrowRight, ["next", "前进", "继续"], "generic"),
  icon("arrow-up", ArrowUp, ["up", "上升", "增加"], "generic"),
  icon("arrow-down", ArrowDown, ["down", "下降", "降低"], "generic"),
  icon("refresh-cw", RefreshCw, ["loop", "循环", "刷新"], "structure"),
];

function toKebabCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}

function buildAutoTags(name: string): string[] {
  const id = toKebabCase(name);
  const tokens = id.split("-").filter((t) => t.length > 0);
  return [...new Set([id, ...tokens])];
}

function isIconComponent(value: unknown): value is LucideIcon {
  if (typeof value === "function") return true;
  if (typeof value === "object" && value !== null) {
    return "render" in (value as Record<string, unknown>);
  }
  return false;
}

const MANUAL_IDS = new Set(MANUAL_ICON_REGISTRY.map((i) => i.id));
const AUTO_EXCLUDE = new Set([
  "default",
  "createLucideIcon",
  "Icon",
  "icons",
  "LucideIcon",
  "toKebabCase",
  "IconNode",
]);

const AUTO_ICON_REGISTRY: IconEntry[] = Object.entries(LucideIcons)
  .filter(([name, value]) => isIconComponent(value) && /^[A-Z]/.test(name))
  .filter(([name]) => !AUTO_EXCLUDE.has(name))
  .map(([name, value]) => {
    const id = toKebabCase(name);
    return {
      id,
      component: value as LucideIcon,
      tags: buildAutoTags(name),
      category: "auto-lucide",
      source: "lucide" as const,
    };
  })
  .filter((entry) => !MANUAL_IDS.has(entry.id))
  .slice(0, 320);

const AUTO_HEALTHICON_REGISTRY: IconEntry[] = Object.entries(HealthIcons)
  .filter(([name, value]) => isIconComponent(value) && /^[A-Z]/.test(name))
  .map(([name, value]) => ({
    id: `hi-${toKebabCase(name)}`,
    component: wrapHealthicon(value as HealthIconSvg, name),
    tags: ["healthicons", ...buildAutoTags(name)],
    category: "auto-healthicons",
    source: "healthicons" as const,
  }))
  .slice(0, 70);

export const ICON_REGISTRY: IconEntry[] = [
  ...MANUAL_ICON_REGISTRY,
  ...AUTO_ICON_REGISTRY,
  ...AUTO_HEALTHICON_REGISTRY,
];

const _registryMap: Map<string, IconEntry> = new Map(
  ICON_REGISTRY.map((entry): [string, IconEntry] => [entry.id, entry]),
);

const _FALLBACK_ICON: LucideIcon = CircleDot;

export function getIcon(name?: string | null): LucideIcon {
  if (!name) return _FALLBACK_ICON;
  return _registryMap.get(name)?.component ?? _FALLBACK_ICON;
}

export function getIconComponent(id?: string | null): LucideIcon {
  if (!id) return _FALLBACK_ICON;
  return _registryMap.get(id)?.component ?? _FALLBACK_ICON;
}

export function getAvailableIconNames(): string[] {
  return ICON_REGISTRY.map((entry) => entry.id);
}

export function getIconCatalogForPrompt(groupByCategory = false): string {
  if (!groupByCategory) {
    return ICON_REGISTRY.map((entry) => `${entry.id}: ${entry.tags.join(", ")}`).join("\n");
  }

  const groups: Map<string, IconEntry[]> = new Map();
  for (const entry of ICON_REGISTRY) {
    const list = groups.get(entry.category) ?? [];
    list.push(entry);
    groups.set(entry.category, list);
  }

  const lines: string[] = [];
  for (const [category, entries] of groups) {
    lines.push(`# ${category}`);
    for (const entry of entries) {
      lines.push(`${entry.id}: ${entry.tags.join(", ")}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function getCompactIconCatalogForPrompt(maxTagsPerIcon = 3): string {
  return MANUAL_ICON_REGISTRY.map((entry) => {
    const tags = entry.tags.slice(0, Math.max(1, maxTagsPerIcon));
    return `${entry.id}: ${tags.join(", ")}`;
  }).join("\n");
}
