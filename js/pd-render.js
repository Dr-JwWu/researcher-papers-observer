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
 *     5. 模态框新增“AI 摘要（仅依据摘要）”单行依据说明与日报引用标记；
 *     6. 删除 KimiChat 第三方预填链接，改为复制摘要页链接（仅本地剪贴板）；
 *     7. 精简：删除 research_scope 工程口径、候选取回/缺元数据/错误计数、
 *        结构自洽诊断、原始 paper id（引用改“第 N 篇”）与卡片逐条免责声明；
 *        公开导出不转载原摘要时只给短句＋来源页按钮；
 *        当日总结按当前主题筛选分节。
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
   * 卡片进入方式标签：只有补录论文需要一个短标签“补录”（不是当日首发）。
   * 检索窗匹配属于正常检索结果，不在卡片上出现；详情里仍保留进入方式一行。
   */
  function discoveryTag(paper) {
    if (paper.discoveryKind !== 'backfill') return null;
    return dom.el('span', {
      class: 'discovery-tag discovery-backfill',
      title: i18n.discoveryHint('backfill'),
      text: T.discoveryBackfillCard
    });
  }

  function sourceTag(paper) {
    return dom.el('span', { class: 'source-tag source-' + paper.sourceLabel, text: i18n.sourceLabel(paper.sourceLabel) });
  }

  /** 卡片日期：日精度是常态，不再写“（精确到日）”；只有月/年这类不完整精度才提示。 */
  function publishedLine(paper) {
    const published = PD.describePublished(paper.published, paper.publishedPrecision);
    const wrap = dom.el('span', { class: 'paper-card-date' });
    if (published.display === '') {
      dom.append(wrap, [dom.el('span', { class: 'date-unknown', text: '发表日期未标注' })]);
    } else {
      dom.append(wrap, [dom.el('time', { datetime: published.iso, text: published.display })]);
      if (published.precision === 'month' || published.precision === 'year') {
        dom.append(wrap, [
          dom.el('span', { class: 'date-precision', text: '（' + i18n.precisionLabel(published.precision) + '）' })
        ]);
      }
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
    // 卡片只保留两件事：来源 + 主题（补录论文再多一个短标签）。
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
    card.appendChild(header);

    const body = dom.el('div', { class: 'paper-card-body' });
    const summary = dom.el('p', { class: 'paper-card-summary' });
    // 卡片正文优先 AI 概括；没有 AI 概括时只有真实原摘要才展示，
    // 公开导出的占位句不当摘要显示。
    const summaryText = paper.ai.tldr && paper.ai.tldr.trim() !== ''
      ? paper.ai.tldr
      : (PD.hasPublicAbstract(paper) ? paper.abstract : '');
    dom.highlighted(summary, summaryText === '' ? T.abstractLinkNote : summaryText, opts.titleTerms || [], 'keyword-highlight');
    body.appendChild(summary);
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

  /**
   * AI 五字段。依据说明在详情里只出现一次（短句），卡片上不重复免责声明；
   * 字段为空时写“摘要未提供”，不伪造。
   */
  function aiSection(paper) {
    const section = dom.el('section', { class: 'paper-ai-section' });
    section.appendChild(dom.el('h3', { class: 'paper-ai-title', text: T.modalAi }));
    section.appendChild(dom.el('p', { class: 'paper-ai-basis', text: T.modalAiBasis }));
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
      // 详情保留完整进入方式（卡片只留“补录”短标签）。
      const discoveryWrap = dom.el('span', { class: 'modal-discovery' });
      const kind = paper.discoveryKind;
      const label = i18n.discoveryLabel(kind);
      if (label) {
        discoveryWrap.appendChild(dom.el('span', {
          class: 'discovery-tag discovery-' + kind,
          title: i18n.discoveryHint(kind),
          text: label
        }));
      }
      discoveryWrap.appendChild(dom.el('span', {
        class: 'discovery-hint',
        text: ' ' + i18n.discoveryHint(kind)
      }));
      meta.appendChild(metaRow('进入方式: ', discoveryWrap));
    }
    if (paper.doi) meta.appendChild(detailRow(T.modalDoi + ': ', paper.doi));
    if (ctx.cited) {
      meta.appendChild(metaRow('', dom.el('span', { class: 'digest-cited-badge', text: T2.modalCiteInDigest })));
    }
    wrap.appendChild(meta);

    wrap.appendChild(aiSection(paper));

    const abstractSection = dom.el('section', { class: 'paper-abstract-section' });
    if (PD.hasPublicAbstract(paper)) {
      abstractSection.appendChild(dom.el('h3', { text: T2.modalAbstract }));
      const abstractNode = dom.el('p', { class: 'original-abstract' });
      dom.highlighted(abstractNode, paper.abstract, ctx.titleTerms || [], 'keyword-highlight');
      abstractSection.appendChild(abstractNode);
    } else {
      // 公开导出不转载原摘要（未逐篇核准许可）：只给一句短提示与来源页按钮，
      // 不在“原摘要”标题下摆占位句假装有摘要。
      abstractSection.appendChild(dom.el('p', { class: 'abstract-link-note', text: T2.abstractLinkNote }));
      const sourceLink = dom.externalLink(paper.links.abs, T2.modalOpenAbs, 'abstract-source-link');
      if (sourceLink) abstractSection.appendChild(sourceLink);
    }
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

  /** 来源状态的纯文本（同一时刻最多一条，供面板与区间视图共用）。 */
  function coverageBriefText(coverage, digest) {
    const scope = digest || {};
    const unavailable = Array.isArray(scope.unavailableSources) ? scope.unavailableSources : [];
    const unavailableLabels = unavailable.map(function (source) { return i18n.sourceLabel(source); });
    if (unavailableLabels.length > 0) {
      // 真的没拿到数据的来源优先，且只给这一条（不再叠加“覆盖不完整”）。
      return i18n.formatTemplate(T.sourceUnavailable, { sources: unavailableLabels.join('、') });
    }
    const incomplete = Array.isArray(scope.incompleteSources) ? scope.incompleteSources : [];
    const incompleteLabels = incomplete.map(function (source) { return i18n.sourceLabel(source); });
    if (incompleteLabels.length > 0) {
      // 有数据但覆盖不完整（如预算上限）：说“覆盖不完整”，不说“暂不可用”。
      return i18n.formatTemplate(T.sourceIncomplete, { sources: incompleteLabels.join('、') });
    }
    if (!PD.coverageIsPartial(coverage)) return '';
    return T.digestCoveragePartial;
  }

  /**
   * 来源状态一行：unavailable > incomplete > 通用 partial。
   * 候选数、取回数、缺元数据数、错误数属于流程诊断，不在研究者页面上出现。
   */
  function coverageBrief(coverage, digest) {
    const text = coverageBriefText(coverage, digest);
    if (text === '') return null;
    return dom.el('p', { class: 'coverage-brief', text: text });
  }

  /** 同日修订：只展示真实发生的数量与说明（0 不写出来）。 */
  function renderRevision(digest) {
    const revision = digest.revision;
    if (!revision || !revision.present) return null;
    const parts = [];
    if (revision.addedCount !== null && revision.addedCount > 0) parts.push(T.revisionAdded + ' ' + revision.addedCount + ' ' + T.revisionUnit);
    if (revision.removedCount !== null && revision.removedCount > 0) parts.push(T.revisionRemoved + ' ' + revision.removedCount + ' ' + T.revisionUnit);
    if (parts.length === 0 && !revision.note) return null;
    const row = dom.el('p', { class: 'revision-row' });
    row.appendChild(dom.el('span', { class: 'revision-label', text: T.revisionTitle + ': ' }));
    row.appendChild(dom.el('span', { text: parts.join(' · ') }));
    if (revision.note) {
      row.appendChild(dom.el('span', { class: 'revision-note', text: (parts.length ? ' · ' : '') + revision.note }));
    }
    return row;
  }

  /** 分节是否属于当前主题筛选：未标注主题的分节不隐藏，避免漏掉内容。 */
  function sectionMatchesTopic(section, topic) {
    if (!topic || topic === 'all') return true;
    if (!section.topic) return true;
    return section.topic === topic;
  }

  /**
   * 引用按钮：只对已发布论文给“第 N 篇”，不显示原始 paper id；
   * 引用不到论文时不给按钮，也不输出内部一致性诊断。
   */
  function citeChip(id, options) {
    const opts = options || {};
    const index = opts.paperIndex && opts.paperIndex[id];
    if (!index) return null;
    const button = dom.el('button', {
      class: 'cite-chip',
      type: 'button',
      'data-paper-id': id,
      text: i18n.formatTemplate(T.digestCiteOrdinal, { n: index })
    });
    if (opts.onCite) {
      button.addEventListener('click', function () { opts.onCite(id); });
    }
    return button;
  }

  /**
   * 当日总结面板（简短版）：
   *   收录 N 篇 · N 篇待审核 · 更新于 …；同一时刻最多一条来源状态
   *   （“本期 arXiv 来源暂缺”＞“本期 arXiv 覆盖不完整”＞“部分来源覆盖不完整”）；
   *   分节正文按当前主题筛选（选具身智能时不再满屏手术总结）；
   *   digest.status=partial 时保留已完成分节并给一行“总结尚不完整”；
   *   日报缺失/生成失败只显示“暂无日报/暂无总结”，不外露内部 error、状态或计数。
   *
   * options: {topic, onCite, paperIndex}
   */
  function renderDigest(refs, digest, coverage, options) {
    const opts = options || {};
    dom.clear(refs.container);
    const panel = dom.el('section', { class: 'digest-panel' });
    panel.appendChild(dom.el('h2', { class: 'digest-heading', text: T.digestTitle }));

    const statusRow = dom.el('div', { class: 'digest-status-row' });
    statusRow.appendChild(dom.el('span', {
      class: 'digest-count',
      text: T.digestPublished + ' ' + coverage.publishedCount + ' ' + T.digestUnit
    }));
    if (coverage.pendingCount !== null && coverage.pendingCount > 0) {
      statusRow.appendChild(dom.el('span', {
        class: 'digest-pending',
        text: coverage.pendingCount + ' ' + T.digestUnit + T.digestPending
      }));
    }
    const updated = PD.describeTimestamp(digest.generatedAt);
    if (updated.display) {
      statusRow.appendChild(dom.el('span', { class: 'digest-generated' }, [
        dom.el('time', { datetime: updated.iso, text: T.digestUpdated + ' ' + updated.display })
      ]));
    }
    panel.appendChild(statusRow);

    const brief = coverageBrief(coverage, digest);
    if (brief) panel.appendChild(brief);

    const revisionRow = renderRevision(digest);
    if (revisionRow) panel.appendChild(revisionRow);

    // digest.status：
    //   completed → 分节正文；
    //   partial   → 分节正文照常显示 + 一行“总结尚不完整”（后半段分析未完成）；
    //   no_included_papers / failed / 缺失 → 只给一句短话，不外露 note/status/error。
    const status = digest.available ? digest.digest.status : 'unavailable';
    if (!digest.available && digest.problem === 'missing') {
      panel.appendChild(dom.el('p', { class: 'digest-notice', text: T.digestNoPapers }));
    } else if (status === 'no_included_papers') {
      panel.appendChild(dom.el('p', { class: 'digest-notice', text: T.digestNoIncluded }));
    } else if (status !== 'completed' && status !== 'partial') {
      panel.appendChild(dom.el('p', { class: 'digest-notice', text: T.digestNoSummary }));
    } else {
      const sections = digest.digest.sections.filter(function (section) {
        return sectionMatchesTopic(section, opts.topic);
      });
      if (sections.length === 0) {
        panel.appendChild(dom.el('p', { class: 'digest-notice', text: T.digestNoSummary }));
      }
      sections.forEach(function (section) {
        const block = dom.el('article', { class: 'digest-section' });
        // 分节标题只保留 heading：主题已由标题本身表达，不再重复一枚 topic 徽标。
        const heading = dom.el('h3', { class: 'digest-section-heading' });
        heading.appendChild(dom.el('span', { class: 'digest-heading-text', text: section.heading || '（无标题）' }));
        block.appendChild(heading);
        block.appendChild(dom.el('p', { class: 'digest-text', text: section.text }));
        const chips = section.paperIds.map(function (id) { return citeChip(id, opts); }).filter(Boolean);
        if (chips.length > 0) {
          const cites = dom.el('div', { class: 'digest-cites' });
          cites.appendChild(dom.el('span', { class: 'digest-cites-label', text: T.digestCiteLabel + '：' }));
          chips.forEach(function (chip) { cites.appendChild(chip); });
          block.appendChild(cites);
        }
        panel.appendChild(block);
      });
      if (status === 'partial') {
        panel.appendChild(dom.el('p', { class: 'digest-notice digest-incomplete', text: T.digestIncomplete }));
      }
    }

    refs.container.appendChild(panel);
    return panel;
  }

  PD.render = {
    paperCard: paperCard,
    renderPaperList: renderPaperList,
    renderPaperModal: renderPaperModal,
    renderDigest: renderDigest,
    coverageBriefText: coverageBriefText,
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
