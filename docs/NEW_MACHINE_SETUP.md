# 新电脑安装与迁移清单

最后更新：2026-03-24

这份文档用于把 `editing V1` 项目迁移到一台新的 Windows 电脑，并继续跑当前这套流程：

1. `analyze`
2. `timing:direct`
3. `render`
4. `export-srt`

当前默认前提：

- 你已经改成使用 `ANTHROPIC_API_KEY`
- 不再依赖 `Claude Code CLI`
- 新电脑有可用的 NVIDIA GPU
- 仍然使用本地 `Qwen ASR` 开源模型做转录和时间戳
- 目标是按旧电脑当前做法 1:1 复刻，不引入新的运行方式

## 1. 先复制哪些东西

至少复制下面这些内容：

- 整个 `editing V1` 项目目录
- 你实际要处理的视频、文稿、输出目录
- 如果你沿用现在的批处理命令，新电脑还需要能访问同样的共享盘符，例如 `P:`

建议：

- 1:1 复刻时，最稳妥的做法是把整个 `editing V1` 原样复制过去
- 这个仓库当前没有 `package-lock.json`，所以如果你要尽量减少新旧电脑差异，建议把 `node_modules` 也一起复制
- 如果旧电脑里已经有可直接使用的本地 Qwen 模型目录，也建议一起复制到新电脑的固定路径
- 如果条件允许，尽量保持和旧电脑一致的盘符布局，例如项目目录、共享盘符、模型盘符

## 2. 旧电脑当前可工作的版本

下面这些版本是当前旧电脑上已经验证可用的版本：

- `Node.js`: `v24.12.0`
- `npm`: `11.6.2`
- `Python`: `3.10.11`
- `ffmpeg`: `8.0.1-full_build-www.gyan.dev`
- `ffprobe`: `8.0.1-full_build-www.gyan.dev`

迁移时优先靠近这套版本，能减少环境差异。

## 3. 新电脑必须安装的东西

### 必装

- Windows 10/11 x64
- `Node.js` 和 `npm`
- `ffmpeg` 和 `ffprobe`，并加入 `PATH`
- 一个可用的 Python 环境，用来跑 `qwen-asr`
- `ANTHROPIC_API_KEY`
- NVIDIA GPU 驱动
- 可用的 CUDA 运行环境

原因：

- 项目里的 Qwen 转录脚本默认就是 `device_map="cuda:0"`
- 这次迁移目标是完全沿用当前项目思路，所以默认直接按 GPU 路线配置

### 不再需要

- `Claude Code CLI`

只要你走 `--provider anthropic`，就不需要再装和登录 `claude` 命令行工具。

## 4. 安装 Node.js 依赖

1:1 复刻时，优先级如下：

1. 直接复制旧电脑里的 `node_modules`
2. 如果没有复制 `node_modules`，再在新电脑执行 `npm install`

如果需要重新安装 Node 依赖，进入项目根目录后执行：

```powershell
npm install
```

然后确认：

```powershell
node -v
npm -v
```

如果你已经把旧电脑的 `node_modules` 一并复制过来，这一步可以作为校验使用。

## 5. 安装 ffmpeg / ffprobe

项目的 timing、source direct 音频、source direct 视频、最终渲染都依赖 `ffmpeg` / `ffprobe`。

安装完成后确认：

```powershell
ffmpeg -version
ffprobe -version
```

如果命令找不到，说明还没有进 `PATH`。

## 6. 按旧电脑思路复刻 Qwen ASR Python 环境

这里不采用“多种环境并行试”的思路，直接按旧电脑当前做法复刻。

项目主流程是 Node.js，但 Qwen ASR 是 Python 依赖，所以仍然建议放进单独的 Python 环境里。  
Qwen 官方示例常用 Python 3.12，但为了尽量贴近旧电脑，本次主线固定使用 `Python 3.10.11`。

推荐命令：

```powershell
conda create -n qwen3-asr python=3.10.11 -y
conda activate qwen3-asr
pip install -U qwen-asr
```

如果 `conda` 在 PowerShell 里不可用，先执行一次：

```powershell
conda init powershell
```

然后重开终端。

### 可选：FlashAttention 2

Qwen 官方建议在兼容的 GPU 环境下安装 `flash-attn` 来降低显存占用并提速，尤其是长音频和大 batch。

```powershell
pip install -U flash-attn --no-build-isolation
```

注意：

- 这不是当前 1:1 复刻的必装项
- 如果旧电脑没有特别依赖它，新电脑也不需要为了“复刻”强行安装
- Windows 上安装它可能比 Linux 更折腾

## 7. Qwen 开源模型要准备哪些

当前项目实际会用到这些模型：

- `Qwen/Qwen3-ASR-1.7B`
- `Qwen/Qwen3-ForcedAligner-0.6B`

可选模型：

- `Qwen/Qwen3-ASR-0.6B`

说明：

- 当前 `scripts/transcribe-qwen.py` 默认 ASR 模型就是 `Qwen/Qwen3-ASR-1.7B`
- 它默认还会同时加载 `Qwen/Qwen3-ForcedAligner-0.6B`，用于时间戳输出
- 所以如果你要 1:1 复刻现在这套转录效果，固定准备 `1.7B + ForcedAligner`
- `0.6B` 不是当前项目默认模型，不建议在复刻阶段切换过去

## 8. 下载 Qwen 开源模型

Qwen 官方说明：如果运行时可以联网，`qwen-asr` 在按模型名加载时会自动下载权重。  
但对于 1:1 复刻，建议不要依赖“首次运行时自动下载”，而是提前把模型下载到固定目录，再显式传给项目。

### 主线路径：ModelScope

适合中国大陆网络环境，Qwen 官方也明确把它列为推荐方式。

```powershell
pip install -U modelscope
modelscope download --model Qwen/Qwen3-ASR-1.7B --local_dir D:\models\Qwen3-ASR-1.7B
modelscope download --model Qwen/Qwen3-ForcedAligner-0.6B --local_dir D:\models\Qwen3-ForcedAligner-0.6B
```

### 备用路径：Hugging Face

```powershell
pip install -U "huggingface_hub[cli]"
huggingface-cli download Qwen/Qwen3-ASR-1.7B --local-dir D:\models\Qwen3-ASR-1.7B
huggingface-cli download Qwen/Qwen3-ForcedAligner-0.6B --local-dir D:\models\Qwen3-ForcedAligner-0.6B
```

## 9. 怎么让项目使用 Qwen Python 环境

1:1 复刻时，推荐直接把 Python 路径固定下来，不依赖“当前刚好激活了哪个环境”。

可以设置用户环境变量：

```powershell
[System.Environment]::SetEnvironmentVariable('QWEN_TRANSCRIBE_PYTHON', 'C:\Users\<你自己的用户名>\miniconda3\envs\qwen3-asr\python.exe', 'User')
[System.Environment]::SetEnvironmentVariable('QWEN_FORCE_ALIGN_PYTHON', 'C:\Users\<你自己的用户名>\miniconda3\envs\qwen3-asr\python.exe', 'User')
```

设置后重开 PowerShell。

然后确认：

```powershell
python --version
$env:QWEN_TRANSCRIBE_PYTHON
$env:QWEN_FORCE_ALIGN_PYTHON
```

如果你不想设环境变量，也可以在命令行里直接传：

```powershell
--transcribe-python "C:\Users\<你自己的用户名>\miniconda3\envs\qwen3-asr\python.exe"
```

如果以后你单独启用强制对齐脚本，也可以用：

```powershell
--force-align-python "C:\Users\<你自己的用户名>\miniconda3\envs\qwen3-asr\python.exe"
```

## 10. 怎么让项目使用本地 Qwen 模型目录

1:1 复刻时，推荐固定使用本地模型目录，不依赖运行时自动联网拉取。

示例：

```powershell
npm run analyze -- `
  --audio "D:\demo\demo.mp4" `
  --transcribe-qwen `
  --script "D:\demo\demo.docx" `
  --provider anthropic `
  --transcribe-python "C:\Users\<你自己的用户名>\miniconda3\envs\qwen3-asr\python.exe" `
  --transcribe-model "D:\models\Qwen3-ASR-1.7B" `
  --transcribe-aligner-model "D:\models\Qwen3-ForcedAligner-0.6B" `
  -o "D:\demo\out\blueprint.json"
```

如果你不传 `--transcribe-model` 和 `--transcribe-aligner-model`，脚本会使用默认模型名：

- `Qwen/Qwen3-ASR-1.7B`
- `Qwen/Qwen3-ForcedAligner-0.6B`

## 11. 设置 Anthropic API Key

当前推荐直接使用 Anthropic API，不再走 `claude` CLI。

### 当前 PowerShell 会话临时生效

```powershell
$env:ANTHROPIC_API_KEY = "<your-api-key>"
```

### Windows 用户级永久生效

```powershell
[System.Environment]::SetEnvironmentVariable('ANTHROPIC_API_KEY', '<your-api-key>', 'User')
```

设置后重开 PowerShell。

## 12. 1:1 复刻建议使用的 analyze 命令

下面这条更接近“复刻当前项目思路”的写法：

示例：

```powershell
npm run analyze -- `
  --audio "D:\demo\demo.mp4" `
  --transcribe-qwen `
  --script "D:\demo\demo.docx" `
  --provider anthropic `
  --transcribe-python "C:\Users\<你自己的用户名>\miniconda3\envs\qwen3-asr\python.exe" `
  --transcribe-model "D:\models\Qwen3-ASR-1.7B" `
  --transcribe-aligner-model "D:\models\Qwen3-ForcedAligner-0.6B" `
  --transcribe-device-map cuda:0 `
  --transcribe-dtype bfloat16 `
  -o "D:\demo\out\blueprint.json"
```

注意：

- 这里显式写出模型路径和 Python 路径，能最大限度减少新旧电脑差异
- 当前项目思路默认就是 GPU 跑 Qwen，所以这里固定用 `cuda:0`
- `bfloat16` 也是当前脚本默认值

## 13. 新电脑上的最小验证步骤

按下面顺序检查：

### 第一步：基础命令都能找到

```powershell
node -v
npm -v
python --version
ffmpeg -version
ffprobe -version
```

### 第二步：Node 依赖安装成功

```powershell
npm install
npm run typecheck
```

### 第三步：Qwen Python 环境可用

```powershell
"C:\Users\<你自己的用户名>\miniconda3\envs\qwen3-asr\python.exe" -c "import qwen_asr; print('ok')"
```

### 第四步：跑一次最小 analyze

```powershell
npm run analyze -- `
  --audio "D:\demo\demo.mp4" `
  --transcribe-qwen `
  --script "D:\demo\demo.docx" `
  --provider anthropic `
  --transcribe-python "C:\Users\<你自己的用户名>\miniconda3\envs\qwen3-asr\python.exe" `
  --transcribe-model "D:\models\Qwen3-ASR-1.7B" `
  --transcribe-aligner-model "D:\models\Qwen3-ForcedAligner-0.6B" `
  --transcribe-device-map cuda:0 `
  --transcribe-dtype bfloat16 `
  -o "D:\demo\out\blueprint.json"
```

成功后再继续跑：

```powershell
npm run timing:direct -- --input "D:\demo\demo.mp4" --blueprint "D:\demo\out\blueprint.json" -o "D:\demo\out\timing_map.json"
npm run render -- -b "D:\demo\out\blueprint.json" -t "D:\demo\out\timing_map.json" --source-video "D:\demo\demo.mp4" -o "D:\demo\out\overlay.mp4"
```

## 14. 常见坑

- 新电脑没有映射 `P:` 盘，旧命令里的共享路径会直接失效
- `ffmpeg` 安装了但没进 `PATH`
- `ANTHROPIC_API_KEY` 已经设置，但当前 PowerShell 没有重开
- `qwen-asr` 安装在 Conda 环境里，但项目实际调用的是另一个 `python`
- 第一次跑 Qwen 时联网拉模型很慢，看起来像“卡住”
- CUDA、显卡驱动或 Python 环境不匹配，导致本来应该走 GPU，结果退回失败
- 如果新电脑重新 `npm install` 后行为与旧电脑不完全一样，优先怀疑是因为当前仓库没有锁定 `package-lock.json`

## 15. 推荐的最终状态

如果你想让新电脑长期稳定使用，推荐最后整理成下面这个状态：

- 项目目录：`editing V1`
- Node：`v24.12.0`
- npm：`11.6.2`
- Python：`3.10.11`
- Python 环境：单独用一个 `qwen3-asr` 环境
- GPU：NVIDIA + CUDA，可直接跑 `cuda:0`
- API：使用 `ANTHROPIC_API_KEY`
- Qwen 模型：提前下载到固定目录，例如 `D:\models\Qwen3-ASR-1.7B` 和 `D:\models\Qwen3-ForcedAligner-0.6B`
- Qwen Python 路径：固定到 `QWEN_TRANSCRIBE_PYTHON` / `QWEN_FORCE_ALIGN_PYTHON`
- 媒体素材：继续用统一共享盘符，或者统一改批处理路径
- Node 依赖：优先直接复制旧电脑的 `node_modules`

## 16. 官方参考

Qwen 官方文档与模型说明：

- GitHub: https://github.com/QwenLM/Qwen3-ASR
- Hugging Face 模型卡: https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B

其中和当前项目最相关的官方结论是：

- `qwen-asr` 可以直接 `pip install -U qwen-asr`
- 官方推荐使用隔离环境，并给出了 Python 3.12 的示例
- 当前这份迁移文档为了 1:1 贴近旧电脑，主线固定使用本机已验证过的 `Python 3.10.11`
- 模型可以按名称运行时自动下载，也可以提前手动下载
- 中国大陆用户官方明确给出了 `ModelScope` 下载方式
