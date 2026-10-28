# Maintaining the purchasing inventory

Use the existing CSV headers as the schema. `orders.csv` has one row per order; `items.csv` has one row per purchased product, linked by `order_id`.

1. Check whether an order ID already exists. Update its rows instead of adding duplicates.
2. From the supplied confirmation or invoice, record product names, SKUs, quantities, prices, shipping, taxes, and delivery status. Leave unknown fields blank and explain what is missing in the notes or report. Never invent values.
3. Preserve invoiced line totals when unit prices require rounding. Do not add taxes again if they are already included in the order total. Keep currencies separate; convert only with an explicit exchange rate.
4. Use `ordered`, `shipped`, `partially received`, or `received` to reflect the actual delivery state.
5. This repository is public. Never include personal information, shipping addresses, payment details, tracking numbers, or private documents.
6. After each update, check CSV formatting, unique order IDs, item arithmetic, and order totals. Report changes and uncertainties.

Do not commit or push unless explicitly instructed.
