import { useCallback, useEffect, useState } from "react";

const read = () => decodeURIComponent(window.location.hash.slice(1));

/** The open tab, kept in the URL's fragment so cards can link to a tab and Back returns. */
export function useHashTab(fallback: string): [string, (tab: string) => void] {
  const [tab, setTab] = useState(() => read() || fallback);
  useEffect(() => {
    const sync = () => setTab(read() || fallback);
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [fallback]);
  const open = useCallback((next: string) => {
    if (next !== read()) window.location.hash = next;
    setTab(next);
  }, []);
  return [tab, open];
}
