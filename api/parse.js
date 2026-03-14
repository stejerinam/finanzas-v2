export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, filename } = req.body;
  if (!text || text.trim().length < 50)
    return res.status(400).json({ error: 'Statement text too short or empty' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const prompt = `You are an expert bank statement parser that works with statements from ANY country and ANY bank worldwide. Extract all financial data from this statement text.

Return ONLY valid JSON with NO markdown, NO backticks, NO explanation — just the raw JSON object.

Required structure:
{
  "bank": "bank name (e.g. BBVA, Nu, Banamex, Banco Nacional de Bolivia, HSBC, Chase, etc.)",
  "accountType": "credit | debit | savings",
  "periodStart": "YYYY-MM-DD",
  "periodEnd": "YYYY-MM-DD",
  "ownClabe": "account identifier of this account (CLABE, IBAN, account number, or null)",
  "currency": "3-letter currency code e.g. MXN, USD, BOB, EUR",
  "transactions": [
    {
      "date": "DD-MMM-YYYY in Spanish if possible, e.g. 15-feb-2026, or ISO format YYYY-MM-DD",
      "description": "clean merchant or sender/receiver name",
      "reference": "the payment concept, referencia, or memo field if present — e.g. 'renta', 'colegiatura', 'gimnasio', 'pago servicios'. Leave null if not present.",
      "amount": 1234.56,
      "direction": "credit | debit",
      "counterpartyCLABE": "account identifier of the other party if present in SPEI/transfer details, or null"
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
1. direction "credit" = money coming IN to this account (abono, depósito, ingreso, haber)
   direction "debit" = money going OUT of this account (cargo, retiro, pago, gasto, debe)
2. For credit cards: purchases are DEBIT, payments to the card are also debit but use description "PAGO TARJETA DE CREDITO"
3. For debit/savings: received transfers = credit, sent transfers = debit
4. IMPORTANT — extract the "reference" field: In Latin American banks, SPEI and transfer transactions often include a "concepto" or "referencia" field (e.g. "renta", "colegiatura", "Transferencia", "pago gym"). This is extremely valuable for categorization. Extract it separately from the description.
5. Extract counterpartyCLABE from SPEI/transfer transaction details when an 18-digit number is present
6. For MSI installment plans section, add to msiPlans array
7. Skip installment summary rows like "08 DE 15 AMAZON MX A MESES"
8. For new MSI purchases (e.g. "MACSTORE A 18 MSI"), include in transactions, clean the "A XX MSI" from description
9. Nu Cajitas (Retiro de Cajita, Depósito en Cajita, Congelaste saldo) = include with description starting "CAJITA:"
10. Accept statements from ANY bank in ANY country — do not reject based on country of origin
11. If the document is clearly NOT a bank statement (e.g. it's a utility bill, contract, or random document), return: {"error": "Not a bank statement: [reason]"}
12. If uncertain whether it's a bank statement, attempt to parse it anyway

Statement text:
${text.slice(0, 120000)}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 16000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    if (data.error) return res.status(502).json({ error: data.error.message });

    const raw = data.content?.[0]?.text || '';

    // Robustly extract JSON — handle markdown fences, leading text, truncation
    let jsonStr = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    // If there's text before the JSON object, find the first {
    const firstBrace = jsonStr.indexOf('{');
    if (firstBrace > 0) jsonStr = jsonStr.slice(firstBrace);

    // If response was truncated, find last complete closing brace
    const lastBrace = jsonStr.lastIndexOf('}');
    if (lastBrace !== -1 && lastBrace < jsonStr.length - 1) {
      jsonStr = jsonStr.slice(0, lastBrace + 1);
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      console.error('JSON parse error. Raw start:', raw.slice(0, 300));
      return res.status(500).json({
        error: 'Could not parse AI response as JSON — the statement may be too long. Try uploading one file at a time.',
      });
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
