# GugleAI

一个基于 Tauri 2 + Vue 3 的桌面图像生成客户端，适配 OpenAI 图像接口（如 `gpt-image-2`）及兼容的第三方中转服务。

## 功能

- **自定义连接**:API 端点、API Key、模型 ID 均可自由配置,自动保存
- **文生图**:输入提示词调用 `/images/generations` 生成图片
- **参考图编辑**:添加任意数量的参考图,自动切换到 `/images/edits` 接口
- **生成参数**:支持选择尺寸(1024×1024 / 横版 / 竖版 / 自动)和生成数量
- **结果保存**:兼容 `b64_json` 与 `url` 两种返回格式,一键保存到本地

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

1. 在左侧设置栏填入 API 端点(如 `https://api.openai.com/v1` 或中转地址)、API Key 和模型 ID
2. 输入提示词,可选添加参考图
3. 点击「生成」(或 Ctrl+Enter),结果出现后点击「保存」存到本地

## 许可证

本项目基于 [GNU Lesser General Public License v3.0](LICENSE) 开源。
