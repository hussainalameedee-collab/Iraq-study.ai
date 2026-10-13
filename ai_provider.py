"""Connect your chosen AI provider here. Keep all API secrets server-side."""

def answer_question(question: str, grade: str = "", subject: str = "") -> dict:
    """
    Safe placeholder until provider details are supplied.
    Replace this function with your provider's official SDK/API call.
    Return a dict with 'answer' and optional 'sources'.
    """
    return {
        "answer": (
            "واجهة الذكاء الاصطناعي جاهزة، لكن لم يتم ربط مزود الـ API بعد. "
            "أضف الاتصال داخل backend/ai_provider.py مع إبقاء المفتاح في ملف .env."
        ),
        "sources": []
    }
