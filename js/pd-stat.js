/**
 * ResearcherPapers 统计计算层（零依赖，可离线在 Node 中测试）。
 *
 * 来源与变更声明 / Provenance notice:
 *   本文件由上游 daily-arXiv-ai-enhanced
 *   （main 01fdad3b0aec2d2f7977b686253a7b0c1c8273dc，Modified Apache License，
 *   参考 .upstream/daily-arxiv，许可证副本见 docs/licenses/daily-arxiv-LICENSE）
 *   的 web/js/statistic.js 中 extractKeywords（依赖外部 compromise 库）、
 *   关键词云与趋势数据准备逻辑改写而来。
 *   变更：
 *     1. 删除 compromise / d3 / chart.js 依赖，改为内置 n-gram 抽取与频次计算；
 *     2. 只统计“已收录样本”：缺失日期不补 0、不插值，并显式返回缺口列表；
 *     3. 不产生 HTML 字符串，输出纯数据结构供 pd-stat 渲染。
 *   本文件为衍生代码，许可遵循 docs/licenses/daily-arxiv-LICENSE。
 */
(function (root) {
  'use strict';

  const PD = root.PD = root.PD || {};

  const STOP_WORDS = [
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'our',
    'their', 'its', 'can', 'use', 'using', 'used', 'based', 'via', 'towards', 'toward',
    'method', 'methods', 'approach', 'approaches', 'model', 'models', 'system', 'systems',
    'framework', 'frameworks', 'result', 'results', 'show', 'shows', 'demonstrate',
    'demonstrates', 'experiment', 'experiments', 'experimental', 'evaluation',
    'performance', 'state', 'art', 'sota', 'dataset', 'datasets', 'task', 'tasks',
    'learning', 'neural', 'network', 'networks', 'deep', 'machine', 'artificial',
    'intelligence', 'paper', 'propose', 'proposed', 'novel', 'new', 'also', 'more',
    'than', 'into', 'such', 'which', 'while', 'when', 'where', 'however', 'thus',
    'have', 'has', 'been', 'not', 'but', 'all', 'any', 'out', 'not', 'other'
  ];

  const STOP_SET = {};
  STOP_WORDS.forEach(function (word) { STOP_SET[word] = true; });

  /** 标题分词：只保留长度 >2 的拉丁词/数字，中文连续片段整体保留。 */
  function tokenize(text) {
    if (typeof text !== 'string' || text.trim() === '') return [];
    const normalized = text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ');
    return normalized.split(' ').filter(function (token) {
      if (token === '') return false;
      if (/^[0-9]+$/.test(token)) return false;
      return token.length > 2;
    });
  }

  /**
   * 从标题抽取 1–2 元短语。与上游 extractKeywords 的差异：
   * 去掉词数上限 3 的多词组合（噪声大），保留单字英文词过滤与停用词过滤。
   */
  function extractTerms(text, options) {
    const opts = options || {};
    const maxGram = opts.maxGram || 2;
    const tokens = tokenize(text).filter(function (token) { return !STOP_SET[token]; });
    const terms = {};
    for (let size = 1; size <= maxGram; size += 1) {
      for (let i = 0; i + size <= tokens.length; i += 1) {
        const parts = tokens.slice(i, i + size);
        if (parts.some(function (part) { return STOP_SET[part]; })) continue;
        const phrase = parts.join(' ');
        terms[phrase] = true;
      }
    }
    return Object.keys(terms);
  }

  /**
   * 跨日统计：只统计传入的样本（缺日期不补 0）。
   * samples: [{date, papers:[normalizedPaper]}]
   * 返回 {cloud:[{text,count,size}], trends:[{keyword,points:[{date,count}]}],
   *       counts:{total,byDate:{date:count}}, gaps:{missingDates,emptyDates}}
   */
  function computeStatistics(samples, options) {
    const opts = options || {};
    const maxTerms = opts.maxTerms || 30;
    const trendTerms = opts.trendTerms || 10;
    const list = Array.isArray(samples) ? samples : [];
    const byDate = {};
    const overall = {};
    const perDate = {};
    const emptyDates = [];

    list.forEach(function (sample) {
      const date = sample && sample.date;
      if (typeof date !== 'string' || date === '') return;
      const papers = Array.isArray(sample.papers) ? sample.papers : [];
      byDate[date] = papers.length;
      perDate[date] = {};
      if (papers.length === 0) emptyDates.push(date);
      papers.forEach(function (paper) {
        const terms = extractTerms(paper.title, { maxGram: opts.maxGram || 2 });
        const seen = {};
        terms.forEach(function (term) {
          if (seen[term]) return;
          seen[term] = true;
          // 多词短语权重更高：与上游 extractKeywords 的 1.5x 意图一致，
          // 这里用整数计数实现（1 篇多词命中记 2 分），避免浮点排序歧义。
          overall[term] = (overall[term] || 0) + (term.indexOf(' ') !== -1 ? 2 : 1);
          perDate[date][term] = (perDate[date][term] || 0) + 1;
        });
      });
    });

    // 只保留出现 >=2 次（或样本极少时出现 >=1 次）的短语，避免一次性噪声。
    const minCount = Number.isFinite(opts.minCount) ? opts.minCount : (list.length > 1 ? 2 : 1);
    const ranked = Object.keys(overall)
      .filter(function (term) { return overall[term] >= minCount; })
      .sort(function (a, b) {
        if (overall[b] !== overall[a]) return overall[b] - overall[a];
        return a < b ? -1 : 1;
      })
      .slice(0, maxTerms);

    const maxObserved = ranked.length > 0 ? overall[ranked[0]] : 1;
    const cloud = ranked.map(function (term) {
      const ratio = overall[term] / maxObserved;
      return { text: term, count: overall[term], size: Math.round(12 + ratio * 32) };
    });

    // 趋势：只使用真实存在的日期点；某日期没有该关键词就记 0（该日期确有样本），
    // 完全不存在的日期不会出现在 points 中（不是 0，而是缺口）。
    const dates = Object.keys(byDate).sort();
    const trends = ranked.slice(0, trendTerms).map(function (term) {
      const points = dates.filter(function (date) { return byDate[date] > 0; }).map(function (date) {
        return { date: date, count: perDate[date][term] || 0 };
      });
      return { keyword: term, points: points };
    });

    return {
      cloud: cloud,
      trends: trends,
      dates: dates,
      counts: { total: Object.keys(byDate).reduce(function (sum, date) { return sum + byDate[date]; }, 0), byDate: byDate },
      gaps: { emptyDates: emptyDates, dateCount: dates.length }
    };
  }

  /** 关键词 → 相关论文（标题/摘要字面匹配，大小写不敏感）。 */
  function papersForKeyword(papers, keyword) {
    const list = Array.isArray(papers) ? papers : [];
    const needle = typeof keyword === 'string' ? keyword.trim().toLowerCase() : '';
    if (needle === '') return [];
    return list.filter(function (paper) {
      const hay = ((paper.title || '') + ' ' + (paper.abstract || '')).toLowerCase();
      return hay.indexOf(needle) !== -1;
    });
  }

  /**
   * 保守估宽：CJK/全角字符按 1em，拉丁字母与数字按 0.62em，再留固定 padding。
   * 宁可高估（少放几个词），也不要低估导致文字互相压住。
   */
  function estimateTextWidth(text, size) {
    const value = String(text === null || text === undefined ? '' : text);
    let units = 0;
    for (let i = 0; i < value.length; i += 1) {
      units += value.charCodeAt(i) > 0x2e7f ? 1 : 0.62;
    }
    return units * size;
  }

  /**
   * 简易词云布局：按频次降序螺旋排布，矩形不重叠。
   * 关键约束：**找不到不重叠位置就跳过该词**（placed.skipped 记录），
   * 而不是强行放置导致文字重叠。关键词列表仍全量展示，统计信息不丢。
   * 不使用 canvas/measureText，宽度按字号与字符类别保守估算。
   */
  function layoutCloud(cloud, options) {
    const opts = options || {};
    const width = opts.width || 800;
    const height = opts.height || 320;
    const placed = [];
    const skipped = [];
    const cx = width / 2;
    const cy = height / 2;
    (Array.isArray(cloud) ? cloud : []).forEach(function (item, index) {
      const size = item.size || 14;
      const w = Math.max(24, estimateTextWidth(item.text, size) + 6);
      const h = size * 1.4;
      let angle = index * 0.7;
      let radius = 0;
      let found = null;
      for (let attempt = 0; attempt < 600 && found === null; attempt += 1) {
        const rawX = cx + Math.cos(angle) * radius - w / 2;
        const rawY = cy + Math.sin(angle) * radius * 0.55 - h / 2;
        // 越界位置直接跳过：夹取到边界会制造"假的不重叠"。
        if (rawX >= 2 && rawY >= 2 && rawX + w <= width - 2 && rawY + h <= height - 2) {
          const overlaps = placed.some(function (other) {
            return !(rawX + w < other.x || other.x + other.w < rawX ||
                     rawY + h < other.y || other.y + other.h < rawY);
          });
          if (!overlaps) found = { x: rawX, y: rawY };
        }
        angle += 0.9;
        radius += 3.5;
      }
      if (found === null) {
        skipped.push(item.text);
        return;
      }
      placed.push({ text: item.text, count: item.count, size: size, x: found.x, y: found.y, w: w, h: h });
    });
    // 数组附带 skipped（不改变返回类型，调用方可选使用）。
    placed.skipped = skipped;
    return placed;
  }

  PD.stat = {
    tokenize: tokenize,
    extractTerms: extractTerms,
    computeStatistics: computeStatistics,
    papersForKeyword: papersForKeyword,
    layoutCloud: layoutCloud,
    estimateTextWidth: estimateTextWidth,
    STOP_WORDS: STOP_WORDS
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
