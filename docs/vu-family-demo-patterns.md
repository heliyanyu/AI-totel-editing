# VU Family Demo Patterns

这些 pattern 来自已经做过的 Remotion demo。Family prompt 必须从这里反推，不允许凭空重新设计。

## `closed_loop_board`

参考：

- `src/remotion/demos/SVU05Motion.tsx`
- `src/remotion/demos/SVU05PlanDemo.tsx`
- `src/remotion/demos/svu05-motion-plan.ts`

适用：

- 一个主题对象被纠偏
- 一个行为造成一串后果
- 一个问题板在后续 beat 中折叠，让位给证据/数字/机制

画面原则：

- 左侧优先放结构：问题板、因果节点、关键判断。
- 右侧优先放主素材/证据：真实视频、医学图、产品/器官素材。
- 主元素必须跨 beat 持续存在，通过 Magic Move / Fold 改变位置和权重。
- 新 critical 元素入场时，旧结构折叠，不是消失重画。

关键运镜：

- Magic Move
- Stack Reveal
- Fold
- active node highlight
- evidence slide-in

禁忌：

- 不要每个 beat 重画一张新卡片。
- 不要把所有句子都做成同尺寸卡片。
- 不要让证据素材被文字挡住。

## `mechanism_warning`

参考：

- `src/remotion/demos/SVU05Motion.tsx` 中“房颤 +10% / Nucleus 视频 / 风险警示”
- `src/remotion/demos/SVU07PlanDemo.tsx`
- `src/remotion/demos/svu07-motion-plan.ts`

适用：

- 药物/行为造成身体机制损伤
- 风险从“听起来抽象”变成“身体部位/机制正在承压”

画面原则：

- 机制路径是主角，不是红框警告卡。
- 风险提示可以红色，但必须服务 path/stack/因果链。
- 如果有真实素材，素材独占 evidence panel，不在素材上压大字。
- 文字节点必须沿机制路径逐步出现。

关键运镜：

- path drawing
- warning pulse
- red slash draw
- stack/glow accumulation
- risk bar rise

禁忌：

- 不要只输出一个大红框。
- 不要只列风险词。
- 不要用斜杠分句直接上屏。

## `action_path`

参考：

- `src/remotion/demos/SVU08PlanDemo.tsx`

适用：

- 多个步骤/建议/禁忌
- “第一/第二/第三”类路径推进

画面原则：

- 序号是路径节点，不是单独 VU 的主题。
- 当前步骤高亮，已完成步骤缩小/变绿，未到步骤弱化。
- 路径线先画，再出现节点。

关键运镜：

- path drawing
- node pop-in
- active step advance
- completed step fold

禁忌：

- 不要把“第二呢/第三呢”作为独立画面大字。

## `kinetic_title`

参考：

- `src/remotion/demos/SVU03PlanDemo.tsx`

适用：

- 开场标题
- 章节承诺
- 强钩子

画面原则：

- 标题是唯一主角。
- 支撑物只做飞入/漂移/退后，不喧宾夺主。
- 最后一拍要有 lock/seal/underline。

关键运镜：

- title burst
- card fly-in
- underline sweep
- seal lock

## `data_pop`

参考：

- `src/remotion/demos/SVU05Motion.tsx` 中 `+10%`

适用：

- 数字/百分比/风险增量/指标值

画面原则：

- 数字是主角，其他元素折叠让位。
- 数字有上下文：上方一句“每多/每少/某指标”，下方一句“意味着什么”。
- 数据来源小字晚入场，不抢主视觉。

关键运镜：

- CountUp
- Pop-in
- settle
- source slide-in

## `decision_tree`

参考：

- `src/remotion/demos/SVU08PlanDemo.tsx`

适用：

- “如果/那么”
- 判断是否需要做某事

画面原则：

- root question 先出现。
- 左右分支线先画，再出现结果卡。
- 推荐分支最后高亮。

关键运镜：

- root pop
- branch line drawing
- branch card reveal
- recommended highlight

## `comparison_split`

参考：

- `src/remotion/demos/SVU01PlanDemo.tsx`

适用：

- 正常人 vs 患者
- 错误 vs 正确
- 花钱方向对比

画面原则：

- 双侧对称入场，中心有 connector/VS。
- 两侧元素不得越过中线。
- 最后一拍给结论锁定。

关键运镜：

- mirrored slide-in
- VS pop
- warning pulse
- conclusion lock

## `concept_balance`

参考：

- `src/remotion/demos/SVU14PlanDemo.tsx`

适用：

- 平衡概念
- 太高/太低/目标区间

画面原则：

- 仪表盘/天平是概念核心。
- 指针或状态从一端扫到安全区。
- 结论是“稳/平衡/范围”，不是单纯拉高。

关键运镜：

- gauge draw
- needle sweep
- safe zone glow
- final settle
