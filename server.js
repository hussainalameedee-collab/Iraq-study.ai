require("dotenv").config();
const express = require("express");
const path = require("path");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const GIGACHAT_CREDENTIALS = process.env.GIGACHAT_CREDENTIALS;
const GIGACHAT_SCOPE = process.env.GIGACHAT_SCOPE || "GIGACHAT_API_PERS";
const MODEL = process.env.GIGACHAT_MODEL || "GigaChat";

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) return cachedToken;
  if (!GIGACHAT_CREDENTIALS) {
    const err = new Error("لم تضف GIGACHAT_CREDENTIALS في إعدادات الاستضافة.");
    err.status = 503;
    throw err;
  }
  const response = await fetch("https://ngw.devices.sberbank.ru:9443/api/v2/oauth", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GIGACHAT_CREDENTIALS}`,
      "RqUID": crypto.randomUUID(),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ scope: GIGACHAT_SCOPE })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    console.error("GigaChat token error:", response.status, JSON.stringify(data));
    const err = new Error("تعذّر الاتصال بخدمة الذكاء الاصطناعي. تحقق من بيانات GigaChat وإعداداتها.");
    err.status = 502;
    throw err;
  }
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (Number(data.expires_at || 0) > Date.now()
    ? Number(data.expires_at) - Date.now()
    : 25 * 60 * 1000);
  return cachedToken;
}

app.post("/api/solve", async (req, res) => {
  try {
    const { grade, subject, page, questionNumber, task, mode } = req.body || {};
    if (!grade || !subject || !task || !String(task).trim()) {
      return res.status(400).json({ error: "اكتب الصف والمادة ونص السؤال أو الموضوع." });
    }
    if (String(task).length > 12000) {
      return res.status(413).json({ error: "النص طويل جداً. اختصر السؤال وحاول مرة أخرى." });
    }
    const token = await getAccessToken();
    const systemPrompt = `أنت مساعد تعليمي متخصص بالمنهج العراقي. أجب باللغة العربية الواضحة وبأسلوب مناسب للطالب.
التزم بالمعلومات التي تعرفها ولا تخترع نصاً من كتاب أو رقم صفحة. إذا كانت المعلومات غير كافية أو لم تستطع التأكد من جواب وزاري، قل ذلك بوضوح.
إذا كان المطلوب حل سؤال: اكتب المعطيات عند الحاجة، ثم خطوات الحل بالتسلسل، ثم الجواب النهائي. لا تتجاوز خطوات المنهج المناسبة للصف.
إذا كان المطلوب تلخيصاً: استخدم عناوين ونقاطاً، وغطِّ الأفكار الأساسية والتعاريف والقوانين المهمة.
لا تدّعِ أنك تحققت من كتاب رسمي إذا لم يُرفق نص الكتاب.`;
    const userPrompt = `الصف: ${grade}
المادة: ${subject}
الصفحة: ${page || "غير محددة"}
رقم السؤال: ${questionNumber || "غير محدد"}
نوع المساعدة: ${mode === "summary" ? "تلخيص" : "حل نموذجي وشرح"}
نص السؤال أو الموضوع:
${String(task).trim()}

أجب وفق المعلومات المتاحة. إذا كان السؤال يشير إلى صفحة من كتاب ولم يُكتب نص السؤال نفسه، اطلب من الطالب كتابة نصه أو إرسال صورة واضحة منه.`;
    const response = await fetch("https://gigachat.devices.sberbank.ru/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("GigaChat completion error:", response.status, JSON.stringify(data));
      return res.status(502).json({ error: "خدمة الذكاء الاصطناعي لم تُكمل الطلب. تحقق من صلاحية الحساب والموديل ثم حاول مجدداً." });
    }
    const answer = data.choices?.[0]?.message?.content;
    if (!answer) return res.status(502).json({ error: "وصل رد فارغ من خدمة الذكاء الاصطناعي. حاول مرة أخرى." });
    res.json({ answer });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || "حدث خطأ غير متوقع." });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`iraq study .ai running on port ${PORT}`));