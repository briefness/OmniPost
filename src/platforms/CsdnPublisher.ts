import { Page, BrowserContext } from 'playwright';
import { BasePublisher } from '../core/BasePublisher.js';
import { SelectorEngine } from '../core/SelectorEngine.js';
import { csdnSelectors } from '../selectors/csdn.js';
import type { ArticleData, PublishResult } from '../types/index.js';
import { config } from '../../config.js';

/**
 * CSDN 平台发布适配器（v2 — 整合 OpenWrite 策略）
 *
 * 核心改进（参考 OpenWrite 扩展）：
 * 1. 模板弹窗自动检测与关闭
 * 2. 正文注入优先使用 CodeMirror API（最稳定）
 * 3. 标题设值后触发 input/change/blur 事件
 * 4. 多种编辑器类型自动识别与适配
 *
 * 入口：https://editor.csdn.net/md/
 */
export class CsdnPublisher extends BasePublisher {
  constructor(context: BrowserContext) {
    super('csdn', context);
  }

  async publish(article: ArticleData): Promise<PublishResult> {
    const page = await this.context.newPage();
    const selector = new SelectorEngine(page);

    try {
      console.log('[CSDN] 1/8 导航到编辑器...');
      await page.goto(config.platforms.csdn.editorUrl, { waitUntil: 'domcontentloaded' });
      await this.waitRandom(2000, 4000);

      // 检查登录状态
      if (page.url().includes('passport') || page.url().includes('login')) {
        throw new Error('登录状态已失效，请重新运行 pnpm run login:csdn');
      }

      await page.waitForLoadState('networkidle').catch(() => {});
      await this.waitRandom(1000, 2000);

      // ⭐ 处理模板弹窗（OpenWrite 策略）
      console.log('[CSDN] 1.5/8 检测模板弹窗...');
      await this.dismissTemplateModal(page);

      console.log('[CSDN] 2/8 注入正文...');
      await this.inputContent(page, article);

      console.log('[CSDN] 3/8 设置标题...');
      await this.inputTitle(page, selector, article.title);

      console.log('[CSDN] 4/8 模拟浏览检查...');
      await this.randomScroll(page);
      await this.waitRandom(1500, 3000);

      console.log('[CSDN] 5/8 打开发布配置...');
      await this.openPublishPanel(page, selector);

      console.log('[CSDN] 6/8 设置标签...');
      await this.setTags(page, selector, article.tags);

      console.log('[CSDN] 7/8 设置原创类型...');
      await this.setArticleType(page, selector);

      if (article.summary) {
        console.log('[CSDN] 7.5/8 填写摘要...');
        await this.inputSummary(page, selector, article.summary);
      }

      console.log('[CSDN] 8/8 确认发布...');
      await this.confirmPublish(page, selector);

      // 等待发布完成
      const articleUrl = await this.waitForPublishComplete(page);

      console.log(`[CSDN] ✅ 发布成功: ${article.title}`);
      return {
        success: true,
        platform: 'csdn',
        articleTitle: article.title,
        url: articleUrl,
        timestamp: Date.now(),
      };
    } catch (error) {
      const err = error as Error;
      console.error(`[CSDN] ❌ 发布失败: ${err.message}`);

      await page.screenshot({
        path: `storage/logs/csdn-error-${Date.now()}.png`,
        fullPage: true,
      }).catch(() => {});

      return {
        success: false,
        platform: 'csdn',
        articleTitle: article.title,
        error: err.message,
        timestamp: Date.now(),
      };
    } finally {
      await page.close();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 模板弹窗处理（来自 OpenWrite）
  // ═══════════════════════════════════════════════════════════════

  /**
   * 自动检测并关闭 CSDN 的"选择模板"弹窗
   * CSDN 新建文章时可能弹出模板选择对话框
   */
  private async dismissTemplateModal(page: Page): Promise<void> {
    const dismissed = await page.evaluate(`
      (() => {
        const keywords = /(模板|模版|选择模板|文章模板|写作模板|Template)/;
        const closeTextKeywords = /(关闭|取消|跳过|不使用|我知道了|暂不|以后再说|×|X|close)/i;
        const modalSelectors = [
          '.ant-modal, .ant-modal-wrap, .ant-modal-root',
          '.el-dialog, .el-message-box, .el-overlay',
          '.modal, .modal-dialog, .modal-backdrop',
          '[class*="template"], [id*="template"]'
        ];

        let found = false;
        for (const sel of modalSelectors) {
          const nodes = document.querySelectorAll(sel);
          for (const n of nodes) {
            try {
              const text = (n.textContent || '').trim();
              if (!text || !keywords.test(text)) continue;
              found = true;

              // 尝试点击关闭按钮
              const closeBtns = n.querySelectorAll('button, [role="button"], .close, [class*="close"], [aria-label="Close"]');
              for (const btn of closeBtns) {
                const t = (btn.innerText || btn.getAttribute('aria-label') || '').trim();
                if (closeTextKeywords.test(t) || btn.className.includes('close')) {
                  btn.click();
                  return 'closed';
                }
              }

              // 强制隐藏
              n.style.setProperty('display', 'none', 'important');
            } catch {}
          }
        }

        // 隐藏遮罩层
        document.querySelectorAll('.ant-modal-mask, .el-overlay, .modal-backdrop, .mask')
          .forEach(function(m) { try { m.style.setProperty('display','none','important'); } catch {} });

        return found ? 'hidden' : 'none';
      })()
    `);

    if (dismissed === 'closed') {
      console.log('  模板弹窗已关闭');
      await this.waitRandom(300, 600);
    } else if (dismissed === 'hidden') {
      console.log('  模板弹窗已强制隐藏');
    } else {
      console.log('  无模板弹窗');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 标题填充（OpenWrite 策略：直接设值 + 触发事件）
  // ═══════════════════════════════════════════════════════════════

  private async inputTitle(page: Page, selector: SelectorEngine, title: string): Promise<void> {
    // 先点击 display 区域激活输入框
    const titleDisplay = await selector.locateOptional(csdnSelectors.titleDisplay);
    if (titleDisplay) {
      await titleDisplay.click();
      await this.waitRandom(300, 600);
    }

    // 使用 JS 直接设值 + 事件触发（OpenWrite 策略，比 fill() 更可靠）
    const filled = await page.evaluate(`
      (() => {
        const selectors = [
          'input[placeholder*="文章标题"]',
          'input[placeholder*="输入文章标题"]',
          'input[placeholder*="标题"]',
          '.article-bar__title--input',
          '.article-bar__input-box input'
        ];
        let input = null;
        for (const sel of selectors) {
          input = document.querySelector(sel);
          if (input) break;
        }
        if (!input) return false;

        input.focus();
        input.click();
        input.value = '';
        input.value = ${JSON.stringify(title)};
        ['input', 'change', 'blur', 'keyup'].forEach(function(t) {
          try { input.dispatchEvent(new Event(t, { bubbles: true })); } catch(e) {}
        });
        return true;
      })()
    `);

    if (filled) {
      console.log(`  标题: ${title}`);
    } else {
      // 降级：使用 Playwright fill
      const titleEl = await selector.locate(csdnSelectors.titleInput);
      await titleEl.fill(title);
      console.log(`  标题(降级fill): ${title}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 正文注入（OpenWrite 策略：CodeMirror API > 文件导入 > 粘贴）
  // ═══════════════════════════════════════════════════════════════

  private async inputContent(page: Page, article: ArticleData): Promise<void> {
    // 策略 1（最优）：通过 CodeMirror API 直接 setValue
    const cmResult = await page.evaluate(`
      (() => {
        // 查找 CodeMirror 实例
        const cmElement = document.querySelector('.CodeMirror');
        if (cmElement && cmElement.CodeMirror) {
          const cm = cmElement.CodeMirror;
          cm.setValue(${JSON.stringify(article.content)});
          cm.refresh && cm.refresh();
          return 'codemirror';
        }

        // 查找 cm-editor (CodeMirror 6)
        const cmEditor = document.querySelector('.cm-editor');
        if (cmEditor) {
          const view = cmEditor.cmView?.view;
          if (view) {
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: ${JSON.stringify(article.content)} }
            });
            return 'cm6';
          }
        }

        return null;
      })()
    `);

    if (cmResult) {
      console.log(`  正文: 通过 ${cmResult} API 注入 (${article.content.length} 字符)`);
      return;
    }

    // 策略 2：通过隐藏 file input 导入 .md 文件
    try {
      const fileInput = page.locator('#import-markdown-file-input');
      if (await fileInput.count() > 0) {
        await fileInput.setInputFiles(article.filePath);
        await this.waitRandom(3000, 5000);
        console.log('  正文: 通过文件导入注入');
        return;
      }
    } catch {
      // 继续降级
    }

    // 策略 3：contenteditable 直接设值 + 事件触发
    const ceResult = await page.evaluate(`
      (() => {
        const editor = document.querySelector('pre.editor__inner[contenteditable="true"]') ||
                       document.querySelector('[contenteditable="true"]');
        if (!editor) return false;

        editor.focus();
        editor.click();
        editor.textContent = '';
        editor.textContent = ${JSON.stringify(article.content)};
        ['input', 'change', 'blur'].forEach(function(t) {
          try { editor.dispatchEvent(new Event(t, { bubbles: true })); } catch(e) {}
        });
        return true;
      })()
    `);

    if (ceResult) {
      console.log(`  正文: 通过 contenteditable 注入 (${article.content.length} 字符)`);
      return;
    }

    // 策略 4（兜底）：剪贴板粘贴
    const editor = page.locator('pre.editor__inner, [contenteditable="true"]').first();
    await editor.click();
    await this.waitRandom(300, 600);

    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+KeyA`);
    await this.waitRandom(200, 400);

    await page.evaluate(`navigator.clipboard.writeText(${JSON.stringify(article.content)})`).catch(() => {});
    await page.keyboard.press(`${modifier}+KeyV`);
    await this.waitRandom(500, 1000);
    console.log(`  正文: 通过粘贴注入 (${article.content.length} 字符)`);
  }

  // ═══════════════════════════════════════════════════════════════
  // 发布配置面板
  // ═══════════════════════════════════════════════════════════════

  private async openPublishPanel(page: Page, selector: SelectorEngine): Promise<void> {
    const publishBtn = await selector.locate(csdnSelectors.publishButton);
    await publishBtn.click();
    await this.waitRandom(1500, 2500);
  }

  /** 设置文章标签 —— 先点击按钮展开，再输入 */
  private async setTags(page: Page, selector: SelectorEngine, tags: string[]): Promise<void> {
    const tagsToSet = tags.slice(0, 3);
    let tagPopupOpened = false;

    // ⭐ 移除 CSDN 的遮罩层（会拦截 pointer events）
    await page.evaluate(`
      (() => {
        document.querySelectorAll('.mark-mask-box-div, [class*="mask-box"]').forEach(function(el) {
          el.remove();
        });
      })()
    `);
    await this.waitRandom(200, 400);

    // 先点击"+ 添加文章标签"按钮
    const tagBtn = await selector.locateOptional(csdnSelectors.tagButton); 
    if (!tagBtn) {
      console.log('  标签按钮未找到，跳过');
      return;
    }

    // 点击按钮打开标签弹窗
    await tagBtn.click();
    tagPopupOpened = true;
    await this.waitRandom(500, 800);

    // 找到输入框，输入标签后按 Enter 添加（不依赖联想下拉）
    const tagInput = await selector.locateOptional(csdnSelectors.tagInput);
    if (!tagInput) {
      console.log('  标签输入框未弹出，跳过');
      return;
    }

    for (const tag of tagsToSet) {
      await tagInput.click();
      await tagInput.fill(tag);
      await this.waitRandom(600, 1000);

      // 直接按 Enter 确认标签
      await page.keyboard.press('Enter');
      await this.waitRandom(400, 700);
    }
    console.log(`  标签: ${tagsToSet.join(', ')}`);

    // ⭐ 关闭标签弹窗：精确定位 tags 容器内的关闭按钮
    await page.locator('.mark_selection[typename="tags"] button.modal__close-button').click({ timeout: 5000 }).catch(() => {});
    await this.waitRandom(500, 800);
  }

  /** 设置文章类型为原创 */
  private async setArticleType(page: Page, selector: SelectorEngine): Promise<void> {
    // 从截图看，原创默认已选中（有绿色勾），可能不需要操作
    const originalBtn = await selector.locateOptional(csdnSelectors.originalTypeRadio);
    if (originalBtn) {
      // 检查是否已选中，如果没有才点击
      const isSelected = await page.evaluate(`
        (() => {
          const labels = document.querySelectorAll('label, [class*="type"], input[type="radio"]');
          for (const el of labels) {
            if ((el.textContent || '').includes('原创') && (el.classList.contains('active') || el.querySelector('.checked, .active, input:checked'))) {
              return true;
            }
          }
          return false;
        })()
      `);
      if (!isSelected) {
        await originalBtn.click();
      }
      console.log('  类型: 原创 ✓');
    }
  }

  /** 填写摘要 */
  private async inputSummary(page: Page, selector: SelectorEngine, summary: string): Promise<void> {
    const summaryEl = await selector.locateOptional(csdnSelectors.summaryInput);
    if (summaryEl) {
      await summaryEl.click();
      await summaryEl.fill(summary);
      console.log('  摘要: 已填写');
    } else {
      // 降级：直接用 JS 查找
      await page.evaluate(`
        (() => {
          const ta = document.querySelector('textarea[placeholder*="摘要"]') || document.querySelector('.desc-box textarea');
          if (ta) {
            ta.focus();
            ta.value = ${JSON.stringify(summary)};
            ta.dispatchEvent(new Event('input', { bubbles: true }));
          }
        })()
      `);
      console.log('  摘要(JS): 已填写');
    }
  }

  /** 确认发布 */
  private async confirmPublish(page: Page, selector: SelectorEngine): Promise<void> {
    await this.waitRandom(1000, 2000);

    // ⭐ 直接用 JS 点击：找到所有"发布文章"文本的按钮，点击最后一个
    // 因为面板内的按钮在 DOM 中排在工具栏按钮后面
    await page.evaluate(`
      (() => {
        const allBtns = document.querySelectorAll('button');
        const matches = [];
        for (const btn of allBtns) {
          const text = (btn.textContent || '').trim();
          if (text === '发布文章') {
            matches.push(btn);
          }
        }
        // 点击最后一个"发布文章"按钮（面板内的在 DOM 后面）
        if (matches.length >= 2) {
          matches[matches.length - 1].click();
        } else if (matches.length === 1) {
          matches[0].click();
        }
      })()
    `);
    console.log('  已点击最终发布');
  }

  /** 等待发布完成 */
  private async waitForPublishComplete(page: Page): Promise<string> {
    try {
      // 等待跳转到文章页面或成功页面
      await Promise.race([
        page.waitForURL('**/article/details/**', { timeout: 30000 }),
        page.waitForURL('**/creation/success/**', { timeout: 30000 }),
      ]);
      const url = page.url();
      if (url.includes('article/details') || url.includes('creation/success')) {
        return url;
      }
      return '';
    } catch {
      // 没有跳转，检查当前 URL 是否仍然在编辑器
      const currentUrl = page.url();
      if (currentUrl.includes('editor.csdn.net')) {
        throw new Error('发布后未跳转，可能发布未成功（标签弹窗可能未关闭或存在其他阻断）');
      }
      // 检查页面是否有成功提示文本
      const success = await page.evaluate(`
        (() => {
          const text = document.body.innerText || '';
          return /(发布成功|发表成功|文章发布成功)/.test(text);
        })()
      `);
      if (success) return page.url();
      return '';
    }
  }
}
