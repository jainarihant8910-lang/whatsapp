DELIVERYOS

Multi-business WhatsApp delivery, inventory, purchase-bill OCR and GST invoicing platform.

FEATURES
- Firm ID + password authentication with salted PBKDF2 password hashes.
- Tenant-isolated business API queries.
- Separate WhatsApp LocalAuth client per business.
- Per-business QR status stored in SQLite and shown on the website.
- Groups ignored; only approved sender phone numbers are processed.
- LID-to-phone mapping when WhatsApp exposes a phone number.
- One complete WhatsApp message creates one order with multiple order items.
- Duplicate WhatsApp message protection.
- No negative stock and no partial item fulfillment.
- Confirmation reply is sent after processing; failed replies remain PENDING.
- Product master with HSN, unit, purchase price, selling price and GST rate.
- Purchase PDF/image extraction with review before stock changes.
- New products in confirmed purchase bills are created automatically.
- GST invoice drafts, finalization and cancellation with stock movements.
- A4-style PDF invoices and order PDFs.
- Responsive mobile dashboard.

DEPLOY
1. Copy .env.example to .env and set a strong DEFAULT_ADMIN_PASSWORD.
2. Run npm install.
3. Run npm start.
4. Expose PORT on 0.0.0.0 in your hosting provider.
5. Use persistent storage for data/ and .wwebjs_auth/ because WhatsApp LocalAuth needs persistent filesystem storage.

WHATSAPP FORMAT
Rahul
10 Bolt
5 Nut
20 Washer

The first non-empty line is delivered_to. The remaining lines are quantity item.

PRODUCTION
Use HTTPS, NODE_ENV=production, a strong bootstrap password, regular backups, and never commit .env, database files or WhatsApp session files.

<!-- final CI validation marker -->
