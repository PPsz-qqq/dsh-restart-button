# dsh-restart-button

在 DeepSeek Harness 会话标题栏的**右上角**加一个「重启」按钮（↻），点一下就能安全地重启整个客户端。

Adds a restart button (↻) to the top-right of the DeepSeek Harness session header. One click restarts the whole client safely.

![重启按钮位于会话标题栏右上角，右侧边栏开关左边](https://raw.githubusercontent.com/PPsz-qqq/dsh-restart-button/main/docs/preview.png)

## 功能

- **位置**：会话标题栏右侧工具区的最右端（`conversation.session.header.utilities`，order 1000），紧挨右侧边栏开关。
- **一键重启**：没有任务在运行时直接重启。
- **跑完后再重启**：有会话正在运行或后台作业未结束时，确认框里多一个「跑完后重启」。选它之后按钮变成蓝色并带一个闪烁的小点，所有任务结束后自动重启；再点按钮可以「取消安排」或「立即重启」。
- **重启后接着干**：重启前会记下你当前打开的会话和被中断的会话。重启完成后自动回到原来的会话，并弹出卡片「重启前有 N 个会话正在运行」，点「全部继续」就向这些会话发送"继续"，也可以逐个点开。
- **插件更新提醒**：插件被原地更新（升级或重装）后，新代码要重启才会加载。插件会发现这种情况，在按钮上显示一个橙色小点，并弹出卡片「插件更新待生效：名称 旧版本 → 新版本」，可以「立即重启」或「稍后」。
- **悬停查看运行状态**：鼠标放在按钮上会显示 Host 已运行多久、占用多少内存、几个会话正在运行、是否已安排重启、有几个插件更新等待生效。
- **桌面版（Windows）**：重启 Electron 外壳和后台 Host，新窗口自动打开，参数与原来一致。
- **dsh web**：重启服务进程，页面在服务恢复后自动刷新。
- 失败时弹窗说明原因，并给出日志路径 `~/.dsh/logs/restart-button.log`。

## 工作原理（桌面版）

DeepSeek Harness 桌面版由 Electron 主进程启动一个 Node 模式的 Host 子进程（它跑插件、会话和 Web 服务）。
点击按钮后：

1. 浏览器端向 `POST api/restart-button.restart` 发请求（走 DSH 自带的 Host/Origin 校验和浏览器鉴权）。
2. Host 把当前会话和正在运行的会话写进 `~/.dsh/restart-button/last-restart.json`，供重启后的 Host 读取。
3. Host 启动一个**脱离进程树**的辅助程序（`detach.mjs` → `restart-desktop.ps1`），由它核对 Electron 主进程和 Host 的身份（可执行文件路径、父子关系）。
4. 辅助程序**挂起** Electron 主进程，使它察觉不到 Host 退出（不会弹出崩溃对话框、不会写崩溃报告）。
5. Host 断开与主进程的 IPC，走的正是桌面版退出时的同一条**优雅关闭**路径：会话落盘、插件逐个释放。
6. Host 退出后，辅助程序结束被冻结的主进程及其残留子进程，等端口 19387 释放后，用原来的参数重新启动 `DeepSeek Harness.exe`。

任何一步出错都会记录到日志；若在挂起后失败，辅助程序会恢复主进程，不会留下卡死的窗口。

「跑完后重启」由 Host 每秒检查一次：连续 3 秒没有运行中的 Agent 回合、排队消息或后台作业，就按上面的流程重启（会先留 1.5 秒让页面显示"正在重启"）。

「插件更新提醒」的判断方法：Host 记下本进程加载过的每个插件的版本和来源。Node 会缓存已加载的模块，所以之后磁盘上的版本或来源一旦变化（原地更新，或先移除再安装），都算待生效；本进程从未加载过的新插件会直接热加载，不算。

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
| 插件市场 dshmarket | 搜索 `dsh-restart-button`（作者 PPsz-qqq），一键安装 |
| GitHub Release 打包文件（推荐） | 最新版：`https://github.com/PPsz-qqq/dsh-restart-button/releases/latest/download/dsh-restart-button.tgz`；指定版本：`https://github.com/PPsz-qqq/dsh-restart-button/releases/download/v0.2.0/dsh-restart-button-0.2.0.tgz` |
| GitHub 仓库 | `github:PPsz-qqq/dsh-restart-button#v0.2.0` |
| 本地打包文件 | `.tgz` 的绝对路径，例如 `C:\Users\<you>\.dsh\plugins\dsh-restart-button-0.2.0.tgz` |

第一次安装立即生效，无需重启。

**升级需要重启一次**：Node 会在整个进程生命周期内缓存已加载的模块，所以已加载过的插件，无论是原地安装新版本，还是先移除再安装，后台 Host 部分都要重启后才会换成新代码（界面部分会先更新）。安装新版本后按钮会出现橙色小点和「插件更新待生效」卡片，点「立即重启」即可。从本地 `.tgz` 安装的，升级前不要删除旧的 `.tgz` 文件。

自己打包：在仓库根目录运行 `pnpm pack`（或 `npm pack`），生成 `dsh-restart-button-<version>.tgz`。

## 接口

所有 POST 都要求 `content-type: application/json`。

| 路由 | 方法 | 说明 |
| --- | --- | --- |
| `api/restart-button.status` | GET | 运行模式、是否支持、确认策略、运行时长与内存（`runtime`）、正在运行的会话（`busySessions`）、当前重启状态、已安排的重启（`scheduled`）、待生效的插件更新（`pendingPlugins`）、重启后的恢复信息（`resume`）、日志路径 |
| `api/restart-button.restart` | POST `{ when?: 'now' \| 'idle', activeSessionId?: string }` | 立即重启（202）；`when: 'idle'` 且有任务运行时改为安排重启（202，`scheduled: true`） |
| `api/restart-button.cancel` | POST `{}` | 取消已安排的重启 |
| `api/restart-button.resume-ack` | POST `{ id, action? }` | 标记重启后的恢复信息已处理 |

## 限制

- 桌面版一键重启目前只支持 Windows；macOS / Linux 桌面版上按钮自动隐藏。
- dsh web 模式下，重启后的服务在后台运行，输出追加到 `~/.dsh/logs/restart-button-web-server.log`，不再占用原来的终端。
- 按钮在会话标题栏中，未打开任何会话（新建会话页）时不显示；提示卡片在任何页面都会出现。
- 恢复信息只在重启后 10 分钟内有效；「全部继续」发送的是普通用户消息"继续"（英文界面为 "Continue"）。
- 「已安排的重启」保存在当前 Host 进程里，插件被重新加载或客户端被手动关闭后会失效。

## 开发与测试

`test/` 里的测试都不依赖真实客户端，也不会打包进插件：

| 文件 | 内容 | 运行 |
| --- | --- | --- |
| `host.test.mjs` | Host 端全部路由：活动判定、跑完后重启、取消、恢复记录、插件更新检测、失败回滚 | `node test/host.test.mjs` |
| `client.test.cjs` | 用真实 React 18 + jsdom 渲染按钮和卡片，对接模拟的 Host | 先在任意目录 `pnpm add react@18 react-dom@18 jsdom`，再 `RB_CLIENT_DEPS=<该目录> node test/client.test.cjs` |
| `dummy-main.mjs` + `dummy-host.mjs` | 用两个 Node 进程模拟 Electron 主进程和 Host，完整演练桌面版重启：核对 → 挂起 → Host 优雅退出 → 结束主进程 → 用原参数重启 | 见下 |
| `dummy-web.mjs` | 模拟 `dsh web` 服务的重启 | 见下 |

```powershell
$env:RB_TEST_DIR = "$env:TEMP\rb-test"; New-Item -ItemType Directory $env:RB_TEST_DIR -Force | Out-Null
$env:RB_TEST_PORT = '19399'
Start-Process node -ArgumentList "$PWD\test\dummy-main.mjs" -WindowStyle Hidden   # 或 test\dummy-web.mjs
# 几秒后查看 $env:RB_TEST_DIR\events.log 与 restart.log（UTF-8）；每次演练前清空 RB_TEST_DIR
```

### 发布清单

1. 更新 `package.json` 的版本号和 `CHANGELOG.md`，跑一遍上面的测试。
2. `pnpm pack` 生成 `dsh-restart-button-<version>.tgz`。
3. 打标签 `v<version>` 并推送，创建同名 GitHub Release，上传**两个**资产：`dsh-restart-button-<version>.tgz`，以及同一文件的无版本号副本 `dsh-restart-button.tgz`。插件市场条目里的 `releases/latest/download/dsh-restart-button.tgz` 依赖后者。

## License

MIT
