/**
 * ResearcherPapers 个人阅读状态：已读 / 收藏，跨设备同步到私有数据仓库。
 *
 * 来源与变更声明 / Provenance notice:
 *   本文件为 ResearcherPapers 项目自写代码，不复制上游源码。
 *   站点内容数据仍只来自本站相对目录；这里的 GitHub API 只服务“用户自己的
 *   已读/收藏状态”，是用户显式配置 token 后才启用的私有写入通道，不是内容源。
 *
 * 存储模型（不是站点数据，站点只读它）：
 *   - 浏览器本地：localStorage 保存当前状态与配置，断网先写本地；
 *   - 远端：一个**私有** GitHub 仓库里的单个 JSON（默认 favorites.json），
 *     由网页带着用户自己填的 fine-grained token 通过 HTTPS API 读写。
 *   token 只存在本机浏览器，不写进仓库、不进日志、不出现在页面文本里。
 *
 * 合并规则：按每篇论文的 updated_at 取较新记录（并集），所以两端离线各点几次
 * 也不会互相抹掉；取消收藏写入空 favorite_at 也会作为新记录传播。
 *
 * 本文件不依赖页面 DOM，可在 Node 里注入 storage / fetch 做离线测试。
 */
(function (root) {
  'use strict';

  const PD = root.PD = root.PD || {};
  const STATE_KEY = 'rp_user_state_v1';
  const CONFIG_KEY = 'rp_user_config_v1';
  const TOKEN_KEY = 'rp_user_token_v1';
  const API = 'https://api.github.com';
  const SCHEMA = 'researcher-papers-user-state/1';
  const DEFAULT_CONFIG = {
    repo: 'Dr-JwWu/researcher-papers-data',
    path: 'favorites.json',
    branch: 'main'
  };

  function memoryStorage() {
    const map = {};
    return {
      getItem: function (key) { return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null; },
      setItem: function (key, value) { map[key] = String(value); },
      removeItem: function (key) { delete map[key]; },
      key: function (index) { return Object.keys(map)[index] || null; },
      get length() { return Object.keys(map).length; }
    };
  }

  function resolveStorage(storage) {
    if (storage) return storage;
    try {
      if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
    } catch (error) { /* 隐私模式：退回内存 */ }
    return memoryStorage();
  }

  function readJson(storage, key, fallback) {
    let raw = null;
    try { raw = storage.getItem(key); } catch (error) { return fallback; }
    if (typeof raw !== 'string' || raw === '') return fallback;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (error) { return fallback; }
  }

  function writeJson(storage, key, value) {
    try { storage.setItem(key, JSON.stringify(value)); return true; }
    catch (error) { return false; }
  }

  function iso(value) {
    if (typeof value !== 'string' || value === '') return '';
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toISOString() : '';
  }

  function text(value, limit) {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim().slice(0, limit || 300);
  }

  function normalizeRecord(raw) {
    const record = raw && typeof raw === 'object' ? raw : {};
    const readAt = iso(record.read_at);
    const favoriteAt = iso(record.favorite_at);
    if (!readAt && !favoriteAt) return null;
    return {
      read_at: readAt || '',
      favorite_at: favoriteAt || '',
      updated_at: iso(record.updated_at) || favoriteAt || readAt,
      title: text(record.title, 300),
      date: /^\d{4}-\d{2}-\d{2}$/.test(record.date || '') ? record.date : '',
      url: typeof record.url === 'string' && /^https:\/\//.test(record.url) ? record.url : '',
      source: record.source === 'pubmed' ? 'pubmed' : 'arxiv'
    };
  }

  function normalizeState(raw) {
    const state = { schema: SCHEMA, papers: {}, updated_at: iso((raw || {}).updated_at) };
    const papers = (raw && raw.papers) || {};
    if (papers && typeof papers === 'object') {
      Object.keys(papers).forEach(function (id) {
        const record = normalizeRecord(papers[id]);
        if (record) state.papers[id] = record;
      });
    }
    return state;
  }

  function mergeStates(local, remote) {
    const out = { schema: SCHEMA, papers: {}, updated_at: '' };
    const ids = Object.keys((local && local.papers) || {}).concat(Object.keys((remote && remote.papers) || {}));
    ids.forEach(function (id) {
      const a = local && local.papers ? local.papers[id] : null;
      const b = remote && remote.papers ? remote.papers[id] : null;
      let pick = a;
      if (b && (!a || (iso(b.updated_at) || '') >= (iso(a.updated_at) || ''))) pick = b;
      if (pick) out.papers[id] = normalizeRecord(pick);
    });
    const times = [local && local.updated_at, remote && remote.updated_at].map(iso).filter(Boolean).sort();
    out.updated_at = times[times.length - 1] || '';
    return out;
  }

  function encodeBase64(content) {
    const bytes = new TextEncoder().encode(content);
    let binary = '';
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
    }
    return root.btoa(binary);
  }

  function decodeBase64(value) {
    const binary = root.atob(String(value || '').replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new TextDecoder().decode(bytes);
  }

  function UserState(storage, options) {
    const opts = options || {};
    this.storage = resolveStorage(storage);
    this.fetch = opts.fetch || (typeof root.fetch === 'function' ? root.fetch.bind(root) : null);
    this.now = opts.now || function () { return new Date().toISOString(); };
    this.lastError = '';
    this.state = normalizeState(readJson(this.storage, STATE_KEY, null));
  }

  UserState.prototype.save = function () {
    this.state.updated_at = this.now();
    return writeJson(this.storage, STATE_KEY, this.state);
  };

  UserState.prototype.config = function () {
    const stored = readJson(this.storage, CONFIG_KEY, null) || {};
    return {
      repo: typeof stored.repo === 'string' && stored.repo ? stored.repo : DEFAULT_CONFIG.repo,
      path: typeof stored.path === 'string' && stored.path ? stored.path : DEFAULT_CONFIG.path,
      branch: typeof stored.branch === 'string' && stored.branch ? stored.branch : DEFAULT_CONFIG.branch
    };
  };

  UserState.prototype.setConfig = function (patch) {
    const merged = Object.assign(this.config(), patch || {});
    const clean = {
      repo: text(merged.repo, 140).replace(/^\/+|\/+$/g, ''),
      path: text(merged.path, 200).replace(/^\/+/g, ''),
      branch: text(merged.branch, 80) || 'main'
    };
    if (!/^[\w.-]+\/[\w.-]+$/.test(clean.repo)) return { ok: false, error: 'repo-shape' };
    if (clean.path === '' || clean.path.indexOf('..') !== -1) return { ok: false, error: 'path-shape' };
    writeJson(this.storage, CONFIG_KEY, clean);
    return { ok: true, config: clean };
  };

  UserState.prototype.token = function () {
    let raw = null;
    try { raw = this.storage.getItem(TOKEN_KEY); } catch (error) { raw = null; }
    return typeof raw === 'string' ? raw : '';
  };

  UserState.prototype.setToken = function (value) {
    const token = typeof value === 'string' ? value.trim() : '';
    try {
      if (token) this.storage.setItem(TOKEN_KEY, token);
      else this.storage.removeItem(TOKEN_KEY);
    } catch (error) { return false; }
    return this.token() === token;
  };

  UserState.prototype.hasToken = function () { return this.token() !== ''; };

  UserState.prototype.record = function (id) {
    return id && this.state.papers[id] ? this.state.papers[id] : null;
  };

  UserState.prototype.isRead = function (id) {
    const record = this.record(id);
    return !!(record && record.read_at);
  };

  UserState.prototype.isFavorite = function (id) {
    const record = this.record(id);
    return !!(record && record.favorite_at);
  };

  UserState.prototype._write = function (id, patch, meta) {
    const previous = this.record(id) || {};
    const info = meta || {};
    const next = normalizeRecord(Object.assign({
      read_at: previous.read_at || '',
      favorite_at: previous.favorite_at || '',
      title: info.title || previous.title || '',
      date: info.date || previous.date || '',
      url: info.url || previous.url || '',
      source: info.source || previous.source || 'arxiv'
    }, patch, { updated_at: this.now() }));
    if (!next) delete this.state.papers[id];
    else this.state.papers[id] = next;
    this.save();
    return next;
  };

  UserState.prototype.markRead = function (id, meta) {
    const record = this.record(id);
    if (record && record.read_at) return record;
    return this._write(id, { read_at: this.now() }, meta);
  };

  UserState.prototype.toggleRead = function (id, meta) {
    const record = this.record(id);
    if (record && record.read_at) {
      return this._write(id, { read_at: '' }, meta);
    }
    return this._write(id, { read_at: this.now() }, meta);
  };

  UserState.prototype.toggleFavorite = function (id, meta) {
    const record = this.record(id);
    if (record && record.favorite_at) {
      return this._write(id, { favorite_at: '' }, meta);
    }
    const stamp = this.now();
    return this._write(id, { favorite_at: stamp, read_at: (record && record.read_at) || stamp }, meta);
  };

  UserState.prototype.favorites = function () {
    const self = this;
    return Object.keys(this.state.papers)
      .map(function (id) { return { id: id, record: self.state.papers[id] }; })
      .filter(function (row) { return !!row.record.favorite_at; })
      .sort(function (a, b) {
        return (a.record.favorite_at < b.record.favorite_at ? 1 : -1);
      });
  };

  UserState.prototype.counts = function () {
    const self = this;
    let read = 0; let favorite = 0;
    Object.keys(this.state.papers).forEach(function (id) {
      if (self.state.papers[id].read_at) read += 1;
      if (self.state.papers[id].favorite_at) favorite += 1;
    });
    return { read: read, favorite: favorite };
  };

  UserState.prototype.merge = function (remote) {
    this.state = mergeStates(this.state, normalizeState(remote));
    this.save();
    return this.state;
  };

  UserState.prototype.exportJson = function () {
    return JSON.stringify({ schema: SCHEMA, exported_at: this.now(), papers: this.state.papers }, null, 2);
  };

  UserState.prototype.importJson = function (raw) {
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (error) { return { ok: false, error: 'json' }; }
    if (!parsed || typeof parsed !== 'object' || !parsed.papers || typeof parsed.papers !== 'object') {
      return { ok: false, error: 'shape' };
    }
    this.merge(parsed);
    return { ok: true, counts: this.counts() };
  };

  UserState.prototype._headers = function () {
    return {
      Authorization: 'Bearer ' + this.token(),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
  };

  UserState.prototype._url = function () {
    const config = this.config();
    return API + '/repos/' + config.repo + '/contents/' + config.path.split('/').map(encodeURIComponent).join('/');
  };

  UserState.prototype._remote = function () {
    const self = this;
    if (!this.fetch) return Promise.reject(new Error('fetch-unavailable'));
    const config = this.config();
    const url = this._url() + (config.branch ? '?ref=' + encodeURIComponent(config.branch) : '');
    return this.fetch(url, { method: 'GET', headers: this._headers(), cache: 'no-store' })
      .then(function (response) {
        if (response.status === 404) return { exists: false, sha: null, state: normalizeState(null) };
        if (response.status === 401 || response.status === 403) throw new Error('auth');
        if (!response.ok) throw new Error('http-' + response.status);
        return response.json().then(function (payload) {
          const content = decodeBase64(payload.content || '');
          let state = null;
          try { state = JSON.parse(content); } catch (error) { state = null; }
          return { exists: true, sha: payload.sha, state: normalizeState(state) };
        });
      });
  };

  UserState.prototype._push = function (state, sha) {
    const self = this;
    const config = this.config();
    const body = {
      message: 'Update reading state (' + new Date(this.now()).toISOString() + ')',
      content: encodeBase64(JSON.stringify({ schema: SCHEMA, updated_at: state.updated_at, papers: state.papers }, null, 2))
    };
    if (sha) body.sha = sha;
    if (config.branch) body.branch = config.branch;
    return this.fetch(this._url(), {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, this._headers()),
      body: JSON.stringify(body)
    }).then(function (response) {
      if (response.status === 409) throw new Error('conflict');
      if (response.status === 401 || response.status === 403) throw new Error('auth');
      if (!response.ok) throw new Error('http-' + response.status);
      return response.json();
    });
  };

  UserState.prototype.sync = function () {
    const self = this;
    if (!this.hasToken()) return Promise.resolve({ status: 'no_token' });
    const run = function (attempt) {
      return self._remote().then(function (remote) {
        const merged = mergeStates(self.state, remote.state);
        const remoteText = JSON.stringify({ papers: remote.state.papers });
        const mergedText = JSON.stringify({ papers: merged.papers });
        self.state = merged;
        self.save();
        if (remote.exists && remoteText === mergedText) {
          return { status: 'clean', pushed: false, counts: self.counts() };
        }
        return self._push(merged, remote.sha).then(function () {
          return { status: remote.exists ? 'pushed' : 'created', pushed: true, counts: self.counts() };
        });
      }).catch(function (error) {
        if (error && error.message === 'conflict' && attempt < 2) return run(attempt + 1);
        self.lastError = error && error.message ? error.message : 'sync-failed';
        return { status: 'error', error: self.lastError };
      });
    };
    return run(0);
  };

  function createUserState(storage, options) {
    return new UserState(storage, options);
  }

  PD.userState = {
    UserState: UserState,
    createUserState: createUserState,
    mergeStates: mergeStates,
    normalizeState: normalizeState,
    encodeBase64: encodeBase64,
    decodeBase64: decodeBase64,
    memoryStorage: memoryStorage,
    DEFAULTS: Object.assign({}, DEFAULT_CONFIG),
    KEYS: { state: STATE_KEY, config: CONFIG_KEY, token: TOKEN_KEY }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof globalThis !== 'undefined' ? globalThis : this).PD.userState;
}
