# LLM Wiki 安装指南

本文介绍三种安装方式，请根据你的需求选择其一。

---

## 安装方式一：BRAT（推荐）

BRAT 可以安装 beta 版本，无需等待社区审核。

### 第一步：安装 BRAT 插件

1. 打开 Obsidian → 设置 → 社区插件
2. 搜索 **BRAT**（作者：TfTHacker）
3. 点击安装，然后启用

### 第二步：通过 BRAT 安装 LLM Wiki

1. 设置 → BRAT → **Add Beta Plugin**
2. 输入仓库地址：`https://github.com/SkyLewis/LLMWiki`
3. 点击 **Add Plugin**，等待下载完成
4. 设置 → 社区插件，找到 **LLM Wiki**，启用

### 第三步：配置插件

1. 设置 → **LLM Wiki**
2. 在 **API Keys** 中填入你的密钥：
   - Anthropic API Key（用于 Claude 模型）
   - 或 OpenAI API Key（用于 GPT 模型）
   - 或配置 Ollama（本地模型，无需 API Key）
3. 在 **Model Router** 中选择各层使用的模型（轻量级用于提取，重量级用于综合）
4. 在 **Vault Paths** 中确认或修改原始资料和 wiki 的存储路径
5. 点击保存

> **提示**：使用 Ollama 可完全免费本地运行，无需任何 API Key。

---

## 安装方式二：手动安装（稳定版）

### 第一步：下载安装包

1. 打开 [LLMWiki Releases](https://github.com/SkyLewis/LLMWiki/releases/latest)
2. 下载以下三个文件：
   - `main.js`
   - `manifest.json`
   - `styles.css`

### 第二步：创建插件目录

1. 打开你的 Obsidian 仓库文件夹
2. 进入 `.obsidian/plugins/` 目录
3. 新建文件夹，命名为 `llm-wiki`

### 第三步：放入文件

将下载的三个文件（`main.js`、`manifest.json`、`styles.css`）复制到 `.obsidian/plugins/llm-wiki/` 目录中。

### 第四步：启用插件

1. 打开 Obsidian → 设置 → 社区插件
2. 找到 **LLM Wiki**，点击启用

### 第五步：配置插件

同 BRAT 安装方式的第三步。

---

## 安装方式三：开发版（从源码构建）

### 第一步：安装 Node.js

建议 Node.js 20 或更高版本。[下载地址](https://nodejs.org/)

### 第二步：克隆仓库

```bash
git clone https://github.com/SkyLewis/LLMWiki.git
cd LLMWiki
npm install
```

### 第三步：构建

```bash
npm run build
```

构建完成后，会在项目根目录生成 `main.js` 和 `styles.css`。

### 第四步：链接到 Vault

```powershell
# Windows PowerShell 示例（请根据你的实际路径修改）
$vaultPath = "C:\Users\你的用户名\Documents\我的仓库"
$projectPath = "C:\code\LLMWiki"

# 创建插件目录（如不存在）
New-Item -ItemType Directory -Path "$vaultPath\.obsidian\plugins\llm-wiki" -Force

# 复制构建产物到插件目录
Copy-Item "$projectPath\main.js" "$vaultPath\.obsidian\plugins\llm-wiki\"
Copy-Item "$projectPath\styles.css" "$vaultPath\.obsidian\plugins\llm-wiki\"
Copy-Item "$projectPath\manifest.json" "$vaultPath\.obsidian\plugins\llm-wiki\"
```

### 第五步：启用插件

打开 Obsidian → 设置 → 社区插件，找到 **LLM Wiki** 启用。

---

## 插件配置说明

| 设置项 | 说明 |
|--------|------|
| **Anthropic API Key** | 用于调用 Claude 系列模型 |
| **OpenAI API Key** | 用于调用 GPT 系列模型 |
| **Ollama Endpoint** | 本地模型地址，如 `http://localhost:11434` |
| **Model Router** | 为不同任务层指定模型：综合（重量级）、默认、提取（轻量级）、本地备选 |
| **Vault Paths** | 原始资料目录、Wiki 输出目录、自定义仓库路径 |
| **Merge Threshold** | 当页面超过指定字数时，触发重构提醒 |

---

## 安装顺序总结

| 方式 | 顺序 | 适用场景 |
|------|------|----------|
| BRAT | 1. 安装BRAT → 2. 添加LLM Wiki → 3. 配置 | 推荐大多数用户，beta功能 |
| 手动 | 1. 下载 → 2. 建目录 → 3. 复制文件 → 4. 启用 → 5. 配置 | 追求稳定，不想用beta |
| 开发版 | 1. Node.js → 2. 克隆 → 3. 构建 → 4. 链接 → 5. 启用 | 参与开发或需要自定义 |
