// 把 web-dist/ 發佈到 gh-pages 分支（GitHub Pages）
// 用 git 底層指令直接把資料夾做成一個 commit，接在遠端 gh-pages 最新一筆後面，一般 push 即可，不需要強制推送。
// 不動目前分支、工作區與暫存區。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'web-dist');
const BRANCH = 'gh-pages';
const git = (args, env = {}) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } }).trim();

if (!fs.existsSync(path.join(OUT, 'index.html'))) throw new Error('web-dist 不存在，先跑 npm run build:web');
if (fs.existsSync(path.join(OUT, '_test'))) throw new Error('web-dist/_test 是本機測試照片，不能發佈；重新 npm run build:web 會清掉');

const index = path.join(os.tmpdir(), `photolab-ghpages-${process.pid}.index`);
try {
  const env = { GIT_INDEX_FILE: index };
  git(['--work-tree', OUT, 'add', '-A', '.'], env);
  const tree = git(['write-tree'], env);
  let parent = '';
  try { git(['fetch', 'origin', BRANCH]); parent = git(['rev-parse', 'FETCH_HEAD']); } catch { /* 第一次發佈，還沒有這個分支 */ }
  if (parent && git(['rev-parse', `${parent}^{tree}`]) === tree) { console.log('網頁版內容沒有變，不用發佈'); process.exit(0); }
  const src = git(['rev-parse', '--short', 'HEAD']);
  const commit = git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', `deploy: 網頁版（來源 ${src}）`]);
  git(['push', 'origin', `${commit}:refs/heads/${BRANCH}`]);
  console.log(`已發佈 ${commit.slice(0, 7)} 到 ${BRANCH}`);
} finally {
  fs.rmSync(index, { force: true });
}
