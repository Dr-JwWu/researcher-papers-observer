/**
 * ResearcherPapers 前端文案层（仅中文界面；不联网、不依赖 i18n 库）。
 *
 * 来源与变更声明 / Provenance notice:
 *   新建文件，不含上游代码。上游 daily-arXiv-ai-enhanced
 *   （main 01fdad3b0aec2d2f7977b686253a7b0c1c8273dc，Modified Apache License，
 *   见 docs/licenses/daily-arxiv-LICENSE）原页面为英文且带语言探测。
 *   变更：固定中文文案；删除 English/Chinese 语言回退与 flatpickr 相关文案；
 *   新增日期精度、来源、主题、AI 依据（abstract）等必须如实说明的文案。
 *   2026-10 精简：删除“无访问控制/不可信数据”安全横幅、research_scope 工程口径、
 *   候选/取回/缺元数据/错误计数、结构自洽诊断与重复免责声明；正文改为
 *   “收录 N 篇 / N 篇待审核 / 部分来源暂不可用 / 本期 arXiv 来源暂缺 /
 *   总结尚不完整 / 暂无总结”这类短句（同一时刻最多一条来源状态）。
 *   本文件不重新授权上游代码，许可仍以 docs/licenses 为准。
 */
(function (root) {
  'use strict';

  const SOURCE_LABELS = { arxiv: 'arXiv', pubmed: 'PubMed', unknown: '来源未标注' };
  const TOPIC_LABELS = { embodied: '具身智能', surgical: '手术机器人/手术AI' };
  const PRECISION_LABELS = { year: '仅年份', month: '精确到月', day: '精确到日', unknown: '精度未标注' };
  const COVERAGE_LABELS = { complete: '来源正常', partial: '部分来源暂不可用', unknown: '来源状态未知' };
  const DIGEST_STATUS_LABELS = {
    completed: '已生成',
    partial: '总结尚不完整',
    no_included_papers: '本日暂无入选论文',
    unavailable: '暂无总结',
    unknown: '状态未知'
  };

  const TEXT = {
    siteTitle: 'ResearcherPapers 论文日报',
    siteSubtitle: '具身智能 · 手术机器人/手术AI',
    pageTitleIndex: '论文日报 - ResearcherPapers',
    pageTitleSettings: '偏好设置 - ResearcherPapers',
    pageTitleStatistic: '统计 - ResearcherPapers',

    navStatistics: '统计',
    navSettings: '偏好设置',
    navBackHome: '返回首页',
    navAbout: '来源与许可',

    loadingPapers: '正在加载论文…',
    loadingFiles: '正在读取数据文件列表…',
    noPapersForDate: '本日暂无收录论文。',
    noPapersForRange: '所选日期区间内暂无收录论文。',
    noMatchingPapers: '当前筛选条件下没有论文。',
    loadFailedTitle: '数据暂时无法读取，请稍后重试。',
    fileListMissing: '暂无日报数据。',
    noDigestForDate: '暂无日报。',
    dateRangeEmpty: '所选区间没有可用日期。',

    filterTopic: '主题',
    filterAll: '全部',
    filterKeywordAuthor: '关键词 / 作者',
    searchPlaceholder: '输入关键词搜索（标题、作者、摘要）',
    searchClear: '清除搜索',
    searchToggle: '搜索',
    matchReasonKeyword: '关键词',
    matchReasonAuthor: '作者',
    matchReasonText: '文本',

    cardDetails: '查看详情',
    cardAuthors: '作者',
    cardTopics: '主题',
    cardCategories: '来源分类',
    cardCategoriesUnknown: '来源分类未知',
    discoveryBackfill: '补录候选',
    discoveryBackfillCard: '补录',
    discoveryWindowMatch: '检索窗匹配',
    discoveryBackfillHint: '该论文由扩大日期窗的回填检索发现，不是当日首次发布，不代表当日新增。',
    discoveryWindowMatchHint: '该论文命中本轮检索窗口。',
    discoveryUnknownHint: '数据未标注进入方式（旧格式），不推断是否为当日首发。',
    cardPublished: '发表日期',
    cardUpdated: '修订',
    cardDiscovered: '发现',

    modalTitleFallback: '论文详情',
    modalAbstract: '原摘要',
    abstractLinkNote: '原摘要与全文请见来源链接。',
    modalAi: 'AI 摘要',
    modalAiBasis: '仅依据摘要生成，未读全文。',
    modalAiMissing: '本篇暂无 AI 摘要（缺少摘要或分析未完成）。',
    modalAiField: {
      tldr: 'TL;DR',
      motivation: 'Motivation',
      method: 'Method',
      result: 'Result',
      conclusion: 'Conclusion'
    },
    modalMeta: '元数据',
    modalDoi: 'DOI',
    modalOpenAbs: '打开摘要页',
    modalOpenPdf: '打开 PDF',
    modalPdfPreview: 'PDF 预览',
    modalNoPdf: '本篇没有真实 PDF（PMC 文章页不是 PDF），因此不提供预览或按钮。',
    modalNoAbs: '数据里没有可用的摘要页链接，未做任何链接推测。',
    modalCopyLink: '复制摘要页链接',
    modalCopied: '已复制到剪贴板',
    modalCopyFailed: '复制失败，请手动复制',
    modalNoLinkToCopy: '没有可复制的链接。',
    modalCiteInDigest: '日报引用',
    modalTopicsBoth: '双主题命中',
    modalNavHint: '← → 切换 · 空格随机',
    modalClose: '关闭',

    digestTitle: '当日总结',
    digestPublished: '收录',
    digestPending: '待审核',
    digestUnit: '篇',
    digestUpdated: '更新于',
    digestCoveragePartial: '部分来源暂不可用',
    digestIncomplete: '总结尚不完整',
    sourceUnavailable: '本期 {sources} 来源暂缺',
    digestNoSummary: '暂无总结',
    digestNoIncluded: '本日暂无入选论文',
    digestNoPapers: '暂无日报',
    digestCiteLabel: '相关论文',
    digestCiteOrdinal: '第 {n} 篇',
    revisionTitle: '同日修订',
    revisionAdded: '新增',
    revisionRemoved: '移除',
    revisionUnit: '篇',

    rangeSummaryTitle: '区间内逐日汇总',
    rangeMissingDates: '区间内以下日期暂无日报：',
    rangeMissingNone: '区间内每个日期都有日报。',
    rangeDayMissing: '暂无日报',
    rangeDayCount: '收录 {n} 篇',
    rangeTotal: '区间合计：{n} 篇',

    statTitle: '已收录样本统计',
    statPublishedCount: '已收录',
    statUnit: '篇',
    statNoData: '没有可统计的数据。',
    statScopeNote: '统计口径：仅本站已收录样本，缺失日期不补 0。',
    statTrendTitle: '关键词趋势',
    statTrendHint: '仅统计本区间论文标题中的关键词频次。',
    statTrendUnavailable: '区间内没有可绘制的趋势（至少需要两个日期）。',
    statKeywordTitle: '热门关键词',
    statRelatedTitle: '相关论文',
    statRelatedNone: '没有匹配论文。',
    statGapNote: '以下日期暂无日报，未计入统计：',
    statEmptyNote: '以下日期日报为空：',
    statCloudSkip: '词云为避免重叠略去 {n} 个词，完整列表见上方。',

    settingsKeywordsTitle: '感兴趣的关键词',
    settingsAuthorsTitle: '感兴趣的作者',
    settingsAdd: '添加',
    settingsCopy: '复制',
    settingsKeywordPlaceholder: '输入关键词后回车…',
    settingsAuthorPlaceholder: '输入作者姓名后回车…',
    settingsEmptyKeywords: '还没有关键词，请在下方添加。',
    settingsEmptyAuthors: '还没有作者，请在下方添加。',
    settingsSave: '保存设置',
    settingsReset: '重置',
    settingsSaved: '设置已保存在本机浏览器，不会上传。',
    settingsResetDone: '已重置本机偏好。',
    settingsNoCopy: '没有可复制的内容。',
    settingsCopied: '已复制到剪贴板。',
    settingsCopyFailed: '复制失败，请手动复制。',
    settingsLocalOnly: '偏好只保存在本机浏览器，用于排序与高亮，不会上传。',

    footerTagline: 'ResearcherPapers 论文日报 · 具身智能 / 手术机器人',
    footerAbout: '来源、许可与免责说明',
    footerAiNotice: 'AI 摘要仅依据摘要生成，不构成临床建议。'
  };

  function formatTemplate(template, values) {
    if (typeof template !== 'string') return '';
    const data = values || {};
    return template.replace(/\{(\w+)\}/g, function (match, key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? String(data[key]) : match;
    });
  }

  function sourceLabel(source) {
    return SOURCE_LABELS[source] || SOURCE_LABELS.unknown;
  }

  const DISCOVERY_LABELS = { backfill: '补录候选', window_match: '检索窗匹配' };

  function discoveryLabel(kind) {
    return DISCOVERY_LABELS[kind] || '';
  }

  function discoveryHint(kind) {
    if (kind === 'backfill') return TEXT.discoveryBackfillHint;
    if (kind === 'window_match') return TEXT.discoveryWindowMatchHint;
    return TEXT.discoveryUnknownHint;
  }

  function topicLabel(topic) {
    return TOPIC_LABELS[topic] || String(topic || '');
  }

  function precisionLabel(precision) {
    return PRECISION_LABELS[precision] || PRECISION_LABELS.unknown;
  }

  function coverageLabel(status) {
    return COVERAGE_LABELS[status] || COVERAGE_LABELS.unknown;
  }

  function digestStatusLabel(status) {
    return DIGEST_STATUS_LABELS[status] || DIGEST_STATUS_LABELS.unknown;
  }

  function topicListLabel(topics) {
    const list = Array.isArray(topics) ? topics : [];
    if (list.length === 0) return '';
    return list.map(topicLabel).join(' + ');
  }

  root.PD = root.PD || {};
  root.PD.i18n = {
    TEXT: TEXT,
    SOURCE_LABELS: SOURCE_LABELS,
    TOPIC_LABELS: TOPIC_LABELS,
    PRECISION_LABELS: PRECISION_LABELS,
    COVERAGE_LABELS: COVERAGE_LABELS,
    DIGEST_STATUS_LABELS: DIGEST_STATUS_LABELS,
    formatTemplate: formatTemplate,
    sourceLabel: sourceLabel,
    DISCOVERY_LABELS: DISCOVERY_LABELS,
    discoveryLabel: discoveryLabel,
    discoveryHint: discoveryHint,
    topicLabel: topicLabel,
    precisionLabel: precisionLabel,
    coverageLabel: coverageLabel,
    digestStatusLabel: digestStatusLabel,
    topicListLabel: topicListLabel
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
