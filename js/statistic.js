/**
 * ResearcherPapers 统计页逻辑：已收录样本的关键词与趋势。
 *
 * 来源与变更声明 / Provenance notice:
 *   本文件由上游 daily-arXiv-ai-enhanced
 *   （main 01fdad3b0aec2d2f7977b686253a7b0c1c8273dc，Modified Apache License，
 *   参考 .upstream/daily-arxiv/web/js/statistic.js，许可证副本见
 *   docs/licenses/daily-arxiv-LICENSE）改写而来：页头、日期选择、关键词列表、
 *   趋势图与相关论文侧栏的阅读结构沿用上游，版权与许可归属上游原作者。
 *   主要变更：
 *     1. 数据源改本站相对目录，删除 GitHub API 星数与语言探测；
 *     2. 删除 d3 / d3-cloud / compromise / chart.js，改用内置 SVG 与 pd-stat 计算；
 *     3. 只统计已收录样本：缺失日期不补 0、不插值，缺口日期显式列出；
 *     4. 全部改用 DOM API 构建（原模板字符串 innerHTML 注入面已消除）；
 *     5. 删除登录守卫与屏幕尺寸警告的 innerHTML 写法；
 *     6. 精简：口径一句话，缺口提示改短句；公开导出不转载原摘要时侧栏显示来源提示；
 *     7. 2026-10 阅读改版：侧栏卡片与首页一致，不再显示主题标签（统计页也没有
 *        “全部”主题选项）；日期选择保留在统计页（统计需要区间），首页已改为连续 feed。
 *   本文件为衍生代码，许可遵循 docs/licenses/daily-arxiv-LICENSE。
 */
(function () {
  'use strict';

  const PD = window.PD;
  const dom = PD.dom;
  const T = PD.i18n.TEXT;

  const state = {
    availableDates: [],
    loaded: {},      // date -> {papers, invalidLines, dropped, missing}
    gaps: [],        // 请求了但没有数据的日期
    papers: [],      // 当前区间的全部论文（去重按 id+date）
    stats: null,
    range: null
  };

  const refs = {};

  function fetchRelative(path) {
    return fetch(path, { credentials: 'same-origin' }).then(function (response) {
      if (!response.ok) {
        const error = new Error('HTTP ' + response.status);
        error.status = response.status;
        throw error;
      }
      return response.text();
    });
  }

  function loadFileList() {
    return fetchRelative(PD.FILE_LIST_PATH).then(function (text) {
      const parsed = PD.parseFileList(text);
      state.availableDates = parsed.dates.slice();
      return parsed;
    }, function () {
      state.availableDates = [];
      return PD.parseFileList('');
    });
  }

  function loadDate(date) {
    if (state.loaded[date]) return Promise.resolve(state.loaded[date]);
    const record = { date: date, papers: [], invalidLines: 0, dropped: 0, missing: false };
    state.loaded[date] = record;
    return fetchRelative(PD.dailyFilePath(date, 'Chinese')).then(function (text) {
      const parsed = PD.parseJsonl(text, { fileDate: date });
      record.papers = parsed.papers;
      record.invalidLines = parsed.invalidLines;
      record.dropped = parsed.dropped;
      return record;
    }, function () {
      // 该日期没有数据：记录为缺口，绝不当成 0 篇参与统计。
      record.missing = true;
      return record;
    });
  }

  function loadRange(start, end) {
    const dates = state.availableDates.filter(function (date) { return date >= start && date <= end; });
    return Promise.all(dates.map(loadDate)).then(function () { return dates; });
  }

  /* ------------------------------ 日期选择 ------------------------------ */

  function initDatePicker() {
    if (!refs.datepicker) return;
    dom.clear(refs.datepicker);
    if (state.availableDates.length === 0) {
      refs.datepicker.appendChild(dom.el('p', { class: 'date-empty', text: T.fileListMissing }));
      return;
    }
    const min = state.availableDates[state.availableDates.length - 1];
    const max = state.availableDates[0];
    const single = dom.el('input', { type: 'date', id: 'statDateSingle', class: 'native-date-input', min: min, max: max, value: max });
    single.addEventListener('change', function () {
      if (single.value) {
        run(single.value, single.value);
        closeDatePicker();
      }
    });
    refs.datepicker.appendChild(single);
    const rangeBox = dom.el('div', { class: 'native-range-inputs' });
    rangeBox.style.setProperty('display', 'none');
    const startInput = dom.el('input', { type: 'date', class: 'native-date-input', min: min, max: max, value: min });
    const endInput = dom.el('input', { type: 'date', class: 'native-date-input', min: min, max: max, value: max });
    const apply = dom.el('button', { type: 'button', id: 'applyRange', class: 'button primary', text: '应用区间' });
    apply.addEventListener('click', function () {
      const a = startInput.value;
      const b = endInput.value;
      if (!PD.isIsoDate(a) || !PD.isIsoDate(b)) return;
      run(a <= b ? a : b, a <= b ? b : a);
      closeDatePicker();
    });
    rangeBox.appendChild(startInput);
    rangeBox.appendChild(endInput);
    rangeBox.appendChild(apply);
    refs.datepicker.appendChild(rangeBox);
    refs.dateSingle = single;
    refs.rangeBox = rangeBox;
  }

  function toggleRangeMode() {
    const isRange = refs.dateRangeToggle && refs.dateRangeToggle.checked;
    if (refs.dateSingle) refs.dateSingle.style.setProperty('display', isRange ? 'none' : '');
    if (refs.rangeBox) refs.rangeBox.style.setProperty('display', isRange ? 'flex' : 'none');
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

  /* ------------------------------ 渲染 ------------------------------ */

  function renderSummary() {
    const stats = state.stats;
    const container = refs.list;
    dom.clear(container);
    const section = dom.el('div', { class: 'statistics-section' });
    section.appendChild(dom.el('h2', { text: T.statTitle }));

    const statsCard = dom.el('div', { class: 'statistics-card' });
    const summary = dom.el('div', { class: 'summary-stats' });
    summary.appendChild(dom.el('h3', { text: T.statPublishedCount + ' ' + stats.counts.total + ' ' + T.statUnit }));
    const knownDates = Object.keys(stats.counts.byDate);
    if (knownDates.length > 0) {
      const list = dom.el('ul', { class: 'paper-count-list' });
      knownDates.forEach(function (date) {
        const item = dom.el('li', { text: date + '：' + stats.counts.byDate[date] + ' ' + T.statUnit });
        item.addEventListener('click', function () { run(date, date); });
        list.appendChild(item);
      });
      summary.appendChild(list);
    } else {
      summary.appendChild(dom.el('p', { text: T.statNoData }));
    }
    if (state.gaps.length > 0) {
      summary.appendChild(dom.el('p', {
        class: 'stat-gap-note',
        text: T.statGapNote + state.gaps.join(', ')
      }));
    }
    if (stats.gaps.emptyDates.length > 0) {
      summary.appendChild(dom.el('p', {
        class: 'stat-gap-note',
        text: T.statEmptyNote + stats.gaps.emptyDates.join(', ')
      }));
    }
    statsCard.appendChild(summary);
    section.appendChild(statsCard);

    // 关键词列表（沿用上游 .keyword-item 结构）
    section.appendChild(dom.el('h2', { text: T.statKeywordTitle }));
    const cloudCard = dom.el('div', { class: 'statistics-card' });
    if (stats.cloud.length === 0) {
      cloudCard.appendChild(dom.el('p', { class: 'no-data', text: T.statNoData }));
    } else {
      const list = dom.el('div', { class: 'keyword-list' });
      stats.cloud.slice(0, 30).forEach(function (item, index) {
        const row = dom.el('div', { class: 'keyword-item', role: 'button', tabindex: '0', 'data-keyword': item.text });
        row.appendChild(dom.el('span', { class: 'keyword-rank', text: String(index + 1) }));
        row.appendChild(dom.el('span', { class: 'keyword-text', text: item.text }));
        row.appendChild(dom.el('span', { class: 'keyword-count', text: String(item.count) }));
        row.addEventListener('click', function () { showRelatedPapers(item.text); });
        list.appendChild(row);
      });
      cloudCard.appendChild(list);
    }
    section.appendChild(cloudCard);

    // 词云（内置 SVG 布局，无 canvas/外部库）
    if (stats.cloud.length > 0) {
      const layout = PD.stat.layoutCloud(stats.cloud, { width: 900, height: 320 });
      const svg = dom.el('svg', { class: 'stat-svg cloud-svg', viewBox: '0 0 900 320', width: '900', height: '320', role: 'img', 'aria-label': '关键词云' });
      layout.forEach(function (word) {
        const group = dom.el('g', { class: 'cloud-word', 'data-keyword': word.text });
        const node = dom.el('text', {
          x: String(Math.round(word.x)),
          y: String(Math.round(word.y + word.size)),
          'font-size': String(word.size),
          text: word.text
        });
        group.appendChild(node);
        group.appendChild(dom.el('title', { text: word.text + '（' + word.count + '）' }));
        group.addEventListener('click', function () { showRelatedPapers(word.text); });
        svg.appendChild(group);
      });
      const cloudWrap = dom.el('div', { class: 'stat-chart-wrapper' }, [svg]);
      section.appendChild(cloudWrap);
      if (layout.skipped && layout.skipped.length > 0) {
        // 宁可少画几个词，也不让文字互相压住；完整关键词仍在上方列表里。
        cloudWrap.appendChild(dom.el('p', {
          class: 'cloud-skip-note',
          text: PD.i18n.formatTemplate(T.statCloudSkip, { n: layout.skipped.length })
        }));
      }
    }

    // 趋势图：只画真实存在的日期点，缺失日期不插值。
    const multiDate = Object.keys(stats.counts.byDate).length > 1;
    if (multiDate && stats.trends.length > 0) {
      section.appendChild(dom.el('h2', { class: 'trend-title', text: T.statTrendTitle }));
      section.appendChild(dom.el('p', { class: 'digest-notice', text: T.statTrendHint }));
      const chartWrap = dom.el('div', { class: 'stat-chart-wrapper' });
      chartWrap.appendChild(buildTrendSvg(stats));
      section.appendChild(chartWrap);
    } else {
      section.appendChild(dom.el('p', { class: 'digest-notice', text: T.statTrendUnavailable }));
    }

    container.appendChild(section);
  }

  /** 轻量折线图：viewBox 自适应，x 轴只标真实日期。 */
  function buildTrendSvg(stats) {
    const width = 900;
    const height = 360;
    const margin = { top: 20, right: 160, bottom: 60, left: 50 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const dates = Object.keys(stats.counts.byDate).filter(function (date) { return stats.counts.byDate[date] > 0; }).sort();
    const maxCount = stats.trends.reduce(function (max, trend) {
      return trend.points.reduce(function (inner, point) { return Math.max(inner, point.count); }, max);
    }, 1);
    const colors = ['#4e79a7', '#f28e2c', '#59a14f', '#e15759', '#76b7b2', '#edc949', '#af7aa1', '#ff9da7', '#9c755f', '#bab0ab'];
    const svg = dom.el('svg', {
      class: 'stat-svg trend-svg',
      viewBox: '0 0 ' + width + ' ' + height,
      width: String(width),
      height: String(height),
      role: 'img',
      'aria-label': T.statTrendTitle
    });
    const plot = dom.el('g', { transform: 'translate(' + margin.left + ',' + margin.top + ')' });
    const xAt = function (index) {
      if (dates.length <= 1) return innerW / 2;
      return (innerW * index) / (dates.length - 1);
    };
    const yAt = function (count) {
      return innerH - (innerH * count) / Math.max(1, maxCount);
    };
    // 坐标轴
    plot.appendChild(dom.el('line', { class: 'axis-line', x1: '0', y1: String(innerH), x2: String(innerW), y2: String(innerH) }));
    plot.appendChild(dom.el('line', { class: 'axis-line', x1: '0', y1: '0', x2: '0', y2: String(innerH) }));
    // x 轴标签（最多 8 个，避免重叠）
    const step = Math.max(1, Math.ceil(dates.length / 8));
    dates.forEach(function (date, index) {
      if (index % step !== 0 && index !== dates.length - 1) return;
      plot.appendChild(dom.el('text', {
        class: 'axis-label',
        x: String(Math.round(xAt(index))),
        y: String(innerH + 18),
        'text-anchor': 'middle',
        text: date.slice(5)
      }));
    });
    // y 轴刻度
    [0, Math.round(maxCount / 2), maxCount].forEach(function (tick) {
      plot.appendChild(dom.el('text', {
        class: 'axis-label',
        x: '-8',
        y: String(Math.round(yAt(tick)) + 4),
        'text-anchor': 'end',
        text: String(tick)
      }));
    });
    stats.trends.forEach(function (trend, index) {
      const color = colors[index % colors.length];
      const points = trend.points.map(function (point) {
        const dateIndex = dates.indexOf(point.date);
        if (dateIndex === -1) return null;
        return Math.round(xAt(dateIndex)) + ',' + Math.round(yAt(point.count));
      }).filter(Boolean);
      if (points.length > 1) {
        plot.appendChild(dom.el('polyline', {
          class: 'series-line',
          points: points.join(' '),
          stroke: color
        }));
      }
      trend.points.forEach(function (point) {
        const dateIndex = dates.indexOf(point.date);
        if (dateIndex === -1) return;
        const dot = dom.el('circle', {
          cx: String(Math.round(xAt(dateIndex))),
          cy: String(Math.round(yAt(point.count))),
          r: '3',
          fill: color
        });
        dot.appendChild(dom.el('title', { text: trend.keyword + ' @ ' + point.date + '：' + point.count }));
        plot.appendChild(dot);
      });
      // 图例（保留上游“图例在右侧”的布局）
      const legend = dom.el('g', { transform: 'translate(' + (innerW + 20) + ',' + (index * 22) + ')' });
      legend.appendChild(dom.el('rect', { x: '0', y: '0', width: '14', height: '14', fill: color, opacity: '0.8' }));
      legend.appendChild(dom.el('text', { class: 'axis-label', x: '20', y: '12', text: trend.keyword }));
      plot.appendChild(legend);
    });
    svg.appendChild(plot);
    return svg;
  }

  function showRelatedPapers(keyword) {
    const sidebar = document.getElementById('paperSidebar');
    const selected = document.getElementById('selectedKeyword');
    const container = document.getElementById('relatedPapers');
    if (!sidebar || !container) return;
    if (selected) selected.textContent = '关键词：' + keyword;
    const related = PD.stat.papersForKeyword(state.papers, keyword);
    dom.clear(container);
    if (related.length === 0) {
      container.appendChild(dom.el('p', { text: T.statRelatedNone }));
    } else {
      related.forEach(function (paper, index) {
        const card = dom.el('div', { class: 'paper-card' });
        card.appendChild(dom.el('div', { class: 'paper-number', text: String(index + 1) }));
        const titleLink = dom.externalLink(paper.links.abs, paper.title, 'paper-title');
        if (titleLink) {
          card.appendChild(titleLink);
        } else {
          card.appendChild(dom.el('span', { class: 'paper-title', text: paper.title }));
        }
        card.appendChild(dom.el('div', {
          class: 'paper-authors',
          text: paper.authors.length ? paper.authors.join(', ') : '作者未标注'
        }));
        // 主题不再作为卡片标签展示（与首页一致）；统计页也没有“全部”主题选项。
        const titleBasis = PD.paperIsTitleBasis ? PD.paperIsTitleBasis(paper) : paper.aiBasis === 'title';
        const summaryText = paper.ai.tldr && paper.ai.tldr.trim() !== ''
          ? paper.ai.tldr
          : (PD.hasPublicAbstract(paper) ? paper.abstract : '');
        // 标题级卡没有摘要分析：没有真实摘要就不铺“原摘要请见…”占位（与首页同规则）。
        if (summaryText !== '' || !titleBasis) {
          card.appendChild(dom.el('div', { class: 'paper-summary', text: summaryText || T.abstractLinkNote }));
        }
        container.appendChild(card);
      });
    }
    sidebar.classList.add('active');
  }

  function closeSidebar() {
    const sidebar = document.getElementById('paperSidebar');
    if (sidebar) sidebar.classList.remove('active');
  }

  /* ------------------------------ 主流程 ------------------------------ */

  function run(start, end) {
    const range = PD.describeDateRange(start, end);
    if (!range.display) return Promise.resolve();
    if (refs.currentDate) refs.currentDate.textContent = range.display;
    dom.clear(refs.list);
    refs.list.appendChild(dom.el('div', { class: 'loading-container' }, [
      dom.el('div', { class: 'loading-spinner' }),
      dom.el('p', { text: T.loadingPapers })
    ]));
    return loadRange(start, end).then(function (dates) {
      /*
       * 缺口 = ① 文件清单里有、但读取失败的日期；② 区间内根本没有发布文件的日期
       * （例如 file-list 只有 10-12/10-14，区间 10-12..10-14 时 10-13 必须显式列出）。
       * 与首页一致地使用 PD.expandDateRange，缺日不得被静默跳过或当 0 篇。
       */
      const failedDates = dates.filter(function (date) { return state.loaded[date].missing; });
      const absentDates = PD.expandDateRange(start, end, state.availableDates).missing;
      state.gaps = failedDates.concat(absentDates.filter(function (date) {
        return failedDates.indexOf(date) === -1;
      }));
      if (dates.length === 0) {
        // 区间内没有任何已发布日期：仍要展示缺口清单，而不是只说“没有论文”。
        state.papers = [];
        state.range = range;
        state.stats = PD.stat.computeStatistics([], { maxTerms: 30, trendTerms: 10 });
        renderSummary();
        return;
      }
      const samples = [];
      const papers = [];
      dates.forEach(function (date) {
        const record = state.loaded[date];
        if (record.missing) return;
        samples.push({ date: date, papers: record.papers });
        record.papers.forEach(function (paper) { papers.push(paper); });
      });
      state.papers = papers;
      state.range = range;
      state.stats = PD.stat.computeStatistics(samples, { maxTerms: 30, trendTerms: 10 });
      renderSummary();
    }, function (error) {
      dom.clear(refs.list);
      refs.list.appendChild(dom.el('div', { class: 'loading-container' }, [
        dom.el('p', { text: T.loadFailedTitle })
      ]));
    });
  }

  function collectRefs() {
    refs.currentDate = document.getElementById('currentDate');
    refs.calendarButton = document.getElementById('calendarButton');
    refs.datePickerModal = document.getElementById('datePickerModal');
    refs.datePickerContent = document.querySelector('.date-picker-content');
    refs.datepicker = document.getElementById('datepicker');
    refs.dateRangeToggle = document.getElementById('dateRangeMode');
    refs.list = document.getElementById('papersList');
    refs.sidebar = document.getElementById('paperSidebar');
  }

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
    const closeButton = document.querySelector('.close-sidebar');
    if (closeButton) closeButton.addEventListener('click', closeSidebar);
    document.addEventListener('click', function (event) {
      const sidebar = refs.sidebar;
      if (!sidebar || !sidebar.classList.contains('active')) return;
      const inside = sidebar.contains(event.target);
      const onKeyword = event.target.closest && (event.target.closest('.keyword-item') || event.target.closest('.cloud-word'));
      if (!inside && !onKeyword) closeSidebar();
    });
  }

  function bootstrap() {
    collectRefs();
    bindEvents();
    loadFileList().then(function () {
      initDatePicker();
      if (state.availableDates.length === 0) {
        if (refs.currentDate) refs.currentDate.textContent = '无数据';
        dom.clear(refs.list);
        refs.list.appendChild(dom.el('p', { class: 'no-data', text: T.fileListMissing }));
        return;
      }
      run(state.availableDates[0], state.availableDates[0]);
    });
  }

  window.PD_STAT_STATE = function () {
    return {
      dates: state.availableDates.slice(),
      gaps: state.gaps.slice(),
      papers: state.papers.length,
      keywords: state.stats ? state.stats.cloud.length : 0,
      requests: 1 + Object.keys(state.loaded).length
    };
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
