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

console.log('Purchase parser tests passed.');
