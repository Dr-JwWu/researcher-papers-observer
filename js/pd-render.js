/**
 * ResearcherPapers 前端渲染层：按日期倒序的连续日报列表、论文卡片、详情模态框。
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
 *     2. 主题不再作为卡片/详情标签展示（顶部两个主题按钮只做筛选）；
 *     3. 连续日期列表：每个报告日期一个 heading（日期 + 收录篇数 + 同日修订），
 *        卡片沿用 daily 上游版式，按日期倒序排列，默认全部可读；
 *     4. 卡片标题：中文 title_zh 大字、英文原题小字（缺中文标题时只显示原题）；
 *     5. 合法配图（reading.figure，本站 assets/papers/ 白名单 + 非空许可）
 *        嵌在卡片顶部；缺图/许可不明/非法 URL 一律不显示，也不用占位图冒充；
 *     6. 详情：作者 + 可核单位（无则“单位待核实”，绝不按作者名猜），
 *        motivation/method/result/conclusion 四项一律 <ul><li> 分条；
 *     7. 删除当日总结正文、PDF 预览与按钮、旧版 “TL;DR” 字样
 *        （改“一句话看懂”）与“日报引用”标记；
 *     8. 来源状态同一时刻只给一行短句，不展示候选/取回/缺元数据/错误等工程计数。
 *   本文件为衍生代码（derivative work），许可遵循 docs/licenses/daily-arxiv-LICENSE。
 */
(function (root) {
  'use strict';

  const PD = root.PD = root.PD || {};
  const dom = PD.dom;
  const i18n = PD.i18n;
  const T = i18n.TEXT;
  const READING_FIELDS = PD.READING_FIELDS || ['motivation', 'method', 'result', 'conclusion'];

  function sourceTag(paper) {
    return dom.el('span', { class: 'source-tag source-' + paper.sourceLabel, text: i18n.sourceLabel(paper.sourceLabel) });
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
      if (kind === 'title') return T.matchReasonTitle + ': ' + value;
      if (kind === 'author') return T.matchReasonAuthor + ': ' + value;
      if (kind === 'points') return T.matchReasonPoints + ': ' + value;
      return T.matchReasonText + ': ' + value;
    });
    return dom.el('div', { class: 'match-badge', title: labels.join(' | '), 'aria-label': labels.join(' | ') });
  }

  /** 标题：中文大字 + 英文原题小字（无中文标题时只显示原题，不翻译、不拼接）。 */
  function titleNode(paper, terms, options) {
    const opts = options || {};
    const titles = PD.displayTitle(paper);
    const node = dom.el(opts.tag || 'h3', { class: opts.className || 'paper-card-title' });
    const main = dom.el('span', { class: opts.mainClass || 'paper-card-title-zh paper-title-zh' });
    dom.highlighted(main, titles.main, terms || [], 'keyword-highlight');
    node.appendChild(main);
    if (titles.secondary) {
      // 有中文标题就始终给出英文原题（即使字符串相同也不隐去，避免“看起来没有原题”）
      const secondary = dom.el('span', { class: opts.secondaryClass || 'paper-card-title-en paper-title-en' });
      dom.highlighted(secondary, titles.secondary, terms || [], 'keyword-highlight');
      node.appendChild(secondary);
    }
    return node;
  }

  /**
   * 许可：CC BY 4.0 用固定已知映射给出官方许可页链接（rel noopener noreferrer）；
   * 未知许可只显示纯文本，绝不按任意字符串拼链接。
   */
  function licenseNode(license) {
    const wrap = dom.el('span', { class: 'figure-license' });
    wrap.appendChild(dom.el('span', { class: 'figure-license-label', text: T.figureLicense + '：' }));
    const info = PD.licenseInfo ? PD.licenseInfo(license) : { url: null };
    const link = info.url ? dom.externalLink(info.url, license, 'figure-license-link') : null;
    if (link) {
      link.setAttribute('rel', 'noopener noreferrer');
      // 与单位来源链接一致：点许可链接/回车不得冒泡触发卡片点击（否则会误开详情）
      wrap.appendChild(stopLinkBubble(link));
    } else {
      wrap.appendChild(dom.el('span', { class: 'figure-license-text', text: license }));
    }
    return wrap;
  }

  /**
   * CC BY 署名信息（作者 + 论文标题 + 图源 + 许可）：放在 figure 的 title 上，
   * 卡片本身已显示标题与作者，图注保持短句；图片字节不改动。
   */
  function figureCredit(paper, figure) {
    const parts = [];
    if (paper.authors && paper.authors.length > 0) parts.push('作者：' + paper.authors.join('、'));
    if (paper.title) parts.push('论文：' + paper.title);
    if (figure.sourceUrl) parts.push('图源：' + figure.sourceUrl);
    parts.push(T.figureLicense + '：' + figure.license);
    return parts.join(' · ');
  }

  /**
   * 卡片顶部配图：只有 reading.figure 通过 assets/papers/ 白名单且许可非空时才创建。
   * 图注写 caption、许可（已知许可给官方链接）与图源外链（source_url 必须是 http/https）。
   */
  function figureBlock(paper) {
    const figure = paper.reading && paper.reading.figure ? paper.reading.figure : null;
    if (!figure) return null;
    const img = dom.assetImage(figure.src, figure.caption || T.figureAltFallback, 'paper-card-figure-img');
    if (!img) return null;
    const wrap = dom.el('figure', { class: 'paper-card-figure paper-figure' });
    wrap.setAttribute('title', figureCredit(paper, figure));
    wrap.appendChild(img);
    const caption = dom.el('figcaption', { class: 'paper-card-figure-caption' });
    if (figure.caption) {
      caption.appendChild(dom.el('span', { class: 'figure-caption-text', text: figure.caption }));
    }
    caption.appendChild(licenseNode(figure.license));
    const link = dom.externalLink(figure.sourceUrl, T.figureSource, 'figure-source-link');
    // 图源链接同样隔离冒泡，避免误触卡片打开详情
    if (link) dom.append(caption, [' · ', stopLinkBubble(link)]);
    wrap.appendChild(caption);
    return wrap;
  }

  /**
   * 单张卡片。结构对齐上游 paper-card（index / header / title / authors /
   * tag row / body / summary / footer），仅替换数据来源与安全渲染：
   * 卡片上只保留来源（+ 补录短标签），不再显示主题与来源分类。
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
    const figure = figureBlock(paper);
    if (figure) card.appendChild(figure);
    card.appendChild(dom.el('div', { class: 'paper-card-index', text: String(index + 1) }));
    const badge = matchBadge(item.reasons);
    if (badge) card.appendChild(badge);

    const header = dom.el('div', { class: 'paper-card-header' });
    header.appendChild(titleNode(paper, opts.titleTerms || []));
    header.appendChild(authorNodes(paper, opts.authorTerms || []));
    // 卡片也显示可核单位（短名单，单行省略号）；没有单位时如实写“单位待核实”。
    header.appendChild(affiliationCardLine(paper));
    const tagRow = dom.el('div', { class: 'paper-card-tag-row' });
    tagRow.appendChild(sourceTag(paper));
    const discovery = discoveryTag(paper);
    if (discovery) tagRow.appendChild(discovery);
    header.appendChild(tagRow);
    card.appendChild(header);

    const body = dom.el('div', { class: 'paper-card-body' });
    const summary = dom.el('p', { class: 'paper-card-summary' });
    // 卡片正文优先 AI 概括（不写 “TL;DR” 之类标签）；没有 AI 概括时只有真实原摘要才展示，
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

  /** 同日修订：只展示真实发生的数量与说明（0 不写出来）。 */
  function renderRevision(digest) {
    const revision = digest && digest.revision ? digest.revision : null;
    if (!revision || !revision.present) return null;
    const parts = [];
    if (revision.addedCount !== null && revision.addedCount > 0) parts.push(T.revisionAdded + ' ' + revision.addedCount + ' ' + T.revisionUnit);
    if (revision.removedCount !== null && revision.removedCount > 0) parts.push(T.revisionRemoved + ' ' + revision.removedCount + ' ' + T.revisionUnit);
    if (parts.length === 0 && !revision.note) return null;
    const row = dom.el('span', { class: 'revision-row feed-day-revision' });
    row.appendChild(dom.el('span', { class: 'revision-label', text: T.revisionTitle + '：' }));
    row.appendChild(dom.el('span', { text: parts.join(' · ') }));
    if (revision.note) {
      row.appendChild(dom.el('span', { class: 'revision-note', text: (parts.length ? ' · ' : '') + revision.note }));
    }
    return row;
  }

  /** 日期 heading：日期 + 收录篇数（+ 同日修订一行）。 */
  function dayHeading(day) {
    const heading = dom.el('h2', { class: 'feed-day-heading feed-date-heading' });
    if (PD.isIsoDate(day.date)) {
      heading.appendChild(dom.el('time', { class: 'feed-day-date', datetime: day.date, text: day.date }));
    } else {
      heading.appendChild(dom.el('span', { class: 'feed-day-date', text: T.feedDayUnknown }));
    }
    heading.appendChild(dom.el('span', {
      class: 'feed-day-count',
      text: i18n.formatTemplate(T.feedDayCount, { n: day.count })
    }));
    const revision = renderRevision(day.digest);
    if (revision) heading.appendChild(revision);
    return heading;
  }

  /**
   * 连续日期列表（首页主视图）。
   * options: {
   *   days: [{date, count, items, digest}],   // 必须已按报告日期倒序
   *   statusText: '',                          // 同一时刻最多一行的来源状态
   *   view: 'grid' | 'list',
   *   titleTerms, authorTerms, onOpen
   * }
   * items 为 pd-core.rankPapers 的结果；卡片序号在整个列表内连续编号。
   */
  function renderFeed(container, options) {
    const opts = options || {};
    dom.clear(container);
    container.className = 'feed' + (opts.view === 'list' ? ' list-view' : '');
    if (opts.statusText) {
      // 来源状态只有一行：不写候选数/取回数/缺元数据/错误数等工程计数。
      container.appendChild(dom.el('p', { class: 'coverage-brief feed-status', text: opts.statusText }));
    }
    const days = Array.isArray(opts.days) ? opts.days : [];
    let index = 0;
    days.forEach(function (day) {
      const section = dom.el('section', { class: 'feed-day', 'data-date': day.date || '' });
      section.appendChild(dayHeading(day));
      const grid = dom.el('div', {
        class: 'paper-container feed-day-grid' + (opts.view === 'list' ? ' list-view' : '')
      });
      if (day.notice) {
        // 该日解析不完整但仍有可读论文：给一行短提示，照常展示有效行。
        section.appendChild(dom.el('p', { class: 'feed-day-notice', text: day.notice }));
      }
      const items = Array.isArray(day.items) ? day.items : [];
      if (items.length === 0) {
        grid.appendChild(dom.el('p', { class: 'feed-day-empty', text: day.emptyText || T.feedDayEmpty }));
      } else {
        items.forEach(function (item) {
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
          grid.appendChild(card);
          index += 1;
        });
      }
      section.appendChild(grid);
      container.appendChild(section);
    });
    return container;
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
    if (updated.display) {
      wrap.appendChild(dom.el('span', { class: 'date-extra', text: ' · ' + T.cardUpdated + ': ' + updated.display }));
    }
    // 抓取时间（discovered_at）不上详情：它是抓取时刻，不是发表事实。
    return wrap;
  }

  /**
   * 可核单位（数据里显式给出的 reading.affiliations）：
   *   - 卡片：一行短名单（最多 2 个，更多时用 title 给全量），单行省略号，不猜、不顶宽；
   *   - 详情：完整列表，source_url 通过 http(s) 白名单才成为外链；
   *   - 没有单位：写“单位待核实”，绝不按作者名或机构习惯推测。
   * 单位来源链接自带 stopPropagation：点它不会冒泡触发卡片点击（否则会误开详情）。
   */
  function stopLinkBubble(node) {
    const stop = function (event) {
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
    };
    node.addEventListener('click', stop);
    node.addEventListener('keydown', stop);
    return node;
  }

  function affiliationEntryNode(entry) {
    const link = dom.externalLink(entry.sourceUrl, entry.name, 'affiliation-name affiliation-link');
    if (link) {
      link.setAttribute('title', entry.name + '（' + T.modalAffiliationsSource + '）');
      return stopLinkBubble(link);
    }
    return dom.el('span', { class: 'affiliation-name', title: entry.name, text: entry.name });
  }

  function affiliationList(paper) {
    const reading = paper && paper.reading && typeof paper.reading === 'object' ? paper.reading : {};
    return Array.isArray(reading.affiliations) ? reading.affiliations : [];
  }

  function affiliationCardLine(paper) {
    const list = affiliationList(paper);
    const wrap = dom.el('p', { class: 'paper-card-affiliations' });
    if (list.length === 0) {
      wrap.appendChild(dom.el('span', { class: 'affiliation-unknown', text: T.modalAffiliationsUnknown }));
      return wrap;
    }
    const limit = 2;
    wrap.setAttribute('title', list.map(function (entry) { return entry.name; }).join('、'));
    list.slice(0, limit).forEach(function (entry, index) {
      if (index > 0) dom.append(wrap, ['、']);
      wrap.appendChild(affiliationEntryNode(entry));
    });
    if (list.length > limit) {
      wrap.appendChild(dom.el('span', {
        class: 'affiliation-more',
        text: ' 等 ' + list.length + ' 个单位'
      }));
    }
    return wrap;
  }

  function affiliationDetail(paper) {
    const list = affiliationList(paper);
    if (list.length === 0) {
      return dom.el('span', { class: 'modal-affiliations-unknown', text: T.modalAffiliationsUnknown });
    }
    const wrap = dom.el('ul', { class: 'modal-affiliations paper-affiliations' });
    list.forEach(function (entry) {
      const item = dom.el('li', { class: 'modal-affiliation' });
      item.appendChild(affiliationEntryNode(entry));
      wrap.appendChild(item);
    });
    return wrap;
  }

  /** 四项要点：一律 <ul><li>；没有内容的字段写一句“摘要未提供”。 */
  function bulletList(items) {
    const list = dom.el('ul', { class: 'paper-ai-bullets' });
    const values = Array.isArray(items) ? items : [];
    if (values.length === 0) {
      list.appendChild(dom.el('li', { class: 'ai-bullet ai-bullet-empty', text: T.modalAiEmpty }));
      return list;
    }
    values.forEach(function (text) {
      list.appendChild(dom.el('li', { class: 'ai-bullet', text: text }));
    });
    return list;
  }

  /**
   * 论文要点区：一句话看懂 + 四项分条（普通 section 版式，不做橙色警告块）。
   * 分条优先用 reading.bullets 的结构化列表，缺失时回退旧 AI 字符串的保守分条；
   * 依据只保留一条细线（全站许可声明在 NOTICE/页脚，正文里不重复免责长句）。
   */
  function aiSection(paper) {
    const section = dom.el('section', { class: 'paper-ai-section' });
    section.appendChild(dom.el('h3', { class: 'paper-ai-title', text: T.modalAi }));
    section.appendChild(dom.el('p', { class: 'paper-ai-basis', text: T.modalAiBasis }));
    const bullets = PD.paperBullets ? PD.paperBullets(paper) : {};
    const hasBullets = READING_FIELDS.some(function (field) {
      return bullets[field] && bullets[field].items.length > 0;
    });
    if (!paper.aiAvailable && !hasBullets) {
      // 整篇没有 AI 数据：给一句缺失说明，四项结构照常保留（每项写“摘要未提供”），
      // 这样阅读结构一致，也不会把“没有分析”误当成有内容。
      section.appendChild(dom.el('p', { class: 'paper-ai-missing', text: T.modalAiMissing }));
    }
    const tldr = paper.ai && typeof paper.ai.tldr === 'string' ? paper.ai.tldr.trim() : '';
    const tldrBlock = dom.el('div', { class: 'paper-section paper-section-tldr' });
    tldrBlock.appendChild(dom.el('h4', { text: T.modalAiField.tldr }));
    tldrBlock.appendChild(dom.el('p', { class: 'ai-tldr', text: tldr === '' ? T.modalAiEmpty : tldr }));
    section.appendChild(tldrBlock);

    const grid = dom.el('div', { class: 'paper-sections' });
    READING_FIELDS.forEach(function (field) {
      const item = dom.el('div', { class: 'paper-section' });
      item.appendChild(dom.el('h4', { text: T.modalAiField[field] }));
      item.appendChild(bulletList(bullets[field] ? bullets[field].items : []));
      grid.appendChild(item);
    });
    section.appendChild(grid);
    return section;
  }

  /**
   * 详情模态框内容（阅读顺序：作者/单位/来源/发表日期 → 论文要点（分条）→ 原摘要）。
   * 只留事实：标题、作者、可核单位、发表日期、DOI、来源；不显示来源分类、
   * 抓取时间（discovered_at）与进入方式的长说明（只留小短标签）；
   * 不再有 PDF 预览区或 PDF 按钮。
   */
  function renderPaperModal(refs, paper, context) {
    const ctx = context || {};
    dom.clear(refs.body);

    const wrap = dom.el('section', { class: 'paper-details' });
    const meta = dom.el('div', { class: 'paper-meta' });
    meta.appendChild(metaRow(T.modalAuthors + ': ', dom.el('span', {
      class: 'modal-authors',
      text: paper.authors.length ? paper.authors.join(', ') : '作者未标注'
    })));
    meta.appendChild(metaRow(T.modalAffiliations + ': ', affiliationDetail(paper)));
    meta.appendChild(metaRow('来源: ', dom.el('span', {}, [sourceTag(paper)])));
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
      meta.appendChild(metaRow('进入方式: ', discoveryWrap));
    }
    if (paper.doi) meta.appendChild(detailRow(T.modalDoi + ': ', paper.doi));
    wrap.appendChild(meta);

    wrap.appendChild(aiSection(paper));

    const abstractSection = dom.el('section', { class: 'paper-abstract-section' });
    if (PD.hasPublicAbstract(paper)) {
      abstractSection.appendChild(dom.el('h3', { text: T.modalAbstract }));
      const abstractNode = dom.el('p', { class: 'original-abstract' });
      dom.highlighted(abstractNode, paper.abstract, ctx.titleTerms || [], 'keyword-highlight');
      abstractSection.appendChild(abstractNode);
    } else {
      // 公开导出不转载原摘要（未逐篇核准许可）：只给一句短提示与来源页按钮，
      // 不在“原摘要”标题下摆占位句假装有摘要。
      abstractSection.appendChild(dom.el('p', { class: 'abstract-link-note', text: T.abstractLinkNote }));
      const sourceLink = dom.externalLink(paper.links.abs, T.modalOpenAbs, 'abstract-source-link');
      if (sourceLink) abstractSection.appendChild(sourceLink);
    }
    wrap.appendChild(abstractSection);
    refs.body.appendChild(wrap);

    // 标题区：中文大字 + 英文原题小字
    dom.clear(refs.title);
    if (typeof ctx.index === 'number' && ctx.index > 0) {
      refs.title.appendChild(dom.el('span', { class: 'paper-index-badge', text: String(ctx.index) }));
    }
    refs.title.appendChild(titleNode(paper, ctx.titleTerms || [], {
      tag: 'span',
      className: 'modal-title',
      mainClass: 'modal-title-zh paper-title-zh',
      secondaryClass: 'modal-title-en paper-title-en'
    }));

    // 底部链接按钮：只设置已通过白名单的真实链接（没有 PDF 按钮）。
    const linkTargets = [
      { node: refs.absLink, url: paper.links.abs, label: T.modalOpenAbs },
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

  /**
   * 来源状态一行的纯文本（同一时刻最多一条）：
   *   真的没拿到数据的来源 > 有数据但覆盖不完整的来源 > 通用“部分来源覆盖不完整”。
   */
  function sourceStatusText(scopeStatus) {
    const status = scopeStatus || {};
    const unavailable = Array.isArray(status.unavailable) ? status.unavailable : [];
    if (unavailable.length > 0) {
      return i18n.formatTemplate(T.sourceUnavailable, {
        sources: unavailable.map(function (source) { return i18n.sourceLabel(source); }).join('、')
      });
    }
    const incomplete = Array.isArray(status.incomplete) ? status.incomplete : [];
    if (incomplete.length > 0) {
      return i18n.formatTemplate(T.sourceIncomplete, {
        sources: incomplete.map(function (source) { return i18n.sourceLabel(source); }).join('、')
      });
    }
    if (status.partial) return T.digestCoveragePartial;
    return '';
  }

  /** 单日来源状态（兼容入口，内部走同一套聚合规则）。 */
  function coverageBriefText(coverage, digest) {
    if (!PD.aggregateScopeStatus) return '';
    return sourceStatusText(PD.aggregateScopeStatus([{ coverage: coverage, digest: digest }]));
  }

  PD.render = {
    paperCard: paperCard,
    renderFeed: renderFeed,
    renderPaperModal: renderPaperModal,
    sourceStatusText: sourceStatusText,
    coverageBriefText: coverageBriefText,
    renderRevision: renderRevision,
    figureBlock: figureBlock,
    figureCredit: figureCredit,
    licenseNode: licenseNode,
    titleNode: titleNode,
    discoveryTag: discoveryTag,
    publishedLine: publishedLine,
    affiliationDetail: affiliationDetail,
    affiliationCardLine: affiliationCardLine,
    aiSection: aiSection,
    bulletList: bulletList
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
