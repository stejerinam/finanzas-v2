export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { merchants, prompt } = req.body;
  if (!merchants || !Array.isArray(merchants) || merchants.length === 0)
    return res.status(400).json({ error: 'merchants array required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  // Use custom prompt from frontend if provided, otherwise build default
  const finalPrompt = prompt || `Categorize these Mexican bank transactions.
Expense categories: food, cafe, groceries, transport, health, subscriptions, shopping, education, rent, entertainment, fitness, travel, other
Income categories: salary, freelance, reimbursement, other_income

Transactions:
${merchants.map((m, i) => `${i + 1}. ${m}`).join('\n')}

Return ONLY JSON: {"MERCHANT": "categoryId"}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: finalPrompt }],
      }),
    });

    const data = await response.json();
    if (data.error) return res.status(502).json({ error: data.error.message });

    const raw = data.content?.[0]?.text || '{}';
    const categories = JSON.parse(raw.replace(/```json|```/g, '').trim());
    return res.status(200).json({ categories });
  } catch (err) {
    console.error('categorize error:', err);
    return res.status(500).json({ error: err.message });
  }
}
