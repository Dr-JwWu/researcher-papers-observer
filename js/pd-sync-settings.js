/**
 * 设置页“已读与收藏同步”：私有仓库配置、token、手动同步与导入导出。
 *
 * 来源与变更声明 / Provenance notice:
 *   本文件为 ResearcherPapers 项目自写代码，不复制上游源码。
 *
 * token 只写入本机 localStorage；本模块从不把它写进页面文本、URL 或任何日志。
 * 未配置 token 时页面只使用本机状态，功能照常可用。
 */
(function (root) {
  'use strict';

  const PD = root.PD;
  const dom = PD.dom;

  function el(id) { return document.getElementById(id); }

  function whenReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  function setStatus(text, kind) {
    const node = el('syncStatus');
    if (!node) return;
    node.textContent = text;
    node.className = 'settings-sync-status' + (kind ? ' ' + kind : '');
  }

  function describe(state) {
    const counts = state.counts();
    const token = state.hasToken();
    return '已读 ' + counts.read + ' 篇，收藏 ' + counts.favorite + ' 篇。' +
      (token ? '已配置同步令牌。' : '未配置同步令牌（仅保存在本机浏览器）。');
  }

  function syncMessage(result) {
    if (!result) return '同步未完成。';
    if (result.status === 'no_token') return '未配置令牌，只保存在本机。';
    if (result.status === 'created') return '已创建远端文件并同步。';
    if (result.status === 'pushed') return '已同步到远端。';
    if (result.status === 'clean') return '已是最新，无需写入。';
    if (result.status === 'error') {
      if (result.error === 'auth') return '令牌无效或权限不足（需要该仓库 Contents 读写）。';
      if (result.error === 'conflict') return '远端同时有更新，已重试仍未成功，请再点一次。';
      return '同步失败：' + (result.error || '未知原因') + '。';
    }
    return '同步未完成。';
  }

  function downloadJson(text, name) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = dom.el('a', { href: url, download: name });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function init() {
    if (!el('syncSection') || !PD.userState) return;
    const state = PD.userState.createUserState();
    const config = state.config();
    const repo = el('syncRepo');
    const path = el('syncPath');
    const token = el('syncToken');
    if (repo) repo.value = config.repo;
    if (path) path.value = config.path;
    setStatus(describe(state), '');

    const save = el('syncSave');
    if (save) save.addEventListener('click', function () {
      const applied = state.setConfig({ repo: repo.value, path: path.value });
      if (!applied.ok) {
        setStatus(applied.error === 'repo-shape' ? '仓库格式应为 owner/repo。' : '文件路径不合法。', 'error');
        return;
      }
      if (token && token.value.trim() !== '') {
        if (!state.setToken(token.value)) {
          setStatus('令牌保存失败：浏览器存储不可用。', 'error');
          return;
        }
        token.value = '';
      }
      setStatus('已保存，正在同步…', '');
      state.sync().then(function (result) {
        setStatus(describe(state) + ' ' + syncMessage(result), result.status === 'error' ? 'error' : 'ok');
      });
    });

    const clear = el('syncClear');
    if (clear) clear.addEventListener('click', function () {
      state.setToken('');
      if (token) token.value = '';
      setStatus('已清除令牌；' + describe(state), 'ok');
    });

    const exportButton = el('syncExport');
    if (exportButton) exportButton.addEventListener('click', function () {
      const stamp = new Date().toISOString().slice(0, 10);
      downloadJson(state.exportJson(), 'researcher-papers-favorites-' + stamp + '.json');
      setStatus('已导出收藏文件。', 'ok');
    });

    const importInput = el('syncImport');
    if (importInput) importInput.addEventListener('change', function () {
      const file = importInput.files && importInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        const result = state.importJson(String(reader.result || ''));
        if (!result.ok) {
          setStatus('导入失败：文件不是本站在用的收藏格式。', 'error');
          return;
        }
        setStatus('已导入并合并；' + describe(state), 'ok');
        state.sync().then(function (out) {
          setStatus('已导入并合并。' + syncMessage(out), out.status === 'error' ? 'error' : 'ok');
        });
      };
      reader.readAsText(file);
      importInput.value = '';
    });
  }

  whenReady(init);
})(typeof globalThis !== 'undefined' ? globalThis : this);
