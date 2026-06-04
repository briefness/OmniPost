/**
 * AI 搜索引擎采集器基类
 * 定义统一的搜索接口，封装通用的等待流式回复、提取引用链接逻辑
 */
import { Page, BrowserContext } from 'playwright';
import { config } from '../../config.js';
import type { SearchResult } from '../types/index.js';

export abstract class BaseSearchScraper {
  protected engine: string;
  protected context: BrowserContext;

  constructor(engine: string, context: BrowserContext) {
    this.engine = engine;
    this.context = context;
  }

  /**
   * 执行搜索并返回结果（子类必须实现）
   */
  abstract search(keyword: string): Promise<SearchResult>;

  // ═══════════════════════════════════════════════════════════
  // 通用工具方法
  // ═══════════════════════════════════════════════════════════

  /**
   * 等待 AI 流式回复完成
   * 通过轮询检测回复容器文本长度是否稳定（无变化超过 stabilizeWait 则视为完成）
   * 同时检测是否超过最大等待时间
   */
  protected async waitForResponseComplete(
    page: Page,
    responseSelector: string,
    options?: {
      generatingIndicator?: string;  // "正在生成"指示器的选择器
      maxWait?: number;
      stabilizeTime?: number;
    }
  ): Promise<string> {
    const maxWait = options?.maxWait || config.monitor.responseTimeout;
    const stabilizeTime = options?.stabilizeTime || config.monitor.stabilizeWait;
    const startTime = Date.now();

    let lastText = '';
    let lastChangeTime = Date.now();

    while (true) {
      const elapsed = Date.now() - startTime;
      if (elapsed > maxWait) {
        console.log(`  [${this.engine}] ⏱️ 回复超时 (${maxWait / 1000}s)，使用当前已获取内容`);
        break;
      }

      // 获取当前回复文本
      const currentText = await page.evaluate(`
        (function() {
          var el = document.querySelector('${responseSelector.replace(/'/g, "\\'")}');
          return el ? el.innerText || el.textContent || '' : '';
        })()
      `) as string;

      if (currentText && currentText !== lastText) {
        lastText = currentText;
        lastChangeTime = Date.now();
      }

      // 检查文本是否稳定（无变化超过 stabilizeTime）
      if (lastText && (Date.now() - lastChangeTime) > stabilizeTime) {
        console.log(`  [${this.engine}] ✓ 回复已稳定 (${lastText.length} 字)`);
        break;
      }

      // 检查生成指示器是否消失
      if (options?.generatingIndicator) {
        const isGenerating = await page.evaluate(`
          (function() {
            var el = document.querySelector('${options.generatingIndicator.replace(/'/g, "\\'")}');
            return !!el;
          })()
        `) as boolean;

        if (!isGenerating && lastText.length > 50) {
          // 指示器消失且有内容，再等一小段确认
          await this.sleep(1000);
          const finalText = await page.evaluate(`
            (function() {
              var el = document.querySelector('${responseSelector.replace(/'/g, "\\'")}');
              return el ? el.innerText || el.textContent || '' : '';
            })()
          `) as string;
          if (finalText === lastText) {
            console.log(`  [${this.engine}] ✓ 生成完成指示器已消失`);
            lastText = finalText;
            break;
          }
        }
      }

      await this.sleep(500);
    }

    return lastText.trim();
  }

  /**
   * 从页面中提取引用链接
   * 查找回复区域内的所有 <a> 标签 href
   */
  protected async extractCitationUrls(page: Page, containerSelector: string): Promise<string[]> {
    const urls = await page.evaluate(`
      (function() {
        var container = document.querySelector('${containerSelector.replace(/'/g, "\\'")}');
        if (!container) return [];
        var links = container.querySelectorAll('a[href]');
        var urls = [];
        for (var i = 0; i < links.length; i++) {
          var href = links[i].getAttribute('href');
          if (href && href.startsWith('http') && !href.includes('javascript:')) {
            urls.push(href);
          }
        }
        return urls;
      })()
    `) as string[];

    // 同时从文本中提取 markdown 格式的链接
    const text = await page.evaluate(`
      (function() {
        var el = document.querySelector('${containerSelector.replace(/'/g, "\\'")}');
        return el ? el.innerText || '' : '';
      })()
    `) as string;

    const markdownLinkRegex = /https?:\/\/[^\s\)\]"'<>]+/g;
    const textUrls = text.match(markdownLinkRegex) || [];

    // 合并去重
    const allUrls = [...new Set([...urls, ...textUrls])];

    // 过滤掉 AI 平台自身的链接
    const filtered = allUrls.filter(url => {
      const selfDomains = ['deepseek.com', 'kimi.moonshot.cn', 'yuanbao.tencent.com', 'metaso.cn'];
      return !selfDomains.some(d => url.includes(d));
    });

    return filtered;
  }

  /**
   * 检测是否需要登录（页面重定向到登录页）
   */
  protected async checkNeedLogin(page: Page): Promise<boolean> {
    const url = page.url();
    const loginKeywords = ['login', 'signin', 'passport', 'auth', 'sso'];
    return loginKeywords.some(kw => url.toLowerCase().includes(kw));
  }

  /**
   * 创建成功结果
   */
  protected createResult(keyword: string, responseText: string, citationUrls: string[], duration: number): SearchResult {
    return {
      engine: this.engine,
      keyword,
      responseText,
      citationUrls,
      success: true,
      duration,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 创建失败结果
   */
  protected createErrorResult(keyword: string, error: string, duration: number): SearchResult {
    return {
      engine: this.engine,
      keyword,
      responseText: '',
      citationUrls: [],
      success: false,
      error,
      duration,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 延迟工具
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 随机延迟（模拟人类操作节奏）
   */
  protected async randomDelay(min: number, max: number): Promise<void> {
    const delay = Math.random() * (max - min) + min;
    await this.sleep(delay);
  }
}
