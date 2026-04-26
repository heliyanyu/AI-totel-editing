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

如果剪辑服务器也要继续扩库，还需要同步：

- `scripts/asset_index/atoms.jsonl`
- `scripts/asset_index/visual_atoms_cbj58_related_5000.jsonl`
- `scripts/asset_index/visual_atoms_zh_chronic.jsonl`
- 对应的 `visual_atom_embeddings_*.npy` 和 `*.keys.json`

## 实际视频素材

索引里的 `mp4_path` 当前指向：

```text
E:/nucleus download/totel nucleus video/...
```

剪辑服务器必须满足其一：

- 有同样的 `E:` 路径和 mp4 文件。
- 或者部署前批量把索引里的 `mp4_path` 改成剪辑服务器上的素材路径。

如果路径不一致，剪映草稿会生成，但素材片段会找不到源文件。

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
