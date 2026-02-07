let chats = JSON.parse(localStorage.getItem("ai_teacher_chats") || "[]");
let activeChatId = null;

function save() { localStorage.setItem("ai_teacher_chats", JSON.stringify(chats)); }
function active() { return chats.find(c => c.id === activeChatId); }

function createChat() {
    const c = { id: Date.now() + "", title: "New chat", messages: [], board: [] };
    chats.unshift(c);
    activeChatId = c.id;
    save();
    document.getElementById("board").innerHTML = "";
    renderList(); renderChat();
}

function renderBoard() {
    const el = document.getElementById("board");
    el.innerHTML = "";
    const c = active(); if (!c || !c.board) return;

    c.board.forEach(line => {
        const div = document.createElement("div");
        if (line.startsWith("# ")) {
            div.className = "board-heading";
            div.textContent = line.slice(2);
        } else if (line.startsWith("> ")) {
            div.className = "board-code";
            div.textContent = line.slice(2);
        } else {
            div.className = "board-text";
            div.textContent = line;
        }
        el.appendChild(div);
    });
}

async function writeLines(lines) {
    const el = document.getElementById("board");
    const c = active();

    for (const rawLine of lines) {
        c.board.push(rawLine);
        save();

        const div = document.createElement("div");
        let content = rawLine;
        let speed = 20;

        // Type detection logic
        if (rawLine.startsWith("# ")) {
            div.className = "board-heading";
            content = rawLine.slice(2);
        } else if (rawLine.startsWith("> ")) {
            div.className = "board-code";
            content = rawLine.slice(2);
            speed = 5; // Faster typing for code
        } else if (rawLine.startsWith("$ ")) {
            div.className = "board-math";
            content = rawLine.slice(2);
        } else if (rawLine.startsWith("- ")) {
            div.className = "board-list";
            content = "• " + rawLine.slice(2);
        } else {
            div.className = "board-text";
        }

        el.appendChild(div);

        // Typing animation
        let i = 0;
        await new Promise(res => {
            const t = setInterval(() => {
                // Use innerText for code to preserve whitespace/newlines
                div.innerText = content.slice(0, i++);
                el.scrollTop = el.scrollHeight;
                if (i > content.length) {
                    clearInterval(t);
                    res();
                }
            }, speed);
        });
    }
}

function renderList() {
    const list = document.getElementById("chatList");
    list.innerHTML = "";
    chats.forEach(c => {
        const w = document.createElement("div"); w.style.position = "relative";
        const i = document.createElement("div");
        i.className = "chat-item" + (c.id === activeChatId ? " active" : "");
        const t = document.createElement("div"); t.className = "chat-title"; t.textContent = c.title;
        t.onclick = () => { activeChatId = c.id; renderList(); renderChat(); renderBoard(); };
        const b = document.createElement("button"); b.className = "chat-menu-btn"; b.textContent = "⋯";
        b.onclick = e => { e.stopPropagation(); openChatMenu(w, c.id); };
        i.appendChild(t); i.appendChild(b); w.appendChild(i); list.appendChild(w);
    });
}

function openChatMenu(w, id) {
    document.querySelectorAll(".chat-menu").forEach(m => m.remove());
    const m = document.createElement("div"); m.className = "chat-menu";
    const r = document.createElement("div"); r.textContent = "Rename";
    r.onclick = () => {
        const c = chats.find(x => x.id === id);
        const n = prompt("Rename chat", c.title);
        if (n) { c.title = n; save(); renderList(); }
        m.remove();
    };
    const d = document.createElement("div"); d.textContent = "Delete";
    d.onclick = () => {
        if (!confirm("Delete chat?")) return;
        chats = chats.filter(x => x.id !== id);
        if (activeChatId === id) { if (chats.length) activeChatId = chats[0].id; else createChat(); }
        save(); renderList(); renderChat(); renderBoard();
        m.remove();
    };
    m.appendChild(r); m.appendChild(d); w.appendChild(m);
    setTimeout(() => document.addEventListener("click", () => m.remove(), { once: true }), 0);
}

function renderChat() {
    const a = document.getElementById("chatArea");
    a.innerHTML = "";
    const c = active(); if (!c) return;
    c.messages.forEach(m => {
        const d = document.createElement("div");
        d.className = "msg " + m.role;
        d.textContent = (m.role === "student" ? "You: " : "Teacher: ") + m.text;
        a.appendChild(d);
    });
    a.scrollTop = a.scrollHeight;
}

function add(role, text) {
    const c = active();
    c.messages.push({ role, text });
    if (c.title === "New chat" && role === "student") c.title = text.slice(0, 28);
    save(); renderList(); renderChat();
}

/* ---------------- MIC / STT ---------------- */

let rec = null;

document.getElementById("micBtn").onclick = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
        alert("Speech recognition not supported in this browser");
        return;
    }

    if (rec) {
        rec.stop();
        rec = null;
    }

    rec = new SR();
    rec.lang = "en-IN";
    rec.continuous = false;
    rec.interimResults = false;

    const status = document.getElementById("status");
    status.textContent = "Listening...";

    rec.onresult = e => {
        const t = e.results[0][0].transcript.trim();
        rec.stop();
        rec = null;
        status.textContent = "";

        if (!t) return;

        add("student", t);
        teachTextOnly(t);
    };

    rec.onerror = e => {
        status.textContent = "";
        rec = null;
    };

    rec.onend = () => {
        status.textContent = "";
        rec = null;
    };

    rec.start();
};

/* ------------------------------------------------ */

const imgInput = document.getElementById("imageInput");
const badge = document.getElementById("attachBadge");
const badgeName = document.getElementById("attachName");

imgInput.onchange = () => {
    if (imgInput.files[0]) {
        badge.style.display = "flex";
        badgeName.textContent = imgInput.files[0].name;
    }
};

document.getElementById("removeAttach").onclick = () => {
    imgInput.value = "";
    badge.style.display = "none";
};

function sendFromInput() {
    const i = document.getElementById("topicInput");
    const t = i.value.trim();
    if (!t && !imgInput.files[0]) return;

    if (imgInput.files[0]) {
        teachImage(t || "Explain this", imgInput.files[0]);
        i.value = "";
        return;
    }

    i.value = "";
    add("student", t);
    teachTextOnly(t);
}

document.getElementById("teachBtn").onclick = sendFromInput;
document.getElementById("topicInput").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); sendFromInput(); }
});

async function teachTextOnly(text) {
    const status = document.getElementById("status");
    status.textContent = "Teacher is thinking...";
    try {
        const res = await fetch("https://ai-teacher-9azw.onrender.com/teach", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                topic: text,
                voiceProfile: document.getElementById("voiceSelect").value,
                chatId: activeChatId
            })
        });

        const data = await res.json();

        if (!Array.isArray(data.steps)) {
            status.textContent = data.error || "No teaching steps received.";
            return;
        }

        await playSteps(data.steps);
    } catch (e) {
        status.textContent = "Failed to connect to server.";
    }
    status.textContent = "";
}

async function teachImage(text, file) {
    const status = document.getElementById("status");
    status.textContent = "Analyzing image...";
    const fd = new FormData();
    fd.append("image", file);
    fd.append("question", text);
    fd.append("voiceProfile", document.getElementById("voiceSelect").value);
    fd.append("chatId", activeChatId);

    add("student", "[Image] " + text);
    imgInput.value = "";
    badge.style.display = "none";

    try {
        const res = await fetch("https://ai-teacher-9azw.onrender.com/teach-image", { method: "POST", body: fd });
        const data = await res.json();

        if (!Array.isArray(data.steps)) {
            status.textContent = data.error || "Image teaching failed.";
            return;
        }

        await playSteps(data.steps);
    } catch (e) {
        status.textContent = "Image request failed.";
    }

    status.textContent = "";
}

async function playSteps(steps) {
    if (!Array.isArray(steps)) return;

    const audio = document.getElementById("teacherAudio");

    for (const step of steps) {
        if (step.spokenText) {
            add("teacher", step.spokenText);
        }

        let audioPromise = Promise.resolve();

        if (step.audio) {
            audio.src = step.audio;
            audio.load();
            try {
                await audio.play();
                audioPromise = new Promise(r => audio.onended = r);
            } catch { }
        }

        let boardPromise = Promise.resolve();

        if (Array.isArray(step.boardLines) && step.boardLines.length) {
            boardPromise = writeLines(step.boardLines);
        }

        await Promise.all([audioPromise, boardPromise]);
    }
}

document.getElementById("toggleSidebar").onclick = () => {
    document.getElementById("sidebar").classList.toggle("collapsed");
};

if (chats.length === 0) createChat();
else {
    activeChatId = chats[0].id;
    renderList(); renderChat(); renderBoard();
}


document.getElementById("newChatBtn").onclick = createChat;
