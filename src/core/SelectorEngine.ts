import { Page, Locator } from 'playwright';

/**
 * 选择器定位策略类型
 */
export interface SelectorStrategy {
  /** 定位方式 */
  type: 'css' | 'placeholder' | 'text' | 'role' | 'label' | 'testid';
  /** 定位值 */
  value: string;
  /** 辅助定位：附近的文本（用于 role 定位时缩小范围） */
  near?: string;
  /** 是否为精确匹配（默认模糊匹配） */
  exact?: boolean;
}

/**
 * 元素配置：多策略降级
 */
export interface ElementConfig {
  /** 元素描述（用于日志） */
  description: string;
  /** 定位策略列表，按优先级依次尝试 */
  strategies: SelectorStrategy[];
  /** 超时时间（毫秒），默认 8000 */
  timeout?: number;
  /** 是否必须可见，默认 true */
  visible?: boolean;
}

/**
 * 平台选择器配置
 */
export interface PlatformSelectors {
  [elementName: string]: ElementConfig;
}

/**
 * 选择器引擎
 *
 * 核心理念：不硬编码选择器，每个元素配置多种定位策略，按优先级依次尝试。
 * 优先级原则：
 *   1. placeholder / aria-label / 文本内容 → 改版最不容易变
 *   2. role 语义角色 → 比 class 名称稳定
 *   3. CSS 选择器 → 作为兜底
 *
 * 使用方式：
 *   const engine = new SelectorEngine(page);
 *   const titleInput = await engine.locate(selectors.titleInput);
 *   await titleInput.fill('Hello');
 */
export class SelectorEngine {
  private page: Page;
  private cache: Map<string, Locator> = new Map();

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * 根据元素配置，使用多策略降级定位元素
   * @returns 第一个匹配到的可见 Locator
   * @throws 如果所有策略都失败
   */
  async locate(config: ElementConfig): Promise<Locator> {
    const timeout = config.timeout ?? 8000;
    const mustBeVisible = config.visible ?? true;
    const errors: string[] = [];

    for (const strategy of config.strategies) {
      try {
        const locator = this.buildLocator(strategy);

        if (mustBeVisible) {
          // 等待元素可见
          await locator.first().waitFor({ state: 'visible', timeout: timeout / config.strategies.length });
        } else {
          // 只等待元素存在于 DOM
          await locator.first().waitFor({ state: 'attached', timeout: timeout / config.strategies.length });
        }

        // 验证确实找到了
        const count = await locator.count();
        if (count > 0) {
          console.log(`  [Selector] ✅ "${config.description}" 定位成功 → ${strategy.type}:"${strategy.value}"`);
          return locator.first();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
        errors.push(`${strategy.type}:"${strategy.value}" → ${msg}`);
      }
    }

    // 所有策略失败
    const errorDetail = errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n');
    throw new Error(
      `[Selector] ❌ "${config.description}" 所有定位策略均失败:\n${errorDetail}`
    );
  }

  /**
   * 尝试定位，如果失败返回 null（不抛异常）
   * 适用于可选元素（如封面上传按钮可能不存在）
   */
  async locateOptional(config: ElementConfig): Promise<Locator | null> {
    try {
      return await this.locate(config);
    } catch {
      console.log(`  [Selector] ⏭️  "${config.description}" 未找到（可选，跳过）`);
      return null;
    }
  }

  /**
   * 等待任一策略的元素出现（不需要立即交互时使用）
   */
  async waitForAny(config: ElementConfig): Promise<boolean> {
    const timeout = config.timeout ?? 8000;

    const promises = config.strategies.map(async (strategy) => {
      try {
        const locator = this.buildLocator(strategy);
        await locator.first().waitFor({ state: 'visible', timeout });
        return true;
      } catch {
        return false;
      }
    });

    const results = await Promise.allSettled(promises);
    return results.some(r => r.status === 'fulfilled' && r.value === true);
  }

  /**
   * 根据策略类型构建 Playwright Locator
   */
  private buildLocator(strategy: SelectorStrategy): Locator {
    const { type, value, near, exact } = strategy;

    switch (type) {
      case 'css':
        return this.page.locator(value);

      case 'placeholder':
        return this.page.getByPlaceholder(value, { exact: exact ?? false });

      case 'text':
        return this.page.getByText(value, { exact: exact ?? false });

      case 'role': {
        const role = value as any;
        const options: any = {};
        if (near) options.name = near;
        if (exact !== undefined) options.exact = exact;
        return this.page.getByRole(role, options);
      }

      case 'label':
        return this.page.getByLabel(value, { exact: exact ?? false });

      case 'testid':
        return this.page.getByTestId(value);

      default:
        throw new Error(`[Selector] 未知策略类型: ${type}`);
    }
  }

  /**
   * 清除定位缓存（页面跳转后调用）
   */
  clearCache(): void {
    this.cache.clear();
  }
}
