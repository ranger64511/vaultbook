import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const DataCtx = createContext(null);

export function DataProvider({ children }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  const reload = useCallback(async () => {
    try {
      setData(await api('/data'));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const notify = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600);
  }, []);

  /** Runs an API call, then refreshes data. */
  const mutate = useCallback(async (path, opts, successMsg) => {
    const result = await api(path, opts);
    await reload();
    if (successMsg) notify(successMsg);
    return result;
  }, [reload, notify]);

  const value = useMemo(() => {
    if (!data) return { data, error, reload, mutate, notify };
    const accountsById = new Map(data.accounts.map((a) => [a.id, a]));
    const categoriesById = new Map(data.categories.map((c) => [c.id, c]));
    return { data, error, reload, mutate, notify, accountsById, categoriesById };
  }, [data, error, reload, mutate, notify]);

  return (
    <DataCtx.Provider value={value}>
      {children}
      {toast && <div className="toast" role="status">{toast}</div>}
    </DataCtx.Provider>
  );
}

export const useData = () => useContext(DataCtx);
