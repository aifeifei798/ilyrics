# ilyrics

本地 AI 歌词工作室：零依赖 Node 服务 + 浏览器前端，调用本机 llama.cpp（`127.0.0.1:8080`）生成 Suno 可直接粘贴的歌词三件套——歌名 / 全英文 style tags / 带段落标签的完整歌词。

![ilyrics screenshot](assets/screenshot.png)

## 功能

- **主题灵感**：100 个当下热门方向，🎲 随机灵感一键抽取；🎰 盲盒配方一键随机整套组合（歌手/风格/曲风/情绪/人声）
- **🔁 Remix**：扔一首歌的歌词进去，生成一首保留原作情绪骨架的全新改编
- **歌手（109）/ 风格（101）/ 曲风（50）**：下拉多选、一行 5 个、悬停提示、可搜索，控件间零联动
- **歌词语言多选**（中/英/日/韩/粤）、情绪多选、人声单选（男声/女声/男团/女团/男女对唱/合唱）
- **局部重写**：生成后按段落一键重写（只改 [Chorus] 等指定段，其余一字不动）
- **可编辑输出**：歌名与 style tags 直接改了保存进历史；行数字数与按 BPM 估算的时长统计
- **流式输出**：实时解析 + 真实 tok/s（读 llama.cpp timings），截断有兜底恢复
- **参数面板**：模型下拉（从上游 `/v1/models` 拉取）、temperature、max_tokens 滑杆
- **历史侧栏**：收藏（★置顶）、重命名、导出 txt，点条目一键回填全部选项（含 remix 原作）
- **PWA**：可安装，移动端自适应；style_tags 合并去重并自动规避真实艺人名

## 使用

```bash
./server.sh install    # 环境检查（node / 上游 llama.cpp）
./server.sh start      # 启动（默认端口 4100）
./server.sh status     # 状态
./server.sh restart    # 重启
./server.sh logs       # 日志
./server.sh stop       # 停止
```

打开 http://localhost:4100 即可。需要本机 llama.cpp 服务端在 `127.0.0.1:8080` 运行（server.js 内置 SSE 代理，绕过上游无 CORS 的限制）。

## 示例输出

```
Title: 末班地铁与未熄的灯

Style: Urban Melancholy, Lo-fi Hip Hop, Slow Tempo, Atmospheric

Lyrics:
[Verse]
屏幕的光刺眼
咖啡杯已凉透
键盘声敲得疲惫
灵魂在空转

[Chorus]
末班地铁呼啸
带走最后一丝清醒
工位灯还亮着
像守夜的幽灵
```

## License

MIT
