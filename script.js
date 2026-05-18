let vocabulary = JSON.parse(localStorage.getItem('myVocab')) || [];
let currentCardIndex = 0;
let selectedAccent = 'en-GB'; // 預設為英式
let tempAudio = { uk: '', us: '' }; // 暫存目前編輯中的音檔連結

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

async function autoFill() {
    const wordInput = document.getElementById('word');
    const word = wordInput.value.trim();
    const btn = document.getElementById('auto-fill-btn');
    
    if (!word) return alert("Please enter a word first");

    btn.innerText = "Loading...";
    btn.disabled = true;

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
        btn.innerText = "Auto Fill";
        btn.disabled = false;
    }
}

function showSection(section) {
    document.getElementById('add-section').classList.add('hidden');
    document.getElementById('practice-section').classList.add('hidden');
    document.getElementById('list-section').classList.add('hidden');
    
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
        status: existingIndex >= 0 ? vocabulary[existingIndex].status : 'learning',
        audio: { ...tempAudio }
    };

    if (existingIndex >= 0) {
        vocabulary[existingIndex] = wordData;
        alert("Word updated (Overwritten)!");
    } else {
        vocabulary.push(wordData);
        alert("Word saved!");
    }

    localStorage.setItem('myVocab', JSON.stringify(vocabulary));

    ['word', 'phonetic', 'example', 'translation'].forEach(id => document.getElementById(id).value = '');
    document.querySelectorAll('input[name="pos"]').forEach(cb => cb.checked = false);
    tempAudio = { uk: '', us: '' };
}

function startPractice() {
    if (vocabulary.length === 0) {
        document.getElementById('card-word').innerText = "No words added yet!";
        return;
    }
    currentCardIndex = Math.floor(Math.random() * vocabulary.length);
    displayCard();
}

function displayCard() {
    const item = vocabulary[currentCardIndex];
    document.getElementById('card-word').innerText = item.word;
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
}

function toggleCard() {
    document.getElementById('front').classList.toggle('hidden');
    document.getElementById('back').classList.toggle('hidden');
}

function nextWord(mastered) {
    if (vocabulary.length === 0) return;
    
    if (mastered) {
        vocabulary[currentCardIndex].status = 'mastered';
    } else {
        vocabulary[currentCardIndex].status = 'learning';
    }
    
    localStorage.setItem('myVocab', JSON.stringify(vocabulary));
    startPractice();
}

function renderList() {
    const tbody = document.getElementById('vocab-body');
    tbody.innerHTML = '';
    
    vocabulary.sort((a, b) => a.word.toLowerCase().localeCompare(b.word.toLowerCase()));

    vocabulary.forEach(item => {
        const row = `<tr>
            <td>${item.word}</td>
            <td>${item.pos}</td>
            <td><span class="stat-badge">${item.status}</span></td>
            <td>
                <button onclick="prepareEdit(${item.id})" style="padding: 5px 10px; width: auto; background-color: #f39c12; font-size: 0.8rem; margin-right: 5px;">Edit</button>
                <button onclick="deleteWord(${item.id})" style="padding: 5px 10px; width: auto; background-color: #e74c3c; font-size: 0.8rem;">Delete</button>
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
    localStorage.setItem('myVocab', JSON.stringify(vocabulary));
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
                status: row.Status || "learning",
                audio: { uk: row.Audio_UK || "", us: row.Audio_US || "" }
            }));

            if (importedVocab.length > 0) {
                if (confirm("匯入將會覆蓋現有的單字庫，確定要繼續嗎？")) {
                    vocabulary = importedVocab;
                    localStorage.setItem('myVocab', JSON.stringify(vocabulary));
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