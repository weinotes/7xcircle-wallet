(function () {
  if (window.ethereum) return;
  var nextId = 1;
  var listeners = {};
  var provider = {
    is7xCircle: true,
    isMetaMask: false,
    request: function (args) {
      var id = nextId++;
      return new Promise(function (resolve, reject) {
        listeners[id] = { resolve: resolve, reject: reject };
        window.postMessage({ source: '7xcircle-inpage', type: 'request', id: id, request: args }, '*');
      });
    },
    on: function (event, handler) {
      window.addEventListener('7xcircle:' + event, function (e) { handler(e.detail); });
    },
    removeListener: function () {}
  };
  window.addEventListener('message', function (event) {
    if (event.source !== window || !event.data || event.data.source !== '7xcircle-content') return;
    var pending = listeners[event.data.id];
    if (!pending) return;
    delete listeners[event.data.id];
    if (event.data.error) pending.reject(Object.assign(new Error(event.data.error.message), event.data.error));
    else pending.resolve(event.data.result);
  });
  window.ethereum = provider;
  window.dispatchEvent(new Event('ethereum#initialized'));
})();
