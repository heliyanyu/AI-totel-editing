import type {
  TakePassDiscardRange,
  TakePassResult,
  TakePassTake,
} from "./take-pass.js";

type Step1AtomLike = {
  id: number;
  text: string;
  time: { s: number; e: number };
  status?: "keep" | "discard";
  boundary?: "scene" | "logic";
  reason?: string;
  audio_span_id?: string;
};

const TAKE_MERGE_GAP_SEC = 0.35;
const TAKE_HARD_BREAK_GAP_SEC = 1.1;
const TAKE_REASON_PREVIEW_CHAR_LIMIT = 28;
const RESTART_FILLER_ATOMS = new Set([
  "我们说",
  "就是说",
  "也就是说",
  "换句话说",
  "这么说吧",
]);
const MODAL_PARTICLE_SUFFIXES = ["呢", "啊", "呀", "吧", "嘛"];

function compactText(text: string): string {
  return text.replace(/\s+/g, "");
}

function atomText(atom: Step1AtomLike): string {
  return compactText(atom.text ?? "");
}

function atomDuration(atom: Step1AtomLike): number {
  return Math.max(0, atom.time.e - atom.time.s);
}

function normalizeRestartText(text: string): string {
  return compactText(text).replace(/[呢啊呀吧嘛]/g, "");
}

function isConnectorAtom(text: string): boolean {
  const compact = compactText(text);
  const connectors = [
    "让给",
    "之后呢",
    "所以呢",
    "但如果",
    "可如果",
    "更重要的是",
    "就是",
    "这时候",
    "把",
    "按住",
    "留出",
    "修复和覆盖的时间",
  ];

  return connectors.some(
    (phrase) => compact === phrase || compact.endsWith(phrase)
  );
}

function buildSceneKeyByAtomId(atoms: Step1AtomLike[]): Map<number, string> {
  const sceneKeyByAtomId = new Map<number, string>();
  let sceneIndex = 0;

  for (const atom of atoms) {
    if (atom.boundary === "scene" || sceneIndex === 0) {
      sceneIndex += 1;
    }

    sceneKeyByAtomId.set(atom.id, `S${sceneIndex}`);
  }

  return sceneKeyByAtomId;
}

function buildAtomById(atoms: Step1AtomLike[]): Map<number, Step1AtomLike> {
  return new Map(atoms.map((atom) => [atom.id, atom]));
}

function normalizeRawDiscardRanges(
  discardRanges: TakePassDiscardRange[],
  atoms: Step1AtomLike[]
): TakePassDiscardRange[] {
  if (discardRanges.length === 0 || atoms.length === 0) {
    return [];
  }

  const validIds = new Set(atoms.map((atom) => atom.id));
  const normalized = discardRanges
    .filter(
      (range) => validIds.has(range.start_id) && validIds.has(range.end_id)
    )
    .map((range) => ({ ...range }))
    .sort((a, b) => a.start_id - b.start_id || a.end_id - b.end_id);

  if (normalized.length === 0) {
    return [];
  }

  const merged: TakePassDiscardRange[] = [{ ...normalized[0] }];
  for (let index = 1; index < normalized.length; index++) {
    const current = normalized[index];
    const previous = merged[merged.length - 1];
    if (current.start_id <= previous.end_id + 1) {
      previous.end_id = Math.max(previous.end_id, current.end_id);
      previous.reason = previous.reason ?? current.reason;
      continue;
    }
    merged.push({ ...current });
  }

  return merged;
}

function normalizeRawTakes(
  takes: TakePassTake[],
  atoms: Step1AtomLike[]
): TakePassTake[] {
  if (takes.length === 0 || atoms.length === 0) {
    return [];
  }

  const validIds = new Set(atoms.map((atom) => atom.id));
  const normalized = takes
    .filter((take) => validIds.has(take.start_id) && validIds.has(take.end_id))
    .map((take) => ({ ...take }))
    .sort((a, b) => a.start_id - b.start_id || a.end_id - b.end_id);

  if (normalized.length === 0) {
    return [];
  }

  const merged: TakePassTake[] = [{ ...normalized[0] }];
  for (let index = 1; index < normalized.length; index++) {
    const current = normalized[index];
    const previous = merged[merged.length - 1];
    if (current.start_id <= previous.end_id + 1) {
      previous.end_id = Math.max(previous.end_id, current.end_id);
      previous.reason = previous.reason ?? current.reason;
      continue;
    }
    merged.push({ ...current });
  }

  return merged;
}

function buildInitialTakesFromDiscardRanges(
  discardRanges: TakePassDiscardRange[],
  atoms: Step1AtomLike[]
): TakePassTake[] {
  if (atoms.length === 0) {
    return [];
  }

  const discardedIds = new Set<number>();
  for (const range of discardRanges) {
    for (let atomId = range.start_id; atomId <= range.end_id; atomId++) {
      discardedIds.add(atomId);
    }
  }

  const keptIds = atoms
    .map((atom) => atom.id)
    .filter((atomId) => !discardedIds.has(atomId));

  return buildContiguousTakesFromIds(keptIds);
}

function buildExplicitDiscardReasonById(
  discardRanges: TakePassDiscardRange[]
): Map<number, string> {
  const reasonById = new Map<number, string>();

  for (const range of discardRanges) {
    if (!range.reason) {
      continue;
    }
    for (let atomId = range.start_id; atomId <= range.end_id; atomId++) {
      reasonById.set(atomId, range.reason);
    }
  }

  return reasonById;
}

function resolveInitialTakes(
  takePass: TakePassResult,
  atoms: Step1AtomLike[]
): {
  takes: TakePassTake[];
  explicitDiscardReasonById: Map<number, string>;
  usesDiscardRanges: boolean;
} {
  if (Array.isArray(takePass.discard_ranges)) {
    const discardRanges = normalizeRawDiscardRanges(takePass.discard_ranges, atoms);
    return {
      takes: buildInitialTakesFromDiscardRanges(discardRanges, atoms),
      explicitDiscardReasonById: buildExplicitDiscardReasonById(discardRanges),
      usesDiscardRanges: true,
    };
  }

  const legacyTakes = normalizeRawTakes(takePass.takes ?? [], atoms);
  return {
    takes: legacyTakes,
    explicitDiscardReasonById: new Map<number, string>(),
    usesDiscardRanges: false,
  };
}

function shouldHardSplitBetween(
  previousAtom: Step1AtomLike,
  nextAtom: Step1AtomLike
): boolean {
  if (nextAtom.boundary === "scene") {
    return true;
  }

  return nextAtom.time.s - previousAtom.time.e > TAKE_HARD_BREAK_GAP_SEC;
}

function splitTakesAtHardBreaks(
  takes: TakePassTake[],
  atoms: Step1AtomLike[]
): TakePassTake[] {
  if (takes.length === 0 || atoms.length === 0) {
    return [];
  }

  const atomById = buildAtomById(atoms);
  const split: TakePassTake[] = [];

  for (const take of takes) {
    let currentStart = take.start_id;
    let previousAtom = atomById.get(take.start_id);
    if (!previousAtom) {
      continue;
    }

    for (let atomId = take.start_id + 1; atomId <= take.end_id; atomId++) {
      const atom = atomById.get(atomId);
      if (!atom) {
        continue;
      }

      if (shouldHardSplitBetween(previousAtom, atom)) {
        split.push({
          start_id: currentStart,
          end_id: previousAtom.id,
          reason: take.reason,
        });
        currentStart = atom.id;
      }

      previousAtom = atom;
    }

    split.push({
      start_id: currentStart,
      end_id: take.end_id,
      reason: take.reason,
    });
  }

  return split.filter((take) => take.end_id >= take.start_id);
}

function expandConnectorBridges(
  takes: TakePassTake[],
  atoms: Step1AtomLike[],
  sceneKeyByAtomId: Map<number, string>,
  explicitDiscardReasonById: Map<number, string>
): TakePassTake[] {
  if (takes.length === 0 || atoms.length === 0) {
    return takes;
  }

  const atomById = buildAtomById(atoms);
  const expanded = takes.map((take) => ({ ...take }));

  for (let index = 0; index < expanded.length - 1; index++) {
    const left = expanded[index];
    const right = expanded[index + 1];
    const gapIds: number[] = [];
    for (let atomId = left.end_id + 1; atomId < right.start_id; atomId++) {
      gapIds.push(atomId);
    }

    if (gapIds.length !== 1) {
      continue;
    }

    const bridge = atomById.get(gapIds[0]);
    if (!bridge || !isConnectorAtom(bridge.text)) {
      continue;
    }
    if (explicitDiscardReasonById.has(bridge.id)) {
      continue;
    }

    const rightStartAtom = atomById.get(right.start_id);
    if (rightStartAtom && shouldDropImmediateRestart(bridge, rightStartAtom)) {
      continue;
    }

    const leftScene = sceneKeyByAtomId.get(left.end_id);
    const bridgeScene = sceneKeyByAtomId.get(bridge.id);
    const rightScene = sceneKeyByAtomId.get(right.start_id);
    if (!leftScene || leftScene !== bridgeScene || bridgeScene !== rightScene) {
      continue;
    }

    left.end_id = bridge.id;
  }

  return expanded;
}

function mergeAdjacentTakes(
  takes: TakePassTake[],
  atoms: Step1AtomLike[],
  sceneKeyByAtomId: Map<number, string>
): TakePassTake[] {
  if (takes.length === 0) {
    return [];
  }

  const atomById = buildAtomById(atoms);
  const sorted = [...takes].sort((a, b) => a.start_id - b.start_id);
  const merged: TakePassTake[] = [{ ...sorted[0] }];

  for (let index = 1; index < sorted.length; index++) {
    const current = sorted[index];
    const last = merged[merged.length - 1];
    const previousAtom = atomById.get(last.end_id);
    const nextAtom = atomById.get(current.start_id);
    const previousScene = sceneKeyByAtomId.get(last.end_id);
    const nextScene = sceneKeyByAtomId.get(current.start_id);

    if (
      previousAtom &&
      nextAtom &&
      previousScene &&
      previousScene === nextScene &&
      current.start_id <= last.end_id + 1 &&
      nextAtom.time.s - previousAtom.time.e <= TAKE_MERGE_GAP_SEC
    ) {
      last.end_id = Math.max(last.end_id, current.end_id);
      last.reason = last.reason ?? current.reason;
      continue;
    }

    merged.push({ ...current });
  }

  return merged;
}

function buildContiguousTakesFromIds(
  atomIds: number[],
  reason?: string
): TakePassTake[] {
  if (atomIds.length === 0) {
    return [];
  }

  const sorted = [...atomIds].sort((a, b) => a - b);
  const rebuilt: TakePassTake[] = [];
  let start = sorted[0];
  let previous = sorted[0];

  for (let index = 1; index < sorted.length; index++) {
    const current = sorted[index];
    if (current !== previous + 1) {
      rebuilt.push({ start_id: start, end_id: previous, reason });
      start = current;
    }
    previous = current;
  }

  rebuilt.push({ start_id: start, end_id: previous, reason });
  return rebuilt;
}

function endsWithModalParticle(text: string): boolean {
  return MODAL_PARTICLE_SUFFIXES.some((suffix) => text.endsWith(suffix));
}

function sharedPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let length = 0;

  while (length < limit && left[length] === right[length]) {
    length += 1;
  }

  return length;
}

function looksLikeRepeatedPhrase(left: string, right: string): boolean {
  const normalizedLeft = normalizeRestartText(left);
  const normalizedRight = normalizeRestartText(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  if (normalizedLeft === normalizedRight) {
    return true;
  }

  if (normalizedLeft.length >= 2 && normalizedRight.startsWith(normalizedLeft)) {
    return true;
  }

  if (normalizedRight.length >= 2 && normalizedLeft.startsWith(normalizedRight)) {
    return true;
  }
  return false;
}

function shouldDropImmediateRestart(
  current: Step1AtomLike,
  next: Step1AtomLike
): boolean {
  const currentText = atomText(current);
  const nextText = atomText(next);
  const normalizedCurrent = normalizeRestartText(currentText);
  const normalizedNext = normalizeRestartText(nextText);
  if (!normalizedCurrent || !normalizedNext) {
    return false;
  }

  if (normalizedCurrent === normalizedNext) {
    return true;
  }

  if (normalizedNext.startsWith(normalizedCurrent) && normalizedCurrent.length <= 3) {
    return true;
  }

  if (
    normalizedCurrent.startsWith(normalizedNext) &&
    normalizedNext.length >= 2 &&
    endsWithModalParticle(currentText)
  ) {
    return true;
  }

  if (
    currentText.startsWith("那") &&
    currentText.length >= 3 &&
    nextText.startsWith(currentText.slice(1))
  ) {
    return true;
  }

  return false;
}

function shouldDropRestartFillerBridge(
  current: Step1AtomLike,
  filler: Step1AtomLike,
  repeated: Step1AtomLike
): boolean {
  return (
    RESTART_FILLER_ATOMS.has(atomText(filler)) &&
    looksLikeRepeatedPhrase(atomText(current), atomText(repeated))
  );
}

function findRestartSequenceDropEnd(
  takeAtoms: Step1AtomLike[],
  index: number
): number | null {
  const remaining = takeAtoms.length - index;
  const maxSequenceLength = Math.min(5, Math.floor(remaining / 2));

  for (let sequenceLength = maxSequenceLength; sequenceLength >= 1; sequenceLength--) {
    for (const gapLength of [1, 0]) {
      const firstEnd = index + sequenceLength - 1;
      const gapEnd = firstEnd + gapLength;
      const secondStart = gapEnd + 1;
      const secondEnd = secondStart + sequenceLength - 1;

      if (secondEnd >= takeAtoms.length) {
        continue;
      }

      const firstPhrase = compactText(
        takeAtoms
          .slice(index, firstEnd + 1)
          .map((atom) => atom.text)
          .join("")
      );
      const gapPhrase = compactText(
        takeAtoms
          .slice(firstEnd + 1, gapEnd + 1)
          .map((atom) => atom.text)
          .join("")
      );
      const secondPhrase = compactText(
        takeAtoms
          .slice(secondStart, secondEnd + 1)
          .map((atom) => atom.text)
          .join("")
      );

      if (
        gapPhrase.length <= 4 &&
        looksLikeRepeatedPhrase(firstPhrase, secondPhrase)
      ) {
        return gapEnd;
      }
    }
  }

  return null;
}

function trimRestartAtomsWithinTake(
  take: TakePassTake,
  atomById: Map<number, Step1AtomLike>
): TakePassTake[] {
  const atomIds: number[] = [];
  for (let atomId = take.start_id; atomId <= take.end_id; atomId++) {
    if (atomById.has(atomId)) {
      atomIds.push(atomId);
    }
  }

  if (atomIds.length <= 1) {
    return atomIds.length === 0 ? [] : [{ ...take }];
  }

  let keptIds = [...atomIds];
  let changed = true;

  while (changed) {
    changed = false;
    const takeAtoms = keptIds
      .map((atomId) => atomById.get(atomId))
      .filter((atom): atom is Step1AtomLike => Boolean(atom));
    const droppedIds = new Set<number>();

    for (let index = 0; index < takeAtoms.length; index++) {
      const current = takeAtoms[index];
      const next = takeAtoms[index + 1];
      const afterNext = takeAtoms[index + 2];

      if (next && shouldDropImmediateRestart(current, next)) {
        droppedIds.add(current.id);
        changed = true;
        continue;
      }

      if (
        next &&
        afterNext &&
        shouldDropRestartFillerBridge(current, next, afterNext)
      ) {
        droppedIds.add(next.id);
        droppedIds.add(afterNext.id);
        changed = true;
        continue;
      }

      const sequenceDropEnd = findRestartSequenceDropEnd(takeAtoms, index);
      if (sequenceDropEnd !== null) {
        for (let dropIndex = index; dropIndex <= sequenceDropEnd; dropIndex++) {
          droppedIds.add(takeAtoms[dropIndex].id);
        }
        changed = true;
        break;
      }
    }

    if (changed) {
      keptIds = keptIds.filter((atomId) => !droppedIds.has(atomId));
    }
  }

  return buildContiguousTakesFromIds(keptIds, take.reason);
}

function dropWeakTakeFragments(
  takes: TakePassTake[],
  atoms: Step1AtomLike[]
): TakePassTake[] {
  if (takes.length === 0) {
    return [];
  }

  const atomById = buildAtomById(atoms);
  const keptIds = new Set<number>();

  for (const take of takes) {
    const takeAtoms: Step1AtomLike[] = [];
    for (let atomId = take.start_id; atomId <= take.end_id; atomId++) {
      const atom = atomById.get(atomId);
      if (atom) {
        takeAtoms.push(atom);
      }
    }

    if (takeAtoms.length === 0) {
      continue;
    }

    const duration =
      takeAtoms[takeAtoms.length - 1].time.e - takeAtoms[0].time.s;
    const text = takeAtoms.map((atom) => atomText(atom)).join("");
    const shouldDrop =
      takeAtoms.length === 1 &&
      (text.length <= 1 ||
        (duration <= 0.35 && text.length <= 1) ||
        RESTART_FILLER_ATOMS.has(text));

    if (shouldDrop) {
      continue;
    }

    for (const atom of takeAtoms) {
      keptIds.add(atom.id);
    }
  }

  return buildContiguousTakesFromIds([...keptIds]);
}

function buildTakeReason(
  take: TakePassTake,
  atomById: Map<number, Step1AtomLike>
): string {
  const textParts: string[] = [];
  for (let atomId = take.start_id; atomId <= take.end_id; atomId++) {
    const atom = atomById.get(atomId);
    if (atom) {
      textParts.push(atomText(atom));
    }
  }

  const text = textParts.join("");
  if (!text) {
    return "保留自然可播表达";
  }

  const preview =
    text.length > TAKE_REASON_PREVIEW_CHAR_LIMIT
      ? `${text.slice(0, TAKE_REASON_PREVIEW_CHAR_LIMIT)}...`
      : text;
  return `保留自然可播表达：${preview}`;
}

function assignAudioSpanIds(atoms: Step1AtomLike[], takes: TakePassTake[]): void {
  for (const atom of atoms) {
    delete atom.audio_span_id;
  }

  takes.forEach((take, index) => {
    const audioSpanId = `A${index + 1}`;
    for (const atom of atoms) {
      if (atom.id >= take.start_id && atom.id <= take.end_id) {
        atom.audio_span_id = audioSpanId;
      }
    }
  });
}

export function applyTakePass(
  step1Result: {
    atoms?: Array<Record<string, unknown>>;
    audio_spans?: Array<Record<string, unknown>>;
  },
  takePass: TakePassResult
): {
  takeCount: number;
  keptAtomCount: number;
  discardedAtomCount: number;
} {
  if (!Array.isArray(step1Result.atoms) || step1Result.atoms.length === 0) {
    return { takeCount: 0, keptAtomCount: 0, discardedAtomCount: 0 };
  }

  const atoms = step1Result.atoms as Step1AtomLike[];
  const atomById = buildAtomById(atoms);
  const sceneKeyByAtomId = buildSceneKeyByAtomId(atoms);
  const originalBoundaries = new Map<number, "scene" | "logic">();

  for (const atom of atoms) {
    if (atom.boundary) {
      originalBoundaries.set(atom.id, atom.boundary);
    }
  }

  const {
    takes: initialTakes,
    explicitDiscardReasonById,
    usesDiscardRanges,
  } = resolveInitialTakes(takePass, atoms);

  let normalized = initialTakes;
  if (usesDiscardRanges) {
    // In repair-pass mode, the LLM owns keep/discard decisions.
    // Local code only groups surviving contiguous atoms and enforces hard breaks.
    normalized = splitTakesAtHardBreaks(normalized, atoms).map((take) => ({
      ...take,
      reason: buildTakeReason(take, atomById),
    }));
  } else {
    normalized = splitTakesAtHardBreaks(normalized, atoms);
    normalized = mergeAdjacentTakes(
      expandConnectorBridges(
        normalized,
        atoms,
        sceneKeyByAtomId,
        explicitDiscardReasonById
      ),
      atoms,
      sceneKeyByAtomId
    );
    normalized = normalized.flatMap((take) =>
      trimRestartAtomsWithinTake(take, atomById)
    );
    normalized = dropWeakTakeFragments(normalized, atoms);
    normalized = splitTakesAtHardBreaks(normalized, atoms);
    normalized = mergeAdjacentTakes(
      expandConnectorBridges(
        normalized,
        atoms,
        sceneKeyByAtomId,
        explicitDiscardReasonById
      ),
      atoms,
      sceneKeyByAtomId
    ).map((take) => ({
      ...take,
      reason: buildTakeReason(take, atomById),
    }));
  }

  assignAudioSpanIds(atoms, normalized);

  const takenIds = new Set<number>();
  for (const take of normalized) {
    for (let atomId = take.start_id; atomId <= take.end_id; atomId++) {
      takenIds.add(atomId);
    }
  }

  let keptAtomCount = 0;
  let discardedAtomCount = 0;
  for (const atom of atoms) {
    if (takenIds.has(atom.id)) {
      atom.status = "keep";
      delete atom.reason;
      keptAtomCount += 1;
    } else {
      atom.status = "discard";
      atom.reason =
        explicitDiscardReasonById.get(atom.id) ?? "未被 take-pass 选中";
      delete atom.audio_span_id;
      discardedAtomCount += 1;
    }
    delete atom.boundary;
  }

  let pendingBoundary: "scene" | "logic" | null = null;
  let seenFirstKeep = false;

  for (const atom of atoms) {
    const originalBoundary = originalBoundaries.get(atom.id);
    if (originalBoundary === "scene") {
      pendingBoundary = "scene";
    } else if (originalBoundary === "logic" && pendingBoundary !== "scene") {
      pendingBoundary = "logic";
    }

    if (atom.status !== "keep") {
      continue;
    }

    if (!seenFirstKeep) {
      atom.boundary = pendingBoundary ?? "scene";
      pendingBoundary = null;
      seenFirstKeep = true;
      continue;
    }

    if (pendingBoundary) {
      atom.boundary = pendingBoundary;
      pendingBoundary = null;
    }
  }

  step1Result.audio_spans = normalized.map((take, index) => ({
    id: `A${index + 1}`,
    start_id: take.start_id,
    end_id: take.end_id,
    reason: take.reason,
  }));

  return {
    takeCount: normalized.length,
    keptAtomCount,
    discardedAtomCount,
  };
}
