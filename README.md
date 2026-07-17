# Hydro Batter Code Edit

这是一个面向 HydroOJ 默认 UI 的 Monaco 代码编辑器增强插件。它不需要额外部署语言服务器，在浏览器内提供：

- Tree-sitter 增量语义补全：重点增强 C++、Python、Java，理解作用域、当前文件的变量/函数/类、用户自定义成员、链式返回类型和标准容器；其他常用语言继续提供关键字、标准库符号和代码片段。
- 自动导入与参数提示：接受候选时按需添加 C++ `#include`、Python/Java `import`，输入 `(` 或 `,` 时显示函数签名、重载和当前参数位置。
- 代码模板：从命令面板、右键菜单或快捷键插入各语言的完整提交模板。
- 代码格式化：优先使用 Monaco 已注册的格式化能力，并为常用 OJ 语言提供保守的缩进/空白格式化。
- 即时代码诊断：检查括号、全角符号、Git 冲突标记、可疑空语句、入口函数、Java `Main` 类和 Python 混合缩进。
- 自动保存：按用户、域、题目、比赛和语言隔离地保存浏览器本地草稿；空编辑器会自动恢复最近草稿。
- 只增强现有 Monaco：题目 Scratchpad 等已有编辑器会获得增强，普通提交 textarea 保持 Hydro 原样，不会额外生成代码框。

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

打开普通题目、比赛题目或作业题目的 Scratchpad。插件会自动识别 Hydro 语言设置中的 `monaco` 模式；“递交以评测”等普通 textarea 页面不会被替换或追加编辑器。

输入符号前缀即可显示候选，例如 C++ 中输入 `qu` 得到 `queue`，Python 中输入 `pri` 得到带参数的 `print(...)`，Java 中输入 `Pri` 得到 `PriorityQueue`。候选出现后可按 <kbd>Tab</kbd>/<kbd>Enter</kbd> 或点击完成输入；只有一个普通符号匹配项时，即使候选框还没来得及出现，按 <kbd>Tab</kbd> 也会直接展开（如 `qu` → `queue`）。

在 C++ 的 `vector<int> values` 后输入 `values.pu`，会优先建议 `push_back(value)`；Python 的 `items.ap` 会得到 `append(value)`；Java 的 `Map` 变量输入 `.getO` 会得到 `getOrDefault(key, defaultValue)`。用户自定义方法的返回类型也会继续传播，例如 `graph.neighbors(1).ap` 可以根据 `neighbors` 的返回注解继续补全。插件也会补全 `#include <...>`、Python/Java 的 `import`、`std::`/`Arrays.`/`Math.` 等静态成员，以及当前文件中声明的函数与方法。函数候选使用 Monaco snippet，接受后可继续按 <kbd>Tab</kbd> 在参数占位之间移动。

编辑器右下角显示 `Batter 1.2.0 · 补全已就绪 · 语法分析已就绪` 时，表示插件和当前语言的 Tree-sitter 已经挂载到 Monaco。插件会读取站点的 `LANGS` 配置，并兼容 `cpp`、`c_cpp`、`text/x-c++src`、`python3` 等常见 Monaco/主题语言别名。语法 WASM 按当前语言懒加载并由浏览器长期缓存；加载期间或加载失败时仍会使用原有轻量补全，不会阻塞编辑器。

| 操作 | 快捷键 |
| --- | --- |
| 插入代码模板 | <kbd>Ctrl/Cmd</kbd> + <kbd>Alt</kbd> + <kbd>T</kbd> |
| 格式化文档 | <kbd>Shift</kbd> + <kbd>Alt</kbd> + <kbd>F</kbd> |
| 立即保存本地草稿 | <kbd>Ctrl/Cmd</kbd> + <kbd>S</kbd> |
| 查看所有命令 | <kbd>Ctrl/Cmd</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> |

恢复和清除草稿也可以从 Monaco 右键菜单或命令面板执行。

如果升级后仍显示旧版本，请重启 Hydro 服务并对题目页执行一次强制刷新。浏览器控制台中输入 `UiContext.hydroBatterCodeEdit` 可确认后端插件版本，输入 `window.HydroBatterCodeEdit` 可以查看前端版本、已注册语言、Tree-sitter 状态、编辑器数量、补全调用次数以及最近一次补全的上下文；两个对象中的版本都应为 `1.2.0`。

## 配置

安装后可在“控制面板 → 系统设置 → Batter Code Editor”中调整：

- 各项能力的总开关；
- 自动保存和诊断的防抖时间；
- 本地草稿保留天数；

配置通过 `UiContext` 以只读形式传到浏览器，不提供修改系统状态的前端接口。草稿只保存在当前浏览器的 `localStorage`，不会上传到服务端。

## 诊断边界

插件诊断是即时、轻量的静态检查，不等同于编译器或语言服务器。它能提前发现常见输入错误，但最终语法、类型与运行结果仍以 Hydro 评测机为准。插件使用独立的 Monaco marker owner，不会覆盖 JavaScript/TypeScript 等语言已有的诊断。

补全与 Tree-sitter 解析完全运行在浏览器中，服务端路由只提供静态 WASM 文件，不接收或分析用户代码，也不依赖 clangd、Pyright 或 JDT Language Server。它针对 OJ 常见的单文件代码、标准容器和标准库做作用域及类型推断；跨文件符号、复杂模板/泛型推导和编译器级准确性仍需要以后接入可选的语言服务器才能实现。

## 开发与验证

```bash
npm run typecheck
npm test
npm run check
```

核心模板、格式化、诊断与草稿逻辑位于 `src/`，浏览器集成入口位于 `frontend/editor-enhancer.page.ts`，Hydro 后端设置和 `UiContext` 注入位于 `index.ts`。

## License

MIT
