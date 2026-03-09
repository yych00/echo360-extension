// 默认配置
const DEFAULT_CONFIG = {
    ccTargetLang: 'zh-CN',
    ccFontSize: 22,
    ccEnglishFontSize: 20,
    ccTranslateColor: '#ffffff',
    ccEnglishColor: '#ffffff',
    ccBgOpacity: 0.75
};

// 监听从网站里的 inject.js 传出来的进度消息并向外透传给插件 options
window.addEventListener('message', (event) => {
    if (event.source === window && event.data && event.data.source === 'echo360-cc-inject') {
        if (event.data.type === 'PROGRESS_UPDATE') {
            try {
                chrome.runtime.sendMessage(event.data).catch(() => { });
            } catch (e) { }
        }
    }
});

chrome.storage.sync.get(DEFAULT_CONFIG, (items) => {
    // 1. 将配置作为全局变量打入主页面的 Window 环境中
    const configScript = document.createElement('script');
    configScript.textContent = `window.__ECHO360_CC_CONFIG__ = ${JSON.stringify(items)};`;
    (document.head || document.documentElement).appendChild(configScript);
    configScript.remove(); // 隐藏痕迹

    // 2. 将真正的请求拦截和渲染引擎注入
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inject.js');
    script.onload = function () {
        this.remove(); // 加载完后把标签移掉以保持 DOM 干净
    };
    (document.head || document.documentElement).appendChild(script);
});

// 监听配置变化并实时打入页面 (实现免刷新应用设置)
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync') {
        chrome.storage.sync.get(DEFAULT_CONFIG, (items) => {
            const syncScript = document.createElement('script');
            syncScript.textContent = `window.__ECHO360_CC_CONFIG__ = ${JSON.stringify(items)};`;
            (document.head || document.documentElement).appendChild(syncScript);
            syncScript.remove();
        });
    }
});
