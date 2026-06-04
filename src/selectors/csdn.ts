import type { PlatformSelectors } from '../core/SelectorEngine.js';

/**
 * CSDN 编辑器选择器配置
 *
 * 编辑器入口: https://editor.csdn.net/md/
 * 页面标题: 写文章-CSDN博客
 *
 * ⚠️ 维护说明：
 * 当 CSDN 改版导致定位失败时，运行 pnpm run diagnose -- --platform csdn
 * 获取最新的 DOM 结构，然后只需更新本文件中的 strategies 数组即可。
 *
 * 最后更新: 2026-06-03 (基于诊断结果)
 */
export const csdnSelectors: PlatformSelectors = {

  // ═══════════════════════════════════════════════════
  // 编辑区域
  // ═══════════════════════════════════════════════════

  /**
   * 标题显示区域（点击后切换为输入框）
   * 诊断结果：.article-bar__title-display 可见，input 不可见
   * 需要先点击 display 区域激活输入框
   */
  titleDisplay: {
    description: '标题显示区域（点击激活输入框）',
    strategies: [
      { type: 'css', value: '.article-bar__title-display' },
      { type: 'css', value: '.article-bar__input-box' },
      { type: 'css', value: '.article-bar__title' },
    ],
    timeout: 10000,
  },

  titleInput: {
    description: '文章标题输入框',
    strategies: [
      { type: 'placeholder', value: '请输入文章标题' },
      { type: 'css', value: 'input.article-bar__title--input' },
      { type: 'css', value: '.article-bar__title.article-bar__title--input' },
      { type: 'css', value: 'input[placeholder*="文章标题"]' },
      { type: 'css', value: '.article-bar__input-box input' },
    ],
    timeout: 10000,
    visible: false, // 初始不可见，需要先点击 titleDisplay
  },

  /**
   * Markdown 编辑区域
   * 诊断结果：<pre class="editor__inner markdown-highlighting" contenteditable="true">
   */
  markdownEditor: {
    description: 'Markdown 编辑区域 (contenteditable pre)',
    strategies: [
      { type: 'css', value: 'pre.editor__inner' },
      { type: 'css', value: 'pre.editor__inner.markdown-highlighting' },
      { type: 'css', value: '.editor [contenteditable="true"]' },
      { type: 'css', value: '.layout__panel--editor [contenteditable]' },
    ],
    timeout: 15000,
  },

  // ═══════════════════════════════════════════════════
  // 发布
  // ═══════════════════════════════════════════════════

  /**
   * 发布按钮
   * 诊断结果：<button class="btn btn-publish"> "发布文章"
   */
  publishButton: {
    description: '发布文章按钮',
    strategies: [
      { type: 'text', value: '发布文章', exact: true },
      { type: 'css', value: 'button.btn-publish' },
      { type: 'css', value: '.btn-publish' },
      { type: 'role', value: 'button', near: '发布文章' },
    ],
    timeout: 10000,
  },

  /**
   * 确认发布按钮（发布配置面板内）
   * 截图确认：底部蓝色按钮，文本"发布文章"
   * 注意：面板内有"取消"、"保存为草稿"、"定时发布"、"发布文章"四个按钮
   */
  confirmPublishButton: {
    description: '发布面板内的最终发布按钮',
    strategies: [
      { type: 'css', value: 'button:not(.btn-publish):has-text("发布文章")' },
      { type: 'css', value: '.article-info-box button:has-text("发布")' },
      { type: 'css', value: '.modal-footer button:last-child' },
      { type: 'css', value: 'button.btn-b-red' },
    ],
    timeout: 10000,
  },

  // ═══════════════════════════════════════════════════
  // 标签与分类（发布面板内）
  // ═══════════════════════════════════════════════════

  tagButton: {
    description: '添加文章标签按钮（点击后弹出输入框）',
    strategies: [
      { type: 'text', value: '添加文章标签' },
      { type: 'css', value: '.tag__btn-tag' },
      { type: 'css', value: 'button.tag__btn-tag' },
      { type: 'text', value: '+ 添加文章标签' },
    ],
    timeout: 8000,
  },

  tagInput: {
    description: '标签搜索输入框（点击按钮后出现）',
    strategies: [
      { type: 'placeholder', value: '请输入文章标签，按回车确认' },
      { type: 'placeholder', value: '请输入文章标签' },
      { type: 'css', value: '.tag__input input' },
      { type: 'css', value: 'input[placeholder*="标签"]' },
      { type: 'css', value: '.tag__input-box input' },
      { type: 'css', value: '.mark_selection input' },
    ],
    timeout: 8000,
  },

  tagSuggestion: {
    description: '标签联想下拉项',
    strategies: [
      { type: 'css', value: '.tag__drop-down li' },
      { type: 'css', value: '.el-select-dropdown__item' },
      { type: 'css', value: '[class*="tag-suggest"] li' },
      { type: 'css', value: '[class*="tag"] [class*="item"]' },
    ],
    timeout: 5000,
  },

  // ═══════════════════════════════════════════════════
  // 文章类型
  // ═══════════════════════════════════════════════════

  originalTypeRadio: {
    description: '文章类型：原创',
    strategies: [
      { type: 'text', value: '原创', exact: true },
      { type: 'label', value: '原创' },
      { type: 'css', value: 'label:has-text("原创")' },
      { type: 'css', value: '[class*="type"] [class*="item"]:first-child' },
    ],
    timeout: 5000,
  },

  // ═══════════════════════════════════════════════════
  // 封面与摘要
  // ═══════════════════════════════════════════════════

  coverUpload: {
    description: '封面上传',
    strategies: [
      { type: 'text', value: '上传封面' },
      { type: 'css', value: '[class*="cover"] input[type="file"]' },
      { type: 'css', value: 'input[accept*="image"]' },
    ],
    timeout: 5000,
    visible: false,
  },

  summaryInput: {
    description: '摘要输入框',
    strategies: [
      { type: 'placeholder', value: '请输入摘要' },
      { type: 'placeholder', value: '摘要' },
      { type: 'css', value: 'textarea[placeholder*="摘要"]' },
      { type: 'css', value: '.desc-box textarea' },
    ],
    timeout: 5000,
  },

  // ═══════════════════════════════════════════════════
  // 导入 Markdown（备用策略）
  // ═══════════════════════════════════════════════════

  /**
   * 隐藏的文件 input —— 可用于直接上传 .md 文件
   * 诊断结果：<input type="file" class="hidden-file" id="import-markdown-file-input">
   */
  importMarkdownFileInput: {
    description: 'Markdown 文件导入 (隐藏 input)',
    strategies: [
      { type: 'css', value: '#import-markdown-file-input' },
      { type: 'css', value: 'input.hidden-file' },
      { type: 'css', value: 'input[type="file"][id*="markdown"]' },
    ],
    timeout: 5000,
    visible: false,
  },
};
