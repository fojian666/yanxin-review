import { test, expect } from './fixtures';

test.use({ trace: 'off' });

test('趋势页在 25%–500% 全部标准缩放下保持可用', async ({ app: page }, testInfo) => {
  test.setTimeout(180_000);
  const scales = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
  for (const scale of scales) {
    const width = Math.max(320, Math.round(1440 / scale));
    const height = Math.max(240, Math.round(900 / scale));
    await page.setViewportSize({ width, height });
    await page.goto('/trend');
    await expect(page.locator('.trend-deck')).toBeVisible();
    for (const tab of ['分析设置', '趋势图表'] as const) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await page.waitForTimeout(250);
      const metrics = await page.evaluate(() => {
        const box = (selector: string) => {
          const element = document.querySelector<HTMLElement>(selector);
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          return {
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            clientWidth: element.clientWidth,
            clientHeight: element.clientHeight,
            scrollWidth: element.scrollWidth,
            scrollHeight: element.scrollHeight,
            overflowY: getComputedStyle(element).overflowY,
          };
        };
        return {
          document: {
            width: innerWidth,
            height: innerHeight,
            scrollWidth: document.documentElement.scrollWidth,
            scrollHeight: document.documentElement.scrollHeight,
          },
          controls: box('.trend-controls-page'),
          kpis: box('.trend-controls-page .kpi-grid'),
          chart: box('.trend-chart-page'),
          panels: [...document.querySelectorAll<HTMLElement>('.trend-chart-page .chart-panel')].map(panel => ({
            width: Math.round(panel.getBoundingClientRect().width),
            height: Math.round(panel.getBoundingClientRect().height),
            clientHeight: panel.clientHeight,
            scrollHeight: panel.scrollHeight,
          })),
        };
      });
      console.log(`TREND_ZOOM ${scale} ${tab} ${JSON.stringify(metrics)}`);
      await page.screenshot({
        path: testInfo.outputPath(`trend-zoom-${String(scale).replace('.', '_')}-${tab === '分析设置' ? 'analysis' : 'chart'}.png`),
      });
      expect(metrics.document.scrollWidth, `${scale} ${tab} 横向溢出`).toBeLessThanOrEqual(metrics.document.width + 1);
      expect(metrics.document.scrollHeight, `${scale} ${tab} 页面纵向溢出`).toBeLessThanOrEqual(metrics.document.height + 1);
      if (tab === '分析设置' && metrics.controls) {
        if (metrics.controls.scrollHeight > metrics.controls.clientHeight + 1) {
          expect(['auto', 'scroll'], `${scale} 分析设置裁切但没有内部滚动`).toContain(metrics.controls.overflowY);
          await page.locator('.trend-controls-page').hover();
          await page.mouse.wheel(0, 300);
          await expect.poll(() => page.locator('.trend-controls-page').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
        }
      }
      if (tab === '趋势图表') {
        expect(metrics.panels).toHaveLength(2);
        for (const panel of metrics.panels) {
          expect(panel.scrollHeight, `${scale} 图表内容裁切`).toBeLessThanOrEqual(panel.clientHeight + 5);
        }
        if (metrics.chart && metrics.chart.scrollHeight > metrics.chart.clientHeight + 1) {
          expect(['auto', 'scroll'], `${scale} 图表窗格裁切但没有内部滚动`).toContain(metrics.chart.overflowY);
          await page.locator('.trend-chart-page').hover();
          await page.mouse.wheel(0, 300);
          await expect.poll(() => page.locator('.trend-chart-page').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
        }
      }
    }
  }
});
