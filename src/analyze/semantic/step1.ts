export type Step1Boundary = "scene" | "logic";

export interface Step1Atom {
  id: number;
  start_id: number;
  end_id: number;
  text: string;
  time: { s: number; e: number };
  status: "keep" | "discard";
  boundary?: Step1Boundary;
  reason?: string;
  audio_span_id?: string;
}

type InputWord = {
  text: string;
  start: number;
  end: number;
};

type RawStep1Atom = {
  id?: unknown;
  start_id?: unknown;
  end_id?: unknown;
  time?: { s?: unknown; e?: unknown };
  boundary?: unknown;
};

type ParsedMarkedAtom = {
  compactText: string;
  boundary?: Step1Boundary;
};

const EPSILON = 1e-6;

export const SYSTEM_PROMPT_STEP1 = `你是医学科普视频的语义分析专家。任务：将逐字转录拆解为三级语义结构，并只通过边界标记输出结果。

你要完成三件事：
1. 切出足够细的 atom
2. 标出 logic 边界
3. 标出 scene 边界

三级结构定义：
- atom：最小连续语义单元，粒度通常是词组、短语或很短的分句
- logic：连续 atom 在论证角度变化处断开形成的逻辑块
- scene：连续 logic 在话题或表达意图变化处断开形成的场景块

atom 切分原则：
- atom 必须足够细，方便后续独立处理
- atom 边界必须落在完整词语之间，绝不能把一个词劈开
- 固定搭配、专有名词、术语、数量短语不要硬拆
- 如果某个前缀、口头语、尾部拖音、重启片段拿掉后正文仍然完整，优先把它单独切成 atom
- 如果两种切法都说得通，优先选择更清晰、更小、后续更容易独立处理的 atom

logic / scene 判断：
- logic：同一场景内的论证角度变化，比如从现象到解释、从认知到行动、从一个并列项切到另一个并列项
- scene：更高层的话题或表达意图变化，比如换一个检查项、从逐项讲解切到总结、从分析切到安抚或提醒

输出格式：
- 不要 JSON
- 不要解释
- 不要 markdown 代码块
- 只输出“原文 + 边界标记”
- 使用以下标记：
  - "|" 表示一个新 atom 开始
  - "||" 表示一个新 logic 的第一个 atom 开始
  - "|||" 表示一个新 scene 的第一个 atom 开始
- 第一段必须以 "|||" 开头
- 除了插入这些标记以及必要的换行空格，你不能新增、删除、改写任何原文字符
- 删除所有 "|" 和所有空白后，结果必须与输入原文完全一致

示例：
||| 最后 | 说几个 | 轻微或者常见的问题 | 这些您基本可以放心
||| 您的心脏彩超 | 提示 | 主动脉瓣和三尖瓣 | 有轻微或轻度的反流 | 还有 | 左室舒张功能减低
|| 这些都是 | 非常常见的 | 年龄相关性变化`;

function compactText(text: string): string {
  return text.replace(/\s+/g, "");
}

function normalizeBoundary(value: unknown): Step1Boundary | undefined {
  if (value === "scene" || value === "logic") {
    return value;
  }
  return undefined;
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

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function clampIndex(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

function stripCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```[a-zA-Z0-9_-]*\s*/u, "")
    .replace(/\s*```$/u, "")
    .trim()
    .replace(/[¦｜]/gu, "|");
}

function markerToBoundary(marker: string): Step1Boundary | undefined {
  if (marker === "|||") {
    return "scene";
  }
  if (marker === "||") {
    return "logic";
  }
  return undefined;
}

function parseMarkedAtoms(rawText: string): ParsedMarkedAtom[] {
  const text = stripCodeFence(rawText);
  const markerPattern = /\|\|\||\|\||\|/g;
  const atoms: ParsedMarkedAtom[] = [];
  let cursor = 0;
  let pendingBoundary: Step1Boundary | undefined;

  const flush = (segment: string) => {
    const compact = compactText(segment);
    if (!compact) {
      return;
    }
    atoms.push({
      compactText: compact,
      boundary: pendingBoundary,
    });
    pendingBoundary = undefined;
  };

  for (const match of text.matchAll(markerPattern)) {
    const marker = match[0];
    const markerIndex = match.index ?? 0;
    flush(text.slice(cursor, markerIndex));
    pendingBoundary = markerToBoundary(marker);
    cursor = markerIndex + marker.length;
  }

  flush(text.slice(cursor));

  if (atoms.length === 0) {
    throw new Error("Step 1 returned no marked atoms.");
  }

  return atoms;
}

function deriveIdsFromTime(
  time: { s?: unknown; e?: unknown } | undefined,
  words: InputWord[]
): { start_id: number; end_id: number } {
  if (words.length === 0) {
    return { start_id: 0, end_id: 0 };
  }

  const startTime = asNumber(time?.s) ?? words[0].start;
  const endTime = asNumber(time?.e) ?? startTime;

  let startId = words.findIndex((word) => word.end >= startTime - EPSILON);
  if (startId < 0) {
    startId = words.length - 1;
  }

  let endId = startId;
  for (let index = words.length - 1; index >= 0; index--) {
    if (words[index].start <= endTime + EPSILON) {
      endId = index;
      break;
    }
  }

  if (endId < startId) {
    endId = startId;
  }

  return {
    start_id: clampIndex(startId, words.length - 1),
    end_id: clampIndex(endId, words.length - 1),
  };
}

function materializeLegacyStep1Atom(
  rawAtom: RawStep1Atom,
  index: number,
  words: InputWord[]
): Step1Atom {
  if (words.length === 0) {
    throw new Error("Step 1 cannot materialize atoms from an empty transcript.");
  }

  const id = asInt(rawAtom.id);
  if (id === undefined) {
    throw new Error(`Step 1 atom #${index + 1} is missing an integer id.`);
  }

  let startId = asInt(rawAtom.start_id);
  let endId = asInt(rawAtom.end_id);

  if (startId === undefined || endId === undefined) {
    const derived = deriveIdsFromTime(rawAtom.time, words);
    startId = startId ?? derived.start_id;
    endId = endId ?? derived.end_id;
  }

  if (endId < startId) {
    throw new Error(`Step 1 atom ${id} has end_id < start_id.`);
  }
  if (startId < 0 || endId >= words.length) {
    throw new Error(
      `Step 1 atom ${id} references token ids outside 0..${words.length - 1}.`
    );
  }

  const slice = words.slice(startId, endId + 1);
  if (slice.length === 0) {
    throw new Error(`Step 1 atom ${id} resolved to an empty token slice.`);
  }

  return {
    id,
    start_id: startId,
    end_id: endId,
    text: slice.map((word) => word.text).join(""),
    time: {
      s: slice[0].start,
      e: slice[slice.length - 1].end,
    },
    status: "keep",
    boundary: normalizeBoundary(rawAtom.boundary),
  };
}

function materializeMarkedStep1Atoms(
  markedAtoms: ParsedMarkedAtom[],
  words: InputWord[]
): Step1Atom[] {
  if (words.length === 0) {
    throw new Error("Step 1 cannot materialize atoms from an empty transcript.");
  }

  const compactWords = words.map((word) => compactText(word.text));
  const expectedTranscript = compactWords.join("");
  const actualTranscript = markedAtoms.map((atom) => atom.compactText).join("");

  if (actualTranscript !== expectedTranscript) {
    throw new Error(
      "Step 1 marked text does not match the source transcript after removing markers and whitespace."
    );
  }

  const atoms: Step1Atom[] = [];
  let wordCursor = 0;

  for (const [index, atom] of markedAtoms.entries()) {
    while (wordCursor < compactWords.length && compactWords[wordCursor] === "") {
      wordCursor++;
    }

    const startId = wordCursor;
    let endId = startId;
    let matchedText = "";

    while (
      wordCursor < compactWords.length &&
      matchedText.length < atom.compactText.length
    ) {
      matchedText += compactWords[wordCursor];
      endId = wordCursor;
      wordCursor++;
    }

    if (matchedText !== atom.compactText) {
      throw new Error(
        `Step 1 atom ${index + 1} could not be aligned back to the source transcript.`
      );
    }

    const slice = words.slice(startId, endId + 1);
    atoms.push({
      id: index + 1,
      start_id: startId,
      end_id: endId,
      text: slice.map((word) => word.text).join(""),
      time: {
        s: slice[0].start,
        e: slice[slice.length - 1].end,
      },
      status: "keep",
      boundary: atom.boundary,
    });
  }

  while (wordCursor < compactWords.length && compactWords[wordCursor] === "") {
    wordCursor++;
  }

  if (wordCursor !== compactWords.length) {
    throw new Error("Step 1 marked text did not consume the full transcript.");
  }

  return atoms;
}

export function normalizeStep1Result(
  raw: unknown,
  words: InputWord[]
): { atoms: Step1Atom[] } {
  if (typeof raw === "string") {
    return {
      atoms: materializeMarkedStep1Atoms(parseMarkedAtoms(raw), words),
    };
  }

  if (
    raw &&
    typeof raw === "object" &&
    Array.isArray((raw as { atoms?: unknown }).atoms)
  ) {
    const rawAtoms = (raw as { atoms: RawStep1Atom[] }).atoms;
    if (rawAtoms.length === 0) {
      throw new Error("Step 1 returned an empty atoms array.");
    }

    const atoms = rawAtoms
      .map((rawAtom, index) => materializeLegacyStep1Atom(rawAtom, index, words))
      .sort((left, right) => left.id - right.id);

    const seenIds = new Set<number>();
    for (const atom of atoms) {
      if (seenIds.has(atom.id)) {
        throw new Error(`Step 1 returned duplicate atom id ${atom.id}.`);
      }
      seenIds.add(atom.id);
    }

    return { atoms };
  }

  throw new Error(
    "Step 1 output must be either marked transcript text or an object with an atoms array."
  );
}

export function buildUserPromptStep1(words: InputWord[]): string {
  const transcriptText = words.map((word) => compactText(word.text)).join("");
  const tokenGuide = words
    .map((word) => compactText(word.text))
    .filter(Boolean)
    .join(" / ");

  return [
    `转录原文（删除所有空白后必须逐字保留）：\n${transcriptText}`,
    `按词切分参考（仅用于识别词语边界，输出时不要保留斜杠）：\n${tokenGuide}`,
    "输出提醒：第一段必须以 ||| 开头；只能插入 |、||、||| 与必要的换行空格；删除所有竖线和空白后，必须与“转录原文”完全一致。",
  ].join("\n\n");
}
