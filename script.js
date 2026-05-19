let currentUser = localStorage.getItem('vocab_current_user') || null;
let vocabulary = [];
let currentCardIndex = 0;
let selectedAccent = 'en-GB'; // 預設為英式
let practiceTimer; // 用於練習模式的自動跳轉計時器
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

    const feedbackEl = document.getElementById('practice-feedback');
    const targetWord = vocabulary[currentCardIndex].word.toLowerCase().replace(/[^\w\s]/gi, '');
    
    const recognition = new Recognition();
    recognition.lang = selectedAccent;
    
    // 開始測試時暫停自動跳轉計時器，避免說話到一半跳走
    clearPracticeTimer();
    
    feedbackEl.innerText = "Listening... (請發音)";
    feedbackEl.style.color = "var(--primary)";
    isRecognizing = true;

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript.toLowerCase().trim().replace(/[^\w\s]/gi, '');
        
        if (transcript === targetWord) {
            feedbackEl.innerText = "🌟 Excellent! Progress +1";
            feedbackEl.style.color = "var(--success)";
            
            // 發音正確，增加該單字的熟悉度次數 (status)
            vocabulary[currentCardIndex].status = (parseInt(vocabulary[currentCardIndex].status) || 0) + 1;
            saveToLocalStorage();
        } else {
            feedbackEl.innerText = `You said: "${transcript}". Try again!`;
            feedbackEl.style.color = "var(--danger)";
        }
    };

    recognition.onerror = () => {
        feedbackEl.innerText = "Could not hear you. Try again.";
        feedbackEl.style.color = "var(--text-muted)";
    };

    recognition.onend = () => {
        isRecognizing = false;
        // 辨識結束後重新設定 10 秒計時器
        practiceTimer = setTimeout(() => nextWord(false), 10000);
    };

    recognition.start();
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

function speakVocabById(id) {
    const item = vocabulary.find(v => v.id === id);
    if (item) speakText(item.word, item.pos, item.audio);
}

function handleWordClick(element, id) {
    // 移除所有單字的選取狀態 (變回原本顏色)
    document.querySelectorAll('.vocab-word-cell').forEach(el => el.classList.remove('word-active'));
    // 設定當前點擊的單字為藍色 (套用 CSS 中的 .word-active)
    element.classList.add('word-active');
    // 執行發音
    speakVocabById(id);
}

function renderList() {
    const tbody = document.getElementById('vocab-body');
    tbody.innerHTML = '';
    
    vocabulary.sort((a, b) => a.word.toLowerCase().localeCompare(b.word.toLowerCase()));

    vocabulary.forEach(item => {
        const displayStatus = isNaN(parseInt(item.status)) ? (item.status === 'mastered' ? 1 : 0) : item.status;
        const row = `<tr>
            <td class="vocab-word-cell clickable-word" onclick="handleWordClick(this, ${item.id})">${item.word}</td>
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