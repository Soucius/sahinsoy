import { useEffect, useState } from 'react';
import api from './axios';

export default function useGoldRates(enabled) {
  const [state, setState] = useState({ data: null, error: '', busy: false });
  const [retry, setRetry] = useState(0), [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!enabled) return;
    let active = true, pending = false;
    const controller = new AbortController();
    async function load() {
      if (pending) return;
      pending = true;
      setState(previous => ({ ...previous, busy: true }));
      try {
        const response = await api.get('/accounting/valuation-rates', { signal: controller.signal, timeout: 12000 });
        if (active) setState({ data: response.data, error: '', busy: false });
      } catch (error) {
        if (active) setState({ data: null, error: error.response?.data?.message || 'Döviz / altın kuru alınamadı. Yeniden deneyin.', busy: false });
      } finally { pending = false; }
    }
    load();
    const refresh = setInterval(load, 60000), clock = setInterval(() => setNow(Date.now()), 15000);
    return () => { active = false; controller.abort(); clearInterval(refresh); clearInterval(clock); };
  }, [enabled, retry]);
  return { ...state, now, refresh: () => setRetry(value => value + 1) };
}
