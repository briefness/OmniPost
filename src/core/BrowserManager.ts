import { chromium, Browser, BrowserContext } from 'playwright';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { config } from '../../config.js';
import { getComprehensiveStealthScript } from './StealthScripts.js';
import type { BrowserConfig } from '../types/index.js';

/**
 * 浏览器管理中心（全面反检测版）
 *
 * 防护层级：
 * 1. 启动参数 —— 隐藏自动化 Blink 特征
 * 2. addInitScript —— 抹除 webdriver、伪造 plugins/Chrome 对象
 * 3. Canvas 指纹 —— 像素级微噪声注入
 * 4. WebGL 指纹 —— Vendor/Renderer 信息伪造
 * 5. AudioContext —— 频率微偏移
 * 6. Permissions API —— 行为一致性修正
 * 7. 鼠标轨迹 —— 贝塞尔曲线自然移动（由 MouseHelper 提供）
 *
 * Cookie 持久化 + Trace 录制保持不变。
 */
export class BrowserManager {
  private browser: Browser | null = null;
  private contexts: Map<string, BrowserContext> = new Map();

  /**
   * 启动浏览器实例
   * 启动参数最大化隐藏自动化痕迹
   */
  async launch(overrides?: Partial<BrowserConfig>): Promise<Browser> {
    const browserConfig = { ...config.browser, ...overrides };

    this.browser = await chromium.launch({
      headless: browserConfig.headless,
      slowMo: browserConfig.slowMo,
      args: [
        // 核心：隐藏 Blink 自动化特征
        '--disable-blink-features=AutomationControlled',
        // 禁用站点隔离（减少指纹差异）
        '--disable-features=IsolateOrigins,site-per-process',
        // 禁用自动化信息栏提示
        '--disable-infobars',
        // 禁用自动化扩展
        '--disable-extensions',
        // 窗口尺寸
        `--window-size=${browserConfig.viewport.width},${browserConfig.viewport.height}`,
        // 禁用 GPU 沙箱（避免某些环境下的指纹差异）
        '--no-sandbox',
        '--disable-setuid-sandbox',
        // 禁用 /dev/shm 使用（Docker 环境兼容）
        '--disable-dev-shm-usage',
        // 隐藏"Chrome 正受自动化测试软件控制"
        '--excludeSwitches=enable-automation',
        // 禁用自动化相关的 UserPrefs
        '--disable-component-update',
      ],
    });

    console.log(`[BrowserManager] 浏览器已启动 (headless: ${browserConfig.headless})`);
    return this.browser;
  }

  /**
   * 为指定平台创建浏览器上下文
   * 注入全套反检测脚本 + 自动加载 Cookie 状态
   */
  async createContext(platform: string): Promise<BrowserContext> {
    if (!this.browser) {
      throw new Error('[BrowserManager] 浏览器未启动，请先调用 launch()');
    }

    // 先从发布平台找，再从采集器找
    const platformConfig = (config.platforms as any)[platform] || (config.scrapers as any)[platform];
    if (!platformConfig) {
      const allPlatforms = [...Object.keys(config.platforms), ...Object.keys(config.scrapers)];
      throw new Error(`[BrowserManager] 未知平台: ${platform}。支持: ${allPlatforms.join(', ')}`);
    }

    const statePath = resolve(platformConfig.statePath);
    const hasState = existsSync(statePath);

    // 创建隔离上下文
    const context = await this.browser.newContext({
      viewport: config.browser.viewport,
      ...(hasState ? { storageState: statePath } : {}),
      // 使用真实的 Chrome UA（定期更新以匹配最新稳定版）
      userAgent: this.getRandomUserAgent(),
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      // 地理位置伪造（北京）
      geolocation: { longitude: 116.4, latitude: 39.9 },
      permissions: ['geolocation'],
      // 禁用 ServiceWorker（减少指纹暴露面）
      serviceWorkers: 'block',
      // 设置颜色方案（匹配系统默认）
      colorScheme: 'light',
    });

    // ═══ 注入综合反检测脚本 ═══
    await context.addInitScript(getComprehensiveStealthScript());

    if (hasState) {
      console.log(`[BrowserManager] 已加载 ${platform} 的登录状态 (Cookie)`);
    } else {
      console.log(`[BrowserManager] ${platform} 无登录状态，需要手动登录`);
      console.log(`  → 运行: pnpm run login -- --platform ${platform}`);
    }

    this.contexts.set(platform, context);
    return context;
  }

  /**
   * 保存当前平台的登录状态（Cookie + LocalStorage）
   */
  async saveState(platform: string): Promise<void> {
    const context = this.contexts.get(platform);
    if (!context) {
      throw new Error(`[BrowserManager] 平台 ${platform} 的上下文不存在`);
    }

    const platformConfig = (config.platforms as any)[platform] || (config.scrapers as any)[platform];
    const statePath = resolve(platformConfig.statePath);
    await context.storageState({ path: statePath });
    console.log(`[BrowserManager] ${platform} 登录状态已保存至 ${statePath}`);
  }

  /**
   * 开启 Trace 录制（用于调试失败场景）
   */
  async startTracing(platform: string): Promise<void> {
    const context = this.contexts.get(platform);
    if (context) {
      await context.tracing.start({ screenshots: true, snapshots: true });
    }
  }

  /**
   * 停止 Trace 并保存到日志目录
   */
  async stopTracing(platform: string, success: boolean): Promise<string | null> {
    const context = this.contexts.get(platform);
    if (!context) return null;

    if (!success) {
      const tracePath = resolve(config.storage.logsDir, `failed-${platform}-${Date.now()}.zip`);
      await context.tracing.stop({ path: tracePath });
      console.log(`[BrowserManager] Trace 已保存: ${tracePath}`);
      return tracePath;
    }

    await context.tracing.stop();
    return null;
  }

  /**
   * 关闭所有上下文和浏览器
   */
  async close(): Promise<void> {
    for (const [platform, context] of this.contexts) {
      await context.close();
      console.log(`[BrowserManager] ${platform} 上下文已关闭`);
    }
    this.contexts.clear();

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('[BrowserManager] 浏览器已关闭');
    }
  }

  /**
   * 随机选取一个真实 Chrome User-Agent
   * 保持与当前 Chrome 稳定版一致，定期维护
   */
  private getRandomUserAgent(): string {
    const userAgents = [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }
}
