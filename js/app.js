/**
 * ResearcherPapers 首页逻辑：本站数据源、主题筛选、日期选择、卡片与模态框。
 *
 * 来源与变更声明 / Provenance notice:
 *   本文件由上游 daily-arXiv-ai-enhanced
 *   （main 01fdad3b0aec2d2f7977b686253a7b0c1c8273dc，Modified Apache License，
 *   参考 .upstream/daily-arxiv/web/js/app.js，许可证副本见
 *   docs/licenses/daily-arxiv-LICENSE）改写而来；版式、卡片、模态框、
 *   关键词/作者偏好与日期阅读流程沿用上游，版权与许可归属上游原作者。
 *   主要变更：
 *     1. 数据源改本站相对目录：assets/file-list.txt、
 *        data/YYYY-MM-DD_AI_enhanced_Chinese.jsonl、data/YYYY-MM-DD_digest.json；
 *        删除 raw.githubusercontent、GitHub API 星数、DATA_CONFIG 注入与语言探测；
 *     2. 主题筛选用 topics（embodied/surgical，允许双命中），categories 只作来源分类标签；
 *     3. 卡片与模态框改由 pd-render/pd-dom 构建（无 innerHTML 注入），
 *        关键词/作者/文本搜索保留“匹配优先排序、不隐藏论文”的上游体验；
 *     4. 日期选择改原生 input[type=date]（单日 + 区间），删除 flatpickr CDN 依赖；
 *     5. PDF 仅在有真实 pdf 字段时出现在按钮/iframe；删除 abs→pdf/html 字符串替换；
 *     6. 删除登录守卫与 KimiChat 第三方预填链接；
 *     7. 新增当日日报面板：计数、partial/缺口、pending、日报引用可点击定位。
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
    availableDates: [],
    days: {},            // date -> {papers, invalidLines, dropped, digest, coverage, crossCheck}
    range: null,         // {start, end, dates:[]}
    topics: 'all',
    keywords: [],
    authors: [],
    text: '',
    view: 'grid',
    currentPapers: [],   // 当前视图内（排序后）的论文
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
      return state.fileList;
    }, function (error) {
      state.fileList = PD.parseFileList('');
      state.fileList.error = error.status === 404 ? 'missing' : 'failed';
      return state.fileList;
    });
  }

  function loadDay(date) {
    if (state.days[date]) return Promise.resolve(state.days[date]);
    const dailyPath = PD.dailyFilePath(date, 'Chinese') || state.fileList.byDate[date].languages.map(function (lang) {
      return PD.dailyFilePath(date, lang);
    })[0];
    const digestPath = state.fileList.byDate[date].digest || PD.digestFilePath(date);
    const day = { date: date, papers: [], invalidLines: 0, dropped: 0, digest: PD.normalizeDigest(null, date), coverage: null, crossCheck: null, dailyMissing: false };
    state.days[date] = day;

    const dailyRequest = fetchRelative(dailyPath).then(function (text) {
      const parsed = PD.parseJsonl(text, { fileDate: date });
      day.papers = parsed.papers;
      day.invalidLines = parsed.invalidLines;
      day.dropped = parsed.dropped;
    }, function () {
      day.dailyMissing = true;
    });

    const digestRequest = fetchRelative(digestPath).then(function (text) {
      let raw = null;
      try {
        raw = JSON.parse(text);
      } catch (error) {
        raw = null;
      }
      day.digest = PD.normalizeDigest(raw, date);
    }, function () {
      day.digest = PD.normalizeDigest(null, date);
    });

    return Promise.all([dailyRequest, digestRequest]).then(function () {
      day.coverage = PD.computeCoverage(day.digest, day.papers, { invalidLines: day.invalidLines, dropped: day.dropped });
      day.crossCheck = PD.crossCheckDigest(day.digest, day.papers);
      return day;
    });
  }

  function loadRange(start, end) {
    const dates = state.availableDates.filter(function (date) { return date >= start && date <= end; });
    return Promise.all(dates.map(loadDay)).then(function () { return dates; });
  }

  /* ------------------------------ 顶栏与筛选 UI ------------------------------ */

  function renderNotice() {
    if (!refs.notice) return;
    dom.clear(refs.notice);
    const box = dom.el('div', { class: 'safety-notice' });
    const auth = dom.el('details', { class: 'notice-item' });
    auth.appendChild(dom.el('summary', { text: T.noticeNoAuthTitle }));
    auth.appendChild(dom.el('p', { text: T.noticeNoAuthBody }));
    box.appendChild(auth);
    const untrusted = dom.el('details', { class: 'notice-item' });
    untrusted.appendChild(dom.el('summary', { text: T.noticeUntrustedTitle }));
    untrusted.appendChild(dom.el('p', { text: T.noticeUntrustedBody }));
    box.appendChild(untrusted);
    refs.notice.appendChild(box);
  }

  function renderTopicNav() {
    if (!refs.categoryScroll) return;
    dom.clear(refs.categoryScroll);
    const counts = { all: 0, embodied: 0, surgical: 0 };
    const papers = currentDayPapers();
    papers.forEach(function (paper) {
      counts.all += 1;
      paper.topics.forEach(function (topic) {
        if (counts[topic] !== undefined) counts[topic] += 1;
      });
    });
    const all = dom.el('button', {
      class: 'category-button' + (state.topics === 'all' ? ' active' : ''),
      'data-topic': 'all',
      type: 'button'
    }, [dom.el('span', { text: T.filterAll }), dom.el('span', { class: 'category-count', text: String(counts.all) })]);
    all.addEventListener('click', function () { setTopic('all'); });
    refs.categoryScroll.appendChild(all);
    PD.TOPICS.forEach(function (topic) {
      const button = dom.el('button', {
        class: 'category-button' + (state.topics === topic ? ' active' : ''),
        'data-topic': topic,
        type: 'button'
      }, [dom.el('span', { text: i18n.topicLabel(topic) }), dom.el('span', { class: 'category-count', text: String(counts[topic]) })]);
      button.title = '按 topics 筛选（允许双主题命中，计数可重复）';
      button.addEventListener('click', function () { setTopic(topic); });
      refs.categoryScroll.appendChild(button);
    });
  }

  function setTopic(topic) {
    state.topics = topic;
    updateUrlParam('topic', topic === 'all' ? null : topic);
    renderTopicNav();
    renderFilterTags();
    renderPapers();
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
    renderPapers();
  }

  function toggleAuthor(author) {
    const index = state.authors.indexOf(author);
    if (index === -1) state.authors.push(author);
    else state.authors.splice(index, 1);
    renderFilterTags();
    renderPapers();
  }

  /* ------------------------------ 日期选择 ------------------------------ */

  function initDatePicker() {
    if (!refs.datepicker) return;
    const dates = state.availableDates;
    dom.clear(refs.datepicker);
    if (dates.length === 0) {
      refs.datepicker.appendChild(dom.el('p', { class: 'date-empty', text: T.fileListMissing }));
      return;
    }
    const min = dates[dates.length - 1];
    const max = dates[0];
    const single = dom.el('input', {
      type: 'date', id: 'dateSingle', class: 'native-date-input', min: min, max: max, value: max
    });
    single.addEventListener('change', function () {
      if (single.value && PD.isIsoDate(single.value)) {
        loadAndRenderSingle(single.value);
        closeDatePicker();
      }
    });
    refs.datepicker.appendChild(single);

    const rangeBox = dom.el('div', { class: 'native-range-inputs', id: 'rangeInputs' });
    rangeBox.style.setProperty('display', 'none');
    const start = dom.el('input', { type: 'date', id: 'dateRangeStart', class: 'native-date-input', min: min, max: max, value: min });
    const end = dom.el('input', { type: 'date', id: 'dateRangeEnd', class: 'native-date-input', min: min, max: max, value: max });
    const apply = dom.el('button', { type: 'button', class: 'button primary', id: 'applyRange', text: '应用区间' });
    apply.addEventListener('click', function () {
      const a = start.value;
      const b = end.value;
      if (!PD.isIsoDate(a) || !PD.isIsoDate(b)) return;
      const from = a <= b ? a : b;
      const to = a <= b ? b : a;
      loadAndRenderRange(from, to);
      closeDatePicker();
    });
    rangeBox.appendChild(start);
    rangeBox.appendChild(end);
    rangeBox.appendChild(apply);
    refs.datepicker.appendChild(rangeBox);
    refs.dateRangeBox = rangeBox;
    refs.dateSingle = single;
  }

  function toggleRangeMode() {
    const isRange = refs.dateRangeToggle && refs.dateRangeToggle.checked;
    if (refs.dateSingle) refs.dateSingle.style.setProperty('display', isRange ? 'none' : '');
    if (refs.dateRangeBox) refs.dateRangeBox.style.setProperty('display', isRange ? 'flex' : 'none');
  }

  function openDatePicker() {
    if (!refs.datePickerModal) return;
    refs.datePickerModal.classList.add('active');
    document.body.style.setProperty('overflow', 'hidden');
  }

  function closeDatePicker() {
    if (!refs.datePickerModal) return;
    refs.datePickerModal.classList.remove('active');
    document.body.style.setProperty('overflow', '');
  }

  /* ------------------------------ 渲染主流程 ------------------------------ */

  function currentDayPapers() {
    if (state.range) {
      let papers = [];
      state.range.dates.forEach(function (date) {
        const day = state.days[date];
        if (day) papers = papers.concat(day.papers);
      });
      return papers;
    }
    const day = state.days[state.currentDate];
    return day ? day.papers : [];
  }

  function renderPapers() {
    const day = state.days[state.currentDate];
    const papers = currentDayPapers();
    const filtered = PD.filterPapersByTopic(papers, state.topics);
    const ranked = PD.rankPapers(filtered, {
      keywords: state.keywords,
      authors: state.authors,
      text: state.text
    });
    state.currentPapers = ranked.map(function (item) { return item.paper; });
    const titleTerms = state.keywords.slice();
    if (state.text.trim() !== '') titleTerms.push(state.text.trim());
    PD.render.renderPaperList(refs.paperContainer, ranked, {
      view: state.view,
      topics: state.topics,
      titleTerms: titleTerms,
      authorTerms: state.authors.slice(),
      onOpen: function (paper) {
        const index = state.currentPapers.indexOf(paper);
        state.currentIndex = index < 0 ? 0 : index;
        openModal(paper, state.currentIndex);
      }
    });
    renderTopicNav();
  }

  function renderDaySummary(days) {
    if (!refs.digestContainer) return;
    if (days.length === 0) {
      dom.clear(refs.digestContainer);
      return;
    }
    if (days.length === 1) {
      const day = days[0];
      PD.render.renderDigest({ container: refs.digestContainer }, day.digest, day.coverage, day.crossCheck, function (id) {
        openByPaperId(id);
      });
      return;
    }
    // 区间视图：逐日列出计数与缺口，不把多天合并成一个伪造的“日报”。
    dom.clear(refs.digestContainer);
    const panel = dom.el('section', { class: 'digest-panel' });
    panel.appendChild(dom.el('h2', { class: 'digest-heading', text: '区间内逐日汇总（不含跨日合并总结）' }));
    const list = dom.el('ul', { class: 'range-day-list' });
    let total = 0;
    days.forEach(function (day) {
      total += day.coverage.publishedCount;
      const item = dom.el('li', { class: 'range-day-item' });
      item.appendChild(dom.el('span', { class: 'range-day-date', text: day.date }));
      item.appendChild(dom.el('span', { text: '已发布 ' + day.coverage.publishedCount + ' 篇' }));
      item.appendChild(dom.el('span', {
        class: 'range-day-digest',
        text: '日报：' + i18n.digestStatusLabel(day.digest.available ? day.digest.digest.status : 'unavailable')
      }));
      if (PD.hasAnyGap(day.coverage.gapReasons)) {
        item.appendChild(dom.el('span', { class: 'range-day-gap', text: '存在缺口' }));
      }
      item.addEventListener('click', function () { loadAndRenderSingle(day.date); });
      list.appendChild(item);
    });
    panel.appendChild(list);
    const missing = state.range && state.range.missing ? state.range.missing : [];
    if (missing.length > 0) {
      const gapBox = dom.el('div', { class: 'range-missing' });
      gapBox.appendChild(dom.el('p', { class: 'range-missing-title', text: T.rangeMissingDates }));
      const gapList = dom.el('ul', { class: 'range-missing-list' });
      missing.forEach(function (date) {
        gapList.appendChild(dom.el('li', { class: 'range-missing-item', text: date + ' · ' + T.rangeDayMissing }));
      });
      gapBox.appendChild(gapList);
      panel.appendChild(gapBox);
    } else {
      panel.appendChild(dom.el('p', { class: 'range-missing-none', text: T.rangeMissingNone }));
    }
    panel.appendChild(dom.el('p', { class: 'range-total', text: '区间合计（仅已发布样本）：' + total + ' 篇' }));
    refs.digestContainer.appendChild(panel);
  }

  function setCurrentDateLabel(text) {
    if (refs.currentDate) refs.currentDate.textContent = text;
  }

  function loadAndRenderSingle(date) {
    setCurrentDateLabel(date);
    if (refs.paperContainer) {
      dom.clear(refs.paperContainer);
      refs.paperContainer.appendChild(dom.el('div', { class: 'loading-container' }, [
        dom.el('div', { class: 'loading-spinner' }),
        dom.el('p', { text: T.loadingPapers })
      ]));
    }
    return loadDay(date).then(function (day) {
      state.range = null;
      state.currentDate = date;
      if (refs.dateSingle) refs.dateSingle.value = date;
      renderDaySummary([day]);
      if (day.papers.length === 0) {
        dom.clear(refs.paperContainer);
        refs.paperContainer.appendChild(dom.el('div', { class: 'loading-container' }, [
          dom.el('p', { text: day.dailyMissing ? T.dataFileFailed + day.date : T.noPapersForDate })
        ]));
        renderTopicNav();
        return;
      }
      renderPapers();
    }, function (error) {
      showLoadError(error);
    });
  }

  function loadAndRenderRange(start, end) {
    const range = PD.describeDateRange(start, end);
    if (!range.display) {
      setCurrentDateLabel('');
      return Promise.resolve();
    }
    setCurrentDateLabel(range.display);
    // 区间内没有数据的日期必须显式列为缺口（不能跳过或当 0 篇）。
    state.rangeMissingDates = PD.expandDateRange(start, end, state.availableDates).missing;
    return loadRange(start, end).then(function (dates) {
      if (dates.length === 0) {
        if (refs.paperContainer) {
          dom.clear(refs.paperContainer);
          refs.paperContainer.appendChild(dom.el('div', { class: 'loading-container' }, [
            dom.el('p', { text: T.noPapersForRange })
          ]));
        }
        return;
      }
      state.range = { start: start, end: end, dates: dates, missing: state.rangeMissingDates || [] };
      state.currentDate = dates[0];
      renderDaySummary(dates.map(function (date) { return state.days[date]; }));
      renderPapers();
    }, function (error) {
      showLoadError(error);
    });
  }

  function showLoadError(error) {
    if (!refs.paperContainer) return;
    dom.clear(refs.paperContainer);
    const box = dom.el('div', { class: 'loading-container' });
    box.appendChild(dom.el('p', { text: T.loadFailedTitle }));
    box.appendChild(dom.el('p', { text: T.loadFailedDetail + (error && error.message ? error.message : '') }));
    refs.paperContainer.appendChild(box);
  }

  /* ------------------------------ 模态框 ------------------------------ */

  function openModal(paper, index) {
    state.currentIndex = index;
    const day = state.days[paper.fileDate] || state.days[state.currentDate];
    const cited = !!(day && day.crossCheck && day.crossCheck.citedIds.indexOf(paper.id) !== -1);
    const titleTerms = state.keywords.slice();
    if (state.text.trim() !== '') titleTerms.push(state.text.trim());
    PD.render.renderPaperModal(refs, paper, {
      index: index + 1,
      total: state.currentPapers.length,
      titleTerms: titleTerms,
      cited: cited
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
    let index = state.currentIndex + step;
    if (index < 0) index = state.currentPapers.length - 1;
    if (index >= state.currentPapers.length) index = 0;
    openModal(state.currentPapers[index], index);
  }

  function showRandomPaper() {
    if (state.currentPapers.length === 0) return;
    const index = Math.floor(Math.random() * state.currentPapers.length);
    openModal(state.currentPapers[index], index);
    const indicator = dom.el('div', { class: 'random-paper-indicator', text: 'Random Paper' });
    document.body.appendChild(indicator);
    setTimeout(function () { indicator.remove(); }, 3000);
  }

  function openByPaperId(id) {
    const index = state.currentPapers.findIndex(function (paper) { return paper.id === id; });
    if (index === -1) {
      const all = currentDayPapers();
      const fallback = all.findIndex(function (paper) { return paper.id === id; });
      if (fallback === -1) return;
      openModal(all[fallback], fallback);
      return;
    }
    openModal(state.currentPapers[index], index);
  }

  /* ------------------------------ 事件绑定 ------------------------------ */

  function bindEvents() {
    if (refs.calendarButton) refs.calendarButton.addEventListener('click', function (event) {
      event.stopPropagation();
      openDatePicker();
    });
    if (refs.datePickerModal) refs.datePickerModal.addEventListener('click', function (event) {
      if (event.target === refs.datePickerModal) closeDatePicker();
    });
    if (refs.datePickerContent) refs.datePickerContent.addEventListener('click', function (event) {
      event.stopPropagation();
    });
    if (refs.dateRangeToggle) refs.dateRangeToggle.addEventListener('change', toggleRangeMode);
    if (refs.closeModal) refs.closeModal.addEventListener('click', closeModal);
    if (refs.modal) refs.modal.addEventListener('click', function (event) {
      if (event.target === refs.modal) closeModal();
    });

    document.addEventListener('keydown', function (event) {
      const active = document.activeElement;
      const isInputFocused = !!active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
      if (event.key === 'Escape') {
        if (refs.modal && refs.modal.classList.contains('active')) closeModal();
        else if (refs.datePickerModal && refs.datePickerModal.classList.contains('active')) closeDatePicker();
      } else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && refs.modal && refs.modal.classList.contains('active')) {
        event.preventDefault();
        navigate(event.key === 'ArrowLeft' ? -1 : 1);
      } else if ((event.key === ' ' || event.key === 'Spacebar') && !isInputFocused &&
                 !(refs.datePickerModal && refs.datePickerModal.classList.contains('active'))) {
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
        renderPapers();
      });
      refs.searchClear.addEventListener('click', function (event) {
        event.stopPropagation();
        refs.searchInput.value = '';
        state.text = '';
        refs.searchClear.style.setProperty('display', 'none');
        refs.searchWrapper.style.setProperty('display', 'none');
        renderPapers();
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
    refs.calendarButton = document.getElementById('calendarButton');
    refs.datePickerModal = document.getElementById('datePickerModal');
    refs.datePickerContent = document.querySelector('.date-picker-content');
    refs.datepicker = document.getElementById('datepicker');
    refs.dateRangeToggle = document.getElementById('dateRangeMode');
    refs.paperContainer = document.getElementById('paperContainer');
    refs.digestContainer = document.getElementById('digestPanel');
    refs.notice = document.getElementById('safetyNotice');
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
    refs.pdfLink = document.getElementById('pdfLink');
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
    renderNotice();
    mountCopyButton();
    bindEvents();

    const params = new URLSearchParams(window.location.search);
    const topicParam = params.get('topic');
    if (topicParam && PD.TOPICS.indexOf(topicParam) !== -1) state.topics = topicParam;

    const prefs = PD.prefs.createPreferences();
    state.keywords = prefs.read('keywords');
    state.authors = prefs.read('authors');
    renderFilterTags();

    loadFileList().then(function (fileList) {
      if (fileList.error === 'missing') {
        setCurrentDateLabel('无数据');
        dom.clear(refs.paperContainer);
        refs.paperContainer.appendChild(dom.el('div', { class: 'loading-container' }, [
          dom.el('p', { text: T.fileListMissing })
        ]));
        return;
      }
      initDatePicker();
      if (state.availableDates.length === 0) {
        setCurrentDateLabel('无数据');
        dom.clear(refs.paperContainer);
        refs.paperContainer.appendChild(dom.el('div', { class: 'loading-container' }, [
          dom.el('p', { text: T.noPapersForDate })
        ]));
        return;
      }
      loadAndRenderSingle(state.availableDates[0]);
    });
  }

  // 供浏览器验收/调试读取（只读快照，不含私有数据）。
  window.PD_APP_STATE = function () {
    return {
      dates: state.availableDates.slice(),
      currentDate: state.currentDate || null,
      range: state.range ? { start: state.range.start, end: state.range.end } : null,
      topics: state.topics,
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
