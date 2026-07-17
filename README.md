# Hydro Batter Code Edit

这是一个面向 HydroOJ 默认 UI 的 Monaco 代码编辑器增强插件。它可以通过 Hydro 后端接入 clangd、Pyright 和 Eclipse JDT Language Server，并在语言服务器未安装、启动失败或尚未就绪时自动回退到浏览器内的 Tree-sitter 引擎：

- 真实 LSP 能力：C++ 使用 clangd、Python 使用 Pyright、Java 使用 JDT LS，按各服务器实际能力提供编译器级补全、参数提示、悬停文档、诊断和服务端格式化。
- Tree-sitter 增量语义补全：重点增强 C++、Python、Java，理解作用域、当前文件的变量/函数/类、用户自定义成员、链式返回类型和标准容器；其他常用语言继续提供关键字、标准库符号和代码片段。
- 自动导入与参数提示：接受候选时按需添加 C++ `#include`、Python/Java `import`，输入 `(` 或 `,` 时显示函数签名、重载和当前参数位置。
- 代码模板：从命令面板、右键菜单或快捷键插入各语言的完整提交模板。
- 代码格式化：优先使用 Monaco 已注册的格式化能力，并为常用 OJ 语言提供保守的缩进/空白格式化。
- 即时代码诊断：检查括号、全角符号、Git 冲突标记、可疑空语句、入口函数、Java `Main` 类和 Python 混合缩进。
- 自动保存：按用户、域、题目、比赛和语言隔离地保存浏览器本地草稿；空编辑器会自动恢复最近草稿。
- 只增强现有 Monaco：题目 Scratchpad 等已有编辑器会获得增强，普通提交 textarea 保持 Hydro 原样，不会额外生成代码框。
- 独立在线 IDE：顶栏新增“在线 IDE”，支持 C++、Python 3、Java 编写与自测运行，复用同一套 Monaco 补全/LSP，并通过 HydroJudge 的隔离沙箱执行。

## 安装

运行环境需要 Node.js 22+、HydroOJ 5.0+ 和 `@hydrooj/ui-default` 4.58+。

本插件仅支持 **Linux + PM2 + Nix** 部署。请使用运行 Hydro/PM2 的同一个 Unix 用户，在插件目录中执行安装脚本：

```bash
./install.sh
```

安装器要求服务器已有 Hydro 使用的 Node.js 22+、npm 和 Nix。它不会调用 `sudo`，不会执行任何系统包管理器，不会运行 `nix profile install`，也不会修改 PM2 配置。

| 安装位置 | 内容 | 用途 |
| --- | --- | --- |
| `node_modules` | Pyright、Tree-sitter WASM/语法包 | Python LSP 和浏览器语法分析 |
| `.hydro-batter-runtime/nix/clangd` | `nixpkgs#clang-tools` | C/C++ LSP |
| `.hydro-batter-runtime/nix/gcc` | `nixpkgs#gcc` | GNU C++ 标准库与 `bits/stdc++.h` |
| `.hydro-batter-runtime/nix/java` | `nixpkgs#jdk21` | JDT LS 的 Java 21 运行时 |
| `.hydro-batter-runtime/nix/jdtls` | `nixpkgs#jdt-language-server` | Java LSP |
| 仅回退时 | `python3`、`aria2` 和校验后的 Eclipse JDT LS 包 | 当前 nixpkgs 没有 JDT LS 时使用 |

Nix 组件只在缺失时构建，并为每项创建项目内 out-link/GC root；旧环境没有 channel 时使用 `nixpkgs` flake，但仍不写入任何 profile。插件后端优先解析 `.hydro-batter-runtime/bin` 中的绝对命令，因此不依赖交互式 shell 与 PM2 的 `PATH` 是否一致。

只检查环境而不修改任何文件可运行 `./install.sh --check`；插件开发环境使用 `./install.sh --dev`。安装器不会安装或替换 Hydro、PM2、Node.js、MongoDB，也不会改动现有 Nix profile。

JDT LS 优先使用 Nix 的 `jdt-language-server`，从而避开 Eclipse 站点缓慢的 48 MiB 单文件下载。仅当当前 nixpkgs 没有可用包时才回退到 Eclipse 官方包；回退下载使用 aria2 多连接，并把断点保存在 `.hydro-batter-runtime/cache`。网络受限时也可先用 `./install.sh --skip-jdtls` 完成 C++/Python 环境，或通过 `JDTLS_DOWNLOAD_URL` 指向可信的内网缓存；下载完成后仍会使用 Eclipse 官方 SHA-256 校验。

Pyright 已作为 npm 依赖随插件安装。也可以手动准备其他语言服务器：

- clangd：按[官方安装说明](https://clangd.llvm.org/installation.html)安装，确保 `clangd --version` 可运行，或在插件设置中填写绝对路径；
- JDT LS：按[官方说明](https://github.com/eclipse-jdtls/eclipse.jdt.ls#running-from-the-command-line-with-wrapper-script)准备 Java 21+ 和 `jdtls` wrapper，或在设置中填写 wrapper 的绝对路径；
- 三个服务器都通过标准输入输出通信，不需要额外开放网络端口。

```bash
git clone git@github.com:LMTINSUZHOU/Hydro-Batter-Code-Edit.git
cd Hydro-Batter-Code-Edit
git switch pre
./install.sh
hydrooj addon add "$(pwd)"
```

脚本不会自行重启服务。安装完成后先用 `pm2 list` 确认现有 Hydro 进程名，再执行 `pm2 restart <现有进程名>`；不需要 `--update-env`。Hydro 会在启动时发现 `frontend/*.page.ts` 并将前端入口编译进默认 UI。

## 卸载

卸载器只删除安装器在插件目录中创建的内容。建议先预览，再执行实际删除：

```bash
./uninstall.sh --dry-run
./uninstall.sh
```

默认删除 `.hydro-batter-runtime`（Nix out-link/GC root、命令链接、JDT LS 和缓存）以及 `node_modules`（Pyright、Tree-sitter）。如需保留 npm 依赖，可使用 `./uninstall.sh --keep-node-modules`。

卸载器不会注销 Hydro addon、停止或重启 PM2、运行 Nix 垃圾回收、删除仓库，也不会清除用户浏览器 `localStorage` 中的草稿。应另行在 Hydro 中停用/注销插件，并重启现有 PM2 进程。删除项目内 GC root 后，相应 Nix store 路径只会变成“可回收”，不会立即影响其他 Nix 环境。

## 使用

### 在线 IDE

登录后，顶栏“控制面板”右侧会出现“在线 IDE”。页面会从 Hydro 当前语言配置中分别选择一个启用的 C++、Python 3 和 Java 判题语言；可以填写标准输入，并点击“运行代码”或按 <kbd>Ctrl/Cmd</kbd> + <kbd>Enter</kbd> 自测。运行使用已经连接的 HydroJudge，与正式评测使用相同的编译器配置和沙箱边界；默认限制为 2 秒、256 MiB。

这个页面没有云保存、提交或分享功能，也不会创建 problem/record 文档。代码只在执行期间进入 Hydro 原有的短生命周期 `task` 队列，Judge 取走任务时即删除，超时任务也会主动清理。运行结果通过 PM2/Hydro 进程总线返回，不会出现在评测记录中。

为恢复“上次关闭时的样子”，页面仅在 `pagehide`/`beforeunload` 时把当前语言、各语言代码、标准输入、最近输出、光标和滚动位置按用户与域隔离写入当前浏览器的 `localStorage`。插件不会把这些工作区状态发送到 MongoDB；卸载脚本也不会删除浏览器中的这份本地状态。

在线 IDE 依赖站点已有并已连接的 HydroJudge，不会在 Hydro/PM2 进程里直接执行用户程序。`install.sh` 仍只准备 Monaco 语义分析所需的 clangd、Pyright、JDT LS、GCC 标准头和浏览器 Tree-sitter，不会额外安装或替换评测机编译器。

### 题目编辑器增强

打开普通题目、比赛题目或作业题目的 Scratchpad。插件会自动识别 Hydro 语言设置中的 `monaco` 模式；“递交以评测”等普通 textarea 页面不会被替换或追加编辑器。

输入符号前缀即可显示候选，例如 C++ 中输入 `qu` 得到 `queue`，Python 中输入 `pri` 得到带参数的 `print(...)`，Java 中输入 `Pri` 得到 `PriorityQueue`。候选出现后可按 <kbd>Tab</kbd>/<kbd>Enter</kbd> 或点击完成输入；只有一个普通符号匹配项时，即使候选框还没来得及出现，按 <kbd>Tab</kbd> 也会直接展开（如 `qu` → `queue`）。

在 C++ 的 `vector<int> values` 后输入 `values.pu`，会优先建议 `push_back(value)`；Python 的 `items.ap` 会得到 `append(value)`；Java 的 `Map` 变量输入 `.getO` 会得到 `getOrDefault(key, defaultValue)`。用户自定义方法的返回类型也会继续传播，例如 `graph.neighbors(1).ap` 可以根据 `neighbors` 的返回注解继续补全。插件也会补全 `#include <...>`、Python/Java 的 `import`、`std::`/`Arrays.`/`Math.` 等静态成员，以及当前文件中声明的函数与方法。函数候选使用 Monaco snippet，接受后可继续按 <kbd>Tab</kbd> 在参数占位之间移动。

编辑器右下角显示 `Batter 1.4.0-pre.1 · 补全已就绪 · 语法分析已就绪 · 语言服务器已就绪` 时，表示插件、Tree-sitter 和当前语言的 LSP 都已经挂载到 Monaco。后面的 `8 diagnostics` 表示当前文件共有 8 条轻量/LSP 诊断，橙色只是提醒存在问题，不是插件加载失败。插件会读取站点的 `LANGS` 配置，并兼容 `cpp`、`c_cpp`、`text/x-c++src`、`python3` 等常见别名。LSP 启动期间或连接失败时仍会使用 Tree-sitter 与静态目录补全，不会阻塞编辑器。

| 操作 | 快捷键 |
| --- | --- |
| 插入代码模板 | <kbd>Ctrl/Cmd</kbd> + <kbd>Alt</kbd> + <kbd>T</kbd> |
| 格式化文档 | <kbd>Shift</kbd> + <kbd>Alt</kbd> + <kbd>F</kbd> |
| 立即保存本地草稿 | <kbd>Ctrl/Cmd</kbd> + <kbd>S</kbd> |
| 查看所有命令 | <kbd>Ctrl/Cmd</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> |

恢复和清除草稿也可以从 Monaco 右键菜单或命令面板执行。

如果升级后仍显示旧版本，请重启 Hydro 服务并对题目页执行一次强制刷新。浏览器控制台中输入 `UiContext.hydroBatterCodeEdit` 可确认后端插件版本和可用的 `lspLanguages`，输入 `window.HydroBatterCodeEdit` 可以查看前端版本、Tree-sitter/LSP 状态、编辑器数量和补全调用次数；两个对象中的版本都应为 `1.4.0-pre.1`。

## 配置

安装后可在“控制面板 → 系统设置 → Batter Code Editor”中调整：

- 各项能力的总开关；
- LSP 总开关，以及 clangd、Pyright、JDT LS 的可执行文件路径；
- clangd 使用的受信任 C++ 编译器；默认 `auto`，优先使用 GNU `g++`；
- 全局/单用户最大 LSP 会话数、文档大小限制和空闲回收时间；
- 自动保存和诊断的防抖时间；
- 本地草稿保留天数；
- 在线 IDE 开关、运行时间/内存、每用户每分钟运行次数、标准输入大小和结果等待超时；

命令配置只在服务端读取，浏览器只能看到哪些语言服务器可用。草稿仍只保存在当前浏览器的 `localStorage`。

## 诊断边界

浏览器轻量诊断与真实 LSP 诊断使用不同的 Monaco marker owner，不会覆盖 Monaco 已有的诊断。clangd、Pyright、JDT LS 的结果比正则/Tree-sitter 推断准确，但编译参数、Python 环境和 Java classpath 仍可能与最终评测环境不同，运行结果以 Hydro 评测机为准。

`#include <bits/stdc++.h>` 是 GNU libstdc++ 提供的非标准聚合头。如果语言服务器已就绪但它仍显示 `file not found`，通常表示服务器只有 clangd、没有 GNU C++ 标准库，或 clangd 没找到评测所用的 GCC。运行 `./install.sh --check` 可同时验证 GNU 编译器和 clangd；插件会为每个 C++ 临时工作区生成受控的 `compile_commands.json`，并使用 `--query-driver` 从管理员配置的编译器获取系统头路径。

启用 LSP 后，当前编辑器代码会通过同源、需登录的 WebSocket 发送到 Hydro 后端，并写入该连接专属的临时工作区；连接关闭后工作区会删除。每个会话使用独立语言服务器进程，网关限制方法、文档 URI、消息大小、全局/单用户并发数和空闲时间，并使用 `shell: false` 启动管理员配置的可执行文件。语言服务器仍与 Hydro 运行在同一主机权限边界内，公开部署建议让 Hydro 使用专用低权限系统账户或容器运行。若站点不能接受代码进入后端，可关闭 `lspEnabled`，插件将恢复为完全浏览器内的 Tree-sitter 模式。

## 开发与验证

```bash
npm run typecheck
npm test
npm run check
```

LSP stdio/WebSocket 网关位于 `src/lsp-gateway.ts`，浏览器 LSP 客户端位于 `frontend/lsp-client.ts`；在线 IDE 的任务桥位于 `src/playground-runner.ts`，页面入口位于 `frontend/playground.page.ts`；通用 Monaco 集成入口仍是 `frontend/editor-enhancer.page.ts`，Hydro 设置、资源和连接注册位于 `index.ts`。

## License

MIT
