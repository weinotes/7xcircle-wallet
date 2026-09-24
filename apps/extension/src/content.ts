const script = document.createElement('script');
script.src = chrome.runtime.getURL('inpage.js');
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

window.addEventListener('message', event => {
  if (event.source !== window || event.data?.source !== '7xcircle-inpage') return;
  const { id, request } = event.data as { id: number; request?: { method?: string; params?: unknown[] } };
  if (!request?.method) return;

  const supported: Record<string, unknown> = {
    eth_chainId: '0x38',
    net_version: '56',
    eth_accounts: [],
    eth_requestAccounts: [],
  };
  if (request.method in supported) {
    window.postMessage({ source: '7xcircle-content', id, result: supported[request.method] }, '*');
    return;
  }
  window.postMessage({
    source: '7xcircle-content',
    id,
    error: { code: 4200, message: `7xCircle Wallet does not support ${request.method} yet` },
  }, '*');
});
