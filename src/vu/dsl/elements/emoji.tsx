import React from "react";

import type { EmojiElement } from "../schema";

export const EmojiView: React.FC<{ el: EmojiElement }> = ({ el }) => (
  <div
    style={{
      fontSize: 140,
      lineHeight: 1,
      filter: "drop-shadow(0 8px 20px rgba(245,158,11,0.35))",
    }}
  >
    {el.content}
  </div>
);
