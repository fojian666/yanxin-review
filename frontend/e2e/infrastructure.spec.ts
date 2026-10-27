import { test, expect } from './fixtures';

test('隔离后端被信号终止后仍能完成fixture清理', async ({ server }) => {
  // pid只来自当前用例启动的临时服务器，绝不查找或操作开发服务。
  process.kill(server.pid, 'SIGKILL');
  await expect.poll(async () => {
    try { return (await fetch(`${server.url}/api/health`, { signal: AbortSignal.timeout(500) })).ok; }
    catch { return false; }
  }).toBe(false);
});
