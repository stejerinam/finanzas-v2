export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { merchants } = req.body;
  if (!merchants || !Array.isArray(merchants) || merchants.length === 0)
    return res.status(400).json({ error: 'merchants array required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  // merchants can be strings OR objects with {description, reference}
  // Format them clearly for the model
  const formatted = merchants.map((m, i) => {
    if (typeof m === 'object' && m !== null) {
      const ref = m.reference ? ` [concepto: "${m.reference}"]` : '';
      return `${i + 1}. ${m.description}${ref}`;
    }
    return `${i + 1}. ${m}`;
  }).join('\n');

  const prompt = `You are a financial transaction categorizer. Categorize each transaction into exactly one category.

Expense categories: food, cafe, groceries, transport, health, subscriptions, shopping, education, rent, entertainment, fitness, travel, other
Income categories: salary, freelance, reimbursement, other_income

Rules for expenses:
- food: restaurants, tacos, pizza, sushi, fast food, food delivery (Uber Eats, Rappi, DiDi Food), cafeterias
- cafe: coffee shops, Starbucks, cafés, bakeries
- groceries: supermarkets (HEB, Walmart, Costco, Chedraui), OXXO, 7-Eleven, convenience stores
- transport: Uber, DiDi, Cabify, taxis, gas stations, tolls, parking, public transport
- health: pharmacies (Farmacia Guadalajara, Farmacias del Ahorro), doctors, hospitals, labs
- subscriptions: Netflix, Spotify, Disney+, Apple, Google, OpenAI, ChatGPT, Telcel, phone plans, SaaS
- shopping: Amazon, department stores, clothing, electronics (Macstore, Apple Store), online retail
- education: schools, universities, Tec, tutors, courses, colegiatura, Oratorio
- rent: rent payments, INMOBILIARIA, property management — also flag if reference says "renta"
- entertainment: movies, concerts, events, WEB TICKETS, bars, clubs
- fitness: gyms, Gympass, Sport City, yoga, sports
- travel: airlines (Aeromexico, Volaris, Viva Aerobus), hotels, Airbnb, travel agencies
- other: anything that doesn't clearly fit above

Rules for income:
- salary: large recurring deposits, nomina, payroll
- freelance: Wise, DLocal, Stripe, PayPal, international payments, irregular large deposits
- reimbursement: small transfers from individuals, shared expenses, "te debo", splits
- other_income: government, SAT, IMSS, refunds, interest, anything else positive

IMPORTANT — use the [concepto] field when present:
- concepto "renta" or "arriendo" → rent
- concepto "colegiatura" or "escuela" → education  
- concepto "gym" or "gimnasio" → fitness
- concepto "nomina" or "sueldo" → salary
- concepto with a person's name + small amount → reimbursement
- concepto "servicios" or "luz" or "agua" → rent (utilities)
- When concepto gives clear context, prioritize it over the sender name

Transactions to categorize:
${formatted}

Return ONLY a JSON object mapping each transaction description to its category ID.
Use the exact description text as the key (without the concepto part).
Example: {"SPEI RECIBIDO BANAMEX": "reimbursement", "UBER": "transport"}

Return ONLY JSON, no explanation, no markdown.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514', // upgraded from Haiku for better accuracy
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
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
