import { Page, BrowserContext } from 'playwright';
import type { ArticleData, PublishResult } from '../types/index.js';
import { config } from '../../config.js';
import { MouseHelper } from './MouseHelper.js';

/**
 * 平台发布器基类
 * 定义统一的发布接口，并封装通用的人类行为模拟方法
 *
 * 行为模拟能力：
 * - humanType: 非匀速打字（正态分布延迟）
 * - humanClick: 贝塞尔曲线鼠标移动 + 点击
 * - randomScroll: 带加速度的自然滚动
 * - pasteContent: 剪贴板注入（对编辑器友好）
 * - withRetry: 指数退避重试
 */
export abstract class BasePublisher {
  protected platform: string;
  protected context: BrowserContext;

  constructor(platform: string, context: BrowserContext) {
    this.platform = platform;
    this.context = context;
  }

  /**
   * 发布文章到目标平台（子类必须实现）
   */
  abstract publish(article: ArticleData): Promise<PublishResult>;

  // ═══════════════════════════════════════════════════════════════
  // 人类行为模拟 - 输入类
  // ═══════════════════════════════════════════════════════════════

  /**
   * 模拟真人打字 —— 正态分布延迟，偶尔有停顿（模拟思考）
   * 比均匀随机更接近真实人类的打字节奏
   */
  protected async humanType(page: Page, selector: string, text: string): Promise<void> {
    await this.humanClick(page, selector);
    const { minDelay, maxDelay } = config.humanBehavior.typing;
    const mean = (minDelay + maxDelay) / 2;
    const stdDev = (maxDelay - minDelay) / 4;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      // 使用 Box-Muller 变换生成正态分布延迟
      let delay = this.gaussianRandom(mean, stdDev);
      delay = Math.max(minDelay, Math.min(maxDelay * 1.5, delay)); // 钳位

      // 5% 概率产生较长停顿（模拟思考或打错字犹豫）
      if (Math.random() < 0.05) {
        delay += Math.random() * 300 + 100;
      }

      await page.type(selector, char, { delay: 0 });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  /**
   * 贝塞尔曲线鼠标移动 + 点击
   * 替代原生的 page.click()，运动轨迹更自然
   */
  protected async humanClick(page: Page, selector: string): Promise<void> {
    try {
      await MouseHelper.moveAndClick(page, selector);
    } catch {
      // 降级到普通点击（元素可能不可见或无 boundingBox）
      await page.click(selector);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 人类行为模拟 - 页面交互类
  // ═══════════════════════════════════════════════════════════════

  /**
   * 模拟人类自然滚动（带加速-减速效果）
   * 不是瞬间跳到某个位置，而是有惯性地滚动
   */
  protected async randomScroll(page: Page): Promise<void> {
    const { minDistance, maxDistance } = config.humanBehavior.scroll;
    const totalDistance = Math.random() * (maxDistance - minDistance) + minDistance;

    // 将总距离分成多段，模拟手指滑动的加速-匀速-减速
    const segments = 5 + Math.floor(Math.random() * 5); // 5-10 段
    const distances = this.generateEaseInOutDistances(totalDistance, segments);

    for (const d of distances) {
      await page.evaluate((dist) => window.scrollBy(0, dist), d);
      await new Promise(resolve => setTimeout(resolve, Math.random() * 30 + 10));
    }

    await this.waitRandom(800, 2000);

    // 60% 概率再滚回一部分（模拟回看）
    if (Math.random() > 0.4) {
      const backDistance = totalDistance * (0.2 + Math.random() * 0.3);
      const backSegments = 3 + Math.floor(Math.random() * 3);
      const backDistances = this.generateEaseInOutDistances(backDistance, backSegments);

      for (const d of backDistances) {
        await page.evaluate((dist) => window.scrollBy(0, -dist), d);
        await new Promise(resolve => setTimeout(resolve, Math.random() * 30 + 10));
      }
      await this.waitRandom(500, 1200);
    }
  }

  /**
   * 随机等待（模拟人类思考时间）
   */
  protected async waitRandom(min: number, max: number): Promise<void> {
    const delay = Math.random() * (max - min) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  // ═══════════════════════════════════════════════════════════════
  // 内容注入
  // ═══════════════════════════════════════════════════════════════

  /**
   * 通过剪贴板粘贴内容
   * 模拟真实的复制粘贴操作，对富文本编辑器更友好
   */
  protected async pasteContent(page: Page, selector: string, content: string): Promise<void> {
    await this.humanClick(page, selector);
    await this.waitRandom(200, 500);

    // 全选已有内容
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+KeyA`);
    await this.waitRandom(100, 300);

    // 通过 ClipboardEvent 注入内容（绕过某些编辑器的输入限制）
    await page.evaluate((text) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', text);
      const event = new ClipboardEvent('paste', {
        clipboardData,
        bubbles: true,
        cancelable: true,
      });
      document.activeElement?.dispatchEvent(event);
    }, content);

    await this.waitRandom(500, 1000);
  }

  // ═══════════════════════════════════════════════════════════════
  // 重试与容错
  // ═══════════════════════════════════════════════════════════════

  /**
   * 带指数退避的重试包装器
   * 支持抖动（jitter）防止多实例同时重试造成雪崩
   */
  protected async withRetry<T>(
    fn: () => Promise<T>,
    maxAttempts: number = config.retry.maxAttempts,
    backoffMs: number = config.retry.backoffMs
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        console.warn(`[${this.platform}] 第 ${attempt}/${maxAttempts} 次尝试失败: ${lastError.message}`);

        if (attempt < maxAttempts) {
          // 指数退避 + 随机抖动
          const exponentialDelay = backoffMs * Math.pow(2, attempt - 1);
          const jitter = Math.random() * backoffMs;
          await new Promise(resolve => setTimeout(resolve, exponentialDelay + jitter));
        }
      }
    }

    throw lastError;
  }

  // ═══════════════════════════════════════════════════════════════
  // 内部工具函数
  // ═══════════════════════════════════════════════════════════════

  /**
   * Box-Muller 变换：生成正态分布随机数
   */
  private gaussianRandom(mean: number, stdDev: number): number {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return z * stdDev + mean;
  }

  /**
   * 生成 ease-in-out 分段距离
   * 模拟滚动的加速-匀速-减速过程
   */
  private generateEaseInOutDistances(totalDistance: number, segments: number): number[] {
    const distances: number[] = [];
    let sum = 0;

    for (let i = 0; i < segments; i++) {
      // 使用 sin 曲线生成 ease-in-out 效果
      const t = i / (segments - 1);
      const weight = Math.sin(t * Math.PI); // 0→1→0 的曲线
      distances.push(weight);
      sum += weight;
    }

    // 归一化使总和等于 totalDistance
    return distances.map(d => (d / sum) * totalDistance);
  }
}
