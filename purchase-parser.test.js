const assert=require('assert');
const {parseBill}=require('./purchase-parser');
const multiline=[
  'PAN : 26CORPP3939N1','TAX INVOICE','ORIGINAL FOR RECIPIENT','Customer Detail','M/S','Shiv Engineering','GSTIN','32AABBA7890B1ZB','Place of','Supply','Kerala ( 32 )','Invoice No.','GST-3425-26','Invoice Date','23-Jul-2025','Challan No','33','Challan Date','23-Jul-2025','E-Way Bill No.','78456378','Transport','Silver Roadlines','Transport ID','24ABSFS0321B2ZL','Sr.','No.','Name of Product / Service','HSN / SAC','Qty','Rate','Taxable Value','IGST','Total','%','Amount','1','Bosch All-in-One Metal Hand Tool Kit','8302','1 NOS','2,535.00','2,535.00','18.00','456.30','2,991.30','2','Taparia Universal Tool Kit','8302','1 NOS','1,270.00','1,270.00','18.00','228.60','1,498.60','Total','2 NOS','3,805.00','684.90','4,489.90','Total in words','FOUR THOUSAND FOUR HUNDRED AND NINETY RUPEES ONLY','Taxable Amount','3,805.00','Add : IGST','684.90','Total Tax','684.90','Total Amount After Tax','₹4,490.00','For Gujarat Freight Tools','Authorised Signatory'
].join('\\n');
const flattened='PAN : 26CORPP3939N1 TAX INVOICE Customer Detail M/S Shiv Engineering GSTIN 32AABBA7890B1ZB Invoice No. GST-3425-26 Invoice Date 23-Jul-2025 Sr. No. Name of Product / Service HSN / SAC Qty Rate Taxable Value IGST Total % Amount 1 Bosch All-in-One Metal Hand Tool Kit 8302 1 NOS 2,535.00 2,535.00 18.00 456.30 2,991.30 2 Taparia Universal Tool Kit 8302 1 NOS 1,270.00 1,270.00 18.00 228.60 1,498.60 Total 2 NOS 3,805.00 684.90 4,489.90 Total Amount After Tax ₹4,490.00';
function check(text){
  const p=parseBill(text);
  assert.strictEqual(p.items.length,2,'expected two purchase items');
  assert.deepStrictEqual(p.items.map(x=>x.name),['Bosch All-in-One Metal Hand Tool Kit','Taparia Universal Tool Kit']);
  assert.deepStrictEqual(p.items.map(x=>x.hsn_code),['8302','8302']);
  assert.deepStrictEqual(p.items.map(x=>x.quantity),[1,1]);
  assert.deepStrictEqual(p.items.map(x=>x.purchase_price),[2535,1270]);
  assert.deepStrictEqual(p.items.map(x=>x.gst_rate),[18,18]);
  assert.strictEqual(p.invoice_number,'GST-3425-26');
  assert.strictEqual(p.invoice_total,4490);
  for(const x of p.items){assert(!/Phone|GSTIN|Transport|Invoice|Challan|E-Way|Sr\\.? No/i.test(x.name),'header leaked into product name: '+x.name)}
}
check(multiline);check(flattened);
console.log('Purchase parser tests passed.');
