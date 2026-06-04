/**
 * Kimi 搜索采集器
 * 目标：kimi.moonshot.cn（联网对话模式）
 *
 * 流程：
 * 1. 打开 kimi.moonshot.cn
 * 2. 输入关键词并发送
 * 3. 等待流式回复完成（Kimi 默认联网搜索）
 * 4. 提取回复文本和引用链接
 */
import { BrowserContext, Page } from 'playwright';
import { BaseSearchScraper } from './BaseSearchScraper.js';
import { config } from '../../config.js';
import type { SearchResult } from '../types/index.js';

export class KimiScraper extends BaseSearchScraper {
  constructor(context: BrowserContext) {
    super('kimi', context);
  }

  async search(keyword: string): Promise<SearchResult> {
    const startTime = Date.now();
    let page: Page | null = null;

    try {
      page = await this.context.newPage();
      const scraperConfig = config.scrapers.kimi;

      console.log(`  [Kimi] 正在打开 ${scraperConfig.url}...`);
      await page.goto(scraperConfig.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.sleep(2000);

      // 检测是否需要登录
      if (await this.checkNeedLogin(page)) {
        return this.createErrorResult(keyword, '需要登录 — 请运行 pnpm run login:kimi', Date.now() - startTime);
      }

      // 等待页面加载
      console.log(`  [Kimi] 等待输入框就绪...`);
      await page.waitForSelector('[contenteditable="true"], textarea, [class*="editor"], [role="textbox"]', { timeout: 15000 }).catch(() => null);
      await this.sleep(1000);

      // 尝试开始新对话
      await this.startNewChat(page);
      await this.sleep(1000);

      // 输入关键词
      console.log(`  [Kimi] 输入关键词: "${keyword}"`);
      await this.typeQuery(page, keyword);
      await this.sleep(500);

      // 发送消息
      await this.sendMessage(page);
      console.log(`  [Kimi] 消息已发送，等待回复...`);
      await this.sleep(3000); // Kimi 联网搜索通常有一个搜索阶段

      // 等待回复完成
      const responseText = await this.waitForResponseComplete(page, '[class*="message"] [class*="content"], .markdown-body, [class*="answer"]', {
        generatingIndicator: '[class*="loading"], [class*="generating"], [class*="typing"]',
        maxWait: config.monitor.responseTimeout,
      });

      if (!responseText) {
        return this.createErrorResult(keyword, '未获取到回复内容', Date.now() - startTime);
      }

      // 提取引用链接
      const citationUrls = await this.extractCitationUrls(page, '[class*="message"] [class*="content"], .markdown-body, [class*="answer"]');

      const duration = Date.now() - startTime;
      console.log(`  [Kimi] ✓ 获取成功 (${responseText.length} 字, ${citationUrls.length} 个引用, ${(duration / 1000).toFixed(1)}s)`);

      return this.createResult(keyword, responseText, citationUrls, duration);
    } catch (err) {
      const error = err as Error;
      console.error(`  [Kimi] ✗ 错误: ${error.message}`);
      return this.createErrorResult(keyword, error.message, Date.now() - startTime);
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }

  /**
   * 开始新对话
   */
  private async startNewChat(page: Page): Promise<void> {
    try {
      const newChatBtn = await page.$('[class*="new"], button:has-text("新对话"), [aria-label*="新建"]');
      if (newChatBtn) {
        await newChatBtn.click();
        await this.sleep(1500);
      }
    } catch {
      // 可能已经在新对话页面
    }
  }

  /**
   * 输入查询内容
   */
  private async typeQuery(page: Page, keyword: string): Promise<void> {
    const selectors = [
      '[contenteditable="true"]',
      'textarea',
      '[role="textbox"]',
      '[class*="editor"]',
    ];

    for (const selector of selectors) {
      const input = await page.$(selector);
      if (input) {
        await input.click();
        await this.sleep(200);

        // Kimi 使用 contenteditable，用 keyboard 输入更可靠
        const tagName = await input.evaluate('(function(el) { return el.tagName.toLowerCase(); })');
        if (tagName === 'textarea') {
          await input.fill(keyword);
        } else {
          // contenteditable: 先清空再输入
          await page.keyboard.press('Meta+A');
          await this.sleep(100);
          await page.keyboard.type(keyword, { delay: 30 });
        }
        return;
      }
    }

    throw new Error('找不到输入框');
  }

  /**
   * 发送消息
   */
  private async sendMessage(page: Page): Promise<void> {
    // 尝试点击发送按钮
    const sendBtn = await page.$('[class*="send"], button[aria-label*="发送"], [data-testid*="send"]');
    if (sendBtn) {
      await sendBtn.click();
      return;
    }

    // 降级：Enter 发送
    await page.keyboard.press('Enter');
  }
}
