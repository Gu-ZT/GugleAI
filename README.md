# GugleAI

[English](README.en.md) | 简体中文

一个基于 Tauri 2 + Vue 3 的桌面图像生成客户端，适配 OpenAI 图像接口（如 `gpt-image-2`）及兼容的第三方中转服务。

## 功能

- **多工作区**:左侧窄导航栏可在图像生成、文字聊天和无尽画布之间切换,三个工作区由独立 Vue Router 页面承载
- **自定义连接**:原侧栏配置集中到独立设置页面;API 端点和 API Key 成对保存为连接配置,可从同一个下拉菜单切换,并通过独立弹出层添加或编辑每个连接的可用模型列表;Key 仅显示脱敏摘要;端点不带 `/v1` 时自动补全
- **分类设置**:设置页面使用独立侧边栏和子路由,分为模型设置、通用设置和日志;连接与默认模型、自动更新、运行日志分别管理
- **文字聊天**:通过 `/chat/completions` 进行连续文字对话,文字模型可直接输入并保存为选项,复用当前 API 连接和系统代理
- **无尽画布**:支持无限平移和缩放,每个节点可独立选择 API 连接和该连接的模型;文字生成会创建并连接新的文字子节点;上传或生成的图片节点只作为参考图输入,连接到新的空图像节点后可一次生成多张图片子节点
- **粘贴导入配置**:直接 Ctrl+V 粘贴连接配置自动添加并切换到对应连接,支持 newapi 渠道 JSON(`{"_type":"newapi_channel_conn",...}`)和 Codex CLI `config.toml`(提取 `base_url`)
- **文生图**:输入提示词调用 `/images/generations` 生成图片
- **参考图编辑**:添加任意数量的参考图,支持文件选择、拖拽和剪贴板粘贴
- **接口模式**:自动 / Images 接口 / Chat 接口三种模式;自动模式下多参考图改走 `/chat/completions`,兼容 edits 只支持单图的中转服务
- **生图配置**:接口模式、尺寸、数量和请求重试集中在生图页面;可按 HTTP 错误码自动重试生成请求,错误码支持下拉多选并保存自定义选项
- **生成控制**:生成期间可停止当前任务,同时取消 API 请求、重试等待和结果下载
- **诊断日志**:记录生成请求的任务编号、阶段、耗时、请求体大小、代理状态和脱敏后的错误详情,便于排查超时及传输失败
- **生成参数**:支持选择尺寸(1024×1024 / 横版 / 竖版 / 自动)和生成数量
- **预览历史**:每次生成的图片和提示词会追加到预览区域并在重启后恢复,支持双击放大,以及右键复制图片或提示词、设为参考图、保存或删除图片,也可一键清空全部预览
- **结果保存**:兼容 `b64_json`、图片 URL(含相对路径)、Chat 内嵌 base64 等返回格式,一键保存到本地

## 下载

前往 [Releases](../../releases) 页面下载对应平台的安装包,支持 Windows(x86 / x86_64 / arm64)、Linux(x86_64 / arm64)和 macOS(Intel / Apple Silicon)。

## 开发

依赖:[Node.js 20.19+](https://nodejs.org/)、[pnpm](https://pnpm.io/)、[Rust](https://www.rust-lang.org/)。

前端使用 Vue Router Hash History 管理 `/image`、`/chat`、`/canvas` 和 `/settings` 页面,设置页进一步使用 `/settings/models`、`/settings/general`、`/settings/logs` 子路由。页面组件位于 `src/views/`,设置子页面位于 `src/views/settings/`。连接编辑和预览交互弹层位于 `src/components/modals/`。Arco Design 组件通过 `unplugin-vue-components` 按需解析;公共逻辑分别位于 `src/api/index.ts`、`src/chat/index.ts`、`src/canvas/index.ts` 和 `src/router/index.ts`,其中 API 连接、聊天会话和画布图结构使用类封装。实际网络请求仍统一经过 `src/App.vue` 的 Tauri HTTP `fetch` 封装。

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm tauri dev

# 打包
pnpm tauri build
```

## 使用

1. 使用左侧图标切换「生图」「聊天」或「无尽画布」;点击左下角设置按钮后,通过二级侧栏进入模型设置、通用设置或日志
2. 生图页面可输入提示词、添加参考图,并单独配置接口模式、尺寸、数量和请求重试;聊天页面可进行连续文字对话
3. 无尽画布中每个节点独立选择连接和模型;文字节点生成后会新增文字子节点;含图片的节点仅作参考输入,需连接到新的空图像节点进行生成
4. 图像预览会持续保留,双击图片可放大,右键可复制图片或提示词、设为参考图、保存或删除,也可清空全部预览

## 许可证

本项目基于 [GNU Lesser General Public License v3.0](LICENSE) 开源。
