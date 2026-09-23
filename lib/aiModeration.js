// ---------------------------------------------------------------------------
// Контекстная ИИ-модерация для подозрительных случаев (в первую очередь —
// "номер телефона по частям в нескольких сообщениях").
//
// В отличие от жёсткой эвристики в messageFilter.js, здесь решение принимает
// модель — она видит контекст переписки и не путает случайные цифры
// (цена, количество, номер заказа) с реальной попыткой передать контакт.
//
// Если ключ ANTHROPIC_API_KEY не задан или запрос не удался — функция
// возвращает null, и вызывающий код сам решает, что делать дальше
// (обычно — резервная эвристика checkPhoneSplitting).
// ---------------------------------------------------------------------------

const MODEL = process.env.MODERATION_MODEL || 'claude-haiku-4-5-20251001';

async function reviewPossiblePhoneSplit({ recentBodies, newMessage }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[aiModeration] ANTHROPIC_API_KEY не задан — использую резервную эвристику');
    return null;
  }

  const context = recentBodies.length
    ? recentBodies.map((m, i) => `${i + 1}. "${m}"`).join('\n')
    : '(предыдущих сообщений за последние 10 минут нет)';

  const prompt = `Ты модератор чата маркетплейса игровых товаров (аккаунты, скины, валюта, бустинг). Правило площадки: нельзя передавать контакты (телефон, Telegram, WhatsApp и т.п.), чтобы увести сделку с площадки. Некоторые пользователи пытаются обойти автоматический фильтр, отправляя номер телефона по кускам в нескольких сообщениях подряд (например: "8", затем "903", затем "123-45-67").

Предыдущие сообщения этого пользователя в этом чате за последние 10 минут (от старых к новым):
${context}

Новое сообщение, которое он сейчас пытается отправить:
"${newMessage}"

Смотри на СМЫСЛ и КОНТЕКСТ, а не только на наличие цифр. Цифры сами по себе — это нормально: цена, количество, номер заказа, уровень персонажа, характеристики товара. Блокировать нужно только если по совокупности сообщений действительно похоже, что человек передаёт номер телефона или другой контакт по частям.

Ответь ТОЛЬКО в формате JSON, без пояснений, без markdown-разметки:
{"blocked": true или false, "reason": "краткая причина на русском, одно предложение"}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      // Не логируем тело ответа: оно может содержать эхо присланного текста
      // (переписки пользователей), а нам для диагностики достаточно статуса.
      console.error('[aiModeration] API вернул ошибку, статус:', response.status);
      return null;
    }

    const data = await response.json();
    const textBlock = (data.content || []).find(block => block.type === 'text');
    if (!textBlock) {
      console.error('[aiModeration] В ответе нет текстового блока (неожиданный формат ответа)');
      return null;
    }

    const cleaned = textBlock.text.replace(/```json|```/gi, '').trim();
    const parsed = JSON.parse(cleaned);

    return {
      blocked: Boolean(parsed.blocked),
      reason: parsed.reason || 'ИИ-модерация посчитала это попыткой передать контакт по частям',
    };
  } catch (err) {
    console.error('[aiModeration] Ошибка запроса:', err.message);
    return null;
  }
}

module.exports = { reviewPossiblePhoneSplit };
