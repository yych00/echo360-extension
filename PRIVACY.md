# Privacy Policy for Echo360 CC 字幕助手 (Echo360 Subtitle Assistant)

Last updated: March 12, 2026

This Extension is committed to protecting your privacy. This Privacy Policy describes how we handle information in relation to the **Echo360 CC 字幕助手** Browser Extension (the "Extension").

## 1. Information Collection and Use

The Extension is designed to operate locally within your browser. 
- **No Personal Data Collection**: We do not collect, store, or transmit any personal information, browsing history, or user account data.
- **Local Processing**: All subtitle extraction and rendering logic happens entirely on your device.

## 2. Third-Party Services (Google Translate)

The Extension's core feature is to provide real-time translations for subtitles. 
- **Data Shared**: The only data sent to an external service is the **text of the English subtitles** from the video you are currently watching. This text is sent to the **Google Translation API** (`translate.googleapis.com`) to retrieve the Chinese translation.
- **No Identifiable Information**: No user identifiers, cookies, or account details are sent to Google alongside the subtitle text.
- **Google's Privacy Policy**: The use of Google Translate is subject to [Google's Privacy Policy](https://policies.google.com/privacy).

## 3. Permissions Justification

The Extension requests the following permissions to function correctly:

- `storage`: Used to save user preferences (e.g., font size, color, display settings, and keyboard shortcut toggles) locally in your browser.
- `host_permissions`:
    - `*://echo360.net.au/*` & `*://canvas.lms.unimelb.edu.au/*`: Required to detect video players and inject the custom subtitle overlay on University of Melbourne's lecture platforms.
    - `*://translate.googleapis.com/*`: Required to communicate with the translation API to provide real-time bilingual subtitles.

## 4. Data Security

Since the Extension does not collect or store any data on external servers, there is no risk of your data being leaked from our side.

## 5. Changes to This Policy

We may update our Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy in the repository.

## 6. Contact Us

If you have any questions about this Privacy Policy, you can contact the developer via the GitHub repository: [yych00/echo360-extension](https://github.com/yych00/echo360-extension).

---

# 隐私政策 (Privacy Policy)

**上次更新日期：2026年3月17日**

本插件致力于保护您的隐私。本政策说明了“Echo360 CC 字幕助手”浏览器插件处理信息的方式。

## 1. 信息收集与使用

本插件设计在您的浏览器本地运行。
- **不收集个人数据**：我们不会收集、存储或传输任何个人信息、浏览历史或用户账户数据。
- **本地处理**：所有字幕提取、按键拦截和渲染逻辑完全在您的设备上完成。

## 2. 第三方服务 (Google 翻译)

插件的核心功能是提供字幕实时翻译。
- **数据交互**：唯一发送到外部服务的数据是您正在观看的视频的**英文幕文字**。该文本被发送到 **Google 翻译 API** (`translate.googleapis.com`) 以获取中文（或您指定的其他目标语言）翻译。
- **无身份识别信息**：字幕文本发送时不会附带任何用户标识、Cookie 或账户信息。

## 3. 权限说明

- `storage`: 用于在浏览器本地保存您的偏好设置（如字体大小、语言、页面外观颜色、快捷键开关等）。
- `host_permissions`:
    - `*://echo360.net.au/*` 和 `*://canvas.lms.unimelb.edu.au/*`: 用于在墨尔本大学的课程视频平台上检测播放器、注入字幕显示界面并控制播放行为。
    - `*://translate.googleapis.com/*`: 用于获取 Google 翻译提供的实时翻译。

## 4. 数据安全

由于插件不收集也不在外部服务器存储任何数据，不存在从我们端泄漏数据的风险。
