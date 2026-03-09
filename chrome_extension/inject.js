(function () {
    'use strict';

    console.log("[Echo360 CC Plugin] Injection script loaded and listening for subtitle API...");

    let transcriptData = null;
    let subtitleInjected = false;

    // ========= 兼容性极强的数据解析引擎 =========
    function parseVTT(vttStr) {
        const lines = vttStr.split(/\r?\n/);
        const cues = [];
        let i = 0;
        while (i < lines.length) {
            if (lines[i].includes('-->')) {
                const timeMatch = lines[i].split('-->');
                const parseTime = (str) => {
                    const parts = str.trim().split(':');
                    let sec = 0;
                    if (parts.length === 3) sec = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
                    else if (parts.length === 2) sec = parseInt(parts[0]) * 60 + parseFloat(parts[1]);
                    return sec * 1000;
                };
                try {
                    let start = parseTime(timeMatch[0]);
                    let end = parseTime(timeMatch[1]);
                    i++;
                    let text = "";
                    while (i < lines.length && lines[i].trim() !== "") {
                        text += lines[i] + "\n";
                        i++;
                    }
                    cues.push({ start, end, text: text.trim().replace(/<[^>]+>/g, '') });
                } catch (e) { i++; }
            } else {
                i++;
            }
        }
        return cues;
    }

    function extractCuesFromPayload(data) {
        if (typeof data === 'string' && data.trim().startsWith('WEBVTT')) {
            return parseVTT(data);
        }

        let rawCues = [];
        if (Array.isArray(data)) rawCues = data;
        else if (data && data.data && Array.isArray(data.data)) rawCues = data.data;
        else if (data && data.cues && Array.isArray(data.cues)) rawCues = data.cues;
        else if (data && data.data && data.data.contentJSON && Array.isArray(data.data.contentJSON.cues)) {
            // Echo360 真实最新接口防线结构
            rawCues = data.data.contentJSON.cues;
        }
        else if (data && typeof data === 'object') {
            for (let key in data) {
                if (Array.isArray(data[key])) { rawCues = data[key]; break; }
            }
        }

        return rawCues.map(c => {
            let start = c.start ?? c.startTime ?? c.startMs ?? c.begin ?? 0;
            let end = c.end ?? c.endTime ?? c.endMs ?? 0;
            let text = c.text ?? c.content ?? c.words ?? c.transcript ?? "";

            // 如果数据是以秒为单位，转为毫秒
            if (start > 0 && start < 150000 && String(start).includes('.')) {
                start = Math.floor(start * 1000);
                end = Math.floor(end * 1000);
            }
            return { start, end, text };
        });
    }

    // ========= 字幕上下文智能合并引擎 (解决碎句不断闪烁的问题) =========
    function mergeSentences(cues) {
        if (!cues || cues.length === 0) return [];
        let merged = [];
        let currentCue = null;

        for (let i = 0; i < cues.length; i++) {
            let cue = cues[i];

            if (!cue.text || cue.text.trim() === "") continue;

            if (!currentCue) {
                currentCue = { start: cue.start, end: cue.end, text: cue.text.trim() };
            } else {
                // 如果没有遇到句末符号，就把新字幕连在后面，并拉伸结束时间到当前这一拍
                currentCue.text += " " + cue.text.trim();
                currentCue.end = cue.end;
            }

            let text = currentCue.text;
            // 判断英文结尾有无句号问号等，或是中文句号结尾
            let isEndOfSentence = /[.?!。？！]\s*$/.test(text) || /[.?!。？！]["']\s*$/.test(text);

            let isGapTooLarge = false;
            // 如果两句话直接老师停顿超过 1.5 秒，也强制断开，防止黏连在一大片中
            if (i < cues.length - 1 && (cues[i + 1].start - cue.end > 1500)) {
                isGapTooLarge = true;
            }

            if (isEndOfSentence || isGapTooLarge || i === cues.length - 1) {
                currentCue.text = currentCue.text.replace(/\s+/g, ' ').trim();
                merged.push(currentCue);
                currentCue = null;
            }
        }

        console.log(`[Echo360 CC Plugin] Sentence Engine: Combined ${cues.length} fragments into ${merged.length} coherent sentences.`);
        return merged;
    }

    // ========= 后台静默翻译队列引擎 =========
    async function translateAllCues(cues) {
        console.log(`[Echo360 CC Plugin] Translation Queue started for ${cues.length} senteces.`);

        // 读取由 content.js 注入的用户自定义设置
        const config = window.__ECHO360_CC_CONFIG__ || { ccTargetLang: 'zh-CN' };
        const tl = config.ccTargetLang || 'zh-CN';

        // 发送进度消息到外层 content.js (供扩展程序的设置页展示)
        const sendProgress = (percent, msg) => {
            window.postMessage({ source: 'echo360-cc-inject', type: 'PROGRESS_UPDATE', percent, msg }, '*');
        };
        sendProgress(0, "🔄 翻译任务初始化...");

        // 限制并发量，每次翻译 10 句话加快速度
        const chunk = 10;
        for (let i = 0; i < cues.length; i += chunk) {
            const batch = cues.slice(i, i + chunk);

            await Promise.all(batch.map(async (cue) => {
                // 如果恰好这句话被用户拖拽进度条触发了“VIP插队急转”，或者已经翻译完了，就跳过它
                if (cue.zhText !== undefined || cue._isTranslating) return;

                cue._isTranslating = true;
                try {
                    const gtUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${tl}&dt=t&q=${encodeURIComponent(cue.text)}`;
                    const res = await fetch(gtUrl);
                    const data = await res.json();

                    let transText = "";
                    if (data && data[0]) {
                        data[0].forEach(t => { if (t[0]) transText += t[0]; });
                        cue.zhText = transText;
                    }
                } catch (e) {
                    console.error('[Echo360 CC Plugin] Translate failed for cue:', cue.text);
                    cue.zhText = '[网络限制]';
                } finally {
                    cue._isTranslating = false;
                }
            }));

            // 发送进度给设置页面
            const percent = Math.min(100, Math.round(((i + chunk) / cues.length) * 100));
            sendProgress(percent, "🧠 正在智能加载翻译资源");

            // 每次拉取 10 句话后，歇息 250ms 防止被封
            await new Promise(r => setTimeout(r, 250));
        }

        // 完成提示
        sendProgress(100, "✅ 课程全量双语翻译已完毕");
        console.log(`[Echo360 CC Plugin] Background Translation Completed!`);
    }

    // ============== 拦截 fetch 请求以获取字幕数据 ==============
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const response = await originalFetch.apply(this, args);
        const url = (typeof args[0] === 'string') ? args[0] : args[0]?.url;

        // 获取 transcript 的 API (Echo360数据)
        if (url && url.includes('/transcript')) {
            console.log("[Echo360 CC Plugin] Found Transcript API Fetch:", url);
            try {
                const clonedRes = response.clone();
                const textData = await clonedRes.text();
                let parsedData = null;

                try { parsedData = JSON.parse(textData); }
                catch (e) { parsedData = textData; } // 可能是 VTT

                const cues = extractCuesFromPayload(parsedData);
                if (cues && cues.length > 0) {
                    console.log(`[Echo360 CC Plugin] Successfully parsed ${cues.length} subtitles from Fetch!`);
                    transcriptData = mergeSentences(cues);
                    injectSubtitles();
                    // 挂载后，触发后台异步全量翻译
                    translateAllCues(transcriptData);
                } else {
                    console.error("[Echo360 CC Plugin] Parsed empty subtitles. Raw data preview:", textData.substring(0, 100));
                }
            } catch (e) {
                console.error("[Echo360 CC Plugin] Failed to process Fetch data:", e);
            }
        }
        return response;
    };

    // ============== 拦截 XHR 请求 ==============
    const originalXhrOpen = XMLHttpRequest.prototype.open;
    const originalXhrSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
        this._reqUrl = url;
        return originalXhrOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
        this.addEventListener('load', function () {
            if (this._reqUrl && this._reqUrl.includes('/transcript')) {
                console.log("[Echo360 CC Plugin] Found Transcript API XHR:", this._reqUrl);
                try {
                    let parsedData = null;
                    try { parsedData = JSON.parse(this.responseText); }
                    catch (e) { parsedData = this.responseText; }

                    const cues = extractCuesFromPayload(parsedData);
                    if (cues && cues.length > 0) {
                        console.log(`[Echo360 CC Plugin] Successfully parsed ${cues.length} subtitles from XHR!`);
                        transcriptData = mergeSentences(cues);
                        injectSubtitles();
                        // 挂载后，触发后台异步全量翻译
                        translateAllCues(transcriptData);
                    } else {
                        console.error("[Echo360 CC Plugin] Parsed empty subtitles from XHR. Raw data preview:", this.responseText.substring(0, 100));
                    }
                } catch (e) {
                    console.error("[Echo360 CC Plugin] Failed to process XHR data:", e);
                }
            }
        });
        return originalXhrSend.apply(this, arguments);
    };

    // ==========================================
    // 核心引擎：定时器轮询模式 (终极防御覆盖和React重构)
    // ==========================================

    let overlayLoopInterval = null;

    // 递归查找视频及穿透 iframe / shadow DOM (全地图扫描)
    function findAllVideos(root, videos = []) {
        if (!root) return videos;
        try {
            const vids = root.querySelectorAll ? root.querySelectorAll('video') : [];
            vids.forEach(v => videos.push(v));

            const els = root.querySelectorAll ? root.querySelectorAll('*') : [];
            for (let i = 0; i < els.length; i++) {
                if (els[i].shadowRoot) {
                    findAllVideos(els[i].shadowRoot, videos);
                }
                if (els[i].tagName === 'IFRAME') {
                    try {
                        if (els[i].contentDocument) {
                            findAllVideos(els[i].contentDocument, videos);
                        }
                    } catch (e) { } // 忽略跨域 iframe 报错
                }
            }
        } catch (e) { }
        return videos;
    }

    function injectSubtitles() {
        if (!transcriptData) return;

        console.log(`[Echo360 CC Plugin] Subtitle data stored (${transcriptData.length} cues). Starting rendering engine...`);
        alert(`[插件调试信息] 成功截获到 ${transcriptData.length} 条字幕！插件引擎开始渲染...如果没有出字请按F12看日志。`);

        if (overlayLoopInterval) clearInterval(overlayLoopInterval);

        let debugTick = 0;

        // 每 100 毫秒高频轮询一次
        overlayLoopInterval = setInterval(() => {
            if (!transcriptData) return;
            debugTick++;

            // 实时寻找页面上存活的 Video 标签
            const videos = findAllVideos(document);

            if (videos.length === 0) {
                if (debugTick % 30 === 0) console.log("[Echo360 CC Debug] 渲染引擎处于活跃状态，但没有在当前帧 (Frame) 或 Shadow DOM 中找到 <video> 节点。当前页面可能只是一个外层的 iframe。");
                return;
            }

            // 找一个正在播放的视频
            let targetVideo = videos.find(v => !v.paused && v.currentTime > 0) || videos[0];
            const currentTimeMs = targetVideo.currentTime * 1000;

            // 确保 overlay 长期存活
            let overlay = document.getElementById('echo360-cc-overlay');
            const config = window.__ECHO360_CC_CONFIG__ || {};
            const bgOp = config.ccBgOpacity !== undefined ? config.ccBgOpacity : 0.75;

            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'echo360-cc-overlay';
                overlay.style.cssText = `
                    position: fixed; 
                    text-align: center; 
                    color: #ffffff; 
                    padding: 8px 18px; 
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    border-radius: 6px; 
                    pointer-events: none; 
                    z-index: 2147483647; 
                    font-weight: 600; 
                    width: max-content;
                    max-width: 80%;
                    text-shadow: 1px 1px 2px #000;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.3);
                    transform: translateX(-50%); /* 确保居中锚点永远是自身的水平中线 */
                    margin: 0;
                    box-sizing: border-box;
                `;
                document.body.appendChild(overlay);
                console.log("[Echo360 CC Debug] CC Overlay 元素已成功创建并附加到 body!");
            }

            // 响应最新的背景透明度设置
            overlay.style.background = `rgba(0, 0, 0, ${bgOp})`;
            // 如果全透明，把阴影也隐去，显得更干净
            overlay.style.boxShadow = bgOp === 0 ? 'none' : '0 4px 6px rgba(0,0,0,0.3)';

            // 全屏处理 & 动态对齐视频画面中心
            const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
            if (fsEl) {
                if (!fsEl.contains(overlay)) {
                    fsEl.appendChild(overlay);
                }
                overlay.style.position = 'absolute';
                overlay.style.left = '50%';
                overlay.style.bottom = '5%';
                overlay.style.transform = 'translateX(-50%)';
            } else {
                if (overlay.parentElement !== document.body) {
                    document.body.appendChild(overlay);
                }
                overlay.style.position = 'fixed';
                // 实时追踪真实视频节点的在屏幕上的方位角
                // 解决双屏 (Video1, Video2 并排) 问题：计算所有可见视频的联合大容器边界
                const visibleVideos = videos.filter(v => {
                    const r = v.getBoundingClientRect();
                    return r.width > 0 && r.height > 0;
                });

                if (visibleVideos.length > 0) {
                    let minLeft = Infinity;
                    let maxRight = -Infinity;
                    let maxBottom = -Infinity;

                    // 遍历双轨/单轨所有实际显示的视频，画一个无形的大框把它们包起来
                    visibleVideos.forEach(v => {
                        const r = v.getBoundingClientRect();
                        if (r.left < minLeft) minLeft = r.left;
                        if (r.right > maxRight) maxRight = r.right;
                        if (r.bottom > maxBottom) maxBottom = r.bottom;
                    });

                    const combinedWidth = maxRight - minLeft;

                    // 设为所有视频框【联合大容器】的绝对水平中心点
                    overlay.style.left = (minLeft + combinedWidth / 2) + 'px';
                    // 距离屏幕底部的高度 = 视口高度 - 联合最深的底片高度 + 留出 15px 控制栏余量
                    const absoluteBottom = window.innerHeight - maxBottom + 15;
                    overlay.style.bottom = absoluteBottom + 'px';
                    overlay.style.transform = 'translateX(-50%)'; // 强行拉回字幕自身宽度的一半实现绝对居中
                }
            }

            // 更新文本内容
            const currentTextObj = transcriptData.find(item =>
                item.start !== undefined && item.end !== undefined &&
                currentTimeMs >= item.start && currentTimeMs <= item.end
            );

            if (debugTick % 30 === 0) {
                console.log(`[Echo360 CC Debug] 状态存活 -> 视频数: ${videos.length} | 毫秒: ${Math.floor(currentTimeMs)} | 中文状态: ${currentTextObj?.zhText || '未翻译'} | 命中: ${currentTextObj?.text || "None"}`);
            }

            if (currentTextObj && currentTextObj.text) {
                // =============== JIT 优先插队翻译机制 ===============
                // 如果拖拽进度条到了未翻译的区域，立刻触发单句 VIP 优先翻译！
                if (currentTextObj.zhText === undefined && !currentTextObj._isTranslating) {
                    currentTextObj._isTranslating = true;
                    // 先显示正在极速翻译中，给点视觉缓冲
                    currentTextObj._tempDisplay = '正在极速跨步翻译...';

                    const config = window.__ECHO360_CC_CONFIG__ || { ccTargetLang: 'zh-CN' };
                    const tl = config.ccTargetLang || 'zh-CN';
                    const gtUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${tl}&dt=t&q=${encodeURIComponent(currentTextObj.text)}`;

                    fetch(gtUrl).then(res => res.json()).then(data => {
                        let transText = "";
                        if (data && data[0]) {
                            data[0].forEach(t => { if (t[0]) transText += t[0]; });
                            currentTextObj.zhText = transText;
                        }
                    }).catch(err => {
                        currentTextObj.zhText = '[网络限制]';
                    }).finally(() => {
                        currentTextObj._isTranslating = false;
                    });
                }

                // 渲染过渡态或真正翻译文案
                const zhTextRaw = currentTextObj.zhText || currentTextObj._tempDisplay || '排队翻译中...';

                const config = window.__ECHO360_CC_CONFIG__ || {};
                const enColor = config.ccEnglishColor || '#ffffff';
                const zhColor = config.ccTranslateColor || '#ffffff';
                const enFontSize = config.ccEnglishFontSize || 20;
                const zhFontSize = config.ccFontSize || 22;

                // 双语排版渲染 (上方稍小英文字幕，下方高亮中文字幕)
                const enHtml = `<div style="font-size: ${enFontSize}px; opacity: 0.9; margin-bottom: 4px; color: ${enColor};">${currentTextObj.text}</div>`;
                const zhHtml = `<div style="font-size: ${zhFontSize}px; color: ${zhColor}; font-weight: bold; font-family: 'Microsoft YaHei', sans-serif;">${zhTextRaw}</div>`;

                overlay.innerHTML = enHtml + zhHtml;
                overlay.style.display = 'block';
            } else {
                overlay.style.display = 'none';
                overlay.innerHTML = '';
            }
        }, 100);
    }

})();
