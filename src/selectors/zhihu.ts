import type { PlatformSelectors } from '../core/SelectorEngine.js';

/**
 * 知乎编辑器选择器配置
 *
 * 编辑器入口: https://zhuanlan.zhihu.com/write
 *
 * ⚠️ 维护说明：同 csdn.ts
 * 最后更新: 2026-06-03
 */
export const zhihuSelectors: PlatformSelectors = {

  // ═══════════════════════════════════════════════════
  // 编辑区域
  // ═══════════════════════════════════════════════════

  titleInput: {
    description: '文章标题输入框',
    strategies: [
      { type: 'placeholder', value: '请输入标题' },
      { type: 'placeholder', value: '输入标题' },
      { type: 'css', value: '.WriteIndex-titleInput textarea' },
      { type: 'css', value: 'textarea[placeholder*="标题"]' },
      { type: 'role', value: 'textbox', near: '标题' },
    ],
    timeout: 15000,
  },

  importButton: {
    description: '导入文档按钮',
    strategies: [
      { type: 'text', value: '导入文档' },
      { type: 'text', value: '导入' },
      { type: 'css', value: 'button[aria-label="导入文档"]' },
      { type: 'css', value: '[class*="Import"]' },
      { type: 'css', value: '.ToolbarMore button' },
    ],
    timeout: 10000,
  },

  moreToolbarButton: {
    description: '工具栏更多按钮',
    strategies: [
      { type: 'text', value: '⋮' },
      { type: 'css', value: '[class*="ToolbarMore"]' },
      { type: 'css', value: 'button[aria-label="更多"]' },
      { type: 'role', value: 'button', near: '更多' },
    ],
    timeout: 5000,
  },

  // ═══════════════════════════════════════════════════
  // 话题/标签
  // ═══════════════════════════════════════════════════

  topicInput: {
    description: '话题输入框',
    strategies: [
      { type: 'placeholder', value: '搜索话题' },
      { type: 'placeholder', value: '话题' },
      { type: 'css', value: 'input[placeholder*="话题"]' },
      { type: 'css', value: '.TopicSelector input' },
      { type: 'css', value: '[class*="topic"] input' },
    ],
    timeout: 8000,
  },

  topicSuggestion: {
    description: '话题联想选项',
    strategies: [
      { type: 'css', value: '.Popover-content li' },
      { type: 'css', value: '.TopicSelector-item' },
      { type: 'css', value: '[class*="topic"] [class*="item"]' },
      { type: 'role', value: 'option' },
    ],
    timeout: 5000,
  },

  // ═══════════════════════════════════════════════════
  // 封面
  // ═══════════════════════════════════════════════════

  coverUpload: {
    description: '封面上传按钮',
    strategies: [
      { type: 'text', value: '上传封面' },
      { type: 'text', value: '添加封面' },
      { type: 'css', value: '[class*="cover"] input[type="file"]' },
      { type: 'css', value: 'button:has-text("封面")' },
    ],
    timeout: 5000,
    visible: false,
  },

  // ═══════════════════════════════════════════════════
  // 发布
  // ═══════════════════════════════════════════════════

  publishButton: {
    description: '发布按钮',
    strategies: [
      { type: 'text', value: '发布', exact: true },
      { type: 'role', value: 'button', near: '发布' },
      { type: 'css', value: '.PublishPanel-button' },
      { type: 'css', value: 'button[class*="publish"]' },
      { type: 'css', value: '.WriteIndex-publishButton button' },
    ],
    timeout: 10000,
  },
};
