// 读取元素
const langSelect = document.getElementById("targetLang");
const fontSizeInput = document.getElementById("fontSize");
const englishFontSizeInput = document.getElementById("englishFontSize");
const translateColorInput = document.getElementById("translateColor");
const englishColorInput = document.getElementById("englishColor");
const bgOpacityInput = document.getElementById("bgOpacity");
const bgOpacityValue = document.getElementById("bgOpacityValue");
const saveBtn = document.getElementById("saveBtn");
const statusDiv = document.getElementById("status");

// 监听从 content.js 发出的实时进度广播
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'PROGRESS_UPDATE') {
        const bar = document.getElementById('optionProgressBar');
        const txt = document.getElementById('optionProgressText');
        if (bar && txt) {
            bar.style.width = msg.percent + '%';
            txt.innerText = msg.msg + (msg.percent < 100 ? ` (${msg.percent}%)` : '');
            bar.style.background = msg.percent === 100 ? '#0f9d58' : '#1a73e8';
        }
    }
});

const previewBox = document.getElementById("previewBox");
const previewEn = document.getElementById("previewEn");
const previewZh = document.getElementById("previewZh");

// 更新预览界面的函数
function updatePreview() {
    previewZh.style.fontSize = fontSizeInput.value + 'px';
    previewEn.style.fontSize = englishFontSizeInput.value + 'px';
    previewZh.style.color = translateColorInput.value;
    previewEn.style.color = englishColorInput.value;

    // 把滑块的值实时展示给文字
    bgOpacityValue.innerText = bgOpacityInput.value;
    const opVal = Number(bgOpacityInput.value);
    previewBox.style.background = `rgba(0, 0, 0, ${opVal})`;
    previewBox.style.boxShadow = opVal === 0 ? 'none' : 'inset 0 2px 5px rgba(0, 0, 0, 0.5)';
}

// 监听一切能导致 UI 变化的事件
[langSelect, fontSizeInput, englishFontSizeInput, translateColorInput, englishColorInput, bgOpacityInput].forEach(el => {
    el.addEventListener('input', updatePreview);
});

// 加载现有配置
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.sync.get(
        {
            ccTargetLang: 'zh-CN',
            ccFontSize: 22,
            ccEnglishFontSize: 20,
            ccTranslateColor: '#ffffff', // 纯白
            ccEnglishColor: '#ffffff',    // 纯白
            ccBgOpacity: 0.75
        },
        (items) => {
            langSelect.value = items.ccTargetLang;
            fontSizeInput.value = items.ccFontSize;
            englishFontSizeInput.value = items.ccEnglishFontSize;
            translateColorInput.value = items.ccTranslateColor;
            englishColorInput.value = items.ccEnglishColor;

            if (items.ccBgOpacity !== undefined) {
                bgOpacityInput.value = items.ccBgOpacity;
            }

            // 初始化渲染一下预览框
            updatePreview();
        }
    );
});

// 保存配置
saveBtn.addEventListener('click', () => {
    chrome.storage.sync.set(
        {
            ccTargetLang: langSelect.value,
            ccFontSize: Number(fontSizeInput.value) || 22,
            ccEnglishFontSize: Number(englishFontSizeInput.value) || 20,
            ccTranslateColor: translateColorInput.value,
            ccEnglishColor: englishColorInput.value,
            ccBgOpacity: Number(bgOpacityInput.value)
        },
        () => {
            statusDiv.textContent = '设置已成功保存！请刷新视频页面以应用。';
            setTimeout(() => {
                statusDiv.textContent = '';
            }, 3000);
        }
    );
});
