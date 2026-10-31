import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const password = 'yanxin2026';
export const proposalText = (unit: string, person = '测试甲') => `科研诚信与自然资源数据治理研究\n申报单位：${unit}\n负责人：${person}\n一、立项背景\n科研诚信与自然资源数据治理具有研究价值。\n二、研究内容\n研究自然资源数据质量管理、科研诚信及数据治理。\n三、技术路线\n通过数据采集、质量核验、政策检索进行科研诚信研究。\n四、创新点\n构建可溯源的科研诚信检查方法。\n五、考核指标\n形成研究报告与数据集。\n六、经费预算\n预算十万元。\n七、团队分工\n负责人统筹，团队开展数据治理。\n八、研究基础\n已有自然资源调查研究基础。\n科研诚信承诺、数据安全、知识产权及参考文献须人工核对。`;

export type Doc = { id: string; name: string };
type Server = { url: string; pid: number };
export const test = base.extend<{ server: Server; app: Page; documents: Doc[] }>({
  server: async ({}, use, testInfo) => {
    const data = await mkdtemp(path.join(tmpdir(), 'yanxin-e2e-'));
    const executable = process.env.E2E_PYTHON || 'python3';
    let logs = '';
    const child = spawn(executable, [path.join(root, 'frontend/e2e/server.py'), data], {
      cwd: root, env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // 所有路径（启动失败、断言失败、正常退出）都执行清理。
    let spawnError: Error | undefined;
    const stopped = new Promise<void>(resolve => {
      child.once('exit', () => resolve());
      child.once('error', error => { spawnError = error; resolve(); });
    });
    child.stdout.on('data', chunk => { logs += chunk.toString(); });
    child.stderr.on('data', chunk => { logs += chunk.toString(); });
    try {
      let url = '';
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        if (spawnError) throw spawnError;
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(`E2E 后端提前退出：${logs}`);
        const match = logs.match(/\{"e2e_url": "(http:\/\/127\.0\.0\.1:\d+)"\}/);
        if (match) {
          url = match[1];
          try { if ((await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5000) })).ok) break; } catch { /* 启动中 */ }
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!url || !(await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5000) })).ok) throw new Error(`E2E 后端启动超时：${logs}`);
      await use({ url, pid: child.pid! });
    } finally {
      try {
        if (child.exitCode === null && child.signalCode === null && !spawnError) {
          child.kill('SIGTERM');
          const killTimer = setTimeout(() => child.kill('SIGKILL'), 3_000);
          await stopped;
          clearTimeout(killTimer);
        }
        if (testInfo.status !== testInfo.expectedStatus) {
          await testInfo.attach('backend.log', { body: logs, contentType: 'text/plain' });
        }
      } finally {
        await rm(data, { recursive: true, force: true });
      }
    }
  },
  baseURL: async ({ server }, use) => { await use(server.url); },
  context: async ({ context, server }, use, testInfo) => {
    const errors: string[] = [];
    const requests: string[] = [];
    const consoleMessages: string[] = [];
    const external: string[] = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (['http:', 'https:'].includes(url.protocol) && url.origin !== server.url) {
        external.push(url.origin);
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    context.on('page', page => {
      page.on('pageerror', error => errors.push(error.stack || error.message));
      page.on('console', message => { if (['error', 'warning'].includes(message.type())) consoleMessages.push(message.text()); });
      page.on('response', response => {
        const url = new URL(response.url());
        if (url.pathname.startsWith('/api/')) requests.push(`${response.status()} ${response.request().method()} ${url.pathname}`);
      });
      page.on('requestfailed', request => requests.push(`FAILED ${new URL(request.url()).pathname} ${request.failure()?.errorText}`));
    });
    await use(context);
    const diagnostics = testInfo.outputPath('browser-diagnostics.json');
    await writeFile(diagnostics, JSON.stringify({ errors, consoleMessages, requests, blockedExternalOrigins: external }, null, 2));
    await testInfo.attach('browser-diagnostics.json', { path: diagnostics, contentType: 'application/json' });
    for (const page of context.pages()) {
      if (!page.isClosed()) await expect(page.getByRole('heading', { name: '页面出了点意外', exact: true })).toHaveCount(0);
    }
    expect(consoleMessages.filter(message => message.startsWith('页面渲染错误')), 'React 捕获的渲染异常').toEqual([]);
    expect(errors, '未捕获的浏览器异常').toEqual([]);
    expect(external, '页面不得向外部服务请求资源').toEqual([]);
  },
  app: async ({ page, context }, use) => {
    const response = await context.request.post('/api/auth/login', { data: { username: 'manager', password } });
    expect(response.ok()).toBeTruthy();
    await page.goto('/welcome');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('工作台');
    await use(page);
  },
  documents: async ({ context, app: _app }, use) => {
    const docs: Doc[] = [];
    for (const [name, unit] of [['E2E甲本子', '沄州大学资源环境学院'], ['E2E乙本子', '独立测试研究院']]) {
      const response = await context.request.post('/api/documents', { multipart: {
        file: { name: `${name}.txt`, mimeType: 'text/plain', buffer: Buffer.from(proposalText(unit)) },
        title: name, kind: 'proposal', year: '2025',
      } });
      expect(response.ok()).toBeTruthy();
      docs.push((await response.json()).document);
    }
    await _app.reload();
    await expect(_app.getByRole('heading', { level: 1 })).toHaveText('工作台');
    await use(docs);
  },
});

export { expect };
export async function loginUI(page: Page, role = 'manager') {
  await page.goto('/');
  await page.getByLabel('用户名', { exact: true }).fill(role);
  await page.getByPlaceholder('请输入密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登 录', exact: true }).click();
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.locator('.app-shell')).not.toHaveAttribute('inert');
}
export async function navigate(page: Page, label: string) {
  if (await page.getByRole('button', { name: '打开导航' }).isVisible()) {
    await page.getByRole('button', { name: '打开导航' }).click();
  }
  await page.locator('.nav').getByRole('link', { name: label, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(label);
}
export async function downloadText(page: Page, action: () => Promise<unknown>, testInfo: TestInfo) {
  const pending = page.waitForEvent('download', { timeout: 10_000 });
  await action();
  const download = await pending;
  expect(await download.failure()).toBeNull();
  const destination = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(destination);
  return readFile(destination, 'utf8');
}
