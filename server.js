import "dotenv/config";
import express from "express";
import fetch from "node-fetch";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import multer from "multer";

const app = express();
const openai = new OpenAI();
const upload = multer({ storage: multer.memoryStorage() });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

/* ---------------- helpers ---------------- */

async function saveMessage(chatId, role, text) {
  if (!text) return;
  await supabase.from("messages").insert({
    chat_id: chatId,
    role,
    text
  });
}

async function loadRecentMessages(chatId, limit = 12) {
  const { data } = await supabase
    .from("messages")
    .select("role, text")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!data) return [];

  return data.reverse().map(m => ({
    role: m.role === "student" ? "user" : "assistant",
    content: m.text
  }));
}

/* ---------------- voice profiles ---------------- */

const voiceProfiles = {
  english: "Use natural friendly English for one student only.",
  hinglish: "Use natural Hinglish (roman script) for one student only and sound like a native indian.",
  hindi: "Use natural spoken Hindi for one student only.",
  gujarati: "Use natural spoken Gujarati for one student only."
};

/* ---------------- TTS ---------------- */

async function generateSpeech(text) {
  const speech = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: "alloy",
    input: text
  });

  const buf = Buffer.from(await speech.arrayBuffer());
  return `data:audio/mp3;base64,${buf.toString("base64")}`;
}

/* ---------------- intent detection ---------------- */

async function detectIntent(text) {
  const t = (text || "").toLowerCase();

  if (
    /(ok|okay|haan|haanji|ready|next|continue|tell me more|in detail|detail|explain more|more about|deep|expand|example|sample|show example|give example|code example|syntax)/i.test(
      t
    )
  ) {
    return "teach";
  }

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "Return only one word: teach or chat. If the user wants explanation, learning, continuation, details, examples or code, return teach."
        },
        { role: "user", content: text }
      ]
    })
  });

  const d = await r.json();
  return d.choices?.[0]?.message?.content?.trim().toLowerCase() || "teach";
}

/* ---------------- board fallback generator ---------------- */

async function generateBoardFromSpoken(spokenText) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `
You are a personal AI teacher's assistant.
Convert the spoken explanation into classroom board notes.

FORMATTING RULES:
1. "# Title" -> Large Yellow Heading.
2. "> code" -> Blue Code Block (Keep newlines & indentation).
3. "$ math" -> Pink Math Formula.
4. "- item" -> Green List Item.
5. Plain text -> White Chalk.

Example Output JSON:
{ "lines": ["# Photosynthesis", "Definition:", "- Process used by plants", "> function photo() { ... }"] }
`
        },
        { role: "user", content: spokenText }
      ],
      response_format: { type: "json_object" }
    })
  });

  const d = await r.json();

  try {
    const parsed = JSON.parse(d.choices[0].message.content);
    return Array.isArray(parsed.lines) ? parsed.lines : [];
  } catch {
    return [];
  }
}

/* ---------------- chat reply ---------------- */

async function chatReply(topic, profile, chatId) {
  const history = await loadRecentMessages(chatId);

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: `You are a friendly one-to-one tutor. ${voiceProfiles[profile]} Never mention any board.`
        },
        ...history,
        { role: "user", content: topic }
      ]
    })
  });

  const d = await r.json();
  return d.choices[0].message.content;
}

/* ---------------- TEACH (text) ---------------- */

app.post("/teach", async (req, res) => {
  const { topic, voiceProfile, chatId } = req.body;
  const finalChatId = chatId || "default";

  await saveMessage(finalChatId, "student", topic);

  const intent = await detectIntent(topic);

  if (intent === "chat") {
    const text = await chatReply(topic, voiceProfile, finalChatId);
    const audio = await generateSpeech(text);
    await saveMessage(finalChatId, "teacher", text);
    return res.json({
      steps: [{ spokenText: text, boardLines: [], audio }]
    });
  }

  const history = await loadRecentMessages(finalChatId);

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.45,
      messages: [
        {
          role: "system",
          content: `
You are a personal AI teacher for ONE student.
${voiceProfiles[voiceProfile]}

The teacher must write on the board using STRICT formatting symbols.

BOARD SYMBOLS (Use these at the start of the string):
1. "# " -> Large Yellow Heading (Use ONLY for Main Topics).
2. "> " -> Blue Code Block (Preserve indentation and newlines).
3. "$ " -> Pink Math Formula (Centered).
4. "- " -> Green List Item.
5. Plain Text -> Standard White Chalk (Definitions, explanations).

Return ONLY JSON in this exact format:
{
  "steps":[
    {
      "spokenText":"...",
      "boardLines":[ "# Header", "Normal text explanation", "> const x = 10;", "- Key point 1" ]
    }
  ]
}
`
        },
        ...history,
        { role: "user", content: topic }
      ],
      response_format: { type: "json_object" }
    })
  });

  const d = await r.json();

  let parsed;
  try {
    parsed = JSON.parse(d.choices[0].message.content);
  } catch {
    parsed = { steps: [] };
  }

  let steps = Array.isArray(parsed.steps) ? parsed.steps : [];

  for (const s of steps) {
    const spoken = s.spokenText || "";

    if ((!s.boardLines || s.boardLines.length === 0) && spoken.length > 40) {
      s.boardLines = await generateBoardFromSpoken(spoken);
    }

    s.audio = spoken ? await generateSpeech(spoken) : null;
    await saveMessage(finalChatId, "teacher", spoken);
  }

  res.json({ steps });
});

/* ---------------- IMAGE TEACH (FIXED & ALIGNED) ---------------- */

app.post("/teach-image", upload.single("image"), async (req, res) => {
  try {
    const { question, voiceProfile, chatId } = req.body;
    const finalChatId = chatId || "default";

    if (!req.file) {
      return res.status(400).json({ error: "No image file uploaded." });
    }

    const base64 = req.file.buffer.toString("base64");

    // 1. Save student's image message to history
    await saveMessage(finalChatId, "student", question || "[Uploaded Image]");

    const history = await loadRecentMessages(finalChatId);

    // 2. Request explanation from OpenAI with Vision
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // Supports vision and JSON mode
        temperature: 0.45,
        messages: [
          {
            role: "system",
            content: `
You are a personal AI teacher explaining from an image. 
${voiceProfiles[voiceProfile] || voiceProfiles.english}

BOARD SYMBOLS (Use these at the start of the string):
1. "# " -> Large Yellow Heading.
2. "> " -> Blue Code Block.
3. "$ " -> Pink Math Formula.
4. "- " -> Green List Item.

Return ONLY JSON in this exact format:
{
  "steps":[
    {
      "spokenText":"...",
      "boardLines":[ "# Analysis", "Based on the image...", "> extracted code", "- key point 1" ]
    }
  ]
}
`
          },
          ...history,
          {
            role: "user",
            content: [
              { type: "text", text: question || "Please explain what is in this image." },
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${base64}` }
              }
            ]
          }
        ],
        response_format: { type: "json_object" }
      })
    });

    const d = await r.json();
    
    if (d.error) {
      console.error("OpenAI Error:", d.error);
      return res.status(500).json({ error: "AI failed to process image." });
    }

    let parsed;
    try {
      parsed = JSON.parse(d.choices[0].message.content);
    } catch (e) {
      parsed = { steps: [] };
    }

    // 3. Process steps (Generate Audio & Board Fallbacks)
    let steps = Array.isArray(parsed.steps) ? parsed.steps : [];
    
    // If the AI returned a single step object instead of an array
    if (steps.length === 0 && parsed.spokenText) {
      steps = [parsed];
    }

    for (const s of steps) {
      const spoken = s.spokenText || "";

      // Add board lines if the AI forgot them but spoke a lot
      if ((!s.boardLines || s.boardLines.length === 0) && spoken.length > 40) {
        s.boardLines = await generateBoardFromSpoken(spoken);
      }

      // Generate the teacher's voice
      s.audio = spoken ? await generateSpeech(spoken) : null;
      
      // Save teacher's response to history
      await saveMessage(finalChatId, "teacher", spoken);
    }

    res.json({ steps });

  } catch (err) {
    console.error("Server Error:", err);
    res.status(500).json({ error: "Internal server error during image analysis." });
  }
});

app.listen(3000, () => console.log("Server running on http://localhost:3000"));
