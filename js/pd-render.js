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
 *     8. 标题级收录（analysis_basis="title"）卡片不生成空详情：标题与页脚
 *        “论文原文”都指向数据里真实存在的 abs 链接（绝不拼 PDF），卡片不再
 *        role=button、不插缺失/仅标题等占位；没有真实摘要时正文不写占位句。
 *     9. 主 feed 不再常驻来源覆盖 banner/“查看原因”；来源缺口与 partial 状态
 *        只保留在数据层与内部 helper，不伪造 complete。加载失败等真实用户
 *        可见错误仍给简短提示。
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

  /**
   * 标题：中文大字 + 英文原题小字（无中文标题时只显示原题，不翻译、不拼接）。
   * 传入 linkUrl 时整块标题成为真实来源链接（仅标题级卡片使用；只接受已在
   * pd-core 通过 http(s) 白名单的 abs，缺失/非法就不造链接）。
   */
  function titleNode(paper, terms, options) {
    const opts = options || {};
    const titles = PD.displayTitle(paper);
    const node = dom.el(opts.tag || 'h3', { class: opts.className || 'paper-card-title' });
    const main = dom.el('span', { class: opts.mainClass || 'paper-card-title-zh paper-title-zh' });
    dom.highlighted(main, titles.main, terms || [], 'keyword-highlight');
    const secondary = titles.secondary
      // 有中文标题就始终给出英文原题（即使字符串相同也不隐去，避免“看起来没有原题”）
      ? dom.el('span', { class: opts.secondaryClass || 'paper-card-title-en paper-title-en' })
      : null;
    if (secondary) dom.highlighted(secondary, titles.secondary, terms || [], 'keyword-highlight');

    const linkUrl = opts.linkUrl ? PD.safeHttpUrl(opts.linkUrl) : null;
    if (linkUrl) {
      const link = dom.externalLink(linkUrl, '', opts.linkClass || 'paper-card-title-link');
      if (link) {
        link.setAttribute('title', T.cardPaperOriginal);
        dom.append(link, [main]);
        if (secondary) dom.append(link, [secondary]);
        node.appendChild(stopLinkBubble(link));
        return node;
      }
    }
    node.appendChild(main);
    if (secondary) node.appendChild(secondary);
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
   * 配图链接目标：优先 backend 生成的本地署名页（credit_url），旧数据回退图源外链。
   * 返回 {href, local} 或 null。
   */
  function figureHref(figure) {
    if (!figure) return null;
    const local = PD.safeCreditUrl ? PD.safeCreditUrl(figure.creditUrl) : null;
    if (local) return { href: local, local: true };
    if (figure.sourceUrl) return { href: figure.sourceUrl, local: false };
    return null;
  }

  /**
   * 卡片配图：只有 reading.figure 通过 assets/papers/ 白名单且许可非空时才创建。
   * 卡片只放一张图、不写 caption/source/license 文字（用户要求）；
   * 合法署名不丢：图片整块可点，指向 backend 生成的逐图署名页（credit_url；
   * 旧数据回退图源页），alt 保留原 caption，title 用短句“图片来源与许可”，
   * 完整署名（作者/标题/许可/来源/原 caption）集中在署名页。
   */
  function figureBlock(paper) {
    const figure = paper.reading && paper.reading.figure ? paper.reading.figure : null;
    if (!figure) return null;
    const img = dom.assetImage(figure.src, figure.caption || T.figureAltFallback, 'paper-card-figure-img');
    if (!img) return null;
    const wrap = dom.el('figure', { class: 'paper-card-figure paper-figure' });
    const target = figureHref(figure);
    if (target && target.local) {
      const link = dom.creditLink(target.href, img, 'paper-figure-link');
      if (link) {
        link.setAttribute('title', T.figureCreditTitle);
        link.setAttribute('aria-label', T.figureCreditTitle);
        link.setAttribute('data-credit-target', 'credits');
        wrap.appendChild(stopLinkBubble(link));
        return wrap;
      }
    }
    if (target && !target.local) {
      const link = dom.externalLink(target.href, img, 'paper-figure-link');
      if (link) {
        link.setAttribute('title', T.figureCreditTitle);
        link.setAttribute('aria-label', T.figureCreditTitle);
        link.setAttribute('data-credit-target', 'source');
        wrap.appendChild(stopLinkBubble(link));
        return wrap;
      }
    }
    wrap.appendChild(img);
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
    const titleBasis = PD.paperIsTitleBasis ? PD.paperIsTitleBasis(paper) : paper.aiBasis === 'title';
    const attrs = {
      class: 'paper-card' + (item.matched ? ' matched-paper' : '') + (titleBasis ? ' paper-card-title-basis' : ''),
      'data-paper-id': paper.id
    };
    // 标题级卡片没有可生成的详情内容：不做 role=button，避免空详情入口。
    if (!titleBasis) {
      attrs.role = 'button';
      attrs.tabindex = '0';
    }
    const card = dom.el('div', attrs);
    const badge = matchBadge(item.reasons);
    if (badge) card.appendChild(badge);

    // 标题级只使用数据里真实存在的 abs；不猜来源、不拼 /pdf、不发起外部请求。
    const sourceUrl = titleBasis && paper.links ? PD.safeHttpUrl(paper.links.abs) : null;

    // 1) 标题最上（中文大字 + 英文原题小字；index 编号/作者/补录/日期都不上卡片）
    const header = dom.el('div', { class: 'paper-card-header' });
    header.appendChild(titleNode(paper, opts.titleTerms || [], titleBasis
      ? { linkUrl: sourceUrl, linkClass: 'paper-card-title-link' }
      : {}));

    // 2) 标签行：单位 pill（原文 + 中文）+ 论文编号灰 pill + 小而保留的来源标签
    const tagRow = dom.el('div', { class: 'paper-card-tag-row' });
    const units = unitPills(paper);
    if (units) tagRow.appendChild(units);
    const idPill = paperIdPill(paper);
    if (idPill) tagRow.appendChild(idPill);
    tagRow.appendChild(sourceTag(paper));
    header.appendChild(tagRow);
    card.appendChild(header);

    // 3) 配图：仅一张、无 caption 文字，图片整块可点去逐图署名页（旧数据回退图源）
    const figure = figureBlock(paper);
    if (figure) card.appendChild(figure);

    // 4) 正文：摘要/概括（仅真实内容）+ 页脚
    const body = dom.el('div', { class: 'paper-card-body' });
    let hasBody = false;
    if (titleBasis) {
      // 有真实摘要才展示；没有就不写“摘要缺失/仅标题判断”等占位。
      const realSummary = PD.hasPublicAbstract(paper) ? paper.abstract : '';
      if (realSummary !== '') {
        const summary = dom.el('p', { class: 'paper-card-summary' });
        dom.highlighted(summary, realSummary, opts.titleTerms || [], 'keyword-highlight');
        body.appendChild(summary);
        hasBody = true;
      }
      const footer = dom.el('div', { class: 'paper-card-footer' });
      const source = sourceUrl
        ? dom.externalLink(sourceUrl, T.cardPaperOriginal, 'paper-card-link paper-card-source-link')
        : null;
      if (source) {
        footer.appendChild(stopLinkBubble(source));
        body.appendChild(footer);
        hasBody = true;
      }
    } else {
      const summary = dom.el('p', { class: 'paper-card-summary' });
      const summaryText = paper.ai.tldr && paper.ai.tldr.trim() !== ''
        ? paper.ai.tldr
        : (PD.hasPublicAbstract(paper) ? paper.abstract : '');
      dom.highlighted(summary, summaryText === '' ? T.abstractLinkNote : summaryText, opts.titleTerms || [], 'keyword-highlight');
      body.appendChild(summary);
      const footer = dom.el('div', { class: 'paper-card-footer' });
      footer.appendChild(dom.el('span', { class: 'paper-card-link', text: T.cardDetails }));
      body.appendChild(footer);
      hasBody = true;
    }
    if (hasBody) card.appendChild(body);

    // 5) 个人阅读状态：已读 / 收藏。收藏隐含已读；状态只存本机并同步到私有仓库。
    if (opts.userActions) card.appendChild(userActionRow(card, paper, opts.userActions));

    return card;
  }

  /** 卡片底部两个小按钮；点击不触发卡片的详情打开。 */
  function userActionRow(card, paper, actions) {
    const row = dom.el('div', { class: 'paper-card-actions' });
    const read = actions.isRead(paper.id);
    const favorite = actions.isFavorite(paper.id);
    if (read) card.classList.add('paper-card-read');
    const readButton = dom.el('button', {
      class: 'paper-card-action' + (read ? ' active' : ''),
      type: 'button',
      'data-action': 'read',
      'aria-pressed': read ? 'true' : 'false',
      title: T.readActionHint,
      text: read ? T.readDoneLabel : T.readActionLabel
    });
    if (favorite) readButton.disabled = true;
    readButton.addEventListener('click', function (event) {
      event.stopPropagation();
      actions.onRead(paper, readButton, card);
    });
    const favoriteButton = dom.el('button', {
      class: 'paper-card-action' + (favorite ? ' active' : ''),
      type: 'button',
      'data-action': 'favorite',
      'aria-pressed': favorite ? 'true' : 'false',
      title: T.favoriteActionHint,
      text: favorite ? T.favoriteDoneLabel : T.favoriteActionLabel
    });
    favoriteButton.addEventListener('click', function (event) {
      event.stopPropagation();
      actions.onFavorite(paper, favoriteButton, readButton, card);
    });
    row.appendChild(readButton);
    row.appendChild(favoriteButton);
    return row;
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
      text: day.count === 0 && day.operationPending ? '待补采' : i18n.formatTemplate(T.feedDayCount, { n: day.count })
    }));
    const revision = renderRevision(day.digest);
    if (revision) heading.appendChild(revision);
    return heading;
  }

  /**
   * 连续日期列表（首页主视图）。
   * options: {
   *   days: [{date, count, items, digest}],   // 必须已按报告日期倒序
   *   view: 'grid' | 'list',
   *   titleTerms, authorTerms, onOpen
   * }
   * items 为 pd-core.rankPapers 的结果；卡片序号在整个列表内连续编号。
   * 来源覆盖/缺口状态不在这里渲染：主 feed 不再有常驻 banner 或“查看原因”。
   * 数据层仍保留 coverage/partial 状态，内部 helper（sourceStatusText）供诊断/测试。
   */
  function renderFeed(container, options) {
    const opts = options || {};
    dom.clear(container);
    container.className = 'feed' + (opts.view === 'list' ? ' list-view' : '');
    const days = Array.isArray(opts.days) ? opts.days : [];
    let index = 0;
    days.forEach(function (day) {
      const section = dom.el('section', {
        class: 'feed-day', 'data-date': day.date || '', id: 'feed-day-' + day.date
      });
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
          const titleBasis = PD.paperIsTitleBasis
            ? PD.paperIsTitleBasis(item.paper)
            : item.paper.aiBasis === 'title';
          // 标题级卡片没有详情：不挂打开模态框的点击/键盘监听。
          if (opts.onOpen && !titleBasis) {
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
    const label = entry.label || entry.name || entry.nameZh || '';
    const link = dom.externalLink(entry.sourceUrl, label, 'affiliation-name affiliation-link');
    if (link) {
      link.setAttribute('title', label + '（' + T.modalAffiliationsSource + '）');
      return stopLinkBubble(link);
    }
    return dom.el('span', { class: 'affiliation-name', title: label, text: label });
  }

  /**
   * 详情里的配图许可行：卡片不再写 caption / 许可大段，但详情必须明确 license 与图源
   * （集中逐图署名由 backend 生成 artwork credits 后再补锚点，这里先给图源页）。
   */
  function figureLicenseRow(paper) {
    const figure = paper.reading && paper.reading.figure ? paper.reading.figure : null;
    if (!figure) return null;
    const wrap = dom.el('span', { class: 'modal-figure-license' });
    // 完整署名（作者/标题/许可/来源/caption）在署名页；详情给一行明确入口
    wrap.setAttribute('title', figureCredit(paper, figure));
    const target = figureHref(figure);
    if (target && target.local) {
      const credits = dom.creditLink(target.href, T.figureCreditsLink, 'figure-credits-link');
      if (credits) wrap.appendChild(stopLinkBubble(credits));
    }
    if (target && !target.local) {
      const source = dom.externalLink(target.href, T.figureSource, 'figure-source-link');
      if (source) dom.append(wrap, [' · ', stopLinkBubble(source)]);
    }
    if (figure.creditUrl === null || figure.creditUrl === undefined) {
      // 旧数据没有署名页：仍明确写出许可（已知许可给官方页链接）
      if (wrap.childNodes.length > 0) dom.append(wrap, [' · ']);
      wrap.appendChild(licenseNode(figure.license));
    }
    return wrap;
  }

  function affiliationList(paper) {
    const reading = paper && paper.reading && typeof paper.reading === 'object' ? paper.reading : {};
    return Array.isArray(reading.affiliations) ? reading.affiliations : [];
  }

  /**
   * 卡片单位 pill：原文 + （中文），有合法 source_url 时整颗 pill 可点（新窗口、隔离冒泡）。
   * 未知单位不再满屏“单位待核实”：卡片上直接不显示任何单位 pill（补全状态由后台处理）；
   * 详情仍会如实写“单位待核实”。
   */
  const CARD_UNIT_LIMIT = 3;

  function unitPill(entry) {
    const label = entry.label || entry.name || entry.nameZh || '';
    const link = entry.sourceUrl
      ? dom.externalLink(entry.sourceUrl, label, 'paper-unit-pill paper-unit-link')
      : null;
    if (link) {
      link.setAttribute('title', label + '（' + T.modalAffiliationsSource + '）');
      link.setAttribute('rel', 'noopener noreferrer');
      return stopLinkBubble(link);
    }
    return dom.el('span', { class: 'paper-unit-pill', title: label, text: label });
  }

  function unitPills(paper) {
    const list = affiliationList(paper);
    if (list.length === 0) return null;
    const wrap = dom.el('div', { class: 'paper-card-units' });
    wrap.setAttribute('title', list.map(function (entry) { return entry.label || entry.name; }).join('、'));
    list.slice(0, CARD_UNIT_LIMIT).forEach(function (entry) {
      wrap.appendChild(unitPill(entry));
    });
    if (list.length > CARD_UNIT_LIMIT) {
      wrap.appendChild(dom.el('span', {
        class: 'paper-unit-pill paper-unit-more',
        text: '+' + (list.length - CARD_UNIT_LIMIT)
      }));
    }
    return wrap;
  }

  /** 论文编号 pill（灰）：arxiv:2610.18869 → 2610.18869；pubmed:1 → PMID 1。 */
  function paperIdPill(paper) {
    const label = PD.paperIdLabel ? PD.paperIdLabel(paper) : '';
    if (label === '') return null;
    return dom.el('span', { class: 'paper-id-pill', title: label, text: label });
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
    // 标题级记录没有可生成的详情：直接不产生任何详情内容（不是空四节，
    // 也不是“方法未提供”式 headline fallback）；来源由卡片标题/页脚承担。
    if (PD.paperIsTitleBasis ? PD.paperIsTitleBasis(paper) : (paper && paper.aiBasis === 'title')) {
      return null;
    }
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
    const licenseRow = figureLicenseRow(paper);
    if (licenseRow) meta.appendChild(metaRow(T.modalFigureLicense + ': ', licenseRow));
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
    figureHref: figureHref,
    figureCredit: figureCredit,
    licenseNode: licenseNode,
    titleNode: titleNode,
    affiliationDetail: affiliationDetail,
    figureLicenseRow: figureLicenseRow,
    unitPills: unitPills,
    unitPill: unitPill,
    paperIdPill: paperIdPill,
    aiSection: aiSection,
    bulletList: bulletList
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
