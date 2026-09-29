const assert=require('assert');
const {parseBill}=require('./purchase-parser');

const text=[
  'Name of Product / Service','HSN / SAC','Qty','Rate','Taxable Value','IGST','Total','%','Amount',
  '1','Bosch All-in-One Metal Hand Tool Kit','8302','1 NOS','2,535.00','2,535.00','18.00','456.30','2,991.30',
  '2','Taparia Universal Tool Kit','8302','1 NOS','1,270.00','1,270.00','18.00','228.60','1,498.60',
  'Total','2 NOS','3,805.00','684.90','4,489.90','Total Amount After Tax','4,490.00'
].join(String.fromCharCode(10));

const p=parseBill(text);
assert.strictEqual(p.items.length,2);
assert.deepStrictEqual(p.items.map(x=>x.name),['Bosch All-in-One Metal Hand Tool Kit','Taparia Universal Tool Kit']);
assert.deepStrictEqual(p.items.map(x=>x.quantity),[1,1]);
assert.deepStrictEqual(p.items.map(x=>x.purchase_price),[2535,1270]);
assert.deepStrictEqual(p.items.map(x=>x.gst_rate),[18,18]);
assert.strictEqual(p.invoice_total,4490);
for(const x of p.items)assert(!/Phone|GSTIN|Transport|Invoice|Challan|E-Way|Sr\.?s*No/i.test(x.name));
console.log('Purchase parser tests passed.');
