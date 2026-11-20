// Tiny toast system — same look (.toast) and 3.2 s default as the original game.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const seq = useRef(0);
  const timers = useRef(new Set());

  const toast = useCallback((msg, ms) => {
    const id = ++seq.current;
    setItems((l) => [...l, { id, msg }]);
    const t = setTimeout(() => { timers.current.delete(t); setItems((l) => l.filter((x) => x.id !== id)); }, ms || 3200);
    timers.current.add(t);
  }, []);
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);

  const value = useMemo(() => toast, [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {items.map((t) => <div className="toast" key={t.id} role="status">{t.msg}</div>)}
    </ToastContext.Provider>
  );
}
