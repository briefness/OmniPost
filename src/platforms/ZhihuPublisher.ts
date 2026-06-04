import { Page, BrowserContext } from 'playwright';
import { BasePublisher } from '../core/BasePublisher.js';
import { SelectorEngine } from '../core/SelectorEngine.js';
import { zhihuSelectors } from '../selectors/zhihu.js';
import type { ArticleData, PublishResult } from '../types/index.js';
import { config } from '../../config.js';

/**
 * 知乎平台发布适配器
 *
 * 策略：利用知乎原生"导入文档"功能上传 .md 文件
 * 使用 SelectorEngine 多策略降级定位。
 *
 * 入口：https://zhuanlan.zhihu.com/write
 */
export class ZhihuPublisher extends BasePublisher {
  constructor(context: BrowserContext) {
    super('zhihu', context);
  }

  async publish(article: ArticleData): Promise<PublishResult> {
    const page = await this.context.newPage();
    const selector = new SelectorEngine(page);

    try {
      console.log('[知乎] 1/7 导航到写文章页面...');
      await page.goto(config.platforms.zhihu.editorUrl, { waitUntil: 'domcontentloaded' });
      await this.waitRandom(2000, 4000);

      // 检查登录状态
      if (page.url().includes('signin') || page.url().includes('login')) {
        throw new Error('登录状态已失效，请重新运行 pnpm run login:zhihu');
      }

      await page.waitForLoadState('networkidle').catch(() => {});
      await this.waitRandom(1000, 2000);

      console.log('[知乎] 2/7 导入 Markdown 文件...');
      await this.importMarkdownFile(page, selector, article.filePath);
      await this.waitRandom(3000, 5000);

      console.log('[知乎] 3/7 验证/补充标题...');
      await this.ensureTitle(page, selector, article.title);

      console.log('[知乎] 4/7 添加话题标签...');
      await this.addTopics(page, selector, article.tags);

      console.log('[知乎] 5/7 模拟浏览检查...');
      await this.randomScroll(page);
      await this.waitRandom(2000, 4000);

      console.log('[知乎] 6/7 点击发布...');
      await this.clickPublish(page, selector);

      console.log('[知乎] 7/7 等待发布完成...');
      const articleUrl = await this.waitForPublishComplete(page);

      console.log(`[知乎] ✅ 发布成功: ${article.title}`);
      return {
        success: true,
        platform: 'zhihu',
        articleTitle: article.title,
        url: articleUrl,
        timestamp: Date.now(),
      };
    } catch (error) {
      const err = error as Error;
      console.error(`[知乎] ❌ 发布失败: ${err.message}`);

      await page.screenshot({
        path: `storage/logs/zhihu-error-${Date.now()}.png`,
        fullPage: true,
      }).catch(() => {});

      return {
        success: false,
        platform: 'zhihu',
        articleTitle: article.title,
        error: err.message,
        timestamp: Date.now(),
      };
    } finally {
      await page.close();
    }
  }

  /** 通过"导入文档"上传 Markdown 文件 */
  private async importMarkdownFile(page: Page, selector: SelectorEngine, filePath: string): Promise<void> {
    // 优先尝试直接找到导入按钮
    const importBtn = await selector.locateOptional(zhihuSelectors.importButton);

    if (importBtn) {
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 10000 }),
        importBtn.click(),
      ]);
      await fileChooser.setFiles(filePath);
      console.log(`  已上传: ${filePath}`);
    } else {
      // 备选：通过"更多"菜单找到导入
      const moreBtn = await selector.locateOptional(zhihuSelectors.moreToolbarButton);
      if (moreBtn) {
        await moreBtn.click();
        await this.waitRandom(500, 1000);

        const [fileChooser] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 10000 }),
          page.getByText('导入文档').click(),
        ]);
        await fileChooser.setFiles(filePath);
        console.log('  已通过菜单上传');
      } else {
        throw new Error('无法找到导入文档入口');
      }
    }

    await this.waitRandom(2000, 4000);
  }

  /** 验证标题，若未自动导入则手动填写 */
  private async ensureTitle(page: Page, selector: SelectorEngine, title: string): Promise<void> {
    const titleEl = await selector.locate(zhihuSelectors.titleInput);
    const currentTitle = await titleEl.inputValue().catch(() => '');

    if (!currentTitle || currentTitle.trim() === '') {
      await titleEl.click();
      await titleEl.fill(title);
      console.log(`  手动填入标题: ${title}`);
    } else {
      console.log(`  标题已自动导入: ${currentTitle.substring(0, 30)}...`);
    }
  }

  /** 添加话题标签 */
  private async addTopics(page: Page, selector: SelectorEngine, tags: string[]): Promise<void> {
    if (tags.length === 0) {
      console.log('  ⚠️ 未提供话题标签');
      return;
    }

    const topicInput = await selector.locateOptional(zhihuSelectors.topicInput);
    if (!topicInput) {
      console.log('  话题输入框未找到，跳过');
      return;
    }

    for (const tag of tags.slice(0, 5)) {
      await topicInput.click();
      await topicInput.fill('');
      await this.waitRandom(300, 600);

      // 逐字输入触发联想
      for (const char of tag) {
        await topicInput.type(char, { delay: 100 });
      }

      await this.waitRandom(1000, 2000);

      // 选择第一个联想结果
      const suggestion = await selector.locateOptional(zhihuSelectors.topicSuggestion);
      if (suggestion) {
        await suggestion.click();
        console.log(`  话题: ${tag} ✓`);
      } else {
        await page.keyboard.press('Enter');
        console.log(`  话题: ${tag} (Enter)`);
      }

      await this.waitRandom(500, 1000);
    }
  }

  /** 点击发布 */
  private async clickPublish(page: Page, selector: SelectorEngine): Promise<void> {
    const publishBtn = await selector.locate(zhihuSelectors.publishButton);
    await publishBtn.click();
  }

  /** 等待发布完成 */
  private async waitForPublishComplete(page: Page): Promise<string> {
    try {
      await page.waitForURL('**/p/**', { timeout: 30000 });
      return page.url();
    } catch {
      return page.url().includes('/p/') ? page.url() : '';
    }
  }
}
