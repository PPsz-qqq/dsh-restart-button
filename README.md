# dsh-restart-button

在 DeepSeek Harness 会话标题栏的**右上角**加一个「重启」按钮（↻），点一下就能安全地重启整个客户端。

Adds a restart button (↻) to the top-right of the DeepSeek Harness session header. One click restarts the whole client safely.

![重启按钮位于会话标题栏右上角，右侧边栏开关左边](https://raw.githubusercontent.com/PPsz-qqq/dsh-restart-button/main/docs/preview.png)

## 功能

- **位置**：会话标题栏右侧工具区的最右端（`conversation.session.header.utilities`，order 1000），紧挨右侧边栏开关。
- **一键重启**：没有任务在运行时直接重启；有 Agent 正在运行或后台作业未结束时，会先弹窗确认，避免误中断。
- **桌面版（Windows）**：重启 Electron 外壳和后台 Host，新窗口自动打开，参数与原来一致。
- **dsh web**：重启服务进程，页面在服务恢复后自动刷新。
- 失败时弹窗说明原因，并给出日志路径 `~/.dsh/logs/restart-button.log`。

## 工作原理（桌面版）

DeepSeek Harness 桌面版由 Electron 主进程启动一个 Node 模式的 Host 子进程（它跑插件、会话和 Web 服务）。
点击按钮后：

1. 浏览器端向 `POST api/restart-button.restart` 发请求（走 DSH 自带的 Host/Origin 校验和浏览器鉴权）。
2. Host 启动一个**脱离进程树**的辅助程序（`detach.mjs` → `restart-desktop.ps1`），由它核对 Electron 主进程和 Host 的身份（可执行文件路径、父子关系）。
3. 辅助程序**挂起** Electron 主进程，使它察觉不到 Host 退出（不会弹出崩溃对话框、不会写崩溃报告）。
4. Host 断开与主进程的 IPC，走的正是桌面版退出时的同一条**优雅关闭**路径：会话落盘、插件逐个释放。
5. Host 退出后，辅助程序结束被冻结的主进程及其残留子进程，等端口 19387 释放后，用原来的参数重新启动 `DeepSeek Harness.exe`。

任何一步出错都会记录到日志；若在挂起后失败，辅助程序会恢复主进程，不会留下卡死的窗口。

## 配置

可在 profile 的 `cordis.patch.yml` 中调整确认策略：

```yaml
- id: restart-button
  config:
    confirm: when-busy   # when-busy（默认，仅在有任务运行时确认）| always（总是确认）| never（从不确认）
```

## 安装

在 DeepSeek Harness 的「插件」页面点「安装」，填入下面任意一种来源（也可以让 Agent 用 `plugin_manager install_bundle` 安装同样的来源）：

| 来源 | 填写内容 |
| --- | --- |
| GitHub Release 打包文件（推荐） | `https://github.com/PPsz-qqq/dsh-restart-button/releases/download/v0.1.2/dsh-restart-button-0.1.2.tgz` |
| GitHub 仓库 | `github:PPsz-qqq/dsh-restart-button#v0.1.2` |
| 本地打包文件 | `.tgz` 的绝对路径，例如 `C:\Users\<you>\.dsh\plugins\dsh-restart-button-0.1.2.tgz` |

安装后立即生效，无需重启。升级时先在插件页面移除旧版本再安装新版本；从本地 `.tgz` 安装的，在移除之前不要删除旧的 `.tgz` 文件。

自己打包：在仓库根目录运行 `pnpm pack`（或 `npm pack`），生成 `dsh-restart-button-<version>.tgz`。

## 接口

| 路由 | 方法 | 说明 |
| --- | --- | --- |
| `api/restart-button.status` | GET | 运行模式、是否支持、是否有任务在运行、确认策略、当前重启状态、日志路径 |
| `api/restart-button.restart` | POST（`content-type: application/json`）| 发起重启；校验通过后返回 202 |

## 限制

- 桌面版一键重启目前只支持 Windows；macOS / Linux 桌面版上按钮自动隐藏。
- dsh web 模式下，重启后的服务在后台运行，输出追加到 `~/.dsh/logs/restart-button-web-server.log`，不再占用原来的终端。
- 按钮在会话标题栏中，未打开任何会话（新建会话页）时不显示。

## 开发与测试

`test/` 里是不依赖真实客户端的端到端演练（不会打包进插件）：

- `dummy-main.mjs` + `dummy-host.mjs`：用两个 Node 进程模拟 Electron 主进程和 Host，跑一遍完整的桌面版流程（核对 → 挂起 → Host 优雅退出 → 结束主进程 → 用原参数重启），并检查主进程没有察觉 Host 退出、`ELECTRON_RUN_AS_NODE` 没有泄漏到新进程。
- `dummy-web.mjs`：模拟 `dsh web` 服务的重启。

```powershell
$env:RB_TEST_DIR = "$env:TEMP\rb-test"; New-Item -ItemType Directory $env:RB_TEST_DIR -Force | Out-Null
$env:RB_TEST_PORT = '19399'
Start-Process node -ArgumentList "$PWD\test\dummy-main.mjs" -WindowStyle Hidden   # 或 test\dummy-web.mjs
# 几秒后查看 $env:RB_TEST_DIR\events.log 与 restart.log（UTF-8）
```

每次演练前清空 `RB_TEST_DIR`。

## License

MIT
