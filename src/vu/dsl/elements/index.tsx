import React from "react";

import type { ElementSnapshot } from "../interpreter";
import type { DSLElement } from "../schema";
import { BigNumberView } from "./big-number";
import { DataCardView } from "./data-card";
import { EmojiView } from "./emoji";
import { NumberedListView } from "./numbered-list";
import { SvgPathView } from "./svg-path";
import { TextCardView } from "./text-card";
import type { ResolvedAsset } from "./video-panel";
import { VideoPanelView } from "./video-panel";

export type { ResolvedAsset } from "./video-panel";

export interface RenderContext {
  fps: number;
  frame: number;
  resolvedAssets?: Record<string, ResolvedAsset>;
}

export function renderElement(
  el: DSLElement,
  snap: ElementSnapshot,
  ctx: RenderContext,
): React.ReactNode {
  switch (el.type) {
    case "emoji":
      return <EmojiView el={el} />;
    case "text_card":
      return <TextCardView el={el} snap={snap} />;
    case "numbered_list":
      return <NumberedListView el={el} snap={snap} frame={ctx.frame} />;
    case "big_number":
      return <BigNumberView el={el} snap={snap} />;
    case "video_panel":
      return <VideoPanelView el={el} resolvedAssets={ctx.resolvedAssets} />;
    case "svg_path":
      return <SvgPathView el={el} snap={snap} />;
    case "data_card":
      return <DataCardView el={el} />;
  }
}
