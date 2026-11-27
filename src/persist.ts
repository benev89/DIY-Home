// Drafts that survive closing the app: every change is written to the phone's database
// immediately, and read back when the screen opens again.
import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "./db";

export function useDraft<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void, boolean, () => void] {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    db.settings.get(`draft:${key}`).then((row) => {
      if (!alive) return;
      setValue(row ? (row.value as T) : initial);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial is only the fallback
  }, [key]);

  const update = useCallback((v: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
      void db.settings.put({ key: `draft:${keyRef.current}`, value: next });
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    void db.settings.where("key").equals(`draft:${keyRef.current}`).delete();
    setValue(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [value, update, loaded, clear];
}
