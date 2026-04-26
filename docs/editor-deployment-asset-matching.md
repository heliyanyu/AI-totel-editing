# 剪辑服务器部署清单：素材匹配系统

## 结论

剪辑服务器上需要三类同步：

1. 代码：继续 `git pull`。
2. npm/Python 运行环境：`node_modules` 可本机安装或本地保留，Python 依赖按机器配置。
3. 素材索引和实际 mp4：不要进 git，单独复制/同步。

## 代码需要包含

端到端入口：

- `run-batch.ps1`

核心 TypeScript 目录：

- `src/analyze`
- `src/timing`
- `src/renderer`
- `src/remotion`
- `src/compose`
- `src/schemas`
- `src/transcribe`
- `src/force-align`

核心脚本：

- `scripts/transcribe-qwen.py`
- `scripts/force-align-qwen.py`
- `scripts/render_progress_bar.py`
- `scripts/render_navigation.py`
- `scripts/split-overlay-by-scene.py`
- `scripts/infer_blueprint_visual_needs.py`
- `scripts/infer_blueprint_visual_beats.py`
- `scripts/match_visual_beats_to_segments.py`
- `scripts/rerank_visual_matches_codex.py`
- `scripts/generate-draft-from-matches.py`
- `scripts/generate-jianying-draft.py`
- `scripts/asset_feedback.py`
- `scripts/codex_rerank_schema.json`

## 当前推荐索引

默认先用稳定版，不启用中文优先加权：

- `scripts/asset_index/visual_segments_cbj58_5000_plus_zh_chronic.jsonl`
- `scripts/asset_index/visual_segment_embeddings_cbj58_5000_plus_zh_chronic.npy`
- `scripts/asset_index/visual_segment_embeddings_cbj58_5000_plus_zh_chronic.keys.json`

剪辑服务器不负责扩库，所以不需要同步 `atoms.jsonl`、`visual_atoms_*.jsonl`
或 `visual_atom_embeddings_*.npy`。

## 实际视频素材

索引里的 `mp4_path` 当前指向：

```text
E:/nucleus download/totel nucleus video/...
```

剪辑服务器必须满足其一：

- 有同样的 `E:` 路径和 mp4 文件。
- 或者部署前批量把索引里的 `mp4_path` 改成剪辑服务器上的素材路径。

如果路径不一致，剪映草稿会生成，但素材片段会找不到源文件。

如果剪辑服务器项目在 `D:\editing V1`，素材库在服务器 D 盘，但剪辑师电脑通过
`W:` 打开共享目录，推荐不要改索引本体，而是在服务器 `.env` 里配置运行时路径映射。

例如服务器本机实际路径是：

```text
D:\jianji\素材库\...
D:\jianji\<case>\out\...
```

剪辑师电脑看到的是：

```text
W:\素材库\...
W:\<case>\out\...
```

则 `D:\editing V1\.env` 里加：

```dotenv
ASSET_INDEX_SOURCE_ROOT=E:/nucleus download/totel nucleus video
ASSET_LOCAL_ROOT=D:/jianji/素材库
ASSET_DRAFT_ROOT=W:/素材库
DRAFT_PATH_SOURCE_ROOT=D:/jianji
DRAFT_PATH_TARGET_ROOT=W:/
```

含义：

- `ASSET_INDEX_SOURCE_ROOT`：索引里原本记录的开发机素材根路径。
- `ASSET_LOCAL_ROOT`：运行脚本的机器用来检查/读取素材的路径。
- `ASSET_DRAFT_ROOT`：写进剪映草稿、剪辑师电脑能打开的素材路径。
- `DRAFT_PATH_SOURCE_ROOT`：服务器本机 out/case 路径根。
- `DRAFT_PATH_TARGET_ROOT`：写进剪映草稿、剪辑师电脑能打开的 out/case 路径根。

如果服务器上也把共享目录映射成了 `W:`，并且脚本直接在 `W:` 下跑，可以简化为：

```dotenv
ASSET_INDEX_SOURCE_ROOT=E:/nucleus download/totel nucleus video
ASSET_LOCAL_ROOT=W:/素材库
ASSET_DRAFT_ROOT=W:/素材库
```

同步索引文件仍然可以用：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sync-asset-index-for-editor.ps1 `
  -TargetDir "D:\editing V1"
```

如果确实想把索引里的 `mp4_path` 原地改成服务器路径，也可以用：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sync-asset-index-for-editor.ps1 `
  -TargetDir "D:\editing V1" `
  -SourceAssetRoot "E:/nucleus download/totel nucleus video" `
  -TargetAssetRoot "D:\你的素材库根目录" `
  -RewriteOnly
```

但通常更推荐 `.env` 映射，因为扩库后只要复制新索引，不需要反复改文件。

`ASSET_LOCAL_ROOT` / `ASSET_DRAFT_ROOT` 要填到能接上索引中相对路径的那一级。例如开发机索引是：

```text
E:/nucleus download/totel nucleus video/xxx/yyy.mp4
```

服务器素材如果是：

```text
D:/素材库/totel nucleus video/xxx/yyy.mp4
```

那就填：

```text
D:\素材库\totel nucleus video
```

## 默认匹配原则

不要启用中文优先策略。中文慢病素材已经进库，但只作为普通候选参与召回。

默认匹配参数建议：

```powershell
python scripts\match_visual_beats_to_segments.py `
  --visual-beats <case_out>\visual_beats.json `
  --visual-segments scripts\asset_index\visual_segments_cbj58_5000_plus_zh_chronic.jsonl `
  --emb scripts\asset_index\visual_segment_embeddings_cbj58_5000_plus_zh_chronic.npy `
  --keys scripts\asset_index\visual_segment_embeddings_cbj58_5000_plus_zh_chronic.keys.json `
  --out <case_out>\asset_matches_rag.json `
  --top-k 60 `
  --min-confidence 0.45 `
  --min-score 0.0
```

`run-batch.ps1` 会自动执行：

```text
docx hotword context -> Qwen ASR -> LLM transcript review -> Qwen force-align -> analyze blueprint -> timing/render/srt -> visual_needs -> visual_beats -> RAG -> feedback apply -> LLM rerank -> Jianying draft
```

它不会再使用根目录旧的 `asset_index.json` 小素材库。

## 不进 git 的内容

这些是本地/过程文件，已经在 `.gitignore` 里屏蔽：

- `scripts/asset_index/*`
- `scripts/logs/`
- `scripts/matches/`
- `local_artifacts/`
- 临时实验目录，如 `scripts/wujie*/`、`scripts/ip_test/`、`scripts/blueprint_w_test/`

后续如果要保存某次实验结果，放进 `local_artifacts/` 或团队盘，不要直接放进 repo 根目录。
