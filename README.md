# GugleAI

[English](README.en.md) | 简体中文

一个基于 Tauri 2 + Vue 3 的桌面图像生成客户端，适配 OpenAI 图像接口（如 `gpt-image-2`）及兼容的第三方中转服务。

## 功能

- **自定义连接**:API 端点、API Key、模型 ID 均可自由配置,自动保存;模型 ID 可从下拉菜单选择,也可保存自定义选项;端点不带 `/v1` 时自动补全
- **粘贴导入配置**:直接 Ctrl+V 粘贴连接配置自动填充,支持 newapi 渠道 JSON(`{"_type":"newapi_channel_conn",...}`)和 Codex CLI `config.toml`(提取 `base_url`)
- **文生图**:输入提示词调用 `/images/generations` 生成图片
- **参考图编辑**:添加任意数量的参考图,支持文件选择、拖拽和剪贴板粘贴
- **接口模式**:自动 / Images 接口 / Chat 接口三种模式;自动模式下多参考图改走 `/chat/completions`,兼容 edits 只支持单图的中转服务
- **请求重试**:可按 HTTP 错误码自动重试生成请求,错误码支持下拉多选并保存自定义选项,重试次数可配置
- **诊断日志**:记录生成请求的任务编号、阶段、耗时、请求体大小、代理状态和脱敏后的错误详情,便于排查超时及传输失败
- **生成参数**:支持选择尺寸(1024×1024 / 横版 / 竖版 / 自动)和生成数量
- **结果保存**:兼容 `b64_json`、图片 URL(含相对路径)、Chat 内嵌 base64 等返回格式,一键保存到本地

## 下载

前往 [Releases](../../releases) 页面下载对应平台的安装包,支持 Windows(x86 / x86_64 / arm64)、Linux(x86_64 / arm64)和 macOS(Intel / Apple Silicon)。

## 开发

依赖:[Node.js](https://nodejs.org/)、[pnpm](https://pnpm.io/)、[Rust](https://www.rust-lang.org/)。

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm tauri dev

# 打包
pnpm tauri build
```

## 使用

1. 在左侧设置栏填入 API 端点(如 `https://api.openai.com/v1` 或中转地址)、API Key,并从下拉菜单选择模型 ID 或保存自定义模型,也可以直接粘贴连接配置
2. 输入提示词,可选添加参考图(文件选择 / 拖拽到加号 / Ctrl+V 粘贴截图)
3. 点击「生成」(或 Ctrl+Enter),结果出现后点击「保存」存到本地

## 许可证

本项目基于 [GNU Lesser General Public License v3.0](LICENSE) 开源。
