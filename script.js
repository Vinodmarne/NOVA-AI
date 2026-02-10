// --- CONFIGURATION ---
// Priority 1: Check config.js (Local) | Priority 2: Check LocalStorage (Hosted)
let API_KEY = window.CONFIG ? CONFIG.API_KEY : localStorage.getItem('nova_vault_key');
const MODEL = window.CONFIG ? CONFIG.MODEL : "google/gemini-2.0-flash-001";

// --- DOM ELEMENTS ---
const chatWindow = document.getElementById('chat-window');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const newChatBtn = document.getElementById('new-chat-btn');
const sessionList = document.getElementById('session-list');
const fileUpload = document.getElementById('file-upload');
const attachBtn = document.getElementById('attach-btn');
const aboutBtn = document.getElementById('about-btn');
const aboutModal = document.getElementById('about-modal');
const closeAbout = document.getElementById('close-about');
const menuToggle = document.getElementById('menu-toggle');
const sidebar = document.getElementById('sidebar');

// --- STATE MANAGEMENT ---
let currentSessionId = null;
let allSessions = JSON.parse(localStorage.getItem('nova_pro_data')) || {};
let pendingFileData = null; 

// Initialize application
window.onload = () => {
    // SECURITY CHECK: If no key is found (common on public GitHub pages), ask user once
    if (!API_KEY) {
        const userKey = prompt("SECURITY: API Key not found in config.js.\nPlease enter your OpenRouter API Key to begin:");
        if (userKey) {
            localStorage.setItem('nova_vault_key', userKey);
            API_KEY = userKey;
        }
    }
    renderSessionList();
    showIntroduction();
};

// --- MOBILE MENU LOGIC ---
menuToggle.onclick = (e) => {
    e.stopPropagation();
    sidebar.classList.toggle('active');
};

// Close sidebar when clicking on the chat area (Mobile improvement)
chatWindow.onclick = () => {
    if (window.innerWidth <= 768) {
        sidebar.classList.remove('active');
    }
};

// --- ABOUT MODAL LOGIC ---
aboutBtn.onclick = () => {
    aboutModal.style.display = 'flex';
};

closeAbout.onclick = () => {
    aboutModal.style.display = 'none';
};

// Close if user clicks outside the modal box
window.onclick = (event) => {
    if (event.target == aboutModal) {
        aboutModal.style.display = 'none';
    }
};

// --- FILE UPLOAD LOGIC ---
attachBtn.onclick = () => fileUpload.click();

fileUpload.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        pendingFileData = {
            name: file.name,
            type: file.type,
            data: event.target.result
        };
        attachBtn.classList.add('file-loaded');
        userInput.placeholder = `File ready: ${file.name}`;
    };

    // If image, read as DataURL for UI preview; else read as text for prompt injection
    if (file.type.startsWith('image/')) {
        reader.readAsDataURL(file);
    } else {
        reader.readAsText(file);
    }
};

// --- SESSION LOGIC ---
function showIntroduction() {
    currentSessionId = null;
    chatWindow.innerHTML = `
        <div id="welcome-container" class="welcome-screen">
            <div class="welcome-icon">✦</div>
            <h2>Welcome to Nova AI</h2>
            <p>Your neural interface for advanced computation and creative synthesis. State your objective to begin the session.</p>
        </div>`;
}

function createNewSession() {
    currentSessionId = 'sn_' + Date.now();
    allSessions[currentSessionId] = {
        title: "New Inquiry",
        messages: []
    };
    saveToLocalStorage();
    loadSession(currentSessionId);
}

function loadSession(id) {
    currentSessionId = id;
    chatWindow.innerHTML = '';
    const session = allSessions[id];
    
    // Auto-close sidebar on mobile after selecting chat
    if (window.innerWidth <= 768) {
        sidebar.classList.remove('active');
    }

    if (session.messages.length === 0) {
        chatWindow.innerHTML = `
            <div class="welcome-screen">
                <h2>Neural Link Established</h2>
                <p>Awaiting command...</p>
            </div>`;
    } else {
        session.messages.forEach(msg => {
            appendMessageUI(msg.text, msg.type, msg.file);
        });
    }
    renderSessionList();
}

function deleteSession(event, id) {
    event.stopPropagation();
    delete allSessions[id];
    if (currentSessionId === id) showIntroduction();
    saveToLocalStorage();
}

function saveToLocalStorage() {
    localStorage.setItem('nova_pro_data', JSON.stringify(allSessions));
    renderSessionList();
}

function renderSessionList() {
    sessionList.innerHTML = '';
    const sortedIds = Object.keys(allSessions).sort((a, b) => {
        const timeA = parseInt(a.split('_')[1]);
        const timeB = parseInt(b.split('_')[1]);
        return timeB - timeA;
    });

    sortedIds.forEach(id => {
        const item = document.createElement('div');
        item.className = `session-item ${id === currentSessionId ? 'active' : ''}`;
        item.innerHTML = `
            <span>${allSessions[id].title}</span>
            <span class="del-btn">✕</span>
        `;
        item.onclick = () => loadSession(id);
        item.querySelector('.del-btn').onclick = (e) => deleteSession(e, id);
        sessionList.appendChild(item);
    });
}

// --- CHAT LOGIC ---
async function handleChat() {
    let text = userInput.value.trim();
    
    if (!text && !pendingFileData) return;

    // Remove welcome screen if it exists
    const intro = document.getElementById('welcome-container');
    if (intro) intro.remove();

    // Create session if user starts typing without clicking "New Session"
    if (!currentSessionId) {
        currentSessionId = 'sn_' + Date.now();
        allSessions[currentSessionId] = {
            title: text ? (text.substring(0, 20) + "...") : (pendingFileData ? pendingFileData.name : "File Analysis"),
            messages: []
        };
    }

    // Prepare Prompt: If file is text, inject its content into the prompt
    let fullPrompt = text;
    const currentFile = pendingFileData;

    if (currentFile && !currentFile.type.startsWith('image/')) {
        fullPrompt = `[FILE ATTACHED: ${currentFile.name}]\n${currentFile.data}\n\n[USER MESSAGE]: ${text || "Please analyze this file."}`;
    }

    // UI Update: Add user message
    appendMessageUI(text, 'user', currentFile);
    allSessions[currentSessionId].messages.push({ 
        text: text, 
        type: 'user', 
        file: currentFile 
    });

    // Reset Input UI
    userInput.value = '';
    userInput.placeholder = "Message Nova...";
    pendingFileData = null;
    attachBtn.classList.remove('file-loaded');
    fileUpload.value = "";

    // Add Loading Indicator
    const loadingId = 'loading-' + Date.now();
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'message ai-msg';
    loadingDiv.id = loadingId;
    loadingDiv.innerText = "Computing...";
    chatWindow.appendChild(loadingDiv);
    chatWindow.scrollTop = chatWindow.scrollHeight;

    // Fetch API Response
    const aiResponse = await fetchAIResponse(fullPrompt);
    
    // Update Loading div with AI result
    loadingDiv.innerText = aiResponse;
    allSessions[currentSessionId].messages.push({ text: aiResponse, type: 'ai' });
    saveToLocalStorage();
}

async function fetchAIResponse(prompt) {
    if(!API_KEY) return "System Error: No API Key detected. Please refresh and provide a key.";

    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "model": MODEL,
                "messages": [{ "role": "user", "content": prompt }]
            })
        });
        const data = await response.json();
        return data.choices[0].message.content;
    } catch (error) {
        return "System Error: Unable to reach core processor. Check your connection or API key.";
    }
}

function appendMessageUI(text, type, fileObj = null) {
    // Ensure welcome screens are gone
    const welcome = document.querySelectorAll('.welcome-screen');
    welcome.forEach(el => el.remove());

    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${type === 'user' ? 'user-msg' : 'ai-msg'}`;
    
    // Add text bubble
    if (text) {
        const textContainer = document.createElement('div');
        textContainer.innerText = text;
        msgDiv.appendChild(textContainer);
    }

    // Add file preview (Image or Attachment Icon)
    if (fileObj) {
        if (fileObj.type.startsWith('image/')) {
            const img = document.createElement('img');
            img.src = fileObj.data;
            img.className = 'chat-image';
            msgDiv.appendChild(img);
        } else {
            const fileBox = document.createElement('div');
            fileBox.className = 'file-attachment-preview';
            fileBox.innerHTML = `
                <span class="file-icon">${fileObj.type === 'application/pdf' ? '📕' : '📄'}</span>
                <span class="file-name">${fileObj.name}</span>
            `;
            msgDiv.appendChild(fileBox);
        }
    }

    chatWindow.appendChild(msgDiv);
    // Auto-scroll to bottom
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

// --- EVENT LISTENERS ---
sendBtn.onclick = handleChat;
userInput.onkeypress = (e) => { if (e.key === 'Enter') handleChat(); };
newChatBtn.onclick = createNewSession;