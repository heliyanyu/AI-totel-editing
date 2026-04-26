# 剪辑服务器复制清单

适用场景：服务器已经在 `D:\editing V1` 执行过 `git pull origin main`。

结论：不是只复制素材视频。还必须复制当前素材匹配索引三件套；扩库用的大文件不用复制。

## 1. 必须复制：素材索引三件套

从开发机复制到剪辑服务器：

```text
开发机:
F:\AI total editing\editing V1\scripts\asset_index\visual_segments_cbj58_5000_plus_zh_chronic.jsonl
F:\AI total editing\editing V1\scripts\asset_index\visual_segment_embeddings_cbj58_5000_plus_zh_chronic.npy
F:\AI total editing\editing V1\scripts\asset_index\visual_segment_embeddings_cbj58_5000_plus_zh_chronic.keys.json

服务器:
D:\editing V1\scripts\asset_index\
```

可选：如果已经开始收集剪辑师反馈，也复制：

```text
scripts\asset_index\asset_feedback.jsonl
```

## 2. 必须复制：实际素材视频

索引里原始路径根是：

```text
E:/nucleus download/totel nucleus video
```

服务器素材库要保留这个根目录下面的相对结构。例如开发机某条素材是：

```text
E:/nucleus download/totel nucleus video/AAA/BBB/clip.mp4
```

如果服务器素材根配置为：

```text
D:\素材库
```

则服务器上必须存在：

```text
D:\素材库\AAA\BBB\clip.mp4
```

如果剪辑师电脑通过 `W:` 访问服务器共享，则对应应能打开：

```text
W:\素材库\AAA\BBB\clip.mp4
```

## 3. 服务器 `.env` 必须配置路径映射

在服务器项目目录：

```text
D:\editing V1\.env
```

如果脚本在服务器本机跑，素材本机路径是 `D:\素材库`，剪辑师电脑看到的是 `W:\素材库`，写：

```dotenv
ASSET_INDEX_SOURCE_ROOT=E:/nucleus download/totel nucleus video
ASSET_LOCAL_ROOT=D:/素材库
ASSET_DRAFT_ROOT=W:/素材库
```

如果 out/case 文件在服务器本机也是 D 盘路径，但剪辑师用 W 盘打开，还要加：

```dotenv
DRAFT_PATH_SOURCE_ROOT=D:/
DRAFT_PATH_TARGET_ROOT=W:/
```

如果服务器实际共享根不是 `D:\`，而是例如 `D:\jianji`，则改成：

```dotenv
DRAFT_PATH_SOURCE_ROOT=D:/jianji
DRAFT_PATH_TARGET_ROOT=W:/
```

如果服务器自己运行脚本时也使用 `W:` 路径，可以简化为：

```dotenv
ASSET_INDEX_SOURCE_ROOT=E:/nucleus download/totel nucleus video
ASSET_LOCAL_ROOT=W:/素材库
ASSET_DRAFT_ROOT=W:/素材库
```

## 4. 服务器 `.env` 还需要保留运行配置

沿用原来能跑通无素材版本的配置，至少确认这些还在：

```dotenv
PYTHON_PATH=...
WORKING_ROOT=...
ANTHROPIC_API_KEY=...
ANTHROPIC_BASE_URL=...
OPENAI_API_KEY=...
OPENAI_BASE_URL=...
```

如果 Sonnet 代理是 OpenAI-compatible 接口，则用：

```dotenv
ANTHROPIC_OPENAI_BASE_URL=...
```

## 5. 不需要复制到剪辑服务器

剪辑服务器不负责扩库，所以不要复制这些开发文件：

```text
scripts\asset_index\atoms.jsonl
scripts\asset_index\visual_atoms_*.jsonl
scripts\asset_index\visual_atom_embeddings_*.npy
scripts\asset_index\atom_embeddings.npy
scripts\asset_index\embeddings.npy
scripts\asset_index\stage*.jsonl
scripts\asset_index\stage*.npy
local_artifacts\
scripts\logs\
scripts\matches\
```

## 6. 推荐验证顺序

先确认旧链路仍然能跑：

```powershell
cd /d "D:\editing V1"
powershell -ExecutionPolicy Bypass -File .\run-batch.ps1 -RootPath "<测试case根目录>" -SkipAssetMatching
```

再跑带素材匹配的版本：

```powershell
powershell -ExecutionPolicy Bypass -File .\run-batch.ps1 -RootPath "<测试case根目录>"
```

如果 LLM rerank 失败，默认会回退生成无素材草稿，不会拿纯 RAG 结果硬生成素材轨。
