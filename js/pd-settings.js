/**
 * ResearcherPapers 偏好设置页面逻辑（关键词 / 作者标签）。
 *
 * 来源与变更声明 / Provenance notice:
 *   本文件由上游 daily-arXiv-ai-enhanced
 *   （main 01fdad3b0aec2d2f7977b686253a7b0c1c8273dc，Modified Apache License，
 *   参考 .upstream/daily-arxiv，许可证副本见 docs/licenses/daily-arxiv-LICENSE）
 *   的 web/js/settings.js 改写而来，版权与许可归属上游原作者。
 *   变更：
 *     1. addKeywordTag/addAuthorTag 原用 tagElement.innerHTML = `${keyword} <button…>`
 *        （localStorage → innerHTML 注入面），改为 createElement + textContent；
 *     2. showNotification 原用 innerHTML 拼图标与消息，改为 DOM 构建；
 *     3. 删除 fetchGitHubStats（外部 GitHub API 星数）；
 *     4. 删除 Auth.logout 与登录守卫（客户端口令不是访问控制）；
 *     5. 保存/读取走 pd-prefs 净化与限额。
 *   本文件为衍生代码，许可遵循 docs/licenses/daily-arxiv-LICENSE。
 */
(function (root) {
  'use strict';

  const PD = root.PD = root.PD || {};
  const dom = PD.dom;
  const T = PD.i18n.TEXT;

  const ICONS = {
    success: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z',
    info: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 15c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1s1 .45 1 1v4c0 .55-.45 1-1 1zm1-8h-2V7h2v2z'
  };

  function notify(message, type) {
    let notification = document.querySelector('.settings-notification');
    if (!notification) {
      notification = dom.el('div', { class: 'settings-notification', role: 'status' });
      document.body.appendChild(notification);
    }
    dom.clear(notification);
    const kind = type === 'info' ? 'info' : 'success';
    const icon = dom.el('svg', {
      width: '20', height: '20', viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true'
    }, [dom.el('path', { d: ICONS[kind], fill: 'currentColor' })]);
    notification.appendChild(icon);
    notification.appendChild(dom.el('span', { text: message }));
    notification.style.setProperty('display', 'flex');
    notification.style.setProperty('align-items', 'center');
    notification.style.setProperty('gap', '8px');
    notification.style.setProperty('position', 'fixed');
    notification.style.setProperty('bottom', '20px');
    notification.style.setProperty('right', '20px');
    notification.style.setProperty('background-color', kind === 'info' ? '#3b82f6' : 'var(--primary-color)');
    notification.style.setProperty('color', 'white');
    notification.style.setProperty('padding', '12px 20px');
    notification.style.setProperty('border-radius', 'var(--radius-sm)');
    notification.style.setProperty('box-shadow', 'var(--shadow-md)');
    notification.style.setProperty('z-index', '1000');
    notification.style.setProperty('opacity', '0');
    notification.style.setProperty('transform', 'translateY(20px)');
    notification.style.setProperty('transition', 'opacity 0.3s ease, transform 0.3s ease');
    setTimeout(function () {
      notification.style.setProperty('opacity', '1');
      notification.style.setProperty('transform', 'translateY(0)');
    }, 10);
    setTimeout(function () {
      notification.style.setProperty('opacity', '0');
      notification.style.setProperty('transform', 'translateY(20px)');
      setTimeout(function () { if (notification.parentNode) notification.parentNode.removeChild(notification); }, 300);
    }, 3000);
  }

  function copyToClipboard(text, successMessage) {
    const done = function (ok) {
      notify(ok ? successMessage : T.settingsCopyFailed, ok ? 'success' : 'info');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      return;
    }
    const area = dom.el('textarea', { class: 'copy-fallback', value: text });
    area.style.setProperty('position', 'fixed');
    area.style.setProperty('left', '-9999px');
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (error) { ok = false; }
    area.remove();
    done(ok);
  }

  const SettingsPage = {
    prefs: null,
    items: { keywords: [], authors: [] },

    init: function () {
      this.prefs = PD.prefs.createPreferences();
      this.items.keywords = this.prefs.read('keywords');
      this.items.authors = this.prefs.read('authors');
      this.render('keywords');
      this.render('authors');
      this.bindEvents();
    },

    containerFor: function (kind) {
      return document.getElementById(kind === 'keywords' ? 'selectedKeywords' : 'selectedAuthors');
    },

    emptyMessageFor: function (kind) {
      return kind === 'keywords' ? T.settingsEmptyKeywords : T.settingsEmptyAuthors;
    },

    render: function (kind) {
      const container = this.containerFor(kind);
      if (!container) return;
      dom.clear(container);
      const list = this.items[kind];
      if (list.length === 0) {
        container.appendChild(dom.el('div', {
          class: 'empty-tag-message',
          id: kind === 'keywords' ? 'emptyTagMessage' : 'emptyAuthorMessage',
          text: this.emptyMessageFor(kind)
        }));
        return;
      }
      const self = this;
      list.forEach(function (value) {
        container.appendChild(self.tagNode(kind, value));
      });
    },

    tagNode: function (kind, value) {
      const self = this;
      const tag = dom.el('span', { class: 'category-button tag-appear', 'data-value': value });
      tag.appendChild(document.createTextNode(value));
      tag.appendChild(document.createTextNode(' '));
      const remove = dom.el('button', {
        class: 'remove-tag',
        type: 'button',
        title: '删除 ' + value,
        text: '×'
      });
      remove.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        tag.classList.add('tag-disappear');
        setTimeout(function () {
          tag.remove();
          self.items[kind] = self.items[kind].filter(function (item) { return item !== value; });
          if (self.containerFor(kind).querySelectorAll('.category-button').length === 0) {
            self.render(kind);
          }
        }, 300);
      });
      tag.appendChild(remove);
      setTimeout(function () { tag.classList.remove('tag-appear'); }, 300);
      return tag;
    },

    add: function (kind, rawValue) {
      const values = String(rawValue === null || rawValue === undefined ? '' : rawValue)
        .split(',')
        .map(function (part) { return PD.sanitizePreferenceItem(part); })
        .filter(function (part) { return part !== ''; });
      if (values.length === 0) return;
      const list = this.items[kind];
      let changed = false;
      values.forEach(function (value) {
        if (list.indexOf(value) !== -1) {
          const existing = self_findTag(kind, value);
          if (existing) {
            existing.classList.add('tag-highlight');
            setTimeout(function () { existing.classList.remove('tag-highlight'); }, 1000);
          }
          return;
        }
        if (list.length >= PD.PREF_LIMITS.items) {
          notify('最多 ' + PD.PREF_LIMITS.items + ' 条，已忽略多余输入。', 'info');
          return;
        }
        list.push(value);
        changed = true;
      });
      if (changed) this.render(kind);
    },

    save: function () {
      const keywordResult = this.prefs.write('keywords', this.items.keywords);
      const authorResult = this.prefs.write('authors', this.items.authors);
      this.items.keywords = keywordResult.items;
      this.items.authors = authorResult.items;
      this.render('keywords');
      this.render('authors');
      if (!keywordResult.ok || !authorResult.ok) {
        notify('保存失败：浏览器存储不可用（未上传任何数据）。', 'info');
        return false;
      }
      notify(T.settingsSaved, 'success');
      return true;
    },

    reset: function () {
      this.items.keywords = [];
      this.items.authors = [];
      this.prefs.clearAll();
      this.render('keywords');
      this.render('authors');
      notify(T.settingsResetDone, 'info');
    },

    copy: function (kind) {
      const list = this.items[kind];
      if (list.length === 0) {
        notify(T.settingsNoCopy, 'info');
        return;
      }
      copyToClipboard(list.join(','), T.settingsCopied);
    },

    bindEvents: function () {
      const self = this;
      const bindAdd = function (kind, inputId, buttonId) {
        const input = document.getElementById(inputId);
        const button = document.getElementById(buttonId);
        if (!input || !button) return;
        const submit = function () {
          self.add(kind, input.value);
          input.value = '';
        };
        button.addEventListener('click', submit);
        input.addEventListener('keypress', function (event) {
          if (event.key === 'Enter') {
            event.preventDefault();
            submit();
          }
        });
      };
      bindAdd('keywords', 'keywordInput', 'addKeyword');
      bindAdd('authors', 'authorInput', 'addAuthor');

      const copyKeywords = document.getElementById('copyKeywords');
      if (copyKeywords) copyKeywords.addEventListener('click', function () { self.copy('keywords'); });
      const copyAuthors = document.getElementById('copyAuthors');
      if (copyAuthors) copyAuthors.addEventListener('click', function () { self.copy('authors'); });
      const save = document.getElementById('saveSettings');
      if (save) save.addEventListener('click', function () { self.save(); });
      const reset = document.getElementById('resetSettings');
      if (reset) reset.addEventListener('click', function () { self.reset(); });
    }
  };

  function self_findTag(kind, value) {
    const container = SettingsPage.containerFor(kind);
    if (!container) return null;
    const nodes = container.querySelectorAll('.category-button');
    for (let i = 0; i < nodes.length; i += 1) {
      if (nodes[i].getAttribute('data-value') === value) return nodes[i];
    }
    return null;
  }

  function bootstrap() {
    const limitNote = document.getElementById('limitNote');
    if (limitNote) {
      limitNote.textContent = PD.i18n.formatTemplate(T.settingsLimitNote, {
        len: PD.PREF_LIMITS.itemLength,
        items: PD.PREF_LIMITS.items
      });
    }
    SettingsPage.init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

  PD.settingsPage = SettingsPage;
})(typeof globalThis !== 'undefined' ? globalThis : this);
