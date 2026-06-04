import { Page } from 'playwright';

/**
 * 鼠标轨迹模拟器
 * 使用贝塞尔曲线生成自然的鼠标移动轨迹，避免被平台通过直线移动检测
 */
export class MouseHelper {
  /**
   * 以贝塞尔曲线轨迹将鼠标从当前位置移动到目标坐标
   * @param page - Playwright Page 实例
   * @param targetX - 目标 X 坐标
   * @param targetY - 目标 Y 坐标
   * @param steps - 轨迹采样点数（越多越平滑，但越慢）
   */
  static async moveTo(page: Page, targetX: number, targetY: number, steps: number = 25): Promise<void> {
    // 获取当前鼠标位置（通过注入脚本追踪）
    let currentPos = { x: Math.random() * 200 + 100, y: Math.random() * 200 + 100 };
    try {
      currentPos = await page.evaluate(() => {
        return {
          x: (window as any).__mouseX || Math.random() * 200 + 100,
          y: (window as any).__mouseY || Math.random() * 200 + 100,
        };
      });
    } catch {
      // 页面可能在导航中，使用默认位置
    }

    const startX = currentPos.x;
    const startY = currentPos.y;

    // 生成贝塞尔曲线控制点（随机偏移，模拟人手抖动）
    const points = this.generateBezierPath(startX, startY, targetX, targetY, steps);

    // 沿轨迹逐点移动
    for (const point of points) {
      await page.mouse.move(point.x, point.y);
      // 每步之间添加微小随机延迟（2-8ms），模拟人手速度波动
      await new Promise(resolve => setTimeout(resolve, Math.random() * 6 + 2));
    }

    // 更新追踪的鼠标位置
    try {
      await page.evaluate(({ x, y }) => {
        (window as any).__mouseX = x;
        (window as any).__mouseY = y;
      }, { x: targetX, y: targetY });
    } catch {
      // 静默忽略
    }
  }

  /**
   * 以贝塞尔曲线移动鼠标到元素中心并点击
   * @param page - Playwright Page 实例
   * @param selector - CSS 选择器
   */
  static async moveAndClick(page: Page, selector: string): Promise<void> {
    const element = page.locator(selector);
    // 等待元素可见再操作
    await element.waitFor({ state: 'visible', timeout: 5000 });

    const box = await element.boundingBox();

    if (!box) {
      throw new Error(`[MouseHelper] 元素不可见或不存在: ${selector}`);
    }

    // 目标点添加微小随机偏移，不总是精确中心（更像真人）
    const targetX = box.x + box.width * (0.3 + Math.random() * 0.4);
    const targetY = box.y + box.height * (0.3 + Math.random() * 0.4);

    await this.moveTo(page, targetX, targetY);

    // 确保鼠标追踪已初始化
    await this.ensureTracking(page);

    // 点击前微停顿（人类反应时间）
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));
    await page.mouse.click(targetX, targetY);
  }

  /**
   * 生成三次贝塞尔曲线路径点
   * 使用两个随机控制点制造自然弧度
   */
  private static generateBezierPath(
    startX: number, startY: number,
    endX: number, endY: number,
    steps: number
  ): Array<{ x: number; y: number }> {
    const points: Array<{ x: number; y: number }> = [];

    // 计算两点间距离，用于决定控制点偏移量
    const distance = Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2);
    const offsetRange = distance * 0.3; // 控制点最大偏移为距离的30%

    // 随机生成两个控制点（三次贝塞尔曲线）
    const cp1x = startX + (endX - startX) * 0.25 + (Math.random() - 0.5) * offsetRange;
    const cp1y = startY + (endY - startY) * 0.25 + (Math.random() - 0.5) * offsetRange;
    const cp2x = startX + (endX - startX) * 0.75 + (Math.random() - 0.5) * offsetRange;
    const cp2y = startY + (endY - startY) * 0.75 + (Math.random() - 0.5) * offsetRange;

    // 采样贝塞尔曲线
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const mt = 1 - t;
      const mt2 = mt * mt;
      const mt3 = mt2 * mt;

      // 三次贝塞尔公式: B(t) = (1-t)³P₀ + 3(1-t)²tP₁ + 3(1-t)t²P₂ + t³P₃
      const x = mt3 * startX + 3 * mt2 * t * cp1x + 3 * mt * t2 * cp2x + t3 * endX;
      const y = mt3 * startY + 3 * mt2 * t * cp1y + 3 * mt * t2 * cp2y + t3 * endY;

      // 添加微小抖动（模拟手部肌肉震颤，±1px）
      const jitterX = (Math.random() - 0.5) * 2;
      const jitterY = (Math.random() - 0.5) * 2;

      points.push({
        x: Math.round(x + jitterX),
        y: Math.round(y + jitterY),
      });
    }

    return points;
  }

  /**
   * 确保鼠标追踪已初始化（安全的懒加载模式）
   * 只在第一次需要时注入，且忽略注入失败（不影响主流程）
   */
  private static async ensureTracking(page: Page): Promise<void> {
    try {
      const alreadyInit = await page.evaluate(() => (window as any).__mouseTrackingInit);
      if (alreadyInit) return;
    } catch {
      // 页面可能还在导航中，静默忽略
      return;
    }

    try {
      await page.evaluate(() => {
        (window as any).__mouseTrackingInit = true;
        document.addEventListener('mousemove', (e) => {
          (window as any).__mouseX = e.clientX;
          (window as any).__mouseY = e.clientY;
        });
      });
    } catch {
      // 注入失败不影响主流程
    }
  }
}
