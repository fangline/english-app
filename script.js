let currentUser = localStorage.getItem('vocab_current_user') || null;
let vocabulary = [];
let currentCardIndex = 0;
let selectedAccent = 'en-GB'; // 預設為英式
let practiceTimer; // 用於練習模式的自動跳轉計時器
let consecutiveCorrectCount = 0; // 新增：追蹤連續正確發音次數
let tempAudio = { uk: '', us: '' }; // 暫存目前編輯中的音檔連結

// 初始化：檢查是否已登入
window.onload = () => {
    if (currentUser) {
        initUserSession();
    } else {
        showSection('login');
    }
};

function login() {
    const name = document.getElementById('username-input').value.trim();
    if (!name) return alert("Please enter your name");
    
    currentUser = name;
    localStorage.setItem('vocab_current_user', name);
    initUserSession();
}

function logout() {
    if (!confirm("確定要登出嗎？")) return;
    currentUser = null;
    localStorage.removeItem('vocab_current_user');
    location.reload(); // 重新整理頁面回到登入狀態
}

function initUserSession() {
    // 載入該使用者專屬的單字庫
    vocabulary = JSON.parse(localStorage.getItem(`vocab_data_${currentUser}`)) || [];
    
    // 顯示 UI
    document.getElementById('nav-container').classList.remove('hidden');
    document.getElementById('current-user-display').innerText = `User: ${currentUser}`;
    showSection('add');
}

function saveToLocalStorage() {
    localStorage.setItem(`vocab_data_${currentUser}`, JSON.stringify(vocabulary));
}

function togglePhoneticPicker() {
    const picker = document.getElementById('phonetic-picker');
    picker.classList.toggle('hidden');
}

function getSelectedPos() {
    return Array.from(document.querySelectorAll('input[name="pos"]:checked')).map(cb => cb.value).join(', ');
}

function insertPhonetic(symbol) {
    const input = document.getElementById('phonetic');
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const text = input.value;

    // 在游標位置插入符號，或是替換選取的文字
    input.value = text.substring(0, start) + symbol + text.substring(end);

    // 恢復焦點並將游標移至新插入符號的後面
    input.focus();
    const newPos = start + symbol.length;
    input.setSelectionRange(newPos, newPos);
}

function speakText(text, pos, audioUrls = null) {
    if (!text) return;

    // 優先嘗試播放真人錄製音檔
    let targetAudioUrl = '';
    if (audioUrls) {
        targetAudioUrl = (selectedAccent === 'en-GB' ? audioUrls.uk : audioUrls.us);
    } else if (text === document.getElementById('word').value.trim()) {
        // 僅在 "Add Word" 頁面預覽單字時使用暫存音檔
        targetAudioUrl = (selectedAccent === 'en-GB' ? tempAudio.uk : tempAudio.us);
    }

    if (targetAudioUrl) {
        const audio = new Audio(targetAudioUrl);
        audio.play().catch(e => {
            console.warn("Audio file play failed, falling back to TTS", e);
            fallbackToTTS(text, pos);
        });
    } else {
        fallbackToTTS(text, pos);
    }
}

function fallbackToTTS(text, pos) {
    // 確保暫停所有排隊中的語音，解決 iOS 系統下 TTS 有時會無聲的問題
    if (window.speechSynthesis) window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = selectedAccent; // 根據選擇切換腔調

    // 偵測是否為疑問句 (以問號結尾)
    const isQuestion = text.trim().endsWith('?');

    // 偵測是否包含動詞或形容詞 (只要其中一個符合即調高音調)
    const hasEmphasis = pos && (pos.includes('v.') || pos.includes('adj.'));

    if (isQuestion) {
        utterance.pitch = 1.5; // 疑問句使用明顯的上升音調
    } else if (hasEmphasis) {
        utterance.pitch = 1.3; // 動詞與形容詞使用稍高的強調音調
    } else {
        utterance.pitch = 1.0; // 一般情況使用正常音調
    }

    window.speechSynthesis.speak(utterance);
}

function clearPracticeTimer() {
    if (practiceTimer) {
        clearTimeout(practiceTimer);
    }
}
let autoFillTimeout;
function debouncedAutoFill() {
    clearTimeout(autoFillTimeout);
    autoFillTimeout = setTimeout(() => {
        autoFill();
    }, 700); // 延遲 700 毫秒，避免打字時頻繁觸發 API 請求
}
let isRecognizing = false;

function startSpeechLoad(fieldId) {
    if (isRecognizing) return; // 防止重複觸發

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
        alert('您的瀏覽器不支援語音辨識。蘋果手機請使用 Safari，安卓手機請使用 Chrome。');
        return;
    }

    const field = document.getElementById(fieldId);
    if (!field) return;

    const recognition = new Recognition();
    recognition.lang = 'en-US';
    recognition.lang = selectedAccent; // 讓辨識語系跟隨你選擇的 UK/US
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false; // 行動裝置上建議設為 false 以提高成功率

    // 提供視覺回饋：改變輸入框邊框顏色與佔位文字
    const originalPlaceholder = field.placeholder;
    field.style.borderColor = '#ef4444';
    field.style.boxShadow = '0 0 10px rgba(239, 68, 68, 0.3)';
    if (field.tagName === 'INPUT') field.placeholder = 'Listening... (正在聽...)';
    isRecognizing = true;

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript.trim();
        if (!transcript) {
            alert('沒有辨識到語音，請再試一次。');
            return;
        }

        field.value = transcript;
        field.dispatchEvent(new Event('input')); // 觸發輸入事件
        if (fieldId === 'word') {
            autoFill();
        }
    };

    recognition.onerror = (event) => {
        // 忽略不影響功能的錯誤訊息
        // 'aborted': 當辨識被手動停止或重複點擊時觸發，不需視為錯誤
        // 'no-speech': 使用者沒說話，不需彈窗
        if (event.error === 'aborted' || event.error === 'no-speech') {
            if (event.error === 'no-speech') {
                field.placeholder = 'No speech detected. (未偵測到聲音)';
            }
            return;
        }

        console.error('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
            alert('請在瀏覽器設定中允許麥克風權限。');
        } else {
            // 其他嚴重錯誤（如網路問題）則顯示在 placeholder，不要彈窗干擾
            field.placeholder = 'Recognition error: ' + event.error;
        }
    };

    recognition.onend = () => {
        isRecognizing = false;
        field.style.borderColor = '';
        field.style.boxShadow = '';
        if (field.tagName === 'INPUT') field.placeholder = originalPlaceholder;
    };

    recognition.start();
}

async function autoFill() {
    // 清除任何待處理的防抖自動填充呼叫，以防直接觸發 autoFill
    clearTimeout(autoFillTimeout);

    const wordInput = document.getElementById('word');
    const word = wordInput.value.trim();
    
    if (!word) {
        // 如果單字為空，則清除 autoFill 會填充的欄位，並重置按鈕狀態
        ['phonetic', 'example', 'translation'].forEach(id => document.getElementById(id).value = '');
        document.querySelectorAll('input[name="pos"]').forEach(cb => cb.checked = false);
        tempAudio = { uk: '', us: '' };
        return;
    }

    try {
        // 1. 從 Free Dictionary API 獲取音標與詞態
        const dictRes = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
        if (dictRes.ok) {
            const data = await dictRes.json();
            if (Array.isArray(data) && data.length > 0) {
                const entry = data[0];
                
                // 清除舊詞態勾選
                document.querySelectorAll('input[name="pos"]').forEach(cb => cb.checked = false);

                // 抓取真人發音 MP3 網址
                tempAudio.uk = '';
                tempAudio.us = '';
                if (entry.phonetics) {
                    const ukObj = entry.phonetics.find(p => p.audio && p.audio.includes('-uk'));
                    const usObj = entry.phonetics.find(p => p.audio && p.audio.includes('-us'));
                    const generalObj = entry.phonetics.find(p => p.audio !== '');
                    
                    tempAudio.uk = ukObj ? ukObj.audio : (generalObj ? generalObj.audio : '');
                    tempAudio.us = usObj ? usObj.audio : (generalObj ? generalObj.audio : '');
                }

                // 填入音標 (處理不同可能的結構)
                const phonetic = entry.phonetic || (entry.phonetics && entry.phonetics.find(p => p.text)?.text);
                if (phonetic) document.getElementById('phonetic').value = phonetic;

                // 自動填入例句
                let foundExample = '';
                if (entry.meanings && entry.meanings.length > 0) {
                    for (const meaning of entry.meanings) {
                        if (meaning.definitions && meaning.definitions.length > 0) {
                            for (const definition of meaning.definitions) {
                                if (definition.example) {
                                    foundExample = definition.example;
                                    break; // 找到第一個例句就停止
                                }
                            }
                        }
                        if (foundExample) break; // 找到例句就停止
                    }
                }
                if (foundExample) {
                    document.getElementById('example').value = foundExample;
                }

                // 自動判斷並選擇詞態
                const apiPos = entry.meanings[0]?.partOfSpeech;
                const posMap = { 'noun': 'n.', 'verb': 'v.', 'adjective': 'adj.', 'adverb': 'adv.' };
                if (apiPos && posMap[apiPos]) {
                    const cb = document.querySelector(`input[name="pos"][value="${posMap[apiPos]}"]`);
                    if (cb) cb.checked = true;
                }
            }
        } else {
            console.warn("Dictionary API could not find the word.");
        }

        // 2. 從 MyMemory API 獲取繁體中文翻譯
        const transRes = await fetch(`https://api.mymemory.translated.net/get?q=${word}&langpair=en|zh-TW`);
        if (transRes.ok) {
            const transData = await transRes.json();
            if (transData.responseData && transData.responseData.translatedText) {
                document.getElementById('translation').value = transData.responseData.translatedText.replace(/<\/?[^>]+(>|$)/g, "");
            }
        }
    } catch (err) {
        console.error("Fetch failed:", err);
    } finally {
    }
}

function showSection(section) {
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('add-section').classList.add('hidden');
    document.getElementById('practice-section').classList.add('hidden');
    document.getElementById('list-section').classList.add('hidden');
    if (section === 'login') return document.getElementById('login-section').classList.remove('hidden');
    
    document.getElementById(`${section}-section`).classList.remove('hidden');
    
    if (section === 'practice') startPractice();
    if (section === 'list') renderList();
}

function saveWord() {
    const wordText = document.getElementById('word').value.trim();
    if (!wordText) return alert("Please enter a word");

    const existingIndex = vocabulary.findIndex(v => v.word.toLowerCase() === wordText.toLowerCase());

    const wordData = {
        id: existingIndex >= 0 ? vocabulary[existingIndex].id : Date.now(),
        word: wordText,
        phonetic: document.getElementById('phonetic').value,
        pos: getSelectedPos(),
        example: document.getElementById('example').value,
        translation: document.getElementById('translation').value,
        status: existingIndex >= 0 ? vocabulary[existingIndex].status : 0,
        audio: { ...tempAudio }
    };

    if (existingIndex >= 0) {
        vocabulary[existingIndex] = wordData;
        alert("Word updated (Overwritten)!");
    } else {
        vocabulary.push(wordData);
        alert("Word saved!");
    }

    saveToLocalStorage();

    ['word', 'phonetic', 'example', 'translation'].forEach(id => document.getElementById(id).value = '');
    document.querySelectorAll('input[name="pos"]').forEach(cb => cb.checked = false);
    tempAudio = { uk: '', us: '' };
}

function startPractice() {
    if (vocabulary.length === 0) {
        document.getElementById('card-word').innerText = "No words added yet!";
        return;
    }
    clearPracticeTimer(); // 開始練習前先清除任何舊的計時器
    currentCardIndex = Math.floor(Math.random() * vocabulary.length);
    displayCard();
}

function displayCard() {
    const item = vocabulary[currentCardIndex];
    document.getElementById('card-word').innerText = item.word;
    // 清除舊的計時器，為新卡片設定新的計時器
    clearPracticeTimer();
    document.getElementById('practice-feedback').innerText = ''; // 清除上個單字的回饋
    document.getElementById('card-phonetic').innerText = item.phonetic;
    document.getElementById('card-pos').innerText = item.pos;
    document.getElementById('card-translation').innerText = item.translation;
    document.getElementById('card-example').innerText = item.example;
    
    const wordBtn = document.querySelector('#front .speak-btn');
    const exBtn = document.querySelector('#back .speak-btn');
    
    wordBtn.onclick = (e) => { e.stopPropagation(); speakText(item.word, item.pos, item.audio); };
    document.getElementById('card-word').onclick = (e) => { e.stopPropagation(); speakText(item.word, item.pos, item.audio); };

    exBtn.onclick = (e) => { e.stopPropagation(); speakText(item.example, item.pos, null); };
    document.getElementById('card-example').onclick = (e) => { e.stopPropagation(); speakText(item.example, item.pos, null); };

    document.getElementById('front').classList.remove('hidden');
    document.getElementById('back').classList.add('hidden');

    // 設定 10 秒後自動跳轉
    practiceTimer = setTimeout(() => {
        nextWord(false); // 自動跳轉視為「Review Later」
    }, 10000); // 10 秒
}

function testPronunciation() {
    if (isRecognizing) return;
    
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return alert('Your browser does not support speech recognition.');

    // 停止任何正在播放的合成語音，避免錄音時發生硬體佔用衝突
    if (window.speechSynthesis) window.speechSynthesis.cancel();

    const feedbackEl = document.getElementById('practice-feedback');
    const targetWord = vocabulary[currentCardIndex].word.toLowerCase().replace(/[^\w\s]/gi, '');
    
    const successSound = document.getElementById('sound-success');
    const errorSound = document.getElementById('sound-error');

    // iOS 關鍵優化：在使用者點擊手勢的當下先「解鎖」音效資源
    // 這樣在辨識完成的非同步 Callback 中，successSound.play() 才能順利執行
    if (successSound) { successSound.play().then(() => { successSound.pause(); successSound.currentTime = 0; }).catch(() => {}); }
    if (errorSound) { errorSound.play().then(() => { errorSound.pause(); errorSound.currentTime = 0; }).catch(() => {}); }

    const recognition = new Recognition();
    recognition.lang = selectedAccent;
    recognition.interimResults = true; // 啟動即時回饋，讓使用者知道系統正在聽
    recognition.continuous = false; // 強制單次辨識模式，提升手機端穩定性
    recognition.maxAlternatives = 1;
    
    // 開始測試時暫停自動跳轉計時器，避免說話到一半跳走
    clearPracticeTimer();
    
    feedbackEl.innerText = "🎤 Listening...";
    feedbackEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 5px;"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg> Listening...`;
    feedbackEl.style.color = "var(--primary)";
    isRecognizing = true;

    recognition.onresult = (event) => {
        const result = event.results[event.results.length - 1];
        const transcript = result[0].transcript.toLowerCase().trim().replace(/[^\w\s]/gi, '');

        // 即時回饋：如果還不是最終結果，先顯示正在辨識的內容，減少等待焦慮
        if (!result.isFinal) {
            feedbackEl.innerText = `👂 Hearing: "${transcript}..."`;
            feedbackEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 5px;"><path d="M6 8a6 6 0 1 0 12 0c0-1.5-.5-2.5-1.5-3.5S14 3 12 3"></path><path d="M16 8.5c0 .5-.5 1-1.5 1s-1.5-.5-1.5-1 1.5-2 3-2"></path><path d="M15.58 16.5a4 4 0 1 0-7.16 0"></path></svg> Hearing: "${transcript}..."`;
            feedbackEl.style.color = "var(--text-muted)";
            return;
        }
        
        if (transcript === targetWord) {
            feedbackEl.innerText = "🌟 Excellent! Progress +1";
            feedbackEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 5px;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg> Excellent! Progress +1`;
            feedbackEl.style.color = "var(--success)";

            // 播放成功音效
            if (successSound) {
                successSound.currentTime = 0;
                successSound.play().catch(e => console.warn("Success sound play failed", e));
            }

            // 成功動畫：縮放脈衝效果 (Pulse effect)
            feedbackEl.animate([
                { transform: 'scale(1)' },
                { transform: 'scale(1.25)', offset: 0.5 },
                { transform: 'scale(1)' }
            ], { duration: 400, easing: 'ease-out' });
            
            // 發音正確，增加該單字的熟悉度次數 (status)
            vocabulary[currentCardIndex].status = (parseInt(vocabulary[currentCardIndex].status) || 0) + 1;
            consecutiveCorrectCount++; // 連續正確次數加一
            saveToLocalStorage();
        } else {
            feedbackEl.innerText = `You said: "${transcript}". Try again!`;
            feedbackEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 5px;"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg> You said: "${transcript}". Try again!`;
            feedbackEl.style.color = "var(--danger)";

            // 播放失敗音效
            if (errorSound) {
                errorSound.currentTime = 0;
                errorSound.play().catch(e => console.warn("Error sound play failed", e));
            }

            // 失敗動畫：水平晃動效果 (Shake effect)
            feedbackEl.animate([
                { transform: 'translateX(0)' },
                { transform: 'translateX(-8px)' },
                { transform: 'translateX(8px)' },
                { transform: 'translateX(0)' }
            ], { duration: 250, iterations: 1 });
            consecutiveCorrectCount = 0; // 答錯或辨識不符，重置連續正確次數
        }
        checkConfettiTrigger(); // 檢查是否觸發 Confetti
    };

    recognition.onerror = (event) => {
        console.error("Speech Recognition Error:", event.error);
        feedbackEl.innerText = event.error === 'no-speech' ? "🔇 No sound detected. Try again." : "⚠️ Error: " + event.error;
        const errorIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 5px;"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>`;
        const micOffIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 5px;"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>`;
        
        feedbackEl.innerHTML = event.error === 'no-speech' ? `${micOffIcon} No sound detected. Try again.` : `${errorIcon} Error: ${event.error}`;
        feedbackEl.style.color = "var(--text-muted)";
        consecutiveCorrectCount = 0; // 出錯時也重置次數
    };

    recognition.onend = () => {
        isRecognizing = false;
        // 辨識結束後重新設定 10 秒計時器
        practiceTimer = setTimeout(() => nextWord(false), 10000);
    };

    recognition.start();
}

/**
 * 檢查是否達到連續正確次數，並觸發 Confetti 效果
 */
function checkConfettiTrigger() {
    if (consecutiveCorrectCount >= 3) {
        // 觸發 Confetti 效果
        confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 }
        });
        consecutiveCorrectCount = 0; // 重置計數器
    }
}

function toggleCard() {
    document.getElementById('front').classList.toggle('hidden');
    document.getElementById('back').classList.toggle('hidden');
}
function nextWord(mastered) {
    if (vocabulary.length === 0) return;
    
    // 取得目前次數，並處理從舊版字串（learning/mastered）轉換的情況
    let count = parseInt(vocabulary[currentCardIndex].status);
    if (isNaN(count)) {
        count = vocabulary[currentCardIndex].status === 'mastered' ? 1 : 0;
    }
    vocabulary[currentCardIndex].status = count + 1;
    clearPracticeTimer(); // 使用者點擊按鈕，清除自動跳轉計時器
    
    saveToLocalStorage();
    startPractice();
}

function speakVocabById(id, element) {
    const item = vocabulary.find(v => v.id === id);
    if (item) {
        speakText(item.word, item.pos, item.audio);
        if (element) element.classList.add('word-spoken');
    }
}

function renderList() {
    const tbody = document.getElementById('vocab-body');
    tbody.innerHTML = '';
    
    vocabulary.sort((a, b) => a.word.toLowerCase().localeCompare(b.word.toLowerCase()));

    vocabulary.forEach(item => {
        const displayStatus = isNaN(parseInt(item.status)) ? (item.status === 'mastered' ? 1 : 0) : item.status;
        const row = `<tr>
            <td class="vocab-word-cell" onclick="speakVocabById(${item.id}, this)">${item.word}</td>
            <td>${item.pos}</td>
            <td><span class="stat-badge">${displayStatus}</span></td>
            <td>
                <button onclick="prepareEdit(${item.id})" class="action-icon-btn" style="background-color: #f39c12; padding: 6px 10px; margin-right: 5px;" title="Edit">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
                <button onclick="deleteWord(${item.id})" class="action-icon-btn" style="background-color: #e74c3c; padding: 6px 10px;" title="Delete">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                </button>
            </td>
        </tr>`;
        tbody.innerHTML += row;
    });
}

function prepareEdit(id) {
    const item = vocabulary.find(v => v.id === id);
    if (!item) return;

    document.getElementById('word').value = item.word;
    document.getElementById('phonetic').value = item.phonetic;
    
    const posArray = item.pos ? item.pos.split(', ') : [];
    document.querySelectorAll('input[name="pos"]').forEach(cb => {
        cb.checked = posArray.includes(cb.value);
    });

    document.getElementById('example').value = item.example;
    document.getElementById('translation').value = item.translation;
    if (item.audio) tempAudio = { ...item.audio };

    showSection('add');
}

function deleteWord(id) {
    if (!confirm("Are you sure you want to delete this word?")) return;
    
    vocabulary = vocabulary.filter(v => v.id !== id);
    saveToLocalStorage();
    renderList();
}

function exportVocab() {
    if (vocabulary.length === 0) return alert("目前沒有單字可以匯出。");
    
    const dataToExport = vocabulary.map(item => ({
        Word: item.word,
        Phonetic: item.phonetic,
        POS: item.pos,
        Example: item.example,
        Translation: item.translation,
        Status: item.status,
        Audio_UK: item.audio ? item.audio.uk : '',
        Audio_US: item.audio ? item.audio.us : '',
        ID: item.id
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Vocabulary");
    
    XLSX.writeFile(workbook, `my_vocabulary_backup_${new Date().toISOString().slice(0,10)}.xlsx`);
}

function importVocab(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet);

            const importedVocab = jsonData.map(row => ({
                id: row.ID || Date.now(),
                word: String(row.Word || ""),
                phonetic: String(row.Phonetic || ""),
                pos: String(row.POS || ""),
                example: String(row.Example || ""),
                translation: String(row.Translation || ""),
                status: isNaN(parseInt(row.Status)) ? 0 : parseInt(row.Status), 
                audio: { uk: row.Audio_UK || "", us: row.Audio_US || "" }
            }));

            if (importedVocab.length > 0) {
                if (confirm("匯入將會覆蓋現有的單字庫，確定要繼續嗎？")) {
                    vocabulary = importedVocab;
                    saveToLocalStorage();
                    renderList();
                    alert("匯入成功！");
                }
            } else {
                alert("檔案格式錯誤或無有效資料。");
            }
        } catch (err) {
            console.error(err);
            alert("讀取 Excel 檔案時發生錯誤。");
        }
        event.target.value = '';
    };
    reader.readAsArrayBuffer(file);
}