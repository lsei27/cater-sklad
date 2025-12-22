export function startSSE(onEvent: (ev: any) => void) {
  const token = localStorage.getItem("token");
  if (!token) return () => {};
  const rawBase = (import.meta as any).env?.VITE_API_BASE_URL as string | undefined;
  const base = (rawBase ?? "").replace(/\/+$/, "");
  const es = new EventSource(`${base}/stream?token=${encodeURIComponent(token)}`, { withCredentials: false });
  es.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data));
    } catch {
      // ignore
    }
  };
  es.onerror = () => {
    es.close();
  };
  return () => es.close();
}
