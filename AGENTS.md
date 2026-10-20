# ilyrics

零依赖 AI 歌词工作室：`server.js`（只用 Node 标准库）在 4100 端口提供静态文件 + SSE 代理（`/api/generate`、`/api/models`），转发到本机 llama.cpp `127.0.0.1:8080`（上游无 CORS，必须走代理）。前端无构建、无模块：`index.html` 依次加载 `presets.js`（`window.PRESETS` 数据：歌手/风格/曲风/术语表/结构模板）和 `app.js`（全部逻辑，单文件浏览器脚本）。运行时零依赖，devDeps 只有 Tailwind。

## 命令

- `./server.sh start|status|restart|logs|stop` — 服务生命周期；日志在 `/tmp/opencode/ilyrics-server.log`；端口固定 4100
- `npm test` = `node --test test/*.test.js` — 必须传 glob，只传目录在 Node 24 下会失败；单测：`node --test --test-name-pattern '…' test/format.test.js`
- `npm run build` — 从 `tailwind.src.css` 重新生成 `tailwind.css`。**样式只改 `tailwind.src.css`**，`tailwind.css` 是提交进仓库的构建产物，不要手改
- `node --check app.js` — 语法自检（app.js 不被构建，改完必查）

## 测试约定

`test/format.test.js` 用正则 `^function name\b[\s\S]*?^}` 从 `app.js` 源码里抠出顶层纯函数再 eval。要进单测的新函数必须：顶层 `function` 声明、闭合的 `}` 在行首、不依赖 `state`/DOM。`eval` 名单在测试第 8 行，加函数时同步更新。

## Suno v6 格式铁律（不可破坏）

标签行全大写、不含数字标点（`[Verse 2]` → `[VERSE]`），竖线修饰词保留（`[CHORUS | anthemic]`），段间恰好空一行，末行 `[END]`，正文行 6–12 单位。由 `canonTagLine` / `normalizeLyrics` / `normalizeBlock` / `spliceRewritten` 强制，全部有回归测试。可唱性 = 押韵×60 + 音节×40（十三辙表在 `rhymeKey`），修复阈值统一 75。

## 验证套路

- file:// 页面到不了 API：模型实测用 node 脚本直接 POST `http://127.0.0.1:4100/api/generate`（复制 app.js 里的 prompt，SSE 按 `data:` 行解析），脚本放 `/tmp/opencode/`。
- UI 探针：复制页面到 `/tmp/opencode/h.html`，在 `</body>` 前注入探针 `<script>`（隐藏 div 输出结果），跑 `google-chrome --headless --disable-gpu --virtual-time-budget=2500 --dump-dom file:///tmp/opencode/h.html`。headless 里**不要点导出类按钮**。
- 生成类实测串行跑（本地 llama.cpp 显存有限），轻量 read/grep 可并行。

## Git 约定

提交固定用 GitHub noreply 身份（本机 git config 是另一个身份，直接用会归错作者）：

```bash
git -c core.user.name="aifeifei798" -c core.user.email="aifeifei798@users.noreply.github.com" commit -m "…"
git push origin master
```

README.md 是功能清单——改行为时同步对应条目，用户可见的新特性要写、内部重构不写。
