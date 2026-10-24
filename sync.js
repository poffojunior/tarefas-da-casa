/* Camada de dados do app: guarda no aparelho ou sincroniza com um Firebase Realtime Database (REST). */
(function () {
  var LS = window.localStorage;
  function lsGet(k) { try { return LS.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { LS.setItem(k, v); } catch (e) {} }
  // Banco compartilhado com o app Android. "-" guardado = usuário escolheu usar só neste aparelho.
  var DEFAULT_URL = "https://tarefas-da-casa-bd053-default-rtdb.firebaseio.com";
  var saved = lsGet("tc-sync-url");
  var base = (saved === "-" ? "" : (saved || DEFAULT_URL)).replace(/\/+$/, "");
  var remote = /^https:\/\/.+/.test(base);
  var tree = {};
  var ready = !remote;
  var status = remote ? "conectando" : "local";
  var listeners = [];
  try { tree = JSON.parse(lsGet("tc-data") || "{}") || {}; } catch (e) { tree = {}; }

  function clean(o) {
    var r = {};
    Object.keys(o).forEach(function (k) { if (o[k] !== null && o[k] !== undefined) r[k] = o[k]; });
    return r;
  }
  function persist() { lsSet("tc-data", JSON.stringify(tree)); }
  function newId() { return "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function mkDoc(col, id) {
    var data = tree[col] && tree[col][id];
    return { id: id, exists: !!data, data: function () { return data; }, metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function colSnap(col, field, dir) {
    var ids = Object.keys(tree[col] || {});
    ids.sort(function (a, b) {
      if (field) {
        var x = tree[col][a][field], y = tree[col][b][field];
        if (x !== y) { if (x === undefined) return 1; if (y === undefined) return -1; return (x < y ? -1 : 1) * (dir === "desc" ? -1 : 1); }
      }
      return a < b ? -1 : a > b ? 1 : 0;
    });
    var docs = ids.map(function (i) { return mkDoc(col, i); });
    return { docs: docs, size: docs.length, empty: !docs.length };
  }
  function fire(l) {
    if (!ready) return;
    var snap = l.get();
    var sig = JSON.stringify(l.sig());
    if (sig === l.last) return;
    l.last = sig;
    try { l.next(snap); } catch (e) { console.error(e); }
  }
  function fireAll() { listeners.slice().forEach(fire); }
  function listen(get, sig, next) {
    var l = { get: get, sig: sig, next: next, last: null };
    listeners.push(l);
    setTimeout(function () { fire(l); }, 0);
    return function () { var i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
  }

  function req(method, path, body) {
    var opts = { method: method, headers: { "Content-Type": "application/json" } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(base + "/" + path + ".json", opts).then(function (r) {
      if (!r.ok) { var e = new Error("http " + r.status); e.code = r.status === 401 || r.status === 403 ? "invalid_argument" : "unavailable"; throw e; }
      return r.json();
    });
  }
  function poll() {
    return req("GET", "").then(function (t) {
      var next = t || {};
      if (JSON.stringify(next) !== JSON.stringify(tree)) { tree = next; persist(); }
      ready = true; status = "sincronizado"; fireAll();
    }).catch(function () {
      status = "offline";
      if (!ready) { ready = true; }
      fireAll();
    });
  }
  if (remote) { poll(); setInterval(poll, 4000); document.addEventListener("visibilitychange", function () { if (!document.hidden) poll(); }); }

  function write(col, id, mutate, httpCall) {
    tree[col] = tree[col] || {};
    mutate();
    if (!Object.keys(tree[col]).length) delete tree[col];
    persist(); fireAll();
    if (!remote) return Promise.resolve();
    return httpCall().catch(function (e) { return poll().then(function () { throw e; }); });
  }

  function docRef(path) {
    var p = path.split("/"), col = p[0], id = p[1];
    return {
      id: id, path: path,
      get: function () { return Promise.resolve(mkDoc(col, id)); },
      set: function (data) {
        var d = clean(data);
        return write(col, id, function () { tree[col][id] = d; }, function () { return req("PUT", col + "/" + id, d); });
      },
      update: function (data) {
        if (!(tree[col] && tree[col][id])) return Promise.reject({ code: "invalid_argument", message: "doc missing" });
        return write(col, id, function () { tree[col][id] = clean(Object.assign({}, tree[col][id], data)); },
          function () { return req("PATCH", col + "/" + id, data); });
      },
      delete: function () {
        return write(col, id, function () { if (tree[col]) delete tree[col][id]; }, function () { return req("DELETE", col + "/" + id); });
      },
      onSnapshot: function (next) {
        return listen(function () { return mkDoc(col, id); }, function () { return (tree[col] || {})[id] || null; }, next);
      }
    };
  }
  function query(col, field, dir) {
    return {
      path: col,
      orderBy: function (f, d) { return query(col, f, d); },
      doc: function (id) { return docRef(col + "/" + (id || newId())); },
      add: function (data) { var r = docRef(col + "/" + newId()); return r.set(data).then(function () { return r; }); },
      get: function () { return Promise.resolve(colSnap(col, field, dir)); },
      onSnapshot: function (next) {
        return listen(function () { return colSnap(col, field, dir); }, function () { return tree[col] || {}; }, next);
      }
    };
  }
  var db = { doc: docRef, collection: function (c) { return query(c); } };

  window.claude = window.claude || {};
  window.claude.use = function (name) { return Promise.resolve(name === "db" ? db : null); };
  window.TCSync = {
    get url() { return base; },
    get remote() { return remote; },
    get status() { return status; },
    setUrl: function (u) { lsSet("tc-sync-url", (u || "").trim() || "-"); lsSet("tc-data", "{}"); location.reload(); }
  };
})();
