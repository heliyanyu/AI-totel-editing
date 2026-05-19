import type { VURenderJob } from "../schema";

export function baseFamilyPlannerRules() {
  return [
    "你是短视频医学科普 VU 镜头脚本规划器。只输出 JSON object，不要解释，不要代码块。",
    "你不写 React，不写 CSS 绝对坐标。你只做结构化画面计划。",
    "",
    "必须遵守：",
    "- 画面设计必须遵循对应 family 的 demo pattern，不允许重新发明版式。",
    "- 右侧 940px 之后保留给点赞/评论/收藏，不放主信息。",
    "- 底部真实字幕区保留，不放主图、图表、证据素材。",
    "- 不画主播占位；主播/原视频由剪映旧管线处理。",
    "- 不画平台 UI 占位；平台安全区默认知道即可。",
    "- 不画免责声明；旧管线处理。",
    "- 同一 beat 主读元素最多 3 个，元素过多必须折叠或淡出。",
    "- 主元素尽量跨 beat 持续，通过 MagicMove/Fold 改变权重，不要每个 beat 重画一页。",
    "- 真实图片/视频通过 asset_slot 替换，不把素材写死。",
    "- 输出必须包含 motion_script，描述 enter/hold/transform/fold/exit。",
    "- 所有字符串必须是合法 JSON 字符串；不要在字符串里直接换行，需要换行时写成 \\n。",
  ].join("\n");
}

export function outputShape(job: VURenderJob) {
  return {
    vu_id: job.vu_id,
    llm_policy: "deepseek_plan",
    presentation_family: job.presentation_family,
    render_strategy: job.render_strategy,
    beats: [
      {
        id: "beat_1",
        source_covers: ["Sx-Ly"],
        start_ratio: 0,
        end_ratio: 0.5,
        large_text: "屏幕大字",
        visual_goal: "这一 beat 的画面任务",
        active_elements: ["element_id"],
      },
    ],
    elements: [
      {
        id: "element_id",
        role: "subject",
        priority: "critical",
        asset_slot: "optional_asset_slot_id",
        text: "可选中文",
        visible_beats: ["beat_1"],
        enter_anim: "pop",
      },
    ],
    asset_requests: job.asset_requests,
    layout_contract: {
      right_rail_reserved: true,
      subtitle_band_reserved: true,
      bottom_disclaimer_only: true,
      max_lower_screen_right_x: 920,
      primary_info_y_range: [180, 1320],
      subtitle_y_range: [1490, 1620],
    },
    motion_script: [
      {
        beat_id: "beat_1",
        actions: [
          {
            element_id: "element_id",
            action: "enter | hold | transform | fold | exit",
            motion: "具体运镜意图，例如 StackReveal / MagicMove / PathDraw",
          },
        ],
      },
    ],
    editor_notes: ["给剪辑师的简短备注"],
  };
}

export function jobInput(job: VURenderJob) {
  return {
    vu_id: job.vu_id,
    presentation_family: job.presentation_family,
    render_strategy: job.render_strategy,
    source_vu: job.source_vu,
    asset_slots: job.asset_slots,
    asset_requests: job.asset_requests,
  };
}
