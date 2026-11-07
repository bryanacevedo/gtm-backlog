/* j/k row focus shared by the list views. The focused row is the one Enter
   opens and the arrow keys move, so keyboard and mouse users act on the same thing. */

import { useEffect, useState } from "react";
import { isTyping, navigate } from "./lib";

export function useRowFocus(ids: string[], extra?: (e: KeyboardEvent, id: string) => boolean) {
  const [focus, setFocus] = useState<string | null>(null);
  useEffect(() => {
    if (focus && !ids.includes(focus)) setFocus(null);
  }, [ids, focus]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".scrim")) return;
      if (!ids.length) return;
      const i = focus ? ids.indexOf(focus) : -1;
      if (e.key === "j" || e.key === "ArrowDown" && e.target === document.body) {
        e.preventDefault(); const next = ids[Math.min(ids.length - 1, i + 1)]; setFocus(next); reveal(next);
      } else if (e.key === "k" || e.key === "ArrowUp" && e.target === document.body) {
        e.preventDefault(); const prev = ids[Math.max(0, i - 1)]; setFocus(prev); reveal(prev);
      } else if (e.key === "Enter" && focus && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement)) {
        e.preventDefault(); navigate(`/item/${focus}`);
      } else if (focus && extra?.(e, focus)) {
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ids, focus, extra]);
  return [focus, setFocus] as const;
}

function reveal(id: string) {
  requestAnimationFrame(() => document.querySelector(`[data-row="${id}"]`)?.scrollIntoView({ block: "nearest" }));
}
