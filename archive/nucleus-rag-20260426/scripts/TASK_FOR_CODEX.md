# 任务：Nucleus 素材三级语义切分

## 背景

我们有 1996 个医学科普视频的 Whisper 转录结果（英文、中文、西班牙语等多语言），需要用 LLM 把每个转录按三级语义结构（atom/logic/scene）切分。切分结果用于后续的素材匹配（把素材片段精确匹配到医生文案的对应段落）。

**关键**：切分必须保留 word-level 时间戳，这样后续才能用这些切分块去配合医生原文。

## 当前进度

共 1996 个 whisper 输出文件，当前状态：
- ✅ **166 个已成功切分**（保留）
- ⏭️ **269 个太短（无旁白），已跳过**（保留）
- ❌ **1561 个需要处理**（已清理之前失败的输出）

已完成的输出在 `E:\nucleus download\asset_segments\`，保留的输出只是 _audio.json 文件名。脚本会自动跳过这些。

## 输入数据

**位置**：`E:\nucleus download\whisper_output\*.json`

**格式**（每个文件）：
```json
{
  "file": "ANCE00174_Coronary Artery Angioplasty (Radial Access).mp4",
  "audio_file": "ANCE00174_Coronary Artery Angioplasty (Radial Access)_audio.m4a",
  "language": "en",
  "segments": [
    {
      "start": 3.84,
      "end": 9.68,
      "text": "A coronary angioplasty procedure is also known as percutaneous coronary intervention.",
      "words": [
        {"word": "A", "start": 3.84, "end": 4.68, "probability": 0.734},
        {"word": "coronary", "start": 4.68, "end": 5.16, "probability": 0.967},
        ...
      ]
    },
    ...
  ]
}
```

## 处理流程

对每个 whisper JSON 文件：

### 1. 提取逐字转录文本
- 遍历所有 `segments` → 所有 `words`
- 过滤空 word（`word.strip() == ''`）
- 如果有效 words 数 < 5 → 标记 `skipped: {reason: "too short"}`
- 否则拼接所有 word → `transcript` 字符串

### 2. 用 Sonnet 4.6 做语义切分

**System prompt：**
```
你是医学科普视频的语义分析专家。任务：将逐字转录拆解为三级语义结构，并只通过边界标记输出结果。

三级结构：
- atom：最小连续语义单元（词组/短语/很短分句）
- logic：连续 atom 在论证角度变化处断开
- scene：连续 logic 在话题或表达意图变化处断开

atom 切分：
- 足够细，边界落在完整词语之间
- 固定搭配、专有名词、术语、数量短语不拆
- 英文按单词/短语切，中文按词组/分句切

输出格式：
- 不要 JSON、不要解释、不要代码块
- 只输出"原文 + 边界标记"
- "|" = 新 atom；"||" = 新 logic；"|||" = 新 scene
- 第一段必须以 "|||" 开头
- 删除所有竖线和空白后必须与原文逐字一致
```

**User prompt：**
```
转录原文（除插入边界标记外，不允许增删改任何一个字符）：
{transcript}

严格要求：
- 只能插入 "|" "||" "|||" 三种标记与必要的空白
- 不允许增加、删除、替换任何字符，包括标点符号
- 第一段必须以 "|||" 开头
- 删除所有竖线和空白后，结果必须与转录原文一字不差
- 如果原文有错别字或怪异字符，也原样保留，不要"修正"
```

### 3. 硬校验

- 把 Sonnet 返回的文本去掉所有 `|` 标记和空白
- 规范化（lowercase）
- 与原 transcript（同样规范化）做**逐字**比较
- 不一致 → **校验失败，重试 1 次**（共 2 次尝试）
- 2 次都失败 → 标记 `skipped: {reason: "verify failed", error: "..."}`

### 4. 对齐时间戳

校验通过后：
- 解析 Sonnet 输出，按 `|` `||` `|||` 分割出 atoms，记录每个 atom 的 boundary 类型（None/logic/scene）
- 遍历 atoms，按字符长度在 `words` 数组里走 cursor：
  - 第 N 个 atom 的 `start` = 它起始对应的第一个 word 的 `start`
  - 第 N 个 atom 的 `end` = 它结束对应的最后一个 word 的 `end`
- 每个 atom 得到精确时间戳

### 5. 组装 logic blocks

- 从 atoms 列表按 `boundary == 'scene' or 'logic'` 切分
- 每个 logic block 包含：
  - `start`, `end`（块内第一/最后 atom 的时间戳）
  - `text`（拼接所有 atom 文本）
  - `scene_start`（当前 scene 的起始时间）
  - `n_atoms`

## 输出数据

**位置**：`E:\nucleus download\asset_segments\{相同文件名}.json`

**成功格式**：
```json
{
  "file": "ANCE00174_....mp4",
  "language": "en",
  "atoms": [
    {
      "text": "A coronary angioplasty procedure",
      "start": 3.84,
      "end": 6.22,
      "boundary": "scene"
    },
    {
      "text": "is also known as",
      "start": 6.22,
      "end": 7.18,
      "boundary": null
    },
    ...
  ],
  "logic_blocks": [
    {
      "start": 3.84,
      "end": 9.68,
      "text": "A coronary angioplasty procedure is also known as percutaneous coronary intervention.",
      "scene_start": 3.84,
      "n_atoms": 5
    },
    ...
  ]
}
```

**跳过格式**：
```json
{"skipped": true, "reason": "too short"}
{"skipped": true, "reason": "verify failed", "error": "..."}
```

## 关键约束

1. **必须使用 Sonnet 4.6 或更强**（不能用 Haiku，后续分析工作都基于这个切分）
2. **每次调用要检测 rate limit**：如果输出包含 "hit your limit" 字样，**立即停止**，不要继续烧额度
3. **必须支持断点续跑**：已存在的输出文件要跳过（通过 `os.listdir(OUTPUT_DIR)` 检查）
4. **硬校验不能省**：时间戳准确性非常重要，对不上就跳过，不要模糊对齐

## 参考实现

已有的 Python 参考实现在：
`F:\AI total editing\editing V1\scripts\segment-assets-logic-blocks.py`

里面的 `process_file()` 是单文件处理版本，`parse_markers`、`verify_and_align`、`build_logic_blocks` 函数可以直接复用。

核心逻辑已经调试通过，主要是想换用 codex（或其他更快的方式）来跑，因为 claude CLI 每次调用有 10+ 秒的启动开销，1561 个文件要跑很久。

## 期望

- 用 codex（或者任何你认为合适的工具）跑完这 1561 个文件
- 输出到 `E:\nucleus download\asset_segments\`
- 遇到校验失败尽量重试 1 次
- 预计最终会成功切分 ~1500 个文件（有少量会因为内容、语言等问题失败）

## 几个文件样本

可以先在这几个文件上测试：
- `E:\nucleus download\whisper_output\ANCE00174_Coronary Artery Angioplasty (Radial Access)_audio.json` (英文, 2078 chars)
- `E:\nucleus download\whisper_output\1型糖尿病_audio.json` (中文, 1071 chars)
- `E:\nucleus download\whisper_output\Ablación con catéter_audio.json` (西班牙语)

这三个在之前的 claude-based 流程里能跑通。
