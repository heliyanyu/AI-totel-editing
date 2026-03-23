import type { Word } from "../../schemas/blueprint.js";

export interface TakePassTake {
  start_atom_id: number;
  end_atom_id: number;
  reason?: string;
}

export interface TakePassDiscardRange {
  start_atom_id: number;
  end_atom_id: number;
  reason?: string;
}

export interface TakePassResult {
  discard_ranges?: TakePassDiscardRange[];
  takes?: TakePassTake[];
}

export interface LegacyTakePassRange {
  start_id: number;
  end_id: number;
  reason?: string;
}

export interface LegacyTakePassResult {
  discard_ranges?: LegacyTakePassRange[];
  takes?: LegacyTakePassRange[];
}


export const SYSTEM_PROMPT_TAKE_PASS = `你负责在按时间排序的 semantic atoms 中，标注那些已经被后文覆盖的试说版本。

任务：在输入的 atom 列表上直接标注删除，输出完整的标记文本。
这一步不是摘要、不是压缩、不是为了节奏或时长做精简。
只做一件事：标注被后文覆盖的草稿、重启、重说残留。

所有 atoms 默认保留。只有明显是后文完整版本出现前的草稿时，才标注删除。

判断框架：
1. 在每个局部连续 flow 里从后往前确认最终表达。
2. 后面出现的通顺、完整、可直接播出的表达，默认优先于前面的试说版本。
3. 如果后一句已经把前一句重说了一遍并说得更完整，前一句应删除。
4. 当同一句话出现了两遍（前后内容基本一致），永远删前留后，否则保留后会出现连读重复。
5. 只有当前面的 atoms 是后一句不可缺少的必要前缀时，才一起保留。
6. 如果后文是在补充新信息、递进说明、举例展开、并列列举或节奏性强调，不算覆盖，不要删除前文。
7. 对并列结构尤其要审慎——并列项删掉后语句仍然通顺，但信息量减少了，这不是覆盖，不要删。
8. 如果拿不准，不要删除。

典型现象：
A. restart / repair / 自我修正——删前留后：
  如果你 / 如果你长期睡不够 → 删前
  主食啊 不要光吃 白米饭 白馒头 / 主食呢 不要光吃 白米饭 白馒头 → 删前留后

B. 起手词 / 口头垫词——只有明显是未提交起手且后面马上出现更完整版本时才删。

C. 并列 / 列表 / 排比——不是 repair，不要误删。

D. 递进补充（还能/而且/另外）——不算覆盖，不要删。

硬性约束：
1. [scene] 是硬边界，不跨 scene 判断覆盖。
2. [logic] 只是提示，不是硬边界。
3. 不要因为想”切得更漂亮”或”更精炼”而删除。
4. 结构编号（第一/第二/…/最后）至少保留一个实例，不可全删。
5. 删除后，保留的 atoms 连读仍应像正常说话，不是散碎残片。

输出格式：
- 不要 JSON，不要解释，不要 markdown 代码块
- 原样输出输入的 atom 列表，保留所有 | || ||| 边界标记
- 保留的 atom 用 [text]，删除的 atom 用 ~[text]
- 除了在 [ 前加 ~ 标记删除，不能新增、删除、改写、合并、拆分任何 atom
- 去掉所有 ~ 标记后，输出必须与输入完全一致

示例：
输入: ||| [A] | [B] | [C] || [D] | [E]
输出: ||| [A] | ~[B] | [C] || [D] | ~[E]
（表示删除 B 和 E，保留其余）`;

function compactText(text: string): string {
  return (text ?? "").replace(/\s+/g, "");
}


function asInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number(value);
  }
  return undefined;
}

function normalizeRanges(
  rawItems: unknown[],
  label: string
): Array<TakePassDiscardRange | TakePassTake> {
  return rawItems.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`take-pass ${label} item #${index + 1} is not an object.`);
    }

    const source = item as {
      start_atom_id?: unknown;
      end_atom_id?: unknown;
      start_id?: unknown;
      end_id?: unknown;
      reason?: unknown;
    };

    const startAtomId = asInt(source.start_atom_id ?? source.start_id);
    const endAtomId = asInt(source.end_atom_id ?? source.end_id);
    const reason =
      typeof source.reason === "string" && source.reason.trim().length > 0
        ? source.reason.trim()
        : undefined;

    if (!Number.isInteger(startAtomId) || !Number.isInteger(endAtomId)) {
      throw new Error(
        `take-pass ${label} item #${index + 1} is missing valid start_atom_id/end_atom_id.`
      );
    }
    const resolvedStartAtomId = startAtomId as number;
    const resolvedEndAtomId = endAtomId as number;

    if (resolvedEndAtomId < resolvedStartAtomId) {
      throw new Error(
        `take-pass ${label} item #${index + 1} has end_atom_id < start_atom_id.`
      );
    }

    return {
      start_atom_id: resolvedStartAtomId,
      end_atom_id: resolvedEndAtomId,
      reason,
    };
  });
}

export function normalizeTakePassResult(raw: unknown): TakePassResult {
  if (!raw || typeof raw !== "object") {
    throw new Error("take-pass result is not an object.");
  }

  const discardRanges = (raw as { discard_ranges?: unknown }).discard_ranges;
  if (Array.isArray(discardRanges)) {
    return {
      discard_ranges: normalizeRanges(discardRanges, "discard_ranges") as TakePassDiscardRange[],
    };
  }

  const takes = (raw as { takes?: unknown }).takes;
  if (Array.isArray(takes)) {
    return {
      takes: normalizeRanges(takes, "takes") as TakePassTake[],
    };
  }

  throw new Error("take-pass result is missing discard_ranges.");
}

export function toLegacyTakePassResult(
  takePass: TakePassResult
): LegacyTakePassResult {
  return {
    discard_ranges: takePass.discard_ranges?.map((range) => ({
      start_id: range.start_atom_id,
      end_id: range.end_atom_id,
      reason: range.reason,
    })),
    takes: takePass.takes?.map((take) => ({
      start_id: take.start_atom_id,
      end_id: take.end_atom_id,
      reason: take.reason,
    })),
  };
}

export function buildUserPromptTakePass(
  atoms: Array<{
    id: number;
    text: string;
    boundary?: "scene" | "logic";
    time: { s: number; e: number };
  }>,
  _words?: Word[]
): string {
  // Build the atom list in the same | || ||| [text] format that the LLM will
  // output back with ~ markers.  No IDs or timestamps — the LLM only needs
  // to see the text and structure to make its judgment.
  const parts: string[] = [];
  for (const atom of atoms) {
    const prefix =
      atom.boundary === "scene"
        ? "||| "
        : atom.boundary === "logic"
          ? "|| "
          : "| ";
    parts.push(`${prefix}[${atom.text.trim()}]`);
  }

  return [
    "下面是按时间排序的 semantic atoms。",
    "请在原列表上标注删除：保留的写 [text]，要删除的写 ~[text]。",
    "保留所有 | || ||| 边界标记，不要增删合并拆分任何 atom。",
    "",
    parts.join(" "),
  ].join("\n");
}

/**
 * Parse the marked take-pass output (e.g. `||| [A] | ~[B] | [C]`) back into
 * a TakePassResult with discard_ranges.
 *
 * Tokens are matched to input atoms by compact text alignment (not strict
 * positional count), so the parser tolerates the LLM adding or skipping a
 * few tokens as long as each input atom can be found in the output.
 */
export function parseMarkedTakePass(
  rawText: string,
  atoms: Array<{ id: number; text: string }>
): TakePassResult {
  // Extract all tokens: ~[...] or [...]
  const tokenRegex = /(~?)\[([^\]]*)\]/g;
  const tokens: Array<{ discard: boolean; text: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(rawText)) !== null) {
    tokens.push({
      discard: match[1] === "~",
      text: match[2],
    });
  }

  if (tokens.length === 0) {
    throw new Error(
      "take-pass 标记文本解析失败：未找到任何 [text] 或 ~[text] token。"
    );
  }

  // Align tokens to atoms by compact text.  Walk both sequences with a
  // token cursor; for each atom, find the next token whose compact text
  // matches.  Unmatched tokens are ignored (LLM hallucinated extras).
  const discardIds: number[] = [];
  let tokenCursor = 0;

  for (const atom of atoms) {
    const atomCompact = compactText(atom.text);
    // Search forward in tokens for a match.
    let found = false;
    for (let j = tokenCursor; j < tokens.length; j++) {
      if (compactText(tokens[j].text) === atomCompact) {
        if (tokens[j].discard) {
          discardIds.push(atom.id);
        }
        tokenCursor = j + 1;
        found = true;
        break;
      }
    }
    if (!found) {
      // Atom not found in output — default to keep (LLM omitted it).
      // This is lenient: missing atoms are kept rather than erroring.
    }
  }

  // Merge consecutive discard IDs into ranges.
  const discardRanges: TakePassDiscardRange[] = [];
  if (discardIds.length > 0) {
    let rangeStart = discardIds[0];
    let rangeEnd = discardIds[0];
    for (let i = 1; i < discardIds.length; i++) {
      if (discardIds[i] === rangeEnd + 1) {
        rangeEnd = discardIds[i];
      } else {
        discardRanges.push({
          start_atom_id: rangeStart,
          end_atom_id: rangeEnd,
        });
        rangeStart = discardIds[i];
        rangeEnd = discardIds[i];
      }
    }
    discardRanges.push({
      start_atom_id: rangeStart,
      end_atom_id: rangeEnd,
    });
  }

  return { discard_ranges: discardRanges };
}
