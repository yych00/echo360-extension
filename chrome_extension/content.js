/**
 * @author yuchenyang
 * @description Echo360 CC 字幕助手 Content Script
 */

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
    ccShowEnglish: true
};
let DEFAULT_CONFIG = { ...FALLBACK_DEFAULT_CONFIG };

async function loadDefaultConfig() {
    try {
        const response = await fetch(chrome.runtime.getURL('defaults.json'));
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
        console.warn('[Echo360 CC] Failed to load defaults.json in content script, using fallback defaults.', error);
    }

    return DEFAULT_CONFIG;
}

function syncConfigToPage(config) {
    // 通过 DOM 属性传递配置到 inject.js（inject.js 轮询读取，100% 可靠）
    document.documentElement.setAttribute(
        'data-echo360-cc-config',
        JSON.stringify(config)
    );
    // 同时派发 CustomEvent，供 inject.js 的事件监听器即时响应（无需再注入 <script> 标签）
    window.dispatchEvent(new CustomEvent('echo360-cc-config-updated', {
        detail: config
    }));
}

function postMessageToPage(message) {
    window.postMessage({
        source: 'echo360-cc-content',
        ...message
    }, location.origin);
}

function forwardTranslateRequest(messageType, requestId, payload, _isRetry) {
    chrome.runtime.sendMessage({ type: messageType, payload }, (response) => {
        if (chrome.runtime.lastError) {
            // Service Worker 冷启动导致连接失败时，自动延迟 500ms 重试一次
            if (!_isRetry && chrome.runtime.lastError.message?.includes('Receiving end does not exist')) {
                setTimeout(() => forwardTranslateRequest(messageType, requestId, payload, true), 500);
                return;
            }

            postMessageToPage({
                type: 'TRANSLATE_RESPONSE',
                requestId,
                success: false,
                error: chrome.runtime.lastError.message || 'Background translation request failed.',
                errorCode: 'TRANSLATE_RUNTIME_ERROR',
                errorCategory: 'runtime',
                retryable: false,
                status: 0
            });
            return;
        }

        postMessageToPage({
            type: 'TRANSLATE_RESPONSE',
            requestId,
            success: !!response?.success,
            payload: response?.payload,
            error: response?.error || '',
            errorCode: response?.errorCode || '',
            errorCategory: response?.errorCategory || '',
            retryable: !!response?.retryable,
            status: response?.status || 0
        });
    });
}

// 监听从网站里的 inject.js 传出来的进度消息并向外透传给插件 options
window.addEventListener('message', (event) => {
    if (event.source === window && event.origin === location.origin && event.data && event.data.source === 'echo360-cc-inject') {
        if (event.data.type === 'TRANSLATE_REQUEST' && event.data.requestId && event.data.payload) {
            forwardTranslateRequest('TRANSLATE_TEXT', event.data.requestId, event.data.payload);
            return;
        }

        if (event.data.type === 'TRANSLATE_BATCH_REQUEST' && event.data.requestId && event.data.payload) {
            forwardTranslateRequest('TRANSLATE_TEXT_BATCH', event.data.requestId, event.data.payload);
            return;
        }

        if (event.data.type === 'PROGRESS_UPDATE') {
            const progressPayload = {
                percent: Number(event.data.percent) || 0,
                msg: event.data.msg || '',
                updatedAt: new Date().toISOString()
            };

            chrome.storage.local.set({ echo360ProgressState: progressPayload }, () => {
                try {
                    chrome.runtime.sendMessage({
                        type: 'PROGRESS_UPDATE',
                        ...progressPayload
                    }, () => {
                        void chrome.runtime.lastError;
                    });
                } catch (e) { }
            });
        }

        if (event.data.type === 'TRANSCRIPT_EXPORT_UPDATE' && event.data.payload) {
            const exportPayload = {
                ...event.data.payload,
                capturedAt: new Date().toISOString()
            };

            chrome.storage.local.set({ echo360TranscriptExport: exportPayload }, () => {
                try {
                    chrome.runtime.sendMessage({
                        type: 'TRANSCRIPT_EXPORT_UPDATED',
                        payload: {
                            title: exportPayload.title,
                            cueCount: exportPayload.cues?.length || 0,
                            translatedCount: exportPayload.translatedCount || 0,
                            isTranslationComplete: !!exportPayload.isTranslationComplete
                        }
                    }, () => {
                        void chrome.runtime.lastError;
                    });
                } catch (e) { }
            });
        }
    }
});

loadDefaultConfig().finally(() => {
    chrome.storage.sync.get(DEFAULT_CONFIG, (items) => {
        // 1. 将配置作为全局变量打入主页面的 Window 环境中
        syncConfigToPage(items);

        // 2. 将真正的请求拦截和渲染引擎注入
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('inject.js');
        script.onload = function () {
            this.remove(); // 加载完后把标签移掉以保持 DOM 干净
        };
        (document.head || document.documentElement).appendChild(script);
    });
});

// 监听配置变化并实时打入页面 (实现免刷新应用设置)
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync') {
        chrome.storage.sync.get(DEFAULT_CONFIG, (items) => {
            // 通过 DOM 属性传递配置到 page world (content script 与页面共享 DOM，不受 CSP 限制)
            syncConfigToPage(items);
        });
    }
});
