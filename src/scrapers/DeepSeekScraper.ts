/**
 * DeepSeek 搜索采集器
 * 目标：chat.deepseek.com（联网搜索模式）
 *
 * 流程：
 * 1. 打开 chat.deepseek.com
 * 2. 开启"联网搜索"模式
 * 3. 输入关键词并发送
 * 4. 等待流式回复完成
 * 5. 提取回复文本和引用链接
 */
import { BrowserContext, Page } from 'playwright';
import { BaseSearchScraper } from './BaseSearchScraper.js';
import { config } from '../../config.js';
import type { SearchResult } from '../types/index.js';

export class DeepSeekScraper extends BaseSearchScraper {
  constructor(context: BrowserContext) {
    super('deepseek', context);
  }

  async search(keyword: string): Promise<SearchResult> {
    const startTime = Date.now();
    let page: Page | null = null;

    try {
      page = await this.context.newPage();
      const scraperConfig = config.scrapers.deepseek;

      console.log(`  [DeepSeek] 正在打开 ${scraperConfig.url}...`);
      await page.goto(scraperConfig.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.sleep(2000);

      // 检测是否需要登录
      if (await this.checkNeedLogin(page)) {
        return this.createErrorResult(keyword, '需要登录 — 请运行 pnpm run login:deepseek', Date.now() - startTime);
      }

      // 等待页面加载完成（检测输入框出现）
      console.log(`  [DeepSeek] 等待输入框就绪...`);
      await page.waitForSelector('textarea, [contenteditable="true"], #chat-input', { timeout: 15000 }).catch(() => null);
      await this.sleep(1000);

      // 尝试开启联网搜索模式
      await this.enableWebSearch(page);
      await this.sleep(500);

      // 开始新对话（如果有历史对话的话）
      await this.startNewChat(page);
      await this.sleep(1000);

      // 输入关键词
      console.log(`  [DeepSeek] 输入关键词: "${keyword}"`);
      await this.typeQuery(page, keyword);
      await this.sleep(500);

      // 发送消息
      await this.sendMessage(page);
      console.log(`  [DeepSeek] 消息已发送，等待回复...`);
      await this.sleep(2000);

      // 等待回复完成
      const responseText = await this.waitForResponseComplete(page, '.ds-markdown--block, .markdown-body, [class*="message-content"]', {
        generatingIndicator: '[class*="stop"], button[class*="stop"]',
        maxWait: config.monitor.responseTimeout,
      });

      if (!responseText) {
        return this.createErrorResult(keyword, '未获取到回复内容', Date.now() - startTime);
      }

      // 提取引用链接
      const citationUrls = await this.extractCitationUrls(page, '.ds-markdown--block, .markdown-body, [class*="message-content"]');

      const duration = Date.now() - startTime;
      console.log(`  [DeepSeek] ✓ 获取成功 (${responseText.length} 字, ${citationUrls.length} 个引用, ${(duration / 1000).toFixed(1)}s)`);

      return this.createResult(keyword, responseText, citationUrls, duration);
    } catch (err) {
      const error = err as Error;
      console.error(`  [DeepSeek] ✗ 错误: ${error.message}`);
      return this.createErrorResult(keyword, error.message, Date.now() - startTime);
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }

  /**
   * 尝试开启联网搜索
   */
  private async enableWebSearch(page: Page): Promise<void> {
    try {
      // DeepSeek 的联网搜索按钮通常在输入框附近
      const searchToggle = await page.$('[class*="search"], [aria-label*="搜索"], [aria-label*="search"], button:has-text("联网")');
      if (searchToggle) {
        // 检查是否已经开启
        const isActive = await searchToggle.evaluate(`
          (function(el) {
            var classes = el.className || '';
            var ariaPressed = el.getAttribute('aria-pressed');
            return classes.includes('active') || classes.includes('selected') || ariaPressed === 'true';
          })
        `);
        if (!isActive) {
          await searchToggle.click();
          console.log(`  [DeepSeek] 已开启联网搜索模式`);
          await this.sleep(500);
        }
      }
    } catch {
      // 联网搜索按钮可能不存在或已默认开启，忽略
    }
  }

  /**
   * 开始新对话
   */
  private async startNewChat(page: Page): Promise<void> {
    try {
      const newChatBtn = await page.$('[class*="new-chat"], [aria-label*="新对话"], button:has-text("新对话"), a[href="/"]');
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
    // 尝试多种输入框选择器
    const selectors = [
      'textarea[placeholder]',
      '#chat-input',
      '[contenteditable="true"]',
      'textarea',
      '[role="textbox"]',
    ];

    for (const selector of selectors) {
      const input = await page.$(selector);
      if (input) {
        await input.click();
        await this.sleep(200);
        await input.fill(keyword);
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
    const sendBtn = await page.$('[class*="send"], button[aria-label*="发送"], button:has([class*="send"]), [data-testid="send-button"]');
    if (sendBtn) {
      await sendBtn.click();
      return;
    }

    // 降级：按 Enter 发送
    await page.keyboard.press('Enter');
  }
}
