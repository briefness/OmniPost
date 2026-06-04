/**
 * 腾讯元宝搜索采集器
 * 目标：yuanbao.tencent.com
 *
 * 流程：
 * 1. 打开 yuanbao.tencent.com
 * 2. 输入关键词并发送
 * 3. 等待流式回复完成
 * 4. 提取回复文本和引用链接
 */
import { BrowserContext, Page } from 'playwright';
import { BaseSearchScraper } from './BaseSearchScraper.js';
import { config } from '../../config.js';
import type { SearchResult } from '../types/index.js';

export class YuanbaoScraper extends BaseSearchScraper {
  constructor(context: BrowserContext) {
    super('yuanbao', context);
  }

  async search(keyword: string): Promise<SearchResult> {
    const startTime = Date.now();
    let page: Page | null = null;

    try {
      page = await this.context.newPage();
      const scraperConfig = config.scrapers.yuanbao;

      console.log(`  [元宝] 正在打开 ${scraperConfig.url}...`);
      await page.goto(scraperConfig.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.sleep(2000);

      // 检测是否需要登录
      if (await this.checkNeedLogin(page)) {
        return this.createErrorResult(keyword, '需要登录 — 请运行 pnpm run login:yuanbao', Date.now() - startTime);
      }

      // 等待页面加载
      console.log(`  [元宝] 等待输入框就绪...`);
      await page.waitForSelector('textarea, [contenteditable="true"], input[type="text"], [class*="input"]', { timeout: 15000 }).catch(() => null);
      await this.sleep(1000);

      // 输入关键词
      console.log(`  [元宝] 输入关键词: "${keyword}"`);
      await this.typeQuery(page, keyword);
      await this.sleep(500);

      // 发送消息
      await this.sendMessage(page);
      console.log(`  [元宝] 消息已发送，等待回复...`);
      await this.sleep(3000);

      // 等待回复完成
      const responseText = await this.waitForResponseComplete(page, '[class*="message-content"], [class*="answer"], .markdown-body, [class*="reply"]', {
        generatingIndicator: '[class*="loading"], [class*="generating"], [class*="thinking"]',
        maxWait: config.monitor.responseTimeout,
      });

      if (!responseText) {
        return this.createErrorResult(keyword, '未获取到回复内容', Date.now() - startTime);
      }

      // 提取引用链接
      const citationUrls = await this.extractCitationUrls(page, '[class*="message-content"], [class*="answer"], .markdown-body, [class*="reply"]');

      const duration = Date.now() - startTime;
      console.log(`  [元宝] ✓ 获取成功 (${responseText.length} 字, ${citationUrls.length} 个引用, ${(duration / 1000).toFixed(1)}s)`);

      return this.createResult(keyword, responseText, citationUrls, duration);
    } catch (err) {
      const error = err as Error;
      console.error(`  [元宝] ✗ 错误: ${error.message}`);
      return this.createErrorResult(keyword, error.message, Date.now() - startTime);
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }

  /**
   * 输入查询内容
   */
  private async typeQuery(page: Page, keyword: string): Promise<void> {
    const selectors = [
      'textarea',
      '[contenteditable="true"]',
      'input[type="text"]',
      '[class*="input"]',
      '[role="textbox"]',
    ];

    for (const selector of selectors) {
      const input = await page.$(selector);
      if (input) {
        await input.click();
        await this.sleep(200);
        const tagName = await input.evaluate('(function(el) { return el.tagName.toLowerCase(); })');
        if (tagName === 'textarea' || tagName === 'input') {
          await input.fill(keyword);
        } else {
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
    const sendBtn = await page.$('[class*="send"], button[aria-label*="发送"], button:has([class*="send"])');
    if (sendBtn) {
      await sendBtn.click();
      return;
    }
    await page.keyboard.press('Enter');
  }
}
