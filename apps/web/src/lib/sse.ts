export function startSSE(onEvent: (ev: any) => void) {
  const token = localStorage.getItem("token");
  if (!token) return () => {};
  const es = new EventSource(`/stream?token=${encodeURIComponent(token)}`, { withCredentials: false });
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
