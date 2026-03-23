# Editing V1 近乎逐行讲解

这套文档不是“架构概述”，而是给已经熟悉项目目标、但看代码容易卡住的人准备的。

写法固定是这样的：

1. 先贴一小段真实代码。
2. 紧跟一段白话翻译。
3. 遇到机器名词，就顺手解释成项目里的真实含义。
4. 尽量配医生口播视频的真实例子。

你可以把它理解成“给未来的你写的项目陪读版”。

## 建议阅读顺序

1. [01-package-json.md](./01-package-json.md)
2. [02-src-schemas-blueprint-ts.md](./02-src-schemas-blueprint-ts.md)
3. [03-src-analyze-index-ts.md](./03-src-analyze-index-ts.md)
4. [04-src-align-index-ts.md](./04-src-align-index-ts.md)
5. [05-src-align-subtitle-align-ts.md](./05-src-align-subtitle-align-ts.md)
6. [06-src-timing-build-direct-timing-map-ts.md](./06-src-timing-build-direct-timing-map-ts.md)
7. [07-src-compose-pipeline-plan-ts.md](./07-src-compose-pipeline-plan-ts.md)
8. [08-src-compose-autopipeline-tsx.md](./08-src-compose-autopipeline-tsx.md)
9. [09-src-renderer-final-video-ts.md](./09-src-renderer-final-video-ts.md)
10. [10-src-renderer-source-direct-audio-ts.md](./10-src-renderer-source-direct-audio-ts.md)
11. [11-scripts-rebuild-output-from-blueprint-ts.md](./11-scripts-rebuild-output-from-blueprint-ts.md)

## 这套文档重点回答什么

- 这个文件在整个链路里负责哪一步？
- 这一小段代码具体在干嘛？
- 里面的“schema / clip / render / fallback / props / sequence”到底是什么意思？
- 如果换成我们做医生视频，会发生什么？

## 先记住 8 个词

- `schema`
  不是高深数学。你可以把它理解成“这份数据必须按什么格式填写”。
- `function`
  可以理解成一个小工人。你把材料给它，它帮你做一件固定的事。
- `object`
  可以理解成一个资料盒子，里面装了若干字段。
- `array`
  就是一串列表。
- `atom`
  在这个项目里不是化学原子，而是“最小不可随便打断的一小句内容”。
- `blueprint`
  就是“视频施工图”。后面渲染、时间规划都照着它干活。
- `timing map`
  就是“原视频时间”到“成片时间”的对照表。
- `render`
  就是“真正导出成视频文件”。

## 读法建议

如果你现在最卡的是“代码入口在哪”，先读 `01` 和 `03`。

如果你最卡的是“为什么 keep / discard / words / media_range 这么多层”，先读 `02`、`04`、`05`。

如果你最卡的是“为什么 blueprint 都有了，还要 timing_map 和 render”，先读 `06` 到 `10`。

如果你想从一个现成案例重新跑一遍整条链，读 `11`。
