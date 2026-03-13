export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, filename } = req.body;
  if (!text || text.trim().length < 50)
    return res.status(400).json({ error: 'Statement text too short or empty' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const prompt = `You are an expert Mexican bank statement parser. Extract all financial data from this statement text.

Return ONLY valid JSON with NO markdown, NO backticks, NO explanation — just the raw JSON object.

Required structure:
{
  "bank": "bank name (e.g. BBVA, Nu, Banamex, Santander, HSBC, Banorte, Scotiabank)",
  "accountType": "credit | debit | savings",
  "periodStart": "YYYY-MM-DD",
  "periodEnd": "YYYY-MM-DD",
  "ownClabe": "18-digit CLABE of this account, or null if not found",
  "currency": "MXN",
  "transactions": [
    {
      "date": "DD-MMM-YYYY in Spanish, e.g. 15-feb-2026",
      "description": "clean merchant or sender/receiver name, remove codes and references",
      "amount": 1234.56,
      "direction": "credit | debit",
      "counterpartyCLABE": "18-digit CLABE of the other party from SPEI details, or null"
    }
  ],
  "msiPlans": [
    {
      "description": "merchant name",
      "originalAmount": 5949.00,
      "pendingTotal": 2376.00,
      "monthlyPayment": 397.00,
      "installmentNumber": 9,
      "totalInstallments": 15
    }
  ],
  "summary": "One sentence in Spanish describing what this statement contains, e.g. Estado de cuenta de BBVA Tarjeta de Crédito del 5 de febrero al 4 de marzo de 2026 con 133 transacciones"
}

Critical parsing rules:
1. direction "credit" = money coming IN to this account (abono, depósito, ingreso)
   direction "debit" = money going OUT of this account (cargo, retiro, pago, gasto)
2. For BBVA credit cards: purchases are DEBIT (cargo), payments like BMOVIL.PAGO are also debit but mark description as "PAGO TARJETA DE CREDITO"
3. For BBVA debit/Nu: SPEI RECIBIDO = credit, SPEI ENVIADO = debit
4. Extract counterpartyCLABE from SPEI transaction details (the 18-digit number after the bank name)
5. For MSI (meses sin intereses) plans in the MSI section, add to msiPlans array
6. For MSI installment rows in regular section (e.g. "08 DE 15 AMAZON MX A MESES"), SKIP them
7. For new MSI purchases in regular section (e.g. "MACSTORE SAN AGUSTIN A 18 MSI"), include in transactions with description cleaned of "A XX MSI"
8. Skip payment rows: BMOVIL.PAGO TDC, entries with negative amounts that represent payments received
9. Clean descriptions: remove references, card numbers, TIPO DE CAMBIO lines, Referencia codes
10. Nu Cajitas (Retiro de Cajita, Depósito en Cajita, Congelaste saldo) = include but mark as internal savings movement with description starting with "CAJITA:"
11. If document is not a bank statement, return: {"error": "Not a bank statement: [reason]"}

Statement text:
${text.slice(0, 120000)}`; // cap at ~120k chars to stay within context

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514', // Use Sonnet for parsing — needs to be accurate
        max_tokens: 8000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    if (data.error) return res.status(502).json({ error: data.error.message });

    const raw = data.content?.[0]?.text || '';
    // Strip any accidental markdown
    const clean = raw.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      console.error('JSON parse error:', e, 'Raw:', raw.slice(0, 500));
      return res.status(500).json({ error: 'Could not parse AI response as JSON', raw: raw.slice(0, 500) });
    }

    if (parsed.error) {
      return res.status(422).json({ error: parsed.error });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    console.error('parse error:', err);
    return res.status(500).json({ error: err.message });
  }
}
