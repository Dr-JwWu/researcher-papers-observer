/**
 * ResearcherPapers 偏好设置存储层：localStorage 读写、净化、限制。
 *
 * 来源与变更声明 / Provenance notice:
 *   本文件由上游 daily-arXiv-ai-enhanced
 *   （main 01fdad3b0aec2d2f7977b686253a7b0c1c8273dc，Modified Apache License，
 *   参考 .upstream/daily-arxiv，许可证副本见 docs/licenses/daily-arxiv-LICENSE）
 *   的 web/js/settings.js 与 app.js 中 loadUserKeywords/loadUserAuthors 的
 *   偏好持久化逻辑（键名 preferredKeywords / preferredAuthors）改写而来。
 *   变更：
 *     1. 读取时净化：去掉标签、控制字符，限制单条长度与条数，去重，畸形 JSON 不抛异常；
 *     2. 写入时使用 {schema, items} 结构并再次净化，兼容上游旧的纯数组格式；
 *     3. 新增可注入 storage（便于 Node 离线测试），存储失败不静默；
 *     4. 明确不上传：没有任何网络调用，偏好不离开本机浏览器。
 *   本文件为衍生代码，许可遵循 docs/licenses/daily-arxiv-LICENSE。
 */
(function (root) {
  'use strict';

  const PD = root.PD = root.PD || {};

  function memoryStorage() {
    const map = {};
    return {
      getItem: function (key) { return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null; },
      setItem: function (key, value) { map[key] = String(value); },
      removeItem: function (key) { delete map[key]; },
      key: function (index) { return Object.keys(map)[index] || null; },
      get length() { return Object.keys(map).length; },
      _dump: function () { return Object.assign({}, map); }
    };
  }

  function resolveStorage(storage) {
    if (storage) return storage;
    try {
      if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
    } catch (error) {
      /* 隐私模式禁用 localStorage：退回内存实现 */
    }
    return memoryStorage();
  }

  function Preferences(storage) {
    this.storage = resolveStorage(storage);
    this.lastError = '';
  }

  Preferences.prototype.read = function (kind) {
    const key = PD.PREF_KEYS[kind];
    if (!key) return [];
    let raw = null;
    try {
      raw = this.storage.getItem(key);
    } catch (error) {
      this.lastError = 'read-failed';
      return [];
    }
    return PD.parseStoredPreferences(raw);
  };

  Preferences.prototype.write = function (kind, items) {
    const key = PD.PREF_KEYS[kind];
    if (!key) return { ok: false, items: [], error: 'unknown-kind' };
    const clean = PD.sanitizePreferenceList(items);
    try {
      this.storage.setItem(key, PD.serializePreferences(clean));
      this.lastError = '';
      return { ok: true, items: clean, error: '' };
    } catch (error) {
      // 配额或隐私模式失败：不假装保存成功。
      this.lastError = 'write-failed';
      return { ok: false, items: clean, error: 'write-failed' };
    }
  };

  Preferences.prototype.clear = function (kind) {
    const key = PD.PREF_KEYS[kind];
    if (!key) return false;
    try {
      this.storage.removeItem(key);
      return true;
    } catch (error) {
      this.lastError = 'remove-failed';
      return false;
    }
  };

  Preferences.prototype.clearAll = function () {
    return this.clear('keywords') && this.clear('authors');
  };

  function createPreferences(storage) {
    return new Preferences(storage);
  }

  PD.prefs = {
    Preferences: Preferences,
    createPreferences: createPreferences,
    memoryStorage: memoryStorage
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
