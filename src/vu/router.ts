import type {
  AssetRequest,
  AssetSlot,
  LlmPolicy,
  PresentationFamily,
  RenderStrategy,
  VURenderJob,
  VisualUnit,
} from "./schema";

const DOCTOR_FAMILIES = new Set<PresentationFamily>([
  "doctor_talk",
  "suspense_talk",
  "doctor_cta",
]);

const TEMPLATE_ONLY_FAMILIES = new Set<PresentationFamily>([
  "comparison_split",
  "kinetic_title",
  "object_shock_title",
  "pivot_title",
]);

export function inferPresentationFamily(vu: VisualUnit): PresentationFamily {
  const strategy = vu.presentation_strategy;
  const message = vu.one_screen_message;
  const combined = `${strategy} ${message}`;

  if (combined.includes("CTA") || combined.includes("转给") || combined.includes("关注")) {
    return "doctor_cta";
  }
  if (strategy.includes("替代对比")) return "replacement_compare";
  if (strategy.includes("悬念")) return "suspense_talk";
  if (strategy.includes("主播口播")) return "doctor_talk";
  if (strategy.includes("对比屏")) return "comparison_split";
  if (strategy.includes("标题揭示")) return "kinetic_title";
  if (strategy.includes("对象登场") || strategy.includes("定性")) return "object_shock_title";
  if (strategy.includes("极短转折")) return "pivot_title";
  if (strategy.includes("总览") && strategy.includes("数字")) return "overview_data";
  if (strategy.includes("总览推进") || strategy.includes("要点逐步")) return "closed_loop_board";
  if (strategy.includes("因果链") || strategy.includes("机制展示")) return "mechanism_chain";
  if (strategy.includes("反讽叙事")) return "case_narrative";
  if (strategy.includes("多因素") || strategy.includes("累积")) return "risk_stack";
  if (strategy.includes("决策树")) return "decision_tree";
  if (message.includes("牛初乳")) return "closed_loop_board";
  if (strategy.includes("机制因果链")) return "mechanism_chain";
  if (strategy.includes("误区翻转")) return "myth_flip";
  if (strategy.includes("概念模型")) return "concept_balance";
  if (strategy.includes("路径屏")) return "action_path";
  if (strategy.includes("数字披露")) return "data_pop";
  if (strategy.includes("机制 + 警示") || strategy.includes("机制+警示")) return "mechanism_warning";
  if (strategy.includes("收尾总结") || strategy.includes("价值替换")) return "value_summary";

  if (vu.attention_owner === "doctor") return "doctor_talk";
  if (vu.attention_owner === "diagram") return "mechanism_chain";
  if (vu.attention_owner === "board") return "closed_loop_board";
  return "kinetic_title";
}

export function inferRenderStrategy(vu: VisualUnit, family: PresentationFamily): RenderStrategy {
  if (DOCTOR_FAMILIES.has(family)) return "source_video_overlay";
  if (family === "kinetic_title" || family === "object_shock_title" || family === "pivot_title") {
    return "remotion_text";
  }
  if (family === "case_narrative" && vu.duration <= 12) return "image_first_hybrid";
  if (
    family === "mechanism_chain" ||
    family === "mechanism_warning" ||
    family === "risk_stack" ||
    family === "overview_data"
  ) {
    return "structured_hybrid";
  }
  return "remotion_structural";
}

export function routeVisualUnit(vu: VisualUnit): LlmPolicy {
  const family = inferPresentationFamily(vu);
  if (DOCTOR_FAMILIES.has(family)) return "skip_llm";
  if (TEMPLATE_ONLY_FAMILIES.has(family)) return "template_only";
  return "deepseek_plan";
}

function slot(
  slot_id: string,
  semantic_label: string,
  accepted_types: AssetSlot["accepted_types"],
  fallback: AssetSlot["fallback"],
  placement_hint?: AssetSlot["placement_hint"]
): AssetSlot {
  return { slot_id, semantic_label, accepted_types, fallback, placement_hint };
}

function request(
  request_id: string,
  slot_id: string,
  query_zh: string,
  intent: AssetRequest["intent"],
  usage: AssetRequest["usage"],
  required = false,
  preferred_aspect?: AssetRequest["preferred_aspect"],
  query_en?: string
): AssetRequest {
  return {
    request_id,
    slot_id,
    query_zh,
    query_en,
    intent,
    required,
    usage,
    preferred_aspect,
  };
}

export function inferAssetSlots(vu: VisualUnit): AssetSlot[] {
  const text = `${vu.one_screen_message} ${vu.presentation_strategy} ${vu.internal_beats
    ?.map((beat) => `${beat.large_text ?? ""} ${beat.visual ?? ""}`)
    .join(" ") ?? ""}`;
  const slots: AssetSlot[] = [];

  if (text.includes("鱼油")) {
    slots.push(slot("fish_oil_capsule", "鱼油胶囊", ["image", "icon", "emoji"], { type: "emoji", value: "🐟" }, "subject"));
  }
  if (text.includes("心脏") || text.includes("房颤") || text.includes("心电图")) {
    slots.push(slot("heart_afib", "房颤心脏/心电图", ["video", "image", "icon", "emoji"], { type: "emoji", value: "🫀" }, "evidence_panel"));
  }
  if (text.includes("出血") || text.includes("抗凝") || text.includes("阿司匹林") || text.includes("利伐沙班")) {
    slots.push(slot("anticoagulant_drugs", "抗凝/抗血小板药", ["image", "icon", "emoji"], { type: "emoji", value: "💊" }, "subject"));
    slots.push(slot("bleeding_risk", "出血风险素材", ["video", "image", "icon"], { type: "emoji", value: "🚨" }, "evidence_panel"));
  }
  if (text.includes("牛初乳")) {
    slots.push(slot("colostrum_product", "牛初乳产品", ["image", "icon", "emoji"], { type: "emoji", value: "🍼" }, "subject"));
    slots.push(slot("calf", "小牛", ["image", "icon", "emoji"], { type: "emoji", value: "🐄" }, "evidence_panel"));
    slots.push(slot("milk_cup", "纯牛奶", ["image", "icon", "emoji"], { type: "emoji", value: "🥛" }, "subject"));
  }
  if (text.includes("灵芝") || text.includes("孢子")) {
    slots.push(slot("reishi_spore_product", "灵芝孢子粉产品", ["image", "icon", "emoji"], { type: "emoji", value: "🍄" }, "subject"));
  }
  if (text.includes("几丁质") || text.includes("外壳")) {
    slots.push(slot("chitin_shell", "几丁质外壳机制", ["video", "image", "icon"], { type: "emoji", value: "🧱" }, "evidence_panel"));
  }
  if (text.includes("氧化")) {
    slots.push(slot("oxidation_process", "氧化变质过程", ["video", "image", "icon"], { type: "emoji", value: "🧪" }, "evidence_panel"));
  }
  if (text.includes("鸡蛋")) {
    slots.push(slot("eggs", "鸡蛋", ["image", "icon", "emoji"], { type: "emoji", value: "🥚" }, "subject"));
  }
  if (text.includes("免疫")) {
    slots.push(slot("immune_balance", "免疫平衡概念", ["image", "icon", "emoji"], { type: "emoji", value: "⚖️" }, "center"));
  }
  if (text.includes("晒") || text.includes("太阳") || text.includes("维生素D")) {
    slots.push(slot("sun_exposure", "晒太阳/维生素D", ["image", "icon", "emoji"], { type: "emoji", value: "☀️" }, "subject"));
  }
  if (text.includes("运动") || text.includes("150")) {
    slots.push(slot("exercise_icons", "运动方式图标", ["image", "icon", "emoji"], { type: "emoji", value: "🚶" }, "subject"));
  }
  if (text.includes("睡") || text.includes("修复")) {
    slots.push(slot("sleep_repair", "睡眠免疫修复", ["image", "video", "icon", "emoji"], { type: "emoji", value: "🌙" }, "subject"));
  }
  if (text.includes("真实食物") || text.includes("鱼虾水果")) {
    slots.push(slot("real_food_table", "真实食物/家庭餐桌", ["image", "video", "icon", "emoji"], { type: "emoji", value: "🍎" }, "evidence_panel"));
  }
  if (text.includes("肾") || text.includes("肌酐") || text.includes("尿蛋白")) {
    slots.push(slot("kidney_anatomy", "肾脏解剖/肾单位", ["video", "image", "icon", "emoji"], { type: "emoji", value: "🫘" }, "evidence_panel"));
  }
  if (text.includes("布洛芬") || text.includes("双氯芬酸") || text.includes("止痛") || text.includes("消炎")) {
    slots.push(slot("nsaid_drugs", "止痛消炎药/NSAIDs", ["image", "icon", "emoji"], { type: "emoji", value: "💊" }, "subject"));
    slots.push(slot("kidney_filter_pressure", "肾小球滤过压力机制", ["video", "image", "icon"], { type: "emoji", value: "⚠️" }, "evidence_panel"));
  }
  if (text.includes("盐") || text.includes("高盐") || text.includes("烧烤") || text.includes("火锅")) {
    slots.push(slot("high_salt_food", "高盐食物/重口味饮食", ["image", "video", "icon", "emoji"], { type: "emoji", value: "🧂" }, "subject"));
    slots.push(slot("blood_pressure_kidney", "血压升高压迫肾脏", ["video", "image", "icon"], { type: "emoji", value: "📈" }, "evidence_panel"));
  }
  if (text.includes("喝水") || text.includes("饮水") || text.includes("水肿") || text.includes("尿少")) {
    slots.push(slot("water_balance", "喝水/水肿/尿量平衡", ["image", "video", "icon", "emoji"], { type: "emoji", value: "💧" }, "subject"));
  }
  if (text.includes("感染") || text.includes("感冒") || text.includes("发烧")) {
    slots.push(slot("infection_warning", "感染发热对肾病影响", ["image", "video", "icon", "emoji"], { type: "emoji", value: "🤒" }, "evidence_panel"));
  }
  if (text.includes("偏方") || text.includes("秘方") || text.includes("补肾") || text.includes("不明成分")) {
    slots.push(slot("unknown_herbal_product", "偏方/不明成分补肾产品", ["image", "video", "icon", "emoji"], { type: "emoji", value: "🧪" }, "subject"));
    slots.push(slot("toxic_kidney_risk", "不明成分伤肾风险", ["video", "image", "icon"], { type: "emoji", value: "☠️" }, "evidence_panel"));
  }
  if (text.includes("复查") || text.includes("随访")) {
    slots.push(slot("lab_report_kidney", "肌酐尿蛋白复查报告", ["image", "icon", "emoji"], { type: "emoji", value: "📋" }, "evidence_panel"));
  }

  const seen = new Set<string>();
  return slots.filter((item) => {
    if (seen.has(item.slot_id)) return false;
    seen.add(item.slot_id);
    return true;
  });
}

export function buildAssetRequests(vu: VisualUnit, assetSlots: AssetSlot[]): AssetRequest[] {
  return assetSlots.map((assetSlot, index) => {
    const mechanism =
      assetSlot.slot_id.includes("heart") ||
      assetSlot.slot_id.includes("bleeding") ||
      assetSlot.slot_id.includes("chitin") ||
      assetSlot.slot_id.includes("oxidation") ||
      assetSlot.slot_id.includes("sleep") ||
      assetSlot.slot_id.includes("immune");
    const query = `${assetSlot.semantic_label} 医学科普 ${vu.one_screen_message}`;
    return request(
      `asset_req_${String(index + 1).padStart(2, "0")}`,
      assetSlot.slot_id,
      query,
      mechanism ? "medical_animation" : "object_cutout",
      mechanism ? "mechanism_insert" : "subject_icon",
      mechanism,
      mechanism ? "16:9" : "transparent_png"
    );
  });
}

export function buildRenderJob(vu: VisualUnit): VURenderJob {
  const family = inferPresentationFamily(vu);
  const llm_policy = routeVisualUnit(vu);
  const render_strategy = inferRenderStrategy(vu, family);
  const asset_slots = inferAssetSlots(vu);
  const asset_requests = buildAssetRequests(vu, asset_slots);
  const editor_notes: string[] = [];

  if (llm_policy === "skip_llm") {
    editor_notes.push("医生口播型 VU：剪映草稿保留源视频和真实字幕，剪辑师按需加花字。");
  }
  if (llm_policy === "template_only") {
    editor_notes.push("固定模板型 VU：不调 DeepSeek，用 family renderer 的默认布局。");
  }
  if (llm_policy === "deepseek_plan") {
    editor_notes.push("讲解型 VU：调用 DeepSeek 输出结构化 VUPlan，再进入素材解析和 family renderer。");
  }
  if (asset_slots.length > 0) {
    editor_notes.push("素材均通过 asset_slot 绑定，后续可替换真实图片、视频或 RAG 素材。");
  }

  return {
    vu_id: vu.id,
    llm_policy,
    presentation_family: family,
    render_strategy,
    source_vu: vu,
    asset_slots,
    asset_requests,
    editor_notes,
  };
}
