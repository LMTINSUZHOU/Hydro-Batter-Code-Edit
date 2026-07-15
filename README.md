# Hydro Batter Code Edit

这是一个面向 HydroOJ 默认 UI 的 Monaco 代码编辑器增强插件。它不需要额外部署语言服务器，在浏览器内提供：

- 竞赛编程补全：覆盖 C、C++、Python、Java、Kotlin、Go、Rust、C#、JavaScript 等常用语言。
- 代码模板：从命令面板、右键菜单或快捷键插入各语言的完整提交模板。
- 代码格式化：优先使用 Monaco 已注册的格式化能力，并为常用 OJ 语言提供保守的缩进/空白格式化。
- 即时代码诊断：检查括号、全角符号、Git 冲突标记、可疑空语句、入口函数、Java `Main` 类和 Python 混合缩进。
- 自动保存：按用户、域、题目、比赛和语言隔离地保存浏览器本地草稿；空编辑器会自动恢复最近草稿。
- 提交页 Monaco：把 Hydro 原本的提交页文本框升级为 Monaco，同时也增强题目页的 Scratchpad Monaco。

## 安装

运行环境需要 Node.js 22+、HydroOJ 5.0+ 和 `@hydrooj/ui-default` 4.58+。

```bash
git clone git@github.com:LMTINSUZHOU/Hydro-Batter-Code-Edit.git
cd Hydro-Batter-Code-Edit
npm install
npm run check
hydrooj addon add "$(pwd)"
```

重启 HydroOJ。Hydro 会在启动时发现 `frontend/*.page.ts` 并将前端入口编译进默认 UI。

## 使用

打开普通题目、比赛题目或作业题目的 Scratchpad，或直接进入提交页。插件会自动识别 Hydro 语言设置中的 `monaco` 模式。

| 操作 | 快捷键 |
| --- | --- |
| 插入代码模板 | <kbd>Ctrl/Cmd</kbd> + <kbd>Alt</kbd> + <kbd>T</kbd> |
| 格式化文档 | <kbd>Shift</kbd> + <kbd>Alt</kbd> + <kbd>F</kbd> |
| 立即保存本地草稿 | <kbd>Ctrl/Cmd</kbd> + <kbd>S</kbd> |
| 查看所有命令 | <kbd>Ctrl/Cmd</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> |

恢复和清除草稿也可以从 Monaco 右键菜单或命令面板执行。

## 配置

安装后可在“控制面板 → 系统设置 → Batter Code Editor”中调整：

- 各项能力的总开关；
- 自动保存和诊断的防抖时间；
- 本地草稿保留天数；
- 提交页 Monaco 高度。

配置通过 `UiContext` 以只读形式传到浏览器，不提供修改系统状态的前端接口。草稿只保存在当前浏览器的 `localStorage`，不会上传到服务端。

## 诊断边界

插件诊断是即时、轻量的静态检查，不等同于编译器或语言服务器。它能提前发现常见输入错误，但最终语法、类型与运行结果仍以 Hydro 评测机为准。插件使用独立的 Monaco marker owner，不会覆盖 JavaScript/TypeScript 等语言已有的诊断。

## 开发与验证

```bash
npm run typecheck
npm test
npm run check
```

核心模板、格式化、诊断与草稿逻辑位于 `src/`，浏览器集成入口位于 `frontend/editor-enhancer.page.ts`，Hydro 后端设置和 `UiContext` 注入位于 `index.ts`。

## License

MIT
