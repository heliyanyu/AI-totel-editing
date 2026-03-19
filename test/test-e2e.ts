/**
 * 端到端验证脚本
 *
 * 用已有的 Step 1 结果 + 模拟 Step 2 数据，生成三级 blueprint，
 * 然后验证切割和渲染管线。
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, join } from "path";
import { groupStep1Atoms, mergeStep2WithAtoms } from "../src/analyze/prompt-3level.js";
import { autoRepairBlueprint, validateBlueprint } from "../src/analyze/schema.js";
import { postProcessBlueprint } from "../src/align/post-process.js";
import type { Transcript, Blueprint } from "../src/schemas/blueprint.js";

// ── 模板自动分配（模拟 Step 2） ──────────────────────
const TEMPLATE_ROTATION = [
  "hero_text", "list_fade", "term_card", "warning_alert",
  "number_center", "step_arrow", "body_annotate", "split_column",
  "brick_stack", "myth_buster", "color_grid", "branch_path",
];

function mockStep2(step1Result: any): any {
  const grouped = groupStep1Atoms(step1Result);

  const scenes = grouped.map((scene, si) => {
    // 收集场景的所有 keep 文本
    const allKeepText = scene.logicBlocks.map(lb => lb.keepText).join("");

    return {
      title: `场景${si + 1}`,
      view: si % 2 === 0 ? "overlay" : "graphics",
      logic_segments: scene.logicBlocks.map((lb, li) => {
        const templateIdx = (si * 5 + li) % TEMPLATE_ROTATION.length;
        // 从 keep 文本提取 items（简单切分）
        const text = lb.keepText;
        const items = [];

        // 提取短句作为 items（每 10-15 字一个）
        let pos = 0;
        while (pos < text.length && items.length < 4) {
          const len = Math.min(12, text.length - pos);
          if (len > 2) {
            items.push({
              text: text.slice(pos, pos + len),
              emoji: ["🫀", "🦴", "⚠️", "💡", "🔬", "🏃"][items.length % 6],
            });
          }
          pos += len;
        }

        // 至少一个 item
        if (items.length === 0 && text.length > 0) {
          items.push({ text: text.slice(0, Math.min(12, text.length)), emoji: "💡" });
        }

        return {
          transition_type: ["现象描述", "原因解释", "数据引用", "建议措施", "总结归纳"][li % 5],
          template: TEMPLATE_ROTATION[templateIdx],
          items,
          template_props: {},
        };
      }),
    };
  });

  return {
    title: "久坐的危害",
    scenes,
  };
}

// ── 主函数 ──────────────────────────────────────────

async function main() {
  const outputDir = resolve("output/demo01/e2e-test");
  mkdirSync(outputDir, { recursive: true });

  // 1. 读取 Step 1 结果
  const step1Path = resolve("output/demo01/step1-test/step1-result.json");
  const step1Result = JSON.parse(readFileSync(step1Path, "utf-8"));
  console.log(`Step 1: ${step1Result.atoms.length} 原子块`);

  // 2. 模拟 Step 2
  const step2Result = mockStep2(step1Result);
  writeFileSync(join(outputDir, "step2_mock.json"), JSON.stringify(step2Result, null, 2));
  console.log(`Step 2 (mock): ${step2Result.scenes.length} 场景`);

  // 3. 合并
  console.log("\n合并 Step 1 + Step 2...");
  const merged = mergeStep2WithAtoms(step1Result, step2Result);
  writeFileSync(join(outputDir, "blueprint_merged.json"), JSON.stringify(merged, null, 2));

  // 4. 自动修复
  const repaired = autoRepairBlueprint(merged);

  // 5. 读取 transcript
  const transcriptPath = resolve("output/demo01/transcript.json");
  const transcript: Transcript = JSON.parse(readFileSync(transcriptPath, "utf-8"));
  const spokenDuration = transcript.words.reduce((s, w) => s + (w.end - w.start), 0);

  // 6. 校验
  console.log("\n校验 Blueprint...");
  const validation = validateBlueprint(repaired, transcript.duration, spokenDuration);

  if (validation.zodErrors) {
    console.error("❌ Zod 校验失败:");
    validation.zodErrors.forEach(e => console.error(`  ${e}`));
    process.exit(1);
  }

  if (validation.logicErrors && validation.logicErrors.length > 0) {
    console.error("❌ 逻辑校验失败:");
    validation.logicErrors.forEach(e => console.error(`  ${e}`));
    process.exit(1);
  }

  console.log("✅ Zod + 逻辑校验通过");

  if (validation.warnings && validation.warnings.length > 0) {
    console.log(`\n⚠️ 警告 (${validation.warnings.length}):`);
    validation.warnings.forEach(w => console.log(`  ${w}`));
  }

  if (validation.stats) {
    const s = validation.stats;
    console.log(`\n统计:`);
    console.log(`  场景: ${s.sceneCount}`);
    console.log(`  逻辑段: ${s.segmentCount}`);
    console.log(`  keep: ${s.keepAtomCount}, discard: ${s.discardAtomCount}`);
    console.log(`  覆盖: ${s.coveragePercent.toFixed(1)}%`);
    console.log(`  模板分布: ${JSON.stringify(s.templateDistribution)}`);
    console.log(`  view 分布: ${JSON.stringify(s.viewDistribution)}`);
    console.log(`  平均 items/段: ${s.avgItemsPerSegment.toFixed(1)}`);
  }

  const bp = validation.data!;

  // 7. Words 对齐
  console.log("\n对齐 words...");
  postProcessBlueprint(bp, transcript);

  // 8. 保存最终 blueprint
  const blueprintPath = join(outputDir, "blueprint.json");
  writeFileSync(blueprintPath, JSON.stringify(bp, null, 2));
  console.log(`\n✅ 已保存: ${blueprintPath}`);

  // 9. 可视化概览
  console.log("\n═══════════════════════════════════════");
  console.log("三级结构概览");
  console.log("═══════════════════════════════════════");
  for (const scene of bp.scenes) {
    console.log(`\n🎬 ${scene.id} "${scene.title}" [${scene.view}]`);
    for (const seg of scene.logic_segments) {
      const keeps = seg.atoms.filter(a => a.status === "keep");
      const discards = seg.atoms.filter(a => a.status === "discard");
      const keepText = keeps.map(a => a.text).join("");
      console.log(`  📦 ${seg.id} [${seg.template}] ${keeps.length}keep/${discards.length}discard`);
      console.log(`     items: ${seg.items.map(i => `${i.emoji||''}${i.text}`).join(" | ")}`);
      console.log(`     text: "${keepText.slice(0, 50)}${keepText.length > 50 ? '...' : ''}"`);
    }
  }

  console.log("\n\n下一步验证:");
  console.log(`  切割: npx tsx src/cut/index.ts -i test/demo01.mp4 -b ${blueprintPath} -o ${outputDir}`);
  console.log(`  渲染: npx tsx src/renderer/render.ts -b ${blueprintPath} -t ${join(outputDir, 'timing_map.json')} -v ${join(outputDir, 'cut_video.mp4')} -o ${join(outputDir, 'result.mp4')}`);
}

main().catch(err => {
  console.error("❌ 错误:", err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
