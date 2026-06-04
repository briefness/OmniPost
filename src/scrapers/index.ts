/**
 * 采集器统一入口
 * 提供工厂方法创建对应引擎的采集器实例
 */
import { BrowserContext } from 'playwright';
import { BaseSearchScraper } from './BaseSearchScraper.js';
import { DeepSeekScraper } from './DeepSeekScraper.js';
import { KimiScraper } from './KimiScraper.js';
import { YuanbaoScraper } from './YuanbaoScraper.js';
import { MetasoScraper } from './MetasoScraper.js';

/** 所有支持的搜索引擎 ID */
export const SUPPORTED_ENGINES = ['deepseek', 'kimi', 'yuanbao', 'metaso'] as const;
export type EngineId = typeof SUPPORTED_ENGINES[number];

/**
 * 创建指定引擎的采集器实例
 */
export function createScraper(engine: string, context: BrowserContext): BaseSearchScraper {
  switch (engine) {
    case 'deepseek':
      return new DeepSeekScraper(context);
    case 'kimi':
      return new KimiScraper(context);
    case 'yuanbao':
      return new YuanbaoScraper(context);
    case 'metaso':
      return new MetasoScraper(context);
    default:
      throw new Error(`不支持的引擎: ${engine}。支持: ${SUPPORTED_ENGINES.join(', ')}`);
  }
}

export { BaseSearchScraper, DeepSeekScraper, KimiScraper, YuanbaoScraper, MetasoScraper };
