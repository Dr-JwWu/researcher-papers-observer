/**
 * ResearcherPapers 前端渲染层：论文卡片、详情模态框、当日汇总面板。
 *
 * 来源与变更声明 / Provenance notice:
 *   本文件由上游 daily-arXiv-ai-enhanced
 *   （main 01fdad3b0aec2d2f7977b686253a7b0c1c8273dc，Modified Apache License，
 *   参考 .upstream/daily-arxiv，许可证副本见 docs/licenses/daily-arxiv-LICENSE）
 *   的 web/js/app.js（renderPapers / showPaperDetails / 卡片与模态框结构）
 *   与 web/js/statistic.js（侧栏论文卡片结构）改写而来；
 *   版权与许可归属上游原作者，本项目不重新标注、不改为 MIT。
 *   主要变更：
 *     1. 全部改用 pd-dom.createEl/textContent 构建，删除 innerHTML 模板拼接；
 *     2. 主题分组改用 topics（embodied/surgical，允许双命中），
 *        categories 仅作为来源分类标签展示，不再当主题；
 *     3. 发表日期按 published_precision 显示，修订/发现时间单独标注，不补造日期；
 *     4. PDF 区域只在数据含真实 pdf 时创建 iframe/按钮，删除 url.replace('abs','pdf'|'html')；
 *     5. 模态框新增“AI 摘要级分析（仅依据摘要）”标识与日报引用标记；
 *     6. 删除 KimiChat 第三方预填链接，改为复制摘要页链接（仅本地剪贴板）。
 *   本文件为衍生代码（derivative work），许可遵循 docs/licenses/daily-arxiv-LICENSE。
 */
(function (root) {
  'use strict';

  const PD = root.PD = root.PD || {};
  const dom = PD.dom;
  const i18n = PD.i18n;
  const T = i18n.TEXT;

  function topicTags(paper, className) {
    const wrap = dom.el('div', { class: className || 'paper-card-topics' });
    paper.topics.forEach(function (topic) {
      wrap.appendChild(dom.el('span', {
        class: 'topic-tag topic-' + topic,
        text: i18n.topicLabel(topic)
      }));
    });
    if (paper.topics.length === 0) {
      wrap.appendChild(dom.el('span', { class: 'topic-tag topic-unknown', text: '主题未标注' }));
    }
    return wrap;
  }

  function categoryTags(paper, className) {
    const wrap = dom.el('div', { class: className || 'paper-card-categories' });
    if (paper.categories.length === 0) {
      // 后端对未知来源不再强填 med.*：这里如实显示“未知”，不伪造分类。
      wrap.appendChild(dom.el('span', { class: 'category-unknown', text: T.cardCategoriesUnknown }));
      return wrap;
    }
    paper.categories.forEach(function (category) {
      wrap.appendChild(dom.el('span', { class: 'category-tag', text: category }));
    });
    return wrap;
  }

  /**
   * 进入方式标签：backfill=补录候选（扩大日期窗回填），window_match=检索窗匹配。
   * 缺省（旧 16 字段数据）不显示标签、不推断，避免冒称当日首发。
   */
  function discoveryTag(paper) {
    const kind = paper.discoveryKind;
    if (!kind) return null;
    const label = i18n.discoveryLabel(kind);
    if (!label) return null;
    return dom.el('span', {
      class: 'discovery-tag discovery-' + kind,
      title: i18n.discoveryHint(kind),
      text: label
    });
  }

  function sourceTag(paper) {
    return dom.el('span', { class: 'source-tag source-' + paper.sourceLabel, text: i18n.sourceLabel(paper.sourceLabel) });
  }

  function publishedLine(paper) {
    const published = PD.describePublished(paper.published, paper.publishedPrecision);
    const wrap = dom.el('span', { class: 'paper-card-date' });
    if (published.display === '') {
      dom.append(wrap, [dom.el('span', { class: 'date-unknown', text: '发表日期未标注' })]);
    } else {
      dom.append(wrap, [
        dom.el('time', { datetime: published.iso, text: published.display }),
        dom.el('span', { class: 'date-precision', text: '（' + i18n.precisionLabel(published.precision) + '）' })
      ]);
    }
    return wrap;
  }

  function authorNodes(paper, terms) {
    const formatted = PD.formatAuthorsForCard(paper.authors);
    const wrap = dom.el('p', { class: 'paper-card-authors' });
    if (formatted.total === 0) {
      dom.append(wrap, [dom.el('span', { class: 'authors-unknown', text: '作者未标注' })]);
      return wrap;
    }
    formatted.display.forEach(function (author, index) {
      if (index > 0) dom.append(wrap, [', ']);
      if (author === '…') {
        wrap.appendChild(dom.el('span', { class: 'author-ellipsis', text: '…' }));
        return;
      }
      const span = dom.el('span', { class: 'author-item' });
      dom.highlighted(span, author, terms, 'author-highlight');
      wrap.appendChild(span);
    });
    if (formatted.truncated) {
      wrap.appendChild(dom.el('span', {
        class: 'author-count-hint',
        title: '共 ' + formatted.total + ' 位作者',
        text: '（共 ' + formatted.total + ' 位）'
      }));
    }
    return wrap;
  }

  function matchBadge(reasons) {
    if (!reasons || reasons.length === 0) return null;
    const labels = reasons.map(function (reason) {
      const parts = String(reason).split(':');
      const kind = parts[0];
      const value = parts.slice(1).join(':');
      if (kind === 'keyword') return T.matchReasonKeyword + ': ' + value;
      if (kind === 'author') return T.matchReasonAuthor + ': ' + value;
      return T.matchReasonText + ': ' + value;
    });
    return dom.el('div', { class: 'match-badge', title: labels.join(' | '), 'aria-label': labels.join(' | ') });
  }

  /**
   * 单张卡片。结构对齐上游 paper-card（index / header / title / authors /
   * categories / body / summary / footer / Details），仅替换数据来源与安全渲染。
   */
  function paperCard(item, index, options) {
    const opts = options || {};
    const paper = item.paper;
    const card = dom.el('div', {
      class: 'paper-card' + (item.matched ? ' matched-paper' : ''),
      'data-paper-id': paper.id,
      role: 'button',
      tabindex: '0'
    });
    card.appendChild(dom.el('div', { class: 'paper-card-index', text: String(index + 1) }));
    const badge = matchBadge(item.reasons);
    if (badge) card.appendChild(badge);

    const header = dom.el('div', { class: 'paper-card-header' });
    const titleNode = dom.el('h3', { class: 'paper-card-title' });
    dom.highlighted(titleNode, paper.title, opts.titleTerms || [], 'keyword-highlight');
    header.appendChild(titleNode);
    header.appendChild(authorNodes(paper, opts.authorTerms || []));
    const tagRow = dom.el('div', { class: 'paper-card-tag-row' });
    tagRow.appendChild(sourceTag(paper));
    const discovery = discoveryTag(paper);
    if (discovery) tagRow.appendChild(discovery);
    paper.topics.forEach(function (topic) {
      tagRow.appendChild(dom.el('span', { class: 'topic-tag topic-' + topic, text: i18n.topicLabel(topic) }));
    });
    if (paper.topics.length === 0) {
      tagRow.appendChild(dom.el('span', { class: 'topic-tag topic-unknown', text: '主题未标注' }));
    }
    header.appendChild(tagRow);
    header.appendChild(categoryTags(paper, 'paper-card-categories'));
    card.appendChild(header);

    const body = dom.el('div', { class: 'paper-card-body' });
    const summary = dom.el('p', { class: 'paper-card-summary' });
    const summaryText = paper.ai.tldr && paper.ai.tldr.trim() !== '' ? paper.ai.tldr : paper.abstract;
    dom.highlighted(summary, summaryText, opts.titleTerms || [], 'keyword-highlight');
    body.appendChild(summary);
    if (paper.ai.tldr && paper.ai.tldr.trim() !== '' && paper.abstract) {
      body.appendChild(dom.el('p', {
        class: 'paper-card-ai-note',
        text: '以上为 AI 摘要级概括，原文摘要见详情。'
      }));
    }
    const footer = dom.el('div', { class: 'paper-card-footer' });
    const left = dom.el('div', { class: 'footer-left' });
    left.appendChild(publishedLine(paper));
    footer.appendChild(left);
    footer.appendChild(dom.el('span', { class: 'paper-card-link', text: T.cardDetails }));
    body.appendChild(footer);
    card.appendChild(body);

    return card;
  }

  /** 主题分组标题（保留上游 .category-button 视觉体系）。 */
  const UNLABELED_TOPIC = '__unlabeled';

  function groupHeading(topic, count) {
    const heading = dom.el('div', { class: 'topic-group-heading' });
    const label = topic === UNLABELED_TOPIC ? '主题未标注' : i18n.topicLabel(topic);
    heading.appendChild(dom.el('span', { class: 'topic-group-title', text: label }));
    heading.appendChild(dom.el('span', { class: 'category-count', text: String(count) }));
    return heading;
  }

  /**
   * 论文列表渲染。
   * - 主题=全部：不分组，每篇只出现一次（双主题论文不会被重复渲染）；
   * - 选中单个主题：命中该主题的论文成组显示，标题标明主题；
   * - 主题未标注的论文单独成组，避免被静默隐藏。
   * items 为 pd-core.rankPapers 的结果（匹配优先排序）。
   */
  function renderPaperList(container, items, options) {
    const opts = options || {};
    dom.clear(container);
    container.className = 'paper-container' + (opts.view === 'list' ? ' list-view' : '');
    if (!items || items.length === 0) {
      container.appendChild(dom.el('div', { class: 'loading-container' }, [
        dom.el('p', { text: T.noMatchingPapers })
      ]));
      return;
    }
    const selected = opts.topics && opts.topics !== 'all' ? opts.topics : null;
    const selectedList = selected ? (Array.isArray(selected) ? selected : [selected]) : [];
    const appendCard = function (item, index) {
      const card = paperCard(item, index, opts);
      if (opts.onOpen) {
        const open = function () { opts.onOpen(item.paper, index); };
        card.addEventListener('click', open);
        card.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
          }
        });
      }
      container.appendChild(card);
    };

    let index = 0;
    if (selectedList.length === 0) {
      items.forEach(function (item) {
        appendCard(item, index);
        index += 1;
      });
    } else {
      selectedList.forEach(function (topic) {
        const group = items.filter(function (item) {
          return item.paper.topics.indexOf(topic) !== -1;
        });
        if (group.length === 0) return;
        container.appendChild(groupHeading(topic, group.length));
        group.forEach(function (item) {
          appendCard(item, index);
          index += 1;
        });
      });
    }
    const unlabeled = items.filter(function (item) { return item.paper.topics.length === 0; });
    if (unlabeled.length > 0) {
      container.appendChild(groupHeading(UNLABELED_TOPIC, unlabeled.length));
      unlabeled.forEach(function (item) {
        appendCard(item, index);
        index += 1;
      });
    }
  }

  function metaRow(label, valueNode) {
    const row = dom.el('p', { class: 'paper-meta-row' });
    row.appendChild(dom.el('strong', { text: label }));
    dom.append(row, [valueNode]);
    return row;
  }

  function detailRow(label, value) {
    return metaRow(label, String(value));
  }

  function topicDetail(paper) {
    const wrap = dom.el('span', { class: 'modal-topics' });
    if (paper.topics.length === 0) {
      wrap.appendChild(dom.el('span', { class: 'topic-tag topic-unknown', text: '主题未标注' }));
      return wrap;
    }
    paper.topics.forEach(function (topic) {
      wrap.appendChild(dom.el('span', { class: 'topic-tag topic-' + topic, text: i18n.topicLabel(topic) }));
    });
    if (paper.topics.length > 1) {
      wrap.appendChild(dom.el('span', { class: 'topic-tag topic-both-hint', text: T.modalTopicsBoth }));
    }
    return wrap;
  }

  function dateDetail(paper) {
    const wrap = dom.el('span', { class: 'modal-date' });
    const published = PD.describePublished(paper.published, paper.publishedPrecision);
    if (published.display === '') {
      wrap.appendChild(dom.el('span', { text: '未标注（不推测）' }));
    } else {
      wrap.appendChild(dom.el('time', { datetime: published.iso, text: published.display }));
      wrap.appendChild(dom.el('span', { class: 'date-precision', text: '（' + i18n.precisionLabel(published.precision) + '）' }));
    }
    const updated = PD.describeUpdated(paper.updated);
    const discovered = PD.describeDiscovered(paper.discoveredAt);
    if (updated.display) {
      wrap.appendChild(dom.el('span', { class: 'date-extra', text: ' · ' + T.cardUpdated + ': ' + updated.display }));
    }
    if (discovered.display) {
      wrap.appendChild(dom.el('span', {
        class: 'date-extra date-discovered',
        title: '发现时间来自抓取时刻，不是发表日期',
        text: ' · ' + T.cardDiscovered + ': ' + discovered.display
      }));
    }
    return wrap;
  }

  /** AI 五字段：显式声明仅依据摘要，且字段为空时写“摘要未提供”，不伪造。 */
  function aiSection(paper) {
    const section = dom.el('section', { class: 'paper-ai-section' });
    section.appendChild(dom.el('h3', { class: 'paper-ai-title', text: T.modalAi }));
    section.appendChild(dom.el('p', { class: 'paper-ai-basis', text: T.modalAiBasisWarn }));
    if (!paper.aiAvailable) {
      section.appendChild(dom.el('p', { class: 'paper-ai-missing', text: T.modalAiMissing }));
      return section;
    }
    const tldr = dom.el('div', { class: 'paper-section' });
    tldr.appendChild(dom.el('h4', { text: T.modalAiField.tldr }));
    tldr.appendChild(dom.el('p', { text: paper.ai.tldr || PD.AI_EMPTY }));
    section.appendChild(tldr);
    const grid = dom.el('div', { class: 'paper-sections' });
    ['motivation', 'method', 'result', 'conclusion'].forEach(function (field) {
      const item = dom.el('div', { class: 'paper-section' });
      item.appendChild(dom.el('h4', { text: T.modalAiField[field] }));
      item.appendChild(dom.el('p', { text: paper.ai[field] || PD.AI_EMPTY }));
      grid.appendChild(item);
    });
    section.appendChild(grid);
    return section;
  }

  function pdfSection(paper) {
    const section = dom.el('section', { class: 'pdf-preview-section' });
    const header = dom.el('div', { class: 'pdf-header' });
    header.appendChild(dom.el('h3', { text: T.modalPdfPreview }));
    const pdfUrl = paper.links.pdf;
    if (!pdfUrl) {
      section.appendChild(header);
      section.appendChild(dom.el('p', { class: 'pdf-unavailable', text: T.modalNoPdf }));
      return section;
    }
    const button = dom.el('button', {
      class: 'pdf-expand-btn',
      type: 'button',
      title: '放大/还原 PDF 预览'
    });
    button.appendChild(dom.el('svg', { class: 'expand-icon', viewBox: '0 0 24 24', width: '24', height: '24', 'aria-hidden': 'true' }, [
      dom.el('path', { d: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z' })
    ]));
    button.appendChild(dom.el('svg', { class: 'collapse-icon', viewBox: '0 0 24 24', width: '24', height: '24', 'aria-hidden': 'true' }, [
      dom.el('path', { d: 'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z' })
    ]));
    header.appendChild(button);
    section.appendChild(header);
    const frame = dom.pdfFrame(pdfUrl, paper.title);
    const container = dom.el('div', { class: 'pdf-container' });
    if (frame) container.appendChild(frame);
    section.appendChild(container);

    // 展开/还原：仅改样式，不写 HTML（替代上游 onclick="togglePdfSize(this)"）。
    const expandIcon = button.querySelector('.expand-icon');
    const collapseIcon = button.querySelector('.collapse-icon');
    if (collapseIcon) collapseIcon.style.setProperty('display', 'none');
    button.addEventListener('click', function () {
      const expanded = container.classList.toggle('expanded');
      if (frame) frame.style.setProperty('height', expanded ? '90vh' : '800px');
      if (expandIcon) expandIcon.style.setProperty('display', expanded ? 'none' : 'block');
      if (collapseIcon) collapseIcon.style.setProperty('display', expanded ? 'block' : 'none');
      const existing = document.querySelector('.pdf-overlay');
      if (expanded) {
        const overlay = dom.el('div', { class: 'pdf-overlay' });
        overlay.addEventListener('click', function () { button.click(); });
        document.body.appendChild(overlay);
      } else if (existing) {
        existing.remove();
      }
    });
    return section;
  }

  function copyLinkButton(paper, options) {
    const opts = options || {};
    const url = paper.links.abs;
    const button = dom.el('button', {
      class: 'button icon-button copy-link-button',
      type: 'button',
      title: T.modalCopyLink
    }, [dom.el('span', { class: 'copy-link-label', text: T.modalCopyLink })]);
    button.addEventListener('click', function () {
      if (!url) {
        if (opts.onNotice) opts.onNotice(T.modalNoLinkToCopy, 'info');
        return;
      }
      const done = function (ok) {
        if (opts.onNotice) {
          opts.onNotice(ok ? T.modalCopied : T.modalCopyFailed, ok ? 'success' : 'info');
        }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { done(true); }, function () { done(false); });
      } else {
        const area = dom.el('textarea', { class: 'copy-fallback', value: url });
        area.style.setProperty('position', 'fixed');
        area.style.setProperty('left', '-9999px');
        document.body.appendChild(area);
        area.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (error) { ok = false; }
        area.remove();
        done(ok);
      }
    });
    return button;
  }

  /**
   * 详情模态框内容（对齐上游 showPaperDetails 的阅读顺序：
   * 作者/分类/日期 → AI 五字段 → 原摘要 → PDF 预览）。
   */
  function renderPaperModal(refs, paper, context) {
    const ctx = context || {};
    const T2 = i18n.TEXT;
    dom.clear(refs.body);

    const wrap = dom.el('section', { class: 'paper-details' });
    const meta = dom.el('div', { class: 'paper-meta' });
    meta.appendChild(metaRow('作者: ', dom.el('span', {
      class: 'modal-authors',
      text: paper.authors.length ? paper.authors.join(', ') : '作者未标注'
    })));
    meta.appendChild(metaRow('来源: ', dom.el('span', {}, [sourceTag(paper)])));
    meta.appendChild(metaRow('主题: ', topicDetail(paper)));
    meta.appendChild(metaRow(T.cardCategories + ': ', dom.el('span', {
      class: 'modal-categories',
      text: paper.categories.length ? paper.categories.join(', ') : T.cardCategoriesUnknown
    })));
    meta.appendChild(metaRow(T.cardPublished + ': ', dateDetail(paper)));
    if (paper.discoveryKind) {
      const discoveryWrap = dom.el('span', { class: 'modal-discovery' });
      const tag = discoveryTag(paper);
      if (tag) discoveryWrap.appendChild(tag);
      discoveryWrap.appendChild(dom.el('span', {
        class: 'discovery-hint',
        text: ' ' + i18n.discoveryHint(paper.discoveryKind)
      }));
      meta.appendChild(metaRow('进入方式: ', discoveryWrap));
    }
    if (paper.doi) meta.appendChild(detailRow(T.modalDoi + ': ', paper.doi));
    meta.appendChild(detailRow(T.modalId + ': ', paper.id));
    if (ctx.cited) {
      meta.appendChild(metaRow('', dom.el('span', { class: 'digest-cited-badge', text: T2.modalCiteInDigest })));
    }
    wrap.appendChild(meta);

    wrap.appendChild(aiSection(paper));

    const abstractSection = dom.el('section', { class: 'paper-abstract-section' });
    abstractSection.appendChild(dom.el('h3', { text: T2.modalAbstract }));
    const abstractText = paper.abstract && paper.abstract.trim() !== '' ? paper.abstract : '数据里没有摘要，未生成分析。';
    const abstractNode = dom.el('p', { class: 'original-abstract' });
    dom.highlighted(abstractNode, abstractText, ctx.titleTerms || [], 'keyword-highlight');
    abstractSection.appendChild(abstractNode);
    wrap.appendChild(abstractSection);

    wrap.appendChild(pdfSection(paper));
    refs.body.appendChild(wrap);

    // 标题区
    dom.clear(refs.title);
    if (typeof ctx.index === 'number' && ctx.index > 0) {
      refs.title.appendChild(dom.el('span', { class: 'paper-index-badge', text: String(ctx.index) }));
    }
    const titleText = dom.el('span', { class: 'modal-title-text' });
    dom.highlighted(titleText, paper.title, ctx.titleTerms || [], 'keyword-highlight');
    refs.title.appendChild(titleText);

    // 底部链接按钮：只设置已通过白名单的真实链接。
    const linkTargets = [
      { node: refs.absLink, url: paper.links.abs, label: T2.modalOpenAbs },
      { node: refs.pdfLink, url: paper.links.pdf, label: T2.modalOpenPdf },
      { node: refs.codeLink, url: paper.links.code, label: '代码仓库' }
    ];
    linkTargets.forEach(function (target) {
      if (!target.node) return;
      if (target.url) {
        target.node.setAttribute('href', target.url);
        target.node.setAttribute('target', '_blank');
        target.node.setAttribute('rel', 'noopener noreferrer');
        target.node.setAttribute('title', target.label);
        target.node.style.setProperty('display', '');
      } else {
        target.node.removeAttribute('href');
        target.node.style.setProperty('display', 'none');
      }
    });
    if (refs.position) {
      const total = ctx.total || 0;
      refs.position.textContent = total > 0 ? (ctx.index + ' / ' + total) : '-';
    }
    return wrap;
  }

  function scopeFact(label, value) {
    if (value === null || value === undefined) return null;
    return label + ' ' + value + ' ' + T.revisionUnit;
  }

  /**
   * research_scope 面板：检索 UTC 窗口 + 分析与排除计数。
   * 目的：把“本轮没有入选论文”和“审核把论文排除了”区分开
   * （private journal 的具体原因不公开，这里只展示计数）。
   */
  function renderResearchScope(digest) {
    const scope = digest.researchScope;
    const block = dom.el('section', { class: 'scope-panel' });
    block.appendChild(dom.el('h3', { class: 'scope-title', text: T.scopeTitle }));
    if (!scope || !scope.present) {
      block.appendChild(dom.el('p', { class: 'scope-missing', text: T.scopeMissing }));
      return block;
    }
    const windowText = scope.windowStart && scope.windowEnd
      ? scope.windowStart + ' ~ ' + scope.windowEnd + (scope.dateBasis ? '（' + scope.dateBasis + '）' : '')
      : T.scopeWindowMissing;
    const facts = [
      T.scopeWindow + ': ' + windowText,
      scope.policy ? T.scopePolicy + ': ' + scope.policy : null,
      scopeFact(T.scopeCollected, scope.collectedCount),
      scopeFact(T.scopeAnalyzed, scope.analyzedCount),
      scopeFact(T.scopeExcluded, scope.excludedCount),
      scopeFact(T.scopeUncertain, scope.uncertainCount)
    ].filter(function (item) { return item !== null; });
    const row = dom.el('div', { class: 'scope-facts' });
    facts.forEach(function (fact) {
      row.appendChild(dom.el('span', { class: 'scope-fact', text: fact }));
    });
    block.appendChild(row);
    if (digest.digest.status === 'no_included_papers') {
      block.appendChild(dom.el('p', { class: 'scope-hint', text: T.scopeNoIncludedHint }));
    }
    return block;
  }

  /** 同日修订：只展示数量与说明。 */
  function renderRevision(digest) {
    const revision = digest.revision;
    if (!revision || !revision.present) return null;
    const parts = [];
    if (revision.addedCount !== null) parts.push(T.revisionAdded + ' ' + revision.addedCount + ' ' + T.revisionUnit);
    if (revision.removedCount !== null) parts.push(T.revisionRemoved + ' ' + revision.removedCount + ' ' + T.revisionUnit);
    if (parts.length === 0 && !revision.note) return null;
    const row = dom.el('p', { class: 'revision-row' });
    row.appendChild(dom.el('span', { class: 'revision-label', text: T.revisionTitle + ': ' }));
    row.appendChild(dom.el('span', { text: parts.join(' · ') }));
    if (revision.note) {
      row.appendChild(dom.el('span', { class: 'revision-note', text: (parts.length ? ' · ' : '') + revision.note }));
    }
    return row;
  }

  /** 当日汇总面板：计数、partial 缺口、pending、日报分节与引用。 */
  function renderDigest(refs, digest, coverage, crossCheck, onCite) {
    dom.clear(refs.container);
    const panel = dom.el('section', { class: 'digest-panel' });
    panel.appendChild(dom.el('h2', { class: 'digest-heading', text: T.digestTitle }));

    const statusRow = dom.el('div', { class: 'digest-status-row' });
    statusRow.appendChild(dom.el('span', {
      class: 'digest-status digest-status-' + (digest.available ? digest.digest.status : 'unavailable'),
      text: T.digestStatus + ': ' + i18n.digestStatusLabel(digest.available ? digest.digest.status : 'unavailable')
    }));
    statusRow.appendChild(dom.el('span', {
      class: 'digest-count',
      text: T.statPublishedCount + ': ' + coverage.publishedCount
    }));
    if (digest.generatedAt) {
      statusRow.appendChild(dom.el('span', {
        class: 'digest-generated',
        text: T.digestGeneratedAt + ': ' + digest.generatedAt
      }));
    }
    if (coverage.pendingCount !== null) {
      statusRow.appendChild(dom.el('span', {
        class: 'digest-pending',
        text: T.digestPending + ': ' + coverage.pendingCount + ' ' + T.digestPendingUnit
      }));
    }
    panel.appendChild(statusRow);

    const coverageRow = dom.el('div', { class: 'digest-coverage-row' });
    coverageRow.appendChild(dom.el('span', {
      class: 'coverage-status coverage-' + coverage.coverage.status,
      text: T.digestCoverage + ': ' + i18n.coverageLabel(coverage.coverage.status)
    }));
    coverage.coverage.sources.forEach(function (source) {
      coverageRow.appendChild(dom.el('span', {
        class: 'coverage-source',
        text: i18n.sourceLabel(source.source) + ' · ' + i18n.coverageLabel(source.status) +
          (source.candidateCount === null ? '' : ' · 候选 ' + source.candidateCount) +
          (source.metadataFetched === null ? '' : ' · 取回 ' + source.metadataFetched) +
          (source.missingMetadata === null ? '' : ' · 缺元数据 ' + source.missingMetadata) +
          (source.errorCount ? ' · 错误 ' + source.errorCount : '')
      }));
    });
    panel.appendChild(coverageRow);

    if (coverage.coverage.scopeNote) {
      panel.appendChild(dom.el('p', { class: 'coverage-scope-note', text: T.digestScopeNote + ': ' + coverage.coverage.scopeNote }));
    }

    panel.appendChild(renderResearchScope(digest));
    const revisionRow = renderRevision(digest);
    if (revisionRow) panel.appendChild(revisionRow);

    if (!digest.available) {
      panel.appendChild(dom.el('p', { class: 'digest-notice', text: T.digestMissingNotice }));
    }
    if (coverage.countMismatch) {
      panel.appendChild(dom.el('p', {
        class: 'digest-notice',
        text: i18n.formatTemplate(T.digestCountMismatch, { declared: coverage.declaredCount, actual: coverage.publishedCount })
      }));
    }
    if (coverage.gapReasons.invalidLines || coverage.gapReasons.dropped) {
      panel.appendChild(dom.el('p', {
        class: 'digest-notice',
        text: i18n.formatTemplate(T.digestParseGap, { invalid: coverage.gapReasons.invalidLines ? '若干' : '0', dropped: coverage.gapReasons.dropped ? '若干' : '0' })
      }));
    }
    if (crossCheck && crossCheck.missingIds.length > 0) {
      panel.appendChild(dom.el('p', {
        class: 'digest-gap',
        text: i18n.formatTemplate(T.digestCiteMissing, { ids: crossCheck.missingIds.join(', ') })
      }));
    }
    if (crossCheck && crossCheck.topicMismatchIds.length > 0) {
      panel.appendChild(dom.el('p', {
        class: 'digest-gap',
        text: i18n.formatTemplate(T.digestTopicMismatch, { ids: crossCheck.topicMismatchIds.join(', ') })
      }));
    }

    // 两个维度分开标注：来源覆盖（检索域是否完整尝试）与数据结构校验（已发布数据是否自洽）。
    // 这样 partial 覆盖下不会同时出现“未发现缺口”这种自相对撞的表述。
    panel.appendChild(dom.el('h4', { class: 'digest-gap-heading', text: T.gapSourceLabel }));
    const sourceGapList = dom.el('ul', { class: 'digest-gap-list' });
    if (coverage.gapReasons.coverageIncomplete) {
      sourceGapList.appendChild(dom.el('li', { class: 'gap-item gap-source', text: T.gapSourcePartial }));
    } else {
      sourceGapList.appendChild(dom.el('li', { class: 'gap-item', text: T.gapSourceNone }));
    }
    panel.appendChild(sourceGapList);

    panel.appendChild(dom.el('h4', { class: 'digest-gap-heading', text: T.gapDataLabel }));
    const dataGapList = dom.el('ul', { class: 'digest-gap-list' });
    const dataGapItems = [];
    if (coverage.gapReasons.digestMissing) dataGapItems.push(T.gapDigestMissing);
    if (coverage.gapReasons.digestIncomplete) dataGapItems.push(T.gapDigestIncomplete);
    if (coverage.gapReasons.digestNoIncluded) dataGapItems.push(T.gapDigestNoIncluded);
    if (coverage.gapReasons.pending) dataGapItems.push(T.gapPending);
    if (coverage.gapReasons.countMismatch) dataGapItems.push(T.gapCountMismatch);
    if (coverage.gapReasons.invalidLines) dataGapItems.push(T.gapInvalidLines);
    if (coverage.gapReasons.dropped) dataGapItems.push(T.gapDropped);
    if (crossCheck && crossCheck.missingIds.length > 0) dataGapItems.push(T.gapCiteMissing);
    if (dataGapItems.length === 0) {
      dataGapList.appendChild(dom.el('li', { class: 'gap-item', text: T.gapDataNone }));
    } else {
      dataGapItems.forEach(function (item) {
        dataGapList.appendChild(dom.el('li', { class: 'gap-item gap-data', text: item }));
      });
    }
    panel.appendChild(dataGapList);

    if (digest.digest.note) {
      panel.appendChild(dom.el('p', { class: 'digest-note', text: digest.digest.note }));
    }

    if (digest.digest.sections.length === 0) {
      panel.appendChild(dom.el('p', { class: 'digest-notice', text: T.digestNoSections }));
    } else {
      digest.digest.sections.forEach(function (section) {
        const block = dom.el('article', { class: 'digest-section' });
        const heading = dom.el('h3', { class: 'digest-section-heading' });
        if (section.topic) {
          heading.appendChild(dom.el('span', {
            class: 'topic-tag topic-' + section.topic,
            text: i18n.topicLabel(section.topic)
          }));
        }
        dom.append(heading, [dom.el('span', { class: 'digest-heading-text', text: section.heading || '（无标题）' })]);
        block.appendChild(heading);
        block.appendChild(dom.el('p', { class: 'digest-text', text: section.text }));
        if (section.paperIds.length > 0) {
          const cites = dom.el('div', { class: 'digest-cites' });
          cites.appendChild(dom.el('span', { class: 'digest-cites-label', text: T.digestSectionCited + ': ' }));
          section.paperIds.forEach(function (id) {
            const button = dom.el('button', {
              class: 'cite-chip' + (crossCheck && crossCheck.missingIds.indexOf(id) !== -1 ? ' cite-missing' : ''),
              type: 'button',
              'data-paper-id': id,
              text: id
            });
            if (onCite) {
              button.addEventListener('click', function () { onCite(id); });
            }
            cites.appendChild(button);
          });
          block.appendChild(cites);
        }
        panel.appendChild(block);
      });
    }

    if (crossCheck && crossCheck.unreferencedIds.length > 0) {
      panel.appendChild(dom.el('p', {
        class: 'digest-unreferenced',
        text: i18n.formatTemplate(T.digestUnreferenced, { count: crossCheck.unreferencedIds.length })
      }));
    }

    refs.container.appendChild(panel);
    return panel;
  }

  PD.render = {
    paperCard: paperCard,
    renderPaperList: renderPaperList,
    renderPaperModal: renderPaperModal,
    renderDigest: renderDigest,
    renderResearchScope: renderResearchScope,
    renderRevision: renderRevision,
    topicTags: topicTags,
    discoveryTag: discoveryTag,
    categoryTags: categoryTags,
    publishedLine: publishedLine,
    aiSection: aiSection,
    pdfSection: pdfSection,
    copyLinkButton: copyLinkButton
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
