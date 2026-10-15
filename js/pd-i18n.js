/**
 * ResearcherPapers 前端文案层（仅中文界面；不联网、不依赖 i18n 库）。
 *
 * 来源与变更声明 / Provenance notice:
 *   新建文件，不含上游代码。上游 daily-arXiv-ai-enhanced
 *   （main 01fdad3b0aec2d2f7977b686253a7b0c1c8273dc，Modified Apache License，
 *   见 docs/licenses/daily-arxiv-LICENSE）原页面为英文且带语言探测。
 *   变更：固定中文文案；删除 English/Chinese 语言回退与 flatpickr 相关文案；
 *   新增日期精度、来源、主题、覆盖缺口、AI 依据（abstract）等必须如实说明的文案。
 *   本文件不重新授权上游代码，许可仍以 docs/licenses 为准。
 */
(function (root) {
  'use strict';

  const SOURCE_LABELS = { arxiv: 'arXiv', pubmed: 'PubMed', unknown: '来源未标注' };
  const TOPIC_LABELS = { embodied: '具身智能', surgical: '手术机器人/手术AI' };
  const PRECISION_LABELS = { year: '仅年份', month: '精确到月', day: '精确到日', unknown: '精度未标注' };
  const COVERAGE_LABELS = { complete: '该检索域已完整尝试', partial: 'partial：存在缺口', unknown: '覆盖状态未知' };
  const DIGEST_STATUS_LABELS = {
    completed: '已生成',
    no_included_papers: '本轮无已完成审核的入选论文',
    unavailable: '日报缺失或不可用',
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

    loadingPapers: '正在加载论文…',
    loadingFiles: '正在读取数据文件列表…',
    noPapersForDate: '该日期没有已发布论文。',
    noPapersForRange: '所选日期区间内没有已发布论文。',
    noMatchingPapers: '当前筛选条件下没有论文。',
    loadFailedTitle: '数据加载失败，请重试。',
    loadFailedDetail: '错误信息：',
    fileListMissing: '未找到 assets/file-list.txt：本站还没有发布任何数据文件。',
    fileListFailed: '读取 assets/file-list.txt 失败。',
    dataFileFailed: '读取数据文件失败：',
    dateRangeEmpty: '所选区间没有可用日期。',

    filterTopic: '主题',
    filterAll: '全部',
    filterKeywordAuthor: '关键词 / 作者',
    searchPlaceholder: '输入关键词搜索（标题、作者、摘要）',
    searchClear: '清除搜索',
    searchToggle: '搜索',
    onlyMatchedHint: '匹配项排在前列，其余论文仍然显示。',
    matchReasonKeyword: '关键词',
    matchReasonAuthor: '作者',
    matchReasonText: '文本',

    cardDetails: '查看详情',
    cardAuthors: '作者',
    cardTopics: '主题',
    cardCategories: '来源分类',
    cardCategoriesUnknown: '来源分类未知',
    discoveryBackfill: '补录候选',
    discoveryWindowMatch: '检索窗匹配',
    discoveryBackfillHint: '该论文由扩大日期窗的回填检索发现，不是当日首次发布，不代表当日新增。',
    discoveryWindowMatchHint: '该论文命中本轮检索窗口。',
    discoveryUnknownHint: '数据未标注进入方式（旧格式），不推断是否为当日首发。',
    cardPublished: '发表日期',
    cardUpdated: '修订',
    cardDiscovered: '发现',
    cardAmbigusDate: '（不得当作发表日期）',

    modalTitleFallback: '论文详情',
    modalAbstract: '原摘要',
    modalAi: 'AI 摘要级分析（仅依据摘要，未读全文）',
    modalAiBasisWarn: '以下分析仅基于摘要生成，不构成全文结论或临床证据。',
    modalAiMissing: '本篇没有已完成的 AI 分析（缺少摘要或分析未完成）。',
    modalAiField: {
      tldr: 'TL;DR',
      motivation: 'Motivation',
      method: 'Method',
      result: 'Result',
      conclusion: 'Conclusion'
    },
    modalMeta: '元数据',
    modalDoi: 'DOI',
    modalSourceId: '来源编号',
    modalId: '标识',
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
    modalPos: '位置',
    modalNavHint: '← → 切换 · 空格随机',
    modalClose: '关闭',

    digestTitle: '当日综合总结',
    digestGeneratedAt: '生成时间',
    digestStatus: '日报状态',
    digestPending: '待处理',
    digestPendingUnit: '篇',
    digestCoverage: '覆盖',
    digestScopeNote: '范围说明',
    scopeTitle: '本轮检索范围（research_scope）',
    rangeMissingDates: '区间内以下日期没有已发布数据（缺口，不补 0）：',
    rangeMissingNone: '区间内每个日期都有已发布数据。',
    rangeDayMissing: '无数据（缺口）',
    scopeWindow: '检索窗口（UTC）',
    scopeWindowMissing: '检索窗口未标注',
    scopeCollected: '采集',
    scopeAnalyzed: '已分析',
    scopeExcluded: '审核排除',
    scopeUncertain: '待定',
    scopePolicy: '范围策略',
    scopeBasisUnknown: '日期基准未标注',
    scopeMissing: '日报未提供 research_scope：无法区分“本轮无入选论文”与“审核排除了论文”，请以缺口提示为准。',
    scopeNoIncludedHint: '本轮无已完成审核的入选论文（不等于领域无新论文）；上方“审核排除”计数说明确有论文被排除审核。',
    revisionTitle: '同日修订',
    revisionAdded: '新增',
    revisionRemoved: '移除',
    revisionUnit: '篇',
    digestSectionCited: '引用论文',
    digestNoSections: '日报没有可展示的分节内容。',
    digestMissingNotice: '该日期没有 data/YYYY-MM-DD_digest.json，或它不可用；下方计数只代表已发布数据，不代表全量。',
    digestCountMismatch: '日报申报的论文数（{declared}）与已发布数据条数（{actual}）不一致，已按实际数据显示并标记缺口。',
    digestParseGap: '数据文件有 {invalid} 行无法解析、{dropped} 行缺必填字段，已跳过并计入缺口。',
    digestCiteMissing: '日报引用了当前数据里不存在的论文 ID：{ids}',
    digestTopicMismatch: '日报引用的论文与分节主题不一致：{ids}',
    digestUnreferenced: '本日有 {count} 篇论文未被日报分节引用。',
    // 缺口分成两个不同维度，避免“覆盖 partial”和“未发现缺口”对撞：
    //   来源覆盖 = 检索域是否完整尝试；数据结构校验 = 已发布数据自身是否自洽。
    gapSourceLabel: '来源覆盖缺口',
    gapSourceNone: '两个来源在配置检索域内均已完整尝试',
    gapSourcePartial: '来源覆盖为 partial 或缺失：检索域未完整尝试，条数不代表全量',
    gapDataLabel: '数据结构校验',
    gapDataNone: '已发布数据自洽（条数、日报引用、JSONL 行均可解析）',
    gapDigestMissing: '缺少当日日报文件（data/YYYY-MM-DD_digest.json）',
    gapDigestIncomplete: '日报未完成（digest.status 非 completed）',
    gapDigestNoIncluded: '本轮没有已完成审核的入选论文（不等于领域无新论文）',
    gapPending: '有待处理论文（pending_count > 0）',
    gapCountMismatch: '日报申报论文数与已发布数据条数不一致',
    gapInvalidLines: '存在无法解析的 JSONL 行',
    gapDropped: '存在缺必填字段被跳过的数据行',
    gapCiteMissing: '日报引用了数据里不存在的论文 ID',

    statPublishedCount: '已发布论文',    statByTopic: '按主题',
    statBySource: '按来源',
    statUnit: '篇',
    statNoData: '没有可统计的数据。',
    statTrendTitle: '关键词趋势',
    statTrendHint: '仅统计本区间论文标题中的关键词频次。',
    statTrendUnavailable: '区间内没有可绘制的趋势（至少需要两个日期）。',
    statKeywordTitle: '热门关键词',
    statRelatedTitle: '相关论文',
    statRelatedNone: '没有匹配论文。',
    statRangeMode: '区间',
    statSelectDate: '选择日期',
    statScreenNotice: '检测到屏幕较小，统计图建议在更宽的设备上查看。',
    statGotIt: '知道了',
    statD3Missing: '未加载外部图表库，已使用内置轻量 SVG 绘图。',

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
    settingsSaved: '设置已保存在本机浏览器（localStorage），不会上传到任何服务器。',
    settingsResetDone: '已重置本机偏好。',
    settingsNoCopy: '没有可复制的内容。',
    settingsCopied: '已复制到剪贴板。',
    settingsCopyFailed: '复制失败，请手动复制。',
    settingsLocalOnly: '偏好仅存于本机 localStorage，用于筛选与排序；不会被上传、不涉及任何外部服务。',
    settingsLimitNote: '单个关键词/作者最多 {len} 字符，最多 {items} 条；超长或重复内容会被自动清理。',

    noticeNoAuthTitle: '本页不含访问控制',
    noticeNoAuthBody: '本站是纯静态页面，没有登录、口令或权限校验。任何“前端密码”都无法保护数据：如需访问控制，必须在服务端或托管层（反向代理、对象存储鉴权）实现，页面上不会显示任何伪造的锁定状态。',
    noticeUntrustedTitle: '外部数据不可信',
    noticeUntrustedBody: '论文标题、作者、摘要、AI 文本、分类与链接均来自外部数据源，页面只以纯文本渲染，链接仅允许 http(s)，不会执行其中的任何指令或脚本。',

    footerAttribution: '页面布局与数据形状基于 daily-arXiv-ai-enhanced（Modified Apache License，见 docs/licenses/daily-arxiv-LICENSE），本项目已按本站数据源与安全要求改造。',
    footerAiNotice: 'AI 文本仅基于摘要生成，请谨慎甄别。',
    footerUpstreamLink: '上游项目',
    footerNoUpload: '本页不收集、不上传任何使用数据。'
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
