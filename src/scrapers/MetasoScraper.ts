/**
 * 秘塔 AI 搜索采集器
 * 目标：metaso.cn（纯 AI 搜索引擎，不需要登录即可使用）
 *
 * 秘塔是纯搜索型产品，比对话型 AI 更容易抓取：
 * 1. 打开 metaso.cn
 * 2. 在搜索框输入关键词
 * 3. 等待搜索结果和 AI 总结生成完成
 * 4. 提取 AI 总结文本和引用来源
 */
import { BrowserContext, Page } from 'playwright';
import { BaseSearchScraper } from './BaseSearchScraper.js';
import { config } from '../../config.js';
import type { SearchResult } from '../types/index.js';

export class MetasoScraper extends BaseSearchScraper {
  constructor(context: BrowserContext) {
    super('metaso', context);
  }

  async search(keyword: string): Promise<SearchResult> {
    const startTime = Date.now();
    let page: Page | null = null;

    try {
      page = await this.context.newPage();
      const scraperConfig = config.scrapers.metaso;

      // 秘塔支持直接带参数搜索
      const searchUrl = `${scraperConfig.url}/search?q=${encodeURIComponent(keyword)}`;
      console.log(`  [秘塔] 正在搜索: "${keyword}"...`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.sleep(3000);

      // 秘塔一般不需要登录就能搜索，但检测一下
      if (await this.checkNeedLogin(page)) {
        // 秘塔如果要求登录，尝试直接在首页搜索
        console.log(`  [秘塔] 重定向到登录页，尝试首页搜索...`);
        await page.goto(scraperConfig.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await this.sleep(2000);
        await this.typeAndSearch(page, keyword);
        await this.sleep(3000);
      }

      // 等待 AI 总结完成
      console.log(`  [秘塔] 等待 AI 总结生成...`);
      const responseText = await this.waitForResponseComplete(page, '[class*="summary"], [class*="answer"], [class*="ai-content"], .search-result-ai, main article', {
        generatingIndicator: '[class*="loading"], [class*="generating"], [class*="skeleton"]',
        maxWait: config.monitor.responseTimeout,
        stabilizeTime: 4000,  // 秘塔搜索结果加载较慢，多等一会
      });

      if (!responseText) {
        return this.createErrorResult(keyword, '未获取到搜索结果', Date.now() - startTime);
      }

      // 提取引用链接（秘塔通常有明确的来源列表）
      const citationUrls = await this.extractCitationUrls(page, '[class*="summary"], [class*="answer"], [class*="source"], [class*="reference"], main');

      // 额外尝试从来源卡片中提取
      const sourceUrls = await page.evaluate(`
        (function() {
          var sources = document.querySelectorAll('[class*="source"] a[href], [class*="reference"] a[href], [class*="citation"] a[href]');
          var urls = [];
          for (var i = 0; i < sources.length; i++) {
            var href = sources[i].getAttribute('href');
            if (href && href.startsWith('http')) urls.push(href);
          }
          return urls;
        })()
      `) as string[];

      const allUrls = [...new Set([...citationUrls, ...sourceUrls])];

      const duration = Date.now() - startTime;
      console.log(`  [秘塔] ✓ 获取成功 (${responseText.length} 字, ${allUrls.length} 个引用, ${(duration / 1000).toFixed(1)}s)`);

      return this.createResult(keyword, responseText, allUrls, duration);
    } catch (err) {
      const error = err as Error;
      console.error(`  [秘塔] ✗ 错误: ${error.message}`);
      return this.createErrorResult(keyword, error.message, Date.now() - startTime);
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }

  /**
   * 在首页输入并搜索
   */
  private async typeAndSearch(page: Page, keyword: string): Promise<void> {
    const selectors = [
      'input[type="search"]',
      'input[type="text"]',
      'textarea',
      '[class*="search"] input',
      '[role="searchbox"]',
    ];

    for (const selector of selectors) {
      const input = await page.$(selector);
      if (input) {
        await input.click();
        await this.sleep(200);
        await input.fill(keyword);
        await this.sleep(300);
        await page.keyboard.press('Enter');
        return;
      }
    }

    throw new Error('找不到搜索框');
  }
}
