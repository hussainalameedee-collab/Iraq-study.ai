const form = document.getElementById("studyForm");
const btn = document.getElementById("submitBtn");
const result = document.getElementById("result");
const answer = document.getElementById("answer");
const copyBtn = document.getElementById("copyBtn");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const payload = {
    grade: document.getElementById("grade").value,
    subject: document.getElementById("subject").value,
    page: document.getElementById("page").value.trim(),
    questionNumber: document.getElementById("questionNumber").value.trim(),
    task: document.getElementById("task").value.trim(),
    mode
  };
  btn.disabled = true;
  btn.textContent = "جاري تجهيز الإجابة...";
  result.classList.remove("hidden");
  answer.textContent = "لحظة، نراجع السؤال ونجهّز الرد...";
  try {
    const response = await fetch("/api/solve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "تعذر الحصول على إجابة.");
    answer.textContent = data.answer;
  } catch (error) {
    answer.textContent = `ما قدرنا نكمل الطلب:\n${error.message}\n\nإذا كانت هذه أول مرة تشغّل الموقع، تأكد من إضافة بيانات GigaChat في إعدادات الاستضافة.`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = "<span>✦</span> ابدأ الحل";
  }
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(answer.innerText);
    copyBtn.textContent = "تم النسخ ✓";
    setTimeout(() => copyBtn.textContent = "نسخ الإجابة", 1500);
  } catch {
    copyBtn.textContent = "حدد النص وانسخه";
  }
});