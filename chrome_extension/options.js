// 读取元素
const langSelect = document.getElementById("targetLang");
const fontSizeInput = document.getElementById("fontSize");
const englishFontSizeInput = document.getElementById("englishFontSize");
const translateColorInput = document.getElementById("translateColor");
const englishColorInput = document.getElementById("englishColor");
const saveBtn = document.getElementById("saveBtn");
const statusDiv = document.getElementById("status");

const previewBox = document.getElementById("previewBox");
const previewEn = document.getElementById("previewEn");
const previewZh = document.getElementById("previewZh");

// 更新预览界面的函数
function updatePreview() {
    previewZh.style.fontSize = fontSizeInput.value + 'px';
    previewEn.style.fontSize = englishFontSizeInput.value + 'px';
    previewZh.style.color = translateColorInput.value;
    previewEn.style.color = englishColorInput.value;
}

// 监听一切能导致 UI 变化的事件
[langSelect, fontSizeInput, englishFontSizeInput, translateColorInput, englishColorInput].forEach(el => {
    el.addEventListener('input', updatePreview);
});

// 加载现有配置
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.sync.get(
        {
            ccTargetLang: 'zh-CN',
            ccFontSize: 24,
            ccEnglishFontSize: 20,
            ccTranslateColor: '#ffffff', // 纯白
            ccEnglishColor: '#ffffff'     // 纯白
        },
        (items) => {
            langSelect.value = items.ccTargetLang;
            fontSizeInput.value = items.ccFontSize;
            englishFontSizeInput.value = items.ccEnglishFontSize;
            translateColorInput.value = items.ccTranslateColor;
            englishColorInput.value = items.ccEnglishColor;

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
            ccFontSize: Number(fontSizeInput.value) || 24,
            ccEnglishFontSize: Number(englishFontSizeInput.value) || 20,
            ccTranslateColor: translateColorInput.value,
            ccEnglishColor: englishColorInput.value
        },
        () => {
            statusDiv.textContent = '设置已成功保存！请刷新视频页面以应用。';
            setTimeout(() => {
                statusDiv.textContent = '';
            }, 3000);
        }
    );
});
