const assert=require('assert');
const {parseBill}=require('./purchase-parser');

const gstText=[
  'Name of Product / Service','HSN / SAC','Qty','Rate','Taxable Value','IGST','Total','%','Amount',
  '1','Bosch All-in-One Metal Hand Tool Kit','8302','1 NOS','2,535.00','2,535.00','18.00','456.30','2,991.30',
  '2','Taparia Universal Tool Kit','8302','1 NOS','1,270.00','1,270.00','18.00','228.60','1,498.60',
  'Total','2 NOS','3,805.00','684.90','4,489.90','Total Amount After Tax','4,490.00'
].join(String.fromCharCode(10));

const retailText=[
  'Invoice','Ravi kumar','Invoice No: 55 Invoice Date: 14 May, 2026 05:14 PM',
  '# Items HSN Quantity MRP Rate Per Unit Tax Per Unit Amount',
  '1 ee Croissants 1Pack 120.00 141.60 25.49 (18) 167.09',
  '2 Sourdough Bread 1Pack 80.00 80.00 11.04 (13.8) 91.04',
  'Sub Total 2.00 258.13','Taxable Amount 221.60','Total Amount 258.13'
].join(String.fromCharCode(10));

{
  const p=parseBill(gstText);
  assert.strictEqual(p.items.length,2);
  assert.deepStrictEqual(p.items.map(x=>x.name),['Bosch All-in-One Metal Hand Tool Kit','Taparia Universal Tool Kit']);
  assert.deepStrictEqual(p.items.map(x=>x.quantity),[1,1]);
  assert.deepStrictEqual(p.items.map(x=>x.purchase_price),[2535,1270]);
  assert.deepStrictEqual(p.items.map(x=>x.gst_rate),[18,18]);
  assert.strictEqual(p.invoice_total,4490);
}

{
  const p=parseBill(retailText);
    assert.strictEqual(p.items.length,2);
  assert.deepStrictEqual(p.items.map(x=>x.name),['Croissants','Sourdough Bread']);
  assert.deepStrictEqual(p.items.map(x=>x.quantity),[1,1]);
  assert.deepStrictEqual(p.items.map(x=>x.unit),['PACK','PACK']);
  assert.deepStrictEqual(p.items.map(x=>x.purchase_price),[141.6,80]);
  assert.deepStrictEqual(p.items.map(x=>x.gst_rate),[18,13.8]);
  assert.deepStrictEqual(p.items.map(x=>x.line_total),[167.09,91.04]);
  assert.strictEqual(p.invoice_total,258.13);
  assert.strictEqual(p.taxable_total,221.6);
  assert.deepStrictEqual(p.items.map(x=>x.hsn_code),['','']);
  for(const x of p.items)assert(!/Phone|GSTIN|Transport|Invoice|Challan|E-Way|Sr\.?\s*No/i.test(x.name));
}

{
  const multiLine=[
    'Invoice','Items HSN Quantity MRP Rate Per Unit Tax Per Unit Amount',
    '1','Croissants','1 Pack','120.00','141.60','25.49 (18)','167.09',
    '2','Sourdough Bread','1 Pack','80.00','80.00','11.04 (13.8)','91.04',
    'Total Amount 258.13'
  ].join(String.fromCharCode(10));
  const p=parseBill(multiLine);
  assert.strictEqual(p.items.length,2);
  assert.deepStrictEqual(p.items.map(x=>x.name),['Croissants','Sourdough Bread']);
  assert.deepStrictEqual(p.items.map(x=>x.quantity),[1,1]);
  assert.deepStrictEqual(p.items.map(x=>x.purchase_price),[141.6,80]);
  assert.deepStrictEqual(p.items.map(x=>x.gst_rate),[18,13.8]);
  assert.deepStrictEqual(p.items.map(x=>x.line_total),[167.09,91.04]);
  assert.strictEqual(p.invoice_total,258.13);
}

{
  const ocrFlattened=[
    'Name of Product / Service HSN Qty Unit Rate Taxable GST Tax Total',
    '1 Bosch Drill Machine 8467 2 PCS 1,250.00 2,500.00 18 450.00 2,950.00',
    '2 Taparia Screwdriver Set 8205 3 PCS 300.00 900.00 18 162.00 1,062.00',
    'Total 4,012.00'
  ].join(String.fromCharCode(10));
  const p=parseBill(ocrFlattened);
  assert.strictEqual(p.items.length,2);
  assert.deepStrictEqual(p.items.map(x=>x.name),['Bosch Drill Machine','Taparia Screwdriver Set']);
  assert.deepStrictEqual(p.items.map(x=>x.quantity),[2,3]);
  assert.deepStrictEqual(p.items.map(x=>x.purchase_price),[1250,300]);
}


{
  // OCR.space Engine 3 can emit a Markdown table without the separator row.
  // Column order can also differ from the usual GST invoice layout.
  const markdown=[
    '| Sr No | Product Description | Qty | Unit | Taxable Value | GST % | Tax Amount | Total Amount |',
    '| 1 | Bosch Drill Machine | 2 | PCS | 2500.00 | 18 | 450.00 | 2950.00 |',
    '| 2 | Taparia Screwdriver Set | 3 | PCS | 900.00 | 18 | 162.00 | 1062.00 |',
    '| Grand Total | | | | 3400.00 | | 612.00 | 4012.00 |'
  ].join(String.fromCharCode(10));
  const p=parseBill(markdown);
  assert.strictEqual(p.items.length,2);
  assert.deepStrictEqual(p.items.map(x=>x.name),['Bosch Drill Machine','Taparia Screwdriver Set']);
  assert.deepStrictEqual(p.items.map(x=>x.quantity),[2,3]);
  assert.deepStrictEqual(p.items.map(x=>x.purchase_price),[1250,300]);
  assert.deepStrictEqual(p.items.map(x=>x.gst_rate),[18,18]);
  assert.deepStrictEqual(p.items.map(x=>x.line_total),[2950,1062]);
}

console.log('Purchase parser tests passed.');

const looseImageOcr = [
  'TAX INVOICE',
  '1 Bosch Drill Machine 8207 2 PCS 1,250.00 2,500.00 9% 225.00 9% 225.00 2,950.00',
  '2 Taparia Screwdriver Set 8205 3 PCS 300.00 900.00 9% 81.00 9% 81.00 1,062.00',
  'CGST 9% 306.00',
  'SGST 9% 306.00',
  'Total Tax 612.00',
  'Total Amount 4,012.00'
] .join(String.fromCharCode(10));
const loose=parseBill(looseImageOcr);
assert.equal(loose.items.length,2,'loose OCR rows should recover all products');
assert.deepEqual(loose.items.map(x=>x.quantity),[2,3]);
assert.deepEqual(loose.items.map(x=>x.purchase_price),[1250,300]);
assert.equal(loose.cgst,306);
assert.equal(loose.sgst,306);
assert.equal(loose.tax_total,612);
assert.equal(loose.invoice_total,4012);


{
  // OCR can turn the invoice footer total into a fake numbered product row.
  const footerAsRow=[
    'TAX INVOICE',
    '1 Bosch Drill Machine 8207 2 PCS 1,250.00 2,500.00 18 450.00 2,950.00',
    '2 Taparia Screwdriver Set 8205 3 PCS 300.00 900.00 18 162.00 1,062.00',
    '3 Total Amount After Tax 4,012.00 1 PCS 4,012.00 4,012.00 0 0 4,012.00',
    '4 Bill Amount 4,012.00 1 PCS 4,012.00 4,012.00 0 0 4,012.00',
    'Total Tax 612.00',
    'Total Amount 4,012.00'
  ].join(String.fromCharCode(10));
  const fp=parseBill(footerAsRow);
  assert.strictEqual(fp.items.length,2,'invoice/bill totals must never become products');
  assert.deepStrictEqual(fp.items.map(x=>x.name),['Bosch Drill Machine','Taparia Screwdriver Set']);
}

{
  // Regression from gst-bill-format.png: the invoice has 8 real products,
  // subtotal 32898, GST 5127.84, and final amount 38026.00. OCR may turn
  // the bottom summary into a ninth numbered row.
  const imageBill=[
    'TAX INVOICE',
    '1 Best Ball Pen 1495 2 Nos 10.00 20.00 12 2.40 22.40',
    '2 Executive Diary 1256 8 Box 590.00 4720.00 12 566.40 5,286.40',
    '3 Leather Portfolio Folder 1258 2 Box 630.00 1260.00 12 151.20 1,411.20',
    '4 Wireless Mouse 4589 9 Nos 520.00 4680.00 18 842.40 5,522.40',
    '5 A4 Document File 4587 5 Pkt 420.00 2100.00 12 252.00 2,352.00',
    '6 Power Bank 10000mAh 1248 9 Nos 570.00 5130.00 12 615.60 5,745.60',
    '7 USB Flash Drive 1256 12 Pkt 999.00 11988.00 18 2157.84 14,145.84',
    '8 Bluetooth Keyboard 2536 4 Box 750.00 3000.00 18 540.00 3,540.00',
    '9 Total Amount 38026.00 1 PCS 38026.00 38026.00 0 0 38026.00',
    'CGST Amt: 2563.92',
    'SGST Amt: 2563.92',
    'Sub-Total: 32898 38025.84',
    'Total Amount: 38026.00'
  ].join(String.fromCharCode(10));
  const p=parseBill(imageBill);
  assert.strictEqual(p.items.length,8,'bill total must not become a ninth product');
  assert.deepStrictEqual(p.items.map(x=>x.name),[
    'Best Ball Pen','Executive Diary','Leather Portfolio Folder','Wireless Mouse',
    'A4 Document File','Power Bank 10000mAh','USB Flash Drive','Bluetooth Keyboard'
  ]);
  assert.strictEqual(p.taxable_total,32898);
  assert.strictEqual(p.tax_total,5127.84);
  assert.strictEqual(p.cgst,2563.92);
  assert.strictEqual(p.sgst,2563.92);
  assert.strictEqual(p.invoice_total,38026);
}


{
  // Complete purchase-invoice regression matching the supplied GST bill.
  const bill=[
    'Tax Invoice Original / Duplicate Bill',
    'GSTIN: 07BGUPD3647XXXX',
    'SUNRISE ENTERPRISE',
    'General Store - Delhi-181005',
    '# S-50, 3rd Cross PTC Building, I.T. Estate, New Delhi-1358XX',
    'Contact No. : +91-985689XXX9, +91-98458XXX38',
    'Bill To',
    'Name : Rajiv Gupta',
    'Address : # S-50, 3rd PTC Building, I.T. Estate, Delhi-1358XX',
    'State Delhi - 07',
    'GSTIN : HVBADAXX456',
    'Ship To',
    'Name : Rajiv Gupta',
    'Inv. No. : Inv-5',
    'Inv. Date: 10-01-25',
    'Payment Mode : UPI',
    'Reverse Charge : YES',
    "Buyer's Order No : B4589",
    "Supplier's Ref. : S145",
    'Vehicle Number : V1456',
    '1 Best Ball Pen 1495 2 Nos 10.00 20.00 12 2.40 22.40',
    '2 Executive Diary 1256 8 Box 590.00 4720.00 12 566.40 5286.40',
    '3 Leather Portfolio Folder 1258 2 Box 630.00 1260.00 12 151.20 1411.20',
    '4 Wireless Mouse 4589 9 Nos 520.00 4680.00 18 842.40 5522.40',
    '5 A4 Document File 4587 5 Pkt 420.00 2100.00 12 252.00 2352.00',
    '6 Power Bank 10000mAh 1248 9 Nos 570.00 5130.00 12 615.60 5745.60',
    '7 USB Flash Drive 1256 12 Pkt 999.00 11988.00 18 2157.84 14145.84',
    '8 Bluetooth Keyboard 2536 4 Box 750.00 3000.00 18 540.00 3540.00',
    'Sub-Total: 32898 5127.84 38025.84',
    'CGST Amt : 2563.92',
    'SGST Amt : 2563.92',
    'Round off : 0.16',
    'Total Amount : 38026.00'
  ].join(String.fromCharCode(10));
  const p=parseBill(bill);
  assert.strictEqual(p.supplier_name,'SUNRISE ENTERPRISE');
  assert.strictEqual(p.supplier_gstin,'07BGUPD3647XXXX');
  assert.strictEqual(p.supplier_phone,'+91-985689XXX9, +91-98458XXX38');
  assert.strictEqual(p.buyer_name,'Rajiv Gupta');
  assert.strictEqual(p.buyer_gstin,'HVBADAXX456');
  assert.strictEqual(p.invoice_number,'Inv-5');
  assert.strictEqual(p.invoice_date,'10-01-25');
  assert.strictEqual(p.payment_method,'UPI');
  assert.strictEqual(p.reverse_charge,'YES');
  assert.strictEqual(p.buyer_order_number,'B4589');
  assert.strictEqual(p.supplier_reference,'S145');
  assert.strictEqual(p.vehicle_number,'V1456');
  assert.strictEqual(p.items.length,8);
  assert.deepStrictEqual(p.items.map(x=>x.quantity),[2,8,2,9,5,9,12,4]);
  assert.deepStrictEqual(p.items.map(x=>x.purchase_price),[10,590,630,520,420,570,999,750]);
  assert.strictEqual(p.taxable_total,32898);
  assert.strictEqual(p.cgst,2563.92);
  assert.strictEqual(p.sgst,2563.92);
  assert.strictEqual(p.tax_total,5127.84);
  assert.strictEqual(p.invoice_total,38026);
}
