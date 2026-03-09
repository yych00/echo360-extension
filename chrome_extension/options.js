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
const exportBtn = document.getElementById("exportTxtBtn");
const exportStatusDiv = document.getElementById("exportStatus");
const exportMetaDiv = document.getElementById("exportMeta");
const resetBtn = document.getElementById("resetBtn");
let statusClearTimer = null;
const CONFIG_KEYS = [
    'ccTargetLang',
    'ccFontSize',
    'ccEnglishFontSize',
    'ccTranslateColor',
    'ccEnglishColor',
    'ccBgOpacity'
];

const FALLBACK_DEFAULT_CONFIG = {
    ccTargetLang: 'zh-CN',
    ccFontSize: 22,
    ccEnglishFontSize: 20,
    ccTranslateColor: '#ffffff',
    ccEnglishColor: '#ffffff',
    ccBgOpacity: 0.6
};
let DEFAULT_CONFIG = { ...FALLBACK_DEFAULT_CONFIG };

async function loadDefaultConfig() {
    try {
        const response = await fetch('defaults.json');
        if (!response.ok) {
            throw new Error(`Failed to load defaults.json: ${response.status}`);
        }

        const defaults = await response.json();
        DEFAULT_CONFIG = {
            ...FALLBACK_DEFAULT_CONFIG,
            ...(defaults || {})
        };
    } catch (error) {
        DEFAULT_CONFIG = { ...FALLBACK_DEFAULT_CONFIG };
        console.warn('[Echo360 CC] Failed to load defaults.json, using fallback defaults.', error);
    }

    return DEFAULT_CONFIG;
}

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

    if (msg.type === 'TRANSCRIPT_EXPORT_UPDATED') {
        loadExportState();
    }
});

const previewBox = document.getElementById("previewBox");
const previewEn = document.getElementById("previewEn");
const previewZh = document.getElementById("previewZh");

function formatTimestamp(ms) {
    const totalSeconds = Math.max(0, Math.floor((ms || 0) / 1000));
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

function sanitizeFileName(name) {
    return (name || 'echo360-subtitles')
        .replace(/[\/]+/g, ' - ')
        .replace(/[:*?"<>|]+/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || 'echo360-subtitles';
}

function buildTranscriptTxt(payload) {
    const lines = [];
    lines.push(`标题: ${payload.title || 'Echo360 字幕'}`);
    lines.push(`页面: ${payload.pageUrl || ''}`);
    lines.push(`目标语言: ${payload.targetLang || 'zh-CN'}`);
    lines.push(`字幕条数: ${payload.cueCount || 0}`);
    lines.push(`已翻译: ${payload.translatedCount || 0}`);
    lines.push('');

    (payload.cues || []).forEach((cue) => {
        lines.push(`[${formatTimestamp(cue.start)} - ${formatTimestamp(cue.end)}]`);
        lines.push(`EN: ${cue.text || ''}`);
        lines.push(`ZH: ${cue.zhText || ''}`);
        lines.push('');
    });

    return lines.join('\n');
}

function triggerTxtDownload(payload) {
    const textContent = buildTranscriptTxt(payload);
    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const title = sanitizeFileName(payload.title);
    const lang = payload.targetLang || 'zh-CN';

    // 用缓存时间生成文件名时间戳，格式: 20260310-143025
    const dateObj = payload.capturedAt ? new Date(payload.capturedAt) : new Date();
    const timeStr = [
        dateObj.getFullYear(),
        String(dateObj.getMonth() + 1).padStart(2, '0'),
        String(dateObj.getDate()).padStart(2, '0'),
        '-',
        String(dateObj.getHours()).padStart(2, '0'),
        String(dateObj.getMinutes()).padStart(2, '0'),
        String(dateObj.getSeconds()).padStart(2, '0')
    ].join('');

    link.href = url;
    link.download = `${title}-${lang}-${timeStr}-bilingual.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 1000);
}

function updateExportUi(payload) {
    if (!exportBtn || !exportMetaDiv || !exportStatusDiv) return;

    if (!payload || !payload.cues || payload.cues.length === 0) {
        exportBtn.disabled = true;
        exportMetaDiv.textContent = '暂无字幕缓存。请先打开 Echo360 视频页面并开始播放。';
        exportStatusDiv.textContent = '';
        return;
    }

    exportBtn.disabled = false;
    const capturedAt = payload.capturedAt ? new Date(payload.capturedAt).toLocaleString() : '未知';
    const title = payload.title || '未命名视频';
    exportMetaDiv.innerHTML = `
        <div><strong>课程标题：</strong>${title}</div>
        <div><strong>字幕条数：</strong>${payload.cueCount || payload.cues.length} 条</div>
        <div><strong>已翻译：</strong>${payload.translatedCount || 0} 条</div>
        <div><strong>缓存时间：</strong>${capturedAt}</div>
    `;
    exportStatusDiv.textContent = payload.isTranslationComplete
        ? '字幕缓存完整，可以直接导出双语 TXT。'
        : '字幕缓存已同步，尚有部分中文未完成翻译。';
}

function loadExportState() {
    chrome.storage.local.get({ echo360TranscriptExport: null }, (items) => {
        updateExportUi(items.echo360TranscriptExport);
    });
}

function showStatus(message) {
    if (!statusDiv) return;

    statusDiv.textContent = message;
    if (statusClearTimer) {
        clearTimeout(statusClearTimer);
    }

    statusClearTimer = setTimeout(() => {
        statusDiv.textContent = '';
        statusClearTimer = null;
    }, 3000);
}

function buildCurrentConfig() {
    return {
        ccTargetLang: langSelect.value,
        ccFontSize: Number(fontSizeInput.value) || DEFAULT_CONFIG.ccFontSize,
        ccEnglishFontSize: Number(englishFontSizeInput.value) || DEFAULT_CONFIG.ccEnglishFontSize,
        ccTranslateColor: translateColorInput.value,
        ccEnglishColor: englishColorInput.value,
        ccBgOpacity: Number(bgOpacityInput.value)
    };
}

function buildUserOverrides(config) {
    return Object.fromEntries(
        Object.entries(config).filter(([key, value]) => DEFAULT_CONFIG[key] !== value)
    );
}

function applyConfigToForm(config) {
    langSelect.value = config.ccTargetLang;
    fontSizeInput.value = config.ccFontSize;
    englishFontSizeInput.value = config.ccEnglishFontSize;
    translateColorInput.value = config.ccTranslateColor;
    englishColorInput.value = config.ccEnglishColor;
    bgOpacityInput.value = config.ccBgOpacity;
    updatePreview();
}

function getStoredConfig(callback) {
    chrome.storage.sync.get(DEFAULT_CONFIG, (items) => {
        callback(items);
    });
}

function persistConfig(config, callback) {
    const overrides = buildUserOverrides(config);
    const keysToRemove = CONFIG_KEYS.filter((key) => !(key in overrides));

    chrome.storage.sync.remove(keysToRemove, () => {
        chrome.storage.sync.set(overrides, () => {
            getStoredConfig((resolvedConfig) => {
                callback(resolvedConfig);
            });
        });
    });
}

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
document.addEventListener('DOMContentLoaded', async () => {
    await loadDefaultConfig();

    getStoredConfig((items) => {
        applyConfigToForm(items);
    });

    loadExportState();
});

// 将配置直接发送给所有匹配的标签页 (content script)
function broadcastConfigToTabs(config) {
    const urlPatterns = [
        '*://echo360.net.au/*',
        '*://canvas.lms.unimelb.edu.au/*'
    ];
    urlPatterns.forEach(pattern => {
        chrome.tabs.query({ url: pattern }, (tabs) => {
            if (chrome.runtime.lastError) return;
            (tabs || []).forEach(tab => {
                chrome.tabs.sendMessage(tab.id, {
                    type: 'CONFIG_CHANGED',
                    config: config
                }, () => {
                    void chrome.runtime.lastError;
                });
            });
        });
    });
}

// 执行保存并广播配置的核心逻辑
function saveAndBroadcast(statusMsg) {
    const newConfig = buildCurrentConfig();
    persistConfig(newConfig, (resolvedConfig) => {
        broadcastConfigToTabs(resolvedConfig);
        showStatus(statusMsg || '设置已保存，并已立即应用到已打开的视频页。');
    });
}

// 保存配置
saveBtn.addEventListener('click', () => {
    saveAndBroadcast('设置已保存，并已立即应用到已打开的视频页。');
});

// 恢复默认配置
resetBtn.addEventListener('click', () => {
    applyConfigToForm(DEFAULT_CONFIG);

    chrome.storage.sync.remove(CONFIG_KEYS, () => {
        getStoredConfig((resolvedConfig) => {
            applyConfigToForm(resolvedConfig);
            broadcastConfigToTabs(resolvedConfig);
            showStatus('已恢复默认设置，并已立即应用到已打开的视频页。');
        });
    });
});

if (exportBtn) {
    exportBtn.addEventListener('click', () => {
        chrome.storage.local.get({ echo360TranscriptExport: null }, (items) => {
            const payload = items.echo360TranscriptExport;
            if (!payload || !payload.cues || payload.cues.length === 0) {
                updateExportUi(null);
                return;
            }

            triggerTxtDownload(payload);
            exportStatusDiv.textContent = payload.isTranslationComplete
                ? '双语 TXT 已导出。'
                : '双语 TXT 已导出；未翻译的字幕行会保留为空。';
        });
    });
}
