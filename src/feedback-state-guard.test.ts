/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import source from "./main.tsx?raw";


// Regression guard from the 2026-10-04 functional walkthrough: the Projects
// screen had a `actionStatus` state that 19 handlers wrote validation and
// failure messages into ("Project Documents only accept PDF...", "skipped (no
// matching inventory SKU)", "can't be sent to Procurement until the client
// approves a submittal") -- and nothing ever rendered it, so every one of
// those messages was invisible. This fails if any feedback-style state
// (Status / Message / Error / Notice) is written but never read anywhere.

describe("feedback state is always shown to the user", () => {
  it("has no *Status / *Message / *Error / *Notice useState that is set but never read", () => {
    const declaration = /const \[(\w*(?:Status|Message|Error|Notice)), (set\w+)\] = useState/g;
    const dead: string[] = [];
    for (const match of source.matchAll(declaration)) {
      const [, name, setter] = match;
      const reads = (source.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
      const writes = (source.match(new RegExp(`\\b${setter}\\b`, "g")) ?? []).length;
      // reads === 1 means only the declaration itself mentions it.
      if (reads <= 1 && writes > 1) {
        dead.push(`${name} (written ${writes - 1}x, never read)`);
      }
    }
    expect(dead).toEqual([]);
  });
});
