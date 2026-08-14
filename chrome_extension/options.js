/**
 * @author yuchenyang
 * @description Echo360 CC 字幕助手 Options Script
 */

// 读取元素
const enableSubtitlesInput = document.getElementById("enableSubtitles");
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
const exportEnBtn = document.getElementById("exportEnTxtBtn");
const exportStatusDiv = document.getElementById("exportStatus");
const exportMetaDiv = document.getElementById("exportMeta");
const resetBtn = document.getElementById("resetBtn");
// 字幕显示模式按钮
const showChineseInput = document.getElementById("showChinese");
const showEnglishInput = document.getElementById("showEnglish");
const showChineseBtn = document.getElementById("showChineseBtn");
const showEnglishBtn = document.getElementById("showEnglishBtn");
// 键盘快捷键开关
const keyboardShortcutsInput = document.getElementById("keyboardShortcuts");
// 毛玻璃背景开关
const blurInput = document.getElementById("blurEffect");
let statusClearTimer = null;
// --- 自动保存防抖计时器 ---
let autoSaveTimer = null;
const CONFIG_KEYS = [
    'ccEnableSubtitles',
    'ccTargetLang',
    'ccFontSize',
    'ccEnglishFontSize',
    'ccTranslateColor',
    'ccEnglishColor',
    'ccBgOpacity',
    'ccShowChinese',
    'ccShowEnglish',
    'ccKeyboardShortcuts',
    'ccBlur'
];

// 最小安全回退配置（仅在 defaults.json 加载失败时兜底）
// 日常修改默认值请编辑 defaults.json，此处仅保留结构性回退
const FALLBACK_DEFAULT_CONFIG = {
    ccEnableSubtitles: true,
    ccTargetLang: 'zh-CN',
    ccFontSize: 22,
    ccEnglishFontSize: 20,
    ccTranslateColor: '#ffffff',
    ccEnglishColor: '#ffffff',
    ccBgOpacity: 0.6,
    ccShowChinese: true,
    ccShowEnglish: true,
    ccKeyboardShortcuts: true,
    ccBlur: false
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

function updateProgressUi(progress) {
    const bar = document.getElementById('optionProgressBar');
    const txt = document.getElementById('optionProgressText');
    if (!bar || !txt) return;

    if (!progress) {
        bar.style.width = '0%';
        bar.style.background = 'linear-gradient(90deg, #3b82f6, #60a5fa)';
        txt.innerText = '暂无进度';
        return;
    }

    const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
    const message = progress.msg || '暂无进度';
    bar.style.width = percent + '%';
    txt.innerText = message + (percent < 100 ? ` (${percent}%)` : '');
    bar.style.background = 'linear-gradient(90deg, #3b82f6, #60a5fa)';
}

function loadProgressState() {
    chrome.storage.local.get({ echo360ProgressState: null }, (items) => {
        updateProgressUi(items.echo360ProgressState);
    });
}

// 监听从 content.js 发出的实时进度广播
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'PROGRESS_UPDATE') {
        updateProgressUi(msg);
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

function buildEnglishTranscriptTxt(payload) {
    const lines = [];
    lines.push(`标题: ${payload.title || 'Echo360 字幕'}`);
    lines.push(`页面: ${payload.pageUrl || ''}`);
    lines.push(`字幕条数: ${payload.cueCount || 0}`);
    lines.push('');

    (payload.cues || []).forEach((cue) => {
        lines.push(`[${formatTimestamp(cue.start)} - ${formatTimestamp(cue.end)}]`);
        lines.push(`${cue.text || ''}`);
        lines.push('');
    });

    return lines.join('\n');
}

function triggerTxtDownload(payload, type = 'bilingual') {
    const isEnOnly = type === 'en';
    const textContent = isEnOnly ? buildEnglishTranscriptTxt(payload) : buildTranscriptTxt(payload);
    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const title = sanitizeFileName(payload.title);

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
    link.download = isEnOnly ? `${title}-${timeStr}-EN.txt` : `${title}-${timeStr}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 1000);
}

function updateExportUi(payload) {
    if (!exportMetaDiv || !exportStatusDiv) return;

    const renderMetaRow = (label, value) => {
        const row = document.createElement('div');
        const strong = document.createElement('strong');
        strong.textContent = `${label}：`;
        row.appendChild(strong);
        row.appendChild(document.createTextNode(String(value)));
        return row;
    };

    const summaryTextEl = document.getElementById('exportSummaryText');

    if (!payload || !payload.cues || payload.cues.length === 0) {
        if (exportBtn) exportBtn.disabled = true;
        if (exportEnBtn) exportEnBtn.disabled = true;
        if (summaryTextEl) summaryTextEl.textContent = '查看字幕缓存详情';
        exportMetaDiv.textContent = '暂无字幕缓存。请先打开 Echo360 视频页面并开始播放。';
        exportStatusDiv.textContent = '';
        return;
    }

    if (exportBtn) exportBtn.disabled = false;
    if (exportEnBtn) exportEnBtn.disabled = false;
    const totalCount = payload.cueCount || payload.cues.length;
    if (summaryTextEl) summaryTextEl.textContent = `字幕缓存详情 (${totalCount} 条)`;
    const capturedAt = payload.capturedAt ? new Date(payload.capturedAt).toLocaleString() : '未知';
    const title = payload.title || '未命名视频';
    exportMetaDiv.replaceChildren(
        renderMetaRow('课程标题', title),
        renderMetaRow('字幕条数', `${totalCount} 条`),
        renderMetaRow('已翻译', `${payload.translatedCount || 0} 条`),
        renderMetaRow('缓存时间', capturedAt)
    );
    exportStatusDiv.textContent = payload.isTranslationComplete
        ? '字幕缓存完整，可以直接导出英文或双语 TXT。'
        : '字幕缓存已同步，英文完整可用；中文尚有部分未完成翻译。';
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
        ccEnableSubtitles: enableSubtitlesInput.checked,
        ccTargetLang: langSelect.value,
        ccFontSize: Number(fontSizeInput.value) || DEFAULT_CONFIG.ccFontSize,
        ccEnglishFontSize: Number(englishFontSizeInput.value) || DEFAULT_CONFIG.ccEnglishFontSize,
        ccTranslateColor: translateColorInput.value,
        ccEnglishColor: englishColorInput.value,
        ccBgOpacity: Number(bgOpacityInput.value),
        ccShowChinese: showChineseInput.checked,
        ccShowEnglish: showEnglishInput.checked,
        ccKeyboardShortcuts: keyboardShortcutsInput.checked,
        ccBlur: blurInput ? blurInput.checked : false
    };
}

function buildUserOverrides(config) {
    return Object.fromEntries(
        Object.entries(config).filter(([key, value]) => DEFAULT_CONFIG[key] !== value)
    );
}

function applyConfigToForm(config) {
    if (config.ccEnableSubtitles !== undefined) {
        enableSubtitlesInput.checked = config.ccEnableSubtitles;
    }
    langSelect.value = config.ccTargetLang;
    fontSizeInput.value = config.ccFontSize;
    englishFontSizeInput.value = config.ccEnglishFontSize;
    translateColorInput.value = config.ccTranslateColor;
    englishColorInput.value = config.ccEnglishColor;
    bgOpacityInput.value = config.ccBgOpacity;
    // 字幕显示模式按钮
    showChineseInput.checked = config.ccShowChinese !== false;
    showEnglishInput.checked = config.ccShowEnglish !== false;
    keyboardShortcutsInput.checked = config.ccKeyboardShortcuts !== false;
    if (blurInput) blurInput.checked = Boolean(config.ccBlur);
    syncModeBtnStyle();
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
    const blurOn = blurInput ? blurInput.checked : false;
    previewBox.style.backdropFilter = (blurOn && opVal > 0) ? 'blur(6px)' : 'none';
    previewBox.style.webkitBackdropFilter = (blurOn && opVal > 0) ? 'blur(6px)' : 'none';

    // 显示或隐藏字幕预览
    const masterOn = enableSubtitlesInput.checked;
    previewEn.style.display = (masterOn && showEnglishInput.checked) ? 'block' : 'none';
    previewZh.style.display = (masterOn && showChineseInput.checked) ? 'block' : 'none';
}

// 同步显示模式按钮的 active 样式
function syncModeBtnStyle() {
    showChineseBtn.classList.toggle('active', showChineseInput.checked);
    showEnglishBtn.classList.toggle('active', showEnglishInput.checked);
}

// 监听一切能导致 UI 变化的事件（仅更新预览）
[enableSubtitlesInput, langSelect, fontSizeInput, englishFontSizeInput, translateColorInput, englishColorInput, bgOpacityInput].forEach(el => {
    el.addEventListener('input', updatePreview);
});

// 显示模式按钮：点击切换并同步样式，立即保存（不防抖，同 enableSubtitles）
[showChineseInput, showEnglishInput].forEach(el => {
    el.addEventListener('change', () => {
        syncModeBtnStyle();
        updatePreview();
        saveAndBroadcast('已自动保存。');
    });
});

// --- 自动保存：调节即时保存，300ms 防抖 ---
function scheduleAutoSave() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
        saveAndBroadcast('已自动保存。');
        autoSaveTimer = null;
    }, 300);
}

// 数值/颜色/滑块：input 事件触发自动保存
[fontSizeInput, englishFontSizeInput, bgOpacityInput, translateColorInput, englishColorInput].forEach(el => {
    el.addEventListener('input', scheduleAutoSave);
});

// 下拉语言：change 时立即保存
langSelect.addEventListener('change', () => {
    saveAndBroadcast('语言设置已保存。');
});

// 加载现有配置
document.addEventListener('DOMContentLoaded', async () => {
    await loadDefaultConfig();

    getStoredConfig((items) => {
        applyConfigToForm(items);
    });

    loadProgressState();
    loadExportState();
});

// 执行保存的核心逻辑（配置变更后 content.js 通过 storage.onChanged 自动同步到视频页）
function saveAndBroadcast(statusMsg) {
    const newConfig = buildCurrentConfig();
    persistConfig(newConfig, () => {
        showStatus(statusMsg || '设置已保存。');
    });
}

// 启用 CC 字幕开关独立保存
enableSubtitlesInput.addEventListener('change', () => {
    saveAndBroadcast(enableSubtitlesInput.checked ? 'CC 字幕已启用。' : 'CC 字幕已关闭。');
});

// 键盘快捷键开关独立保存
keyboardShortcutsInput.addEventListener('change', () => {
    saveAndBroadcast(keyboardShortcutsInput.checked ? '键盘快捷键已启用。' : '键盘快捷键已关闭。');
});

// 毛玻璃背景开关独立保存
if (blurInput) {
    blurInput.addEventListener('change', () => {
        updatePreview();
        saveAndBroadcast(blurInput.checked ? '毛玻璃背景已开启。' : '毛玻璃背景已关闭。');
    });
}

// 保存配置 (不包含 enableSubtitles 的其余设置通过保存按钮保存)
saveBtn.addEventListener('click', () => {
    saveAndBroadcast('设置已保存，并已立即应用到已打开的视频页。');
});

// 恢复默认配置
resetBtn.addEventListener('click', () => {
    applyConfigToForm(DEFAULT_CONFIG);

    chrome.storage.sync.remove(CONFIG_KEYS, () => {
        getStoredConfig((resolvedConfig) => {
            applyConfigToForm(resolvedConfig);
            showStatus('已恢复默认设置。');
        });
    });
});

if (exportEnBtn) {
    exportEnBtn.addEventListener('click', () => {
        chrome.storage.local.get({ echo360TranscriptExport: null }, (items) => {
            const payload = items.echo360TranscriptExport;
            if (!payload || !payload.cues || payload.cues.length === 0) {
                updateExportUi(null);
                return;
            }

            triggerTxtDownload(payload, 'en');
            exportStatusDiv.textContent = '英文 TXT 已导出。';
        });
    });
}

if (exportBtn) {
    exportBtn.addEventListener('click', () => {
        chrome.storage.local.get({ echo360TranscriptExport: null }, (items) => {
            const payload = items.echo360TranscriptExport;
            if (!payload || !payload.cues || payload.cues.length === 0) {
                updateExportUi(null);
                return;
            }

            triggerTxtDownload(payload, 'bilingual');
            exportStatusDiv.textContent = payload.isTranslationComplete
                ? '双语 TXT 已导出。'
                : '双语 TXT 已导出；未翻译的字幕行会保留为空。';
        });
    });
}
