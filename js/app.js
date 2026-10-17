/**
 * ResearcherPapers 首页逻辑：按报告日期倒序连续展示所有已有日报（feed）。
 *
 * 来源与变更声明 / Provenance notice:
 *   本文件由上游 daily-arXiv-ai-enhanced
 *   （main 01fdad3b0aec2d2f7977b686253a7b0c1c8273dc，Modified Apache License，
 *   参考 .upstream/daily-arxiv/web/js/app.js，许可证副本见
 *   docs/licenses/daily-arxiv-LICENSE）改写而来；版式、卡片、模态框、
 *   关键词/作者偏好与搜索沿用上游，版权与许可归属上游原作者。
 *   主要变更：
 *     1. 数据源改本站相对目录：assets/file-list.txt、
 *        data/YYYY-MM-DD_AI_enhanced_Chinese.jsonl、data/YYYY-MM-DD_digest.json；
 *        删除 raw.githubusercontent、GitHub API 星数、DATA_CONFIG 注入与语言探测；
 *     2. 主题筛选用 topics（embodied/surgical，允许双命中），categories 只作来源分类标签；
 *     3. 卡片与模态框改由 pd-render/pd-dom 构建（无 innerHTML 注入）；
 *     4. 阅读改版：删除日期选择/区间切换与当日总结正文，改为
 *        “所有已有日期按报告日期倒序连续展开”（最新在顶部），
 *        每个日期一个 heading（日期 + 收录篇数），默认全部可读；
 *     5. 主题过滤只有两个按钮、没有“全部”：初始都不选 = 两个主题都显示，
 *        再点一次即取消，两个都选等价于都显示，永远不会出现空白尴尬态；
 *     6. 主 feed 不再渲染来源覆盖 banner/“查看原因”；coverage/partial 只保留在
 *        数据层与内部 helper，不伪注 complete；加载失败仍给简短可操作提示；
 *     7. PDF 预览/按钮已删除，只保留摘要页与代码仓库外链；删除 KimiChat 第三方预填；
 *     8. 搜索/偏好/统计仍然独立可用；匹配优先排序在各日期分组内生效（不跨日乱序）。
 *   本文件为衍生代码，许可遵循 docs/licenses/daily-arxiv-LICENSE。
 */
(function () {
  'use strict';

  const PD = window.PD;
  const dom = PD.dom;
  const i18n = PD.i18n;
  const T = i18n.TEXT;

  const state = {
    fileList: null,
    operations: {},
    availableDates: [],  // 报告日期，倒序（新 → 旧）
    days: {},            // date -> 完整加载完成的 {date, papers, digest, coverage, ...}
    dayLoads: {},        // date -> 正在进行的加载 Promise
    loadToken: 0,        // 单调递增令牌：旧的整体加载不得覆盖新一轮渲染
    topics: [],          // 选中的主题集合；空数组 = 两个主题都显示（没有“全部”按钮）
    keywords: [],
    authors: [],
    text: '',
    view: 'grid',
    currentPapers: [],   // 当前 feed 顺序内的论文（模态框 ← → 与序号用）
    currentIndex: 0
  };

  const refs = {};

  /* ------------------------------ 数据读取 ------------------------------ */

  let requestCount = 0;
  let requestBytes = 0;

  function fetchRelative(path) {
    requestCount += 1;
    return fetch(path, { credentials: 'same-origin' }).then(function (response) {
      if (!response.ok) {
        const error = new Error('HTTP ' + response.status);
        error.status = response.status;
        throw error;
      }
      return response.text().then(function (text) {
        requestBytes += text.length;
        return text;
      });
    });
  }

  function loadFileList() {
    return fetchRelative(PD.FILE_LIST_PATH).then(function (text) {
      state.fileList = PD.parseFileList(text);
      state.availableDates = state.fileList.dates.slice();
      return fetchRelative('data/operations.json').then(function (text) {
        let raw = null;
        try { raw = JSON.parse(text); } catch (_) {}
        const messages = {
          update_failed: '今日更新暂未完成，已保留已有论文，系统将重试。',
          permission_required: '今日更新需要处理访问权限，已保留已有论文。',
          source_wait: '今日部分来源暂不可用，已有论文照常阅读，系统将继续补采。',
          delivery_pending: '今日内容已生成，发布确认暂未完成，系统将重试。'
        };
        if (raw && raw.schema === 'researcher-papers-operations/1' && raw.days && typeof raw.days === 'object') {
          Object.keys(raw.days).forEach(function (day) {
            const code = raw.days[day] && raw.days[day].code;
            if (PD.isIsoDate(day) && Object.prototype.hasOwnProperty.call(messages, code)) state.operations[day] = messages[code];
          });
          state.availableDates = Array.from(new Set(state.availableDates.concat(Object.keys(state.operations)))).sort().reverse();
        }
        return state.fileList;
      }, function () { return state.fileList; });
    }, function (error) {
      state.fileList = PD.parseFileList('');
      state.fileList.error = error.status === 404 ? 'missing' : 'failed';
      return state.fileList;
    });
  }

  /** 只有 coverage 算好的整日数据才进 state.days。 */
  function dayReady(day) {
    return !!(day && day.coverage);
  }

  function loadDay(date) {
    if (state.days[date]) return Promise.resolve(state.days[date]);
    if (state.dayLoads[date]) return state.dayLoads[date];
    const entry = (state.fileList && state.fileList.byDate[date]) || null;
    if (!entry && state.operations[date]) {
      const digest = PD.normalizeDigest(null, date);
      const day = {date:date, papers:[], digest:digest, invalidLines:0, dropped:0, totalLines:0,
                   coverage:PD.computeCoverage(digest, [], {}), dailyMissing:false};
      state.days[date] = day;
      return Promise.resolve(day);
    }
    const languages = entry && entry.languages ? entry.languages : [];
    const dailyPath = PD.dailyFilePath(date, 'Chinese') ||
      (languages.length > 0 ? PD.dailyFilePath(date, languages[0]) : null);
    const digestPath = (entry && entry.digest) || PD.digestFilePath(date);
    const day = {
      date: date, papers: [], invalidLines: 0, dropped: 0, totalLines: 0,
      digest: PD.normalizeDigest(null, date), coverage: null,
      dailyMissing: false, dailyFailed: false, digestFailed: false
    };

    const dailyRequest = dailyPath
      ? fetchRelative(dailyPath).then(function (text) {
        const parsed = PD.parseJsonl(text, { fileDate: date });
        day.papers = parsed.papers;
        day.invalidLines = parsed.invalidLines;
        day.dropped = parsed.dropped;
        day.totalLines = parsed.totalLines;
      }, function (error) {
        // 404 = 这天真的没有日报；其他失败（断网/5xx）= 读取失败，必须与“缺日”区分开。
        if (error && error.status === 404) day.dailyMissing = true;
        else day.dailyFailed = true;
      })
      : Promise.resolve().then(function () { day.dailyMissing = true; });

    // digest 文件只用于“来源状态一行”与同日修订信息；正文不再渲染。
    const digestRequest = digestPath
      ? fetchRelative(digestPath).then(function (text) {
        let raw = null;
        try {
          raw = JSON.parse(text);
        } catch (error) {
          raw = null;
        }
        day.digest = PD.normalizeDigest(raw, date);
      }, function (error) {
        day.digest = PD.normalizeDigest(null, date);
        if (!error || error.status !== 404) {
          day.digestFailed = true;
          day.digest.problem = 'load-failed';
        }
      })
      : Promise.resolve().then(function () { day.digest = PD.normalizeDigest(null, date); });

    const promise = Promise.all([dailyRequest, digestRequest]).then(function () {
      day.coverage = PD.computeCoverage(day.digest, day.papers, { invalidLines: day.invalidLines, dropped: day.dropped });
      state.days[date] = day;
      delete state.dayLoads[date];
      return day;
    }, function (error) {
      // 失败不缓存，允许之后再试；否则错误状态会被当成“已加载”永久复用。
      delete state.dayLoads[date];
      throw error;
    });
    state.dayLoads[date] = promise;
    return promise;
  }

  /** 一次加载所有已有日期；个别日期加载失败只标记该日，不拖垮整页也不静默丢日期。 */
  function loadAllDays() {
    return Promise.all(state.availableDates.map(function (date) {
      return loadDay(date).catch(function () {
        // 失败也要保留该日期并如实说明“暂时无法读取”，不能让它在 feed 里凭空消失。
        const digest = PD.normalizeDigest(null, date);
        let coverage = null;
        try {
          coverage = PD.computeCoverage(digest, [], {});
        } catch (inner) {
          // 连覆盖率都算不出来时的最小兜底：仍然保留该日期，只给“读取失败”一句话。
          coverage = {
            publishedCount: 0, declaredCount: null, countMismatch: false, pendingCount: null,
            gapReasons: {}, byTopic: { embodied: 0, surgical: 0, both: 0, none: 0 },
            bySource: { arxiv: 0, pubmed: 0, unknown: 0 }, coverage: digest.coverage
          };
        }
        const failed = {
          date: date, papers: [], invalidLines: 0, dropped: 0, totalLines: 0,
          digest: digest, coverage: coverage,
          dailyMissing: false, dailyFailed: true, digestFailed: true, loadFailed: true
        };
        state.days[date] = failed;
        return failed;
      });
    }));
  }

  /* ------------------------------ 顶栏与筛选 UI ------------------------------ */

  /**
   * 主题过滤：只有两个主题按钮，**没有“全部”**。
   * 初始都不选 = 两个主题都显示；点一下只看该主题；再点一次取消；
   * 两个都选中同样等于“都显示”，因此不存在“什么都没选所以空白”的状态。
   */
  function renderTopicNav() {
    if (!refs.categoryScroll) return;
    dom.clear(refs.categoryScroll);
    PD.TOPICS.forEach(function (topic) {
      const active = state.topics.indexOf(topic) !== -1;
      const button = dom.el('button', {
        class: 'category-button' + (active ? ' active' : ''),
        'data-topic': topic,
        type: 'button',
        'aria-pressed': active ? 'true' : 'false',
        title: T.filterTopicHint,
        text: i18n.topicLabel(topic)
      });
      button.addEventListener('click', function () { toggleTopic(topic); });
      refs.categoryScroll.appendChild(button);
    });
  }

  function toggleTopic(topic) {
    const index = state.topics.indexOf(topic);
    if (index === -1) state.topics.push(topic);
    else state.topics.splice(index, 1);
    state.topics = state.topics.filter(function (item) { return PD.TOPICS.indexOf(item) !== -1; });
    updateUrlParam('topic', state.topics.length > 0 ? state.topics.join(',') : null);
    renderTopicNav();
    renderFeed();
  }

  function updateUrlParam(key, value) {
    try {
      const url = new URL(window.location.href);
      if (value === null) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
      window.history.replaceState({}, '', url);
    } catch (error) {
      /* file:// 或受限环境下忽略 URL 同步，不影响筛选 */
    }
  }

  function renderFilterTags() {
    if (!refs.filterTags) return;
    dom.clear(refs.filterTags);
    const hasAny = state.authors.length > 0 || state.keywords.length > 0;
    refs.filterTags.style.setProperty('display', hasAny ? 'flex' : 'none');
    state.authors.forEach(function (author) {
      const tag = dom.el('span', {
        class: 'category-button author-button active',
        'data-author': author,
        title: '匹配作者姓名（点击可停用，不隐藏论文）',
        text: author
      });
      tag.addEventListener('click', function () { toggleAuthor(author); });
      refs.filterTags.appendChild(tag);
    });
    state.keywords.forEach(function (keyword) {
      const tag = dom.el('span', {
        class: 'category-button keyword-button active',
        'data-keyword': keyword,
        title: '匹配标题和摘要中的关键词（点击可停用，不隐藏论文）',
        text: keyword
      });
      tag.addEventListener('click', function () { toggleKeyword(keyword); });
      refs.filterTags.appendChild(tag);
    });
  }

  function toggleKeyword(keyword) {
    const index = state.keywords.indexOf(keyword);
    if (index === -1) state.keywords.push(keyword);
    else state.keywords.splice(index, 1);
    renderFilterTags();
    renderFeed();
  }

  function toggleAuthor(author) {
    const index = state.authors.indexOf(author);
    if (index === -1) state.authors.push(author);
    else state.authors.splice(index, 1);
    renderFilterTags();
    renderFeed();
  }

  /* ------------------------------ 渲染主流程 ------------------------------ */

  function searchTerms() {
    const terms = state.keywords.slice();
    if (state.text.trim() !== '') terms.push(state.text.trim());
    return terms;
  }

  /** 每个日期一段：先按主题筛选，再在各日期内做匹配优先排序（不跨日乱序）。 */
  function buildFeedDays() {
    const days = [];
    state.availableDates.forEach(function (date) {
      const day = state.days[date];
      if (!dayReady(day)) return;
      const papers = PD.topicView(day.papers, state.topics).items.map(function (item) { return item.paper; });
      const ranked = PD.rankPapers(papers, {
        keywords: state.keywords,
        authors: state.authors,
        text: state.text,
        preserveOrder: day.papers.some(function (paper) { return !!paper.selection; })
      });
      // 解析缺口（坏行/缺字段行）不能看起来像“这天没有论文”：
      //   有有效行 → 照常展示 + 一行“部分内容无法读取”；
      //   一条有效行都没有 → “本日数据无法读取”（不说“暂无收录”，也不外露坏行/计数）。
      const unreadable = (day.invalidLines || 0) > 0 || (day.dropped || 0) > 0;
      let emptyText = T.feedDayEmpty;
      let notice = '';
      if (day.papers.length === 0) {
        if (day.dailyFailed) emptyText = T.loadFailedTitle;
        else if (day.dailyMissing) emptyText = T.feedDayMissing;
        else if (unreadable) emptyText = T.feedDayUnreadable;
        // 文件存在、一行都没有：是“这天没有收录”，不是“当前筛选筛掉了”
        else if ((day.totalLines || 0) === 0) emptyText = T.noPapersForDate;
      } else if (unreadable) {
        notice = T.feedDayPartial;
      }
      days.push({
        date: date,
        count: ranked.length,
        items: ranked,
        digest: day.digest,
        emptyText: emptyText,
        notice: state.operations[date] || notice
      });
    });
    return days;
  }

  /* Date navigation uses the rendered rows, never digest/raw-topic totals. The scroll
   * listener also covers zero-paper sections, short days and end-of-page clamping. */
  let dateSections = [];
  let dateButtons = [];
  let activeDate = '';
  let scrollFrame = false;

  function readingOffset() {
    const header = document.querySelector('header');
    const height = header && header.getBoundingClientRect ? header.getBoundingClientRect().height : 0;
    if (refs.readingLayout) refs.readingLayout.style.setProperty('--reading-top', (height + 16) + 'px');
    return height + 20;
  }

  function setActiveDate(date) {
    activeDate = date;
    dateButtons.forEach(function (button) {
      const active = button.getAttribute('data-date') === date;
      button.classList.toggle('active', active);
      if (active) {
        button.setAttribute('aria-current', 'date');
        // Reveal the active item inside the horizontal rail without scrolling the page.
        if (button.getBoundingClientRect && refs.dateNav.getBoundingClientRect) {
          const item = button.getBoundingClientRect();
          const rail = refs.dateNav.getBoundingClientRect();
          if (item.left < rail.left) refs.dateNav.scrollLeft -= rail.left - item.left;
          else if (item.right > rail.right) refs.dateNav.scrollLeft += item.right - rail.right;
        }
      } else button.removeAttribute('aria-current');
    });
  }

  function updateActiveDate() {
    scrollFrame = false;
    if (!dateSections.length || !dateSections[0].getBoundingClientRect) return;
    const offset = readingOffset();
    let current = dateSections[0];
    dateSections.forEach(function (section) {
      if (section.getBoundingClientRect().top <= offset + 1) current = section;
    });
    // The last short/empty day may never reach the header because the document ends.
    if (window.innerHeight + window.pageYOffset >= document.documentElement.scrollHeight - 2) {
      current = dateSections[dateSections.length - 1];
    }
    setActiveDate(current.getAttribute('data-date'));
  }

  function queueActiveDate() {
    if (scrollFrame) return;
    scrollFrame = true;
    if (window.requestAnimationFrame) window.requestAnimationFrame(updateActiveDate);
    else updateActiveDate();
  }

  function renderDateNav(days) {
    if (!refs.dateNav) return;
    dom.clear(refs.dateNav);
    dateButtons = [];
    dateSections = Array.prototype.slice.call(refs.paperContainer.querySelectorAll('.feed-day'));
    days.forEach(function (day, index) {
      const button = dom.el('button', {
        class: 'date-nav-button', type: 'button', 'data-date': day.date,
        'aria-controls': 'feed-day-' + day.date,
        text: day.date + '（' + day.count + '）'
      });
      button.addEventListener('click', function () {
        const section = dateSections[index];
        if (!section || !section.getBoundingClientRect) return;
        const top = section.getBoundingClientRect().top + window.pageYOffset - readingOffset();
        window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
        setActiveDate(day.date);
      });
      refs.dateNav.appendChild(button);
      dateButtons.push(button);
    });
    setActiveDate(activeDate || (days[0] && days[0].date));
    updateActiveDate();
  }

  function renderFeed() {
    if (!refs.paperContainer) return;
    const days = buildFeedDays();
    if (days.length === 0) {
      showMessage(T.feedLoading);
      return;
    }
    state.currentPapers = [];
    days.forEach(function (day) {
      day.items.forEach(function (item) { state.currentPapers.push(item.paper); });
    });
    PD.render.renderFeed(refs.paperContainer, {
      days: days,
      view: state.view,
      titleTerms: searchTerms(),
      authorTerms: state.authors.slice(),
      onOpen: function (paper) {
        const index = state.currentPapers.indexOf(paper);
        state.currentIndex = index < 0 ? 0 : index;
        openModal(paper, state.currentIndex);
      }
    });
    renderDateNav(days);
    renderHeaderLabel();
    renderTopicNav();
  }

  function isTitleBasis(paper) {
    return PD.paperIsTitleBasis ? PD.paperIsTitleBasis(paper) : !!(paper && paper.aiBasis === 'title');
  }

  /** 页头只显示最新一个报告日（不再是可点的日期选择器）。 */
  function renderHeaderLabel() {
    if (!refs.currentDate) return;
    const paperDates = state.fileList && state.fileList.dates ? state.fileList.dates : [];
    const newest = paperDates.length > 0 ? paperDates[0] : '';
    refs.currentDate.textContent = PD.isIsoDate(newest) ? (T.feedLatest + ' ' + newest) : '';
  }

  function showMessage(text) {
    dom.clear(refs.paperContainer);
    refs.paperContainer.appendChild(dom.el('div', { class: 'loading-container' }, [
      dom.el('p', { text: text })
    ]));
  }

  function showLoading() {
    if (!refs.paperContainer) return;
    dom.clear(refs.paperContainer);
    refs.paperContainer.appendChild(dom.el('div', { class: 'loading-container' }, [
      dom.el('div', { class: 'loading-spinner' }),
      dom.el('p', { text: T.feedLoading })
    ]));
  }

  function nextLoadToken() {
    state.loadToken += 1;
    return state.loadToken;
  }

  function isCurrentLoad(token) {
    return token === state.loadToken;
  }

  /* ------------------------------ 模态框 ------------------------------ */

  function openModal(paper, index) {
    // 标题级卡片没有可生成的详情：统一由卡片标题/页脚打开来源页。
    if (isTitleBasis(paper)) return;
    state.currentIndex = index;
    PD.render.renderPaperModal(refs, paper, {
      index: index + 1,
      total: state.currentPapers.length,
      titleTerms: searchTerms()
    });
    if (refs.modal) {
      refs.modal.classList.add('active');
      document.body.style.setProperty('overflow', 'hidden');
    }
  }

  function closeModal() {
    if (refs.modal) refs.modal.classList.remove('active');
    document.body.style.setProperty('overflow', '');
    if (refs.body) refs.body.scrollTop = 0;
  }

  function navigate(step) {
    if (state.currentPapers.length === 0) return;
    let index = state.currentIndex;
    for (let guard = 0; guard < state.currentPapers.length; guard += 1) {
      index += step;
      if (index < 0) index = state.currentPapers.length - 1;
      if (index >= state.currentPapers.length) index = 0;
      if (!isTitleBasis(state.currentPapers[index])) {
        openModal(state.currentPapers[index], index);
        return;
      }
    }
  }

  function showRandomPaper() {
    const detailPapers = state.currentPapers.filter(function (paper) { return !isTitleBasis(paper); });
    if (detailPapers.length === 0) return;
    const index = state.currentPapers.indexOf(detailPapers[Math.floor(Math.random() * detailPapers.length)]);
    openModal(state.currentPapers[index], index);
    const indicator = dom.el('div', { class: 'random-paper-indicator', text: 'Random Paper' });
    document.body.appendChild(indicator);
    setTimeout(function () { indicator.remove(); }, 3000);
  }

  /* ------------------------------ 事件绑定 ------------------------------ */

  function bindEvents() {
    window.addEventListener('scroll', queueActiveDate, { passive: true });
    window.addEventListener('resize', queueActiveDate);
    if (refs.closeModal) refs.closeModal.addEventListener('click', closeModal);
    if (refs.modal) refs.modal.addEventListener('click', function (event) {
      if (event.target === refs.modal) closeModal();
    });

    document.addEventListener('keydown', function (event) {
      const active = document.activeElement;
      const isInputFocused = !!active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
      if (event.key === 'Escape') {
        if (refs.modal && refs.modal.classList.contains('active')) closeModal();
      } else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && refs.modal && refs.modal.classList.contains('active')) {
        event.preventDefault();
        navigate(event.key === 'ArrowLeft' ? -1 : 1);
      } else if ((event.key === ' ' || event.key === 'Spacebar') && !isInputFocused) {
        event.preventDefault();
        showRandomPaper();
      }
    });

    // 文本搜索（沿用上游交互：放大镜展开、清空按钮、匹配优先排序）
    if (refs.searchToggle && refs.searchWrapper && refs.searchInput && refs.searchClear) {
      refs.searchToggle.addEventListener('click', function (event) {
        event.stopPropagation();
        refs.searchWrapper.style.setProperty('display', 'flex');
        refs.searchInput.focus();
      });
      refs.searchInput.addEventListener('input', function () {
        state.text = refs.searchInput.value.trim();
        refs.searchClear.style.setProperty('display', state.text.length > 0 ? 'inline-flex' : 'none');
        renderFeed();
      });
      refs.searchClear.addEventListener('click', function (event) {
        event.stopPropagation();
        refs.searchInput.value = '';
        state.text = '';
        refs.searchClear.style.setProperty('display', 'none');
        refs.searchWrapper.style.setProperty('display', 'none');
        renderFeed();
      });
      refs.searchInput.addEventListener('blur', function () {
        if (refs.searchInput.value.trim() === '') refs.searchWrapper.style.setProperty('display', 'none');
      });
    }

    if (refs.backToTop) {
      const update = function () {
        const top = window.pageYOffset || document.documentElement.scrollTop || 0;
        refs.backToTop.classList.toggle('visible', top > 300);
      };
      update();
      window.addEventListener('scroll', update, { passive: true });
      refs.backToTop.addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
  }

  function collectRefs() {
    refs.currentDate = document.getElementById('currentDate');
    refs.paperContainer = document.getElementById('paperContainer');
    refs.dateNav = document.getElementById('dateNav');
    refs.readingLayout = document.querySelector('.reading-layout');
    refs.categoryScroll = document.querySelector('.category-scroll');
    refs.filterTags = document.getElementById('filterTags');
    refs.searchToggle = document.getElementById('textSearchToggle');
    refs.searchWrapper = document.querySelector('#textSearchContainer .search-input-wrapper');
    refs.searchInput = document.getElementById('textSearchInput');
    refs.searchClear = document.getElementById('textSearchClear');
    refs.backToTop = document.getElementById('backToTop');
    refs.modal = document.getElementById('paperModal');
    refs.closeModal = document.getElementById('closeModal');
    refs.title = document.getElementById('modalTitle');
    refs.body = document.getElementById('modalBody');
    refs.position = document.getElementById('paperPosition');
    refs.absLink = document.getElementById('absLink');
    refs.codeLink = document.getElementById('codeLink');
    refs.modalActions = document.getElementById('modalActions');
  }

  /** 复制摘要页链接按钮（替代上游的 KimiChat 第三方预填跳转）。 */
  function mountCopyButton() {
    if (!refs.modalActions || refs.copyButton) return;
    const button = dom.el('button', {
      class: 'button icon-button copy-link-button',
      type: 'button',
      title: T.modalCopyLink
    }, [dom.el('span', { class: 'copy-link-label', text: T.modalCopyLink })]);
    button.addEventListener('click', function () {
      const paper = state.currentPapers[state.currentIndex];
      const url = paper && paper.links ? paper.links.abs : null;
      const notify = function (message) {
        const tip = dom.el('div', { class: 'copy-toast', role: 'status', text: message });
        document.body.appendChild(tip);
        setTimeout(function () { tip.remove(); }, 2500);
      };
      if (!url) {
        notify(T.modalNoLinkToCopy);
        return;
      }
      const done = function (ok) { notify(ok ? T.modalCopied : T.modalCopyFailed); };
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
    refs.copyButton = button;
    refs.modalActions.appendChild(button);
  }

  /* ------------------------------ 启动 ------------------------------ */

  function bootstrap() {
    collectRefs();
    mountCopyButton();
    bindEvents();

    // URL 里的 topic 只接受已知主题（允许逗号分隔的多选）。
    const params = new URLSearchParams(window.location.search);
    const topicParam = params.get('topic');
    if (topicParam) {
      state.topics = topicParam.split(',').map(function (item) { return item.trim(); })
        .filter(function (item, index, list) {
          return PD.TOPICS.indexOf(item) !== -1 && list.indexOf(item) === index;
        });
    }
    renderTopicNav();

    const prefs = PD.prefs.createPreferences();
    state.keywords = prefs.read('keywords');
    state.authors = prefs.read('authors');
    renderFilterTags();

    const token = nextLoadToken();
    showLoading();
    loadFileList().then(function (fileList) {
      if (fileList.error === 'missing' || state.availableDates.length === 0) {
        if (refs.currentDate) refs.currentDate.textContent = '';
        showMessage(T.fileListMissing);
        renderTopicNav();
        return null;
      }
      return loadAllDays().then(function () {
        if (!isCurrentLoad(token)) return null;
        renderFeed();
        return null;
      });
    }).catch(function () {
      if (!isCurrentLoad(token)) return;
      showMessage(T.loadFailedTitle);
    });
  }

  // 供浏览器验收/调试读取（只读快照，不含私有数据）。
  window.PD_APP_STATE = function () {
    return {
      dates: state.availableDates.slice(),
      newestDate: state.availableDates.length > 0 ? state.availableDates[0] : null,
      topics: state.topics.slice(),
      renderedPapers: state.currentPapers.length,
      requests: requestCount,
      fetchedChars: requestBytes
    };
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
