require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const Tesseract = require("tesseract.js");
const db = require("./database");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const STATUS_FILE = path.join(__dirname, "data", "whatsapp-status.json");

app.use(express.json({limit:"5mb"}));
app.use(express.urlencoded({extended:true}));
app.use(express.static(PUBLIC_DIR));

const sessions = new Map();
const upload = multer({
  storage: multer.memoryStorage(),
  limits:{fileSize:10*1024*1024},
  fileFilter:(req,file,cb)=>{
    const ok=["application/pdf","image/jpeg","image/png","image/webp"].includes(file.mimetype);
    cb(ok?null:new Error("Only PDF, JPG, PNG and WEBP files are allowed."),ok);
  }
});

const clean=v=>String(v??"").trim();
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0;};
const hashPassword=(password,salt)=>crypto.pbkdf2Sync(String(password),salt,120000,64,"sha512").toString("hex");
function makePassword(password){const salt=crypto.randomBytes(16).toString("hex");return {salt,hash:hashPassword(password,salt)};}
function readStatus(){try{return JSON.parse(fs.readFileSync(STATUS_FILE,"utf8"));}catch{return {status:"DISCONNECTED",message:"WhatsApp is not connected.",qr:null};}}
function token(){return crypto.randomBytes(32).toString("hex");}
function auth(req,res,next){const t=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");const s=sessions.get(t);if(!s)return res.status(401).json({error:"Please log in again."});req.auth=s;req.token=t;next();}
function sameState(buyer,firm){return clean(buyer).toLowerCase() && clean(buyer).toLowerCase()===clean(firm).toLowerCase();}

app.get("/api/health",async(req,res)=>{try{await db.get("SELECT 1 AS ok");res.json({success:true,server:true,database:true});}catch(e){res.status(500).json({success:false,error:e.message});}});
app.get("/api/whatsapp/status",(req,res)=>res.json(readStatus()));

app.post("/api/auth/register",async(req,res)=>{
  try{
    const d=req.body||{};
    if(!clean(d.business_id)||!clean(d.firm_name)||!clean(d.name)||!clean(d.email)||String(d.password||"").length<8)return res.status(400).json({error:"Business ID, firm name, name, email and an 8+ character password are required."});
    if(await db.getBusinessByCode(d.business_id))return res.status(409).json({error:"Business ID already exists."});
    const business=await db.createBusiness(d);
    const p=makePassword(d.password);
    const user=await db.createUser({business_id:business.id,name:clean(d.name),email:clean(d.email).toLowerCase(),password_hash:p.hash,password_salt:p.salt,role:"OWNER"});
    const t=token();sessions.set(t,{businessId:business.id,userId:user.id,role:user.role});
    res.status(201).json({success:true,token:t,user,business});
  }catch(e){console.error(e);res.status(500).json({error:e.message||"Registration failed."});}
});

app.post("/api/auth/login",async(req,res)=>{
  try{
    const business=await db.getBusinessByCode(req.body.business_id);
    if(!business)return res.status(401).json({error:"Invalid Business ID or password."});
    const user=await db.getUserByEmail(business.id,req.body.email);
    if(!user)return res.status(401).json({error:"Invalid Business ID or password."});
    const candidate=hashPassword(req.body.password||"",user.password_salt);
    if(candidate!==user.password_hash)return res.status(401).json({error:"Invalid Business ID or password."});
    const t=token();sessions.set(t,{businessId:business.id,userId:user.id,role:user.role});
    res.json({success:true,token:t,user,business});
  }catch(e){res.status(500).json({error:"Login failed."});}
});
app.post("/api/auth/logout",auth,(req,res)=>{sessions.delete(req.token);res.json({success:true});});
app.get("/api/auth/me",auth,async(req,res)=>res.json({success:true,business:await db.getBusiness(req.auth.businessId)}));

app.get("/api/business",auth,async(req,res)=>res.json({success:true,business:await db.getBusiness(req.auth.businessId)}));
app.put("/api/business",auth,async(req,res)=>{try{res.json({success:true,business:await db.updateBusiness(req.auth.businessId,req.body||{})});}catch(e){res.status(400).json({error:e.message});}});

app.get("/api/dashboard",auth,async(req,res)=>{
  try{
    const b=req.auth.businessId;
    const [orders,items,low,pending,finalized,purchases]=await Promise.all([
      db.get("SELECT COUNT(*) count FROM orders WHERE business_id=?",[b]),
      db.get("SELECT COUNT(*) count FROM items WHERE business_id=?",[b]),
      db.get("SELECT COUNT(*) count FROM items WHERE business_id=? AND current_stock<=minimum_stock",[b]),
      db.get("SELECT COUNT(*) count FROM orders WHERE business_id=? AND status='PENDING'",[b]),
      db.get("SELECT COUNT(*) count FROM invoices WHERE business_id=? AND status='FINALIZED'",[b]),
      db.get("SELECT COUNT(*) count FROM purchase_bills WHERE business_id=?",[b])
    ]);
    const stockValue=await db.get("SELECT COALESCE(SUM(current_stock*selling_price),0) value FROM items WHERE business_id=?",[b]);
    const today=await db.get("SELECT COUNT(*) count FROM orders WHERE business_id=? AND date=date('now','localtime')",[b]);
    res.json({success:true,totalOrders:num(orders.count),todayOrders:num(today.count),totalStockItems:num(items.count),lowStockItems:num(low.count),pendingOrders:num(pending.count),finalizedInvoices:num(finalized.count),purchaseBills:num(purchases.count),stockValue:num(stockValue.value)});
  }catch(e){res.status(500).json({error:"Failed to load dashboard."});}
});

app.get("/api/items",auth,async(req,res)=>res.json({success:true,items:await db.all("SELECT *,CASE WHEN current_stock<=minimum_stock THEN 1 ELSE 0 END low_stock FROM items WHERE business_id=? ORDER BY name COLLATE NOCASE",[req.auth.businessId])}));
app.post("/api/items",auth,async(req,res)=>{try{const d=req.body||{},name=clean(d.name);if(!name)return res.status(400).json({error:"Product name is required."});const exists=await db.get("SELECT id FROM items WHERE business_id=? AND name=? COLLATE NOCASE",[req.auth.businessId,name]);if(exists)return res.status(409).json({error:"Product already exists."});const stock=num(d.opening_stock);const r=await db.run("INSERT INTO items (business_id,name,sku,hsn_code,unit,opening_stock,current_stock,minimum_stock,purchase_price,selling_price,gst_rate) VALUES (?,?,?,?,?,?,?,?,?,?,?)",[req.auth.businessId,name,clean(d.sku),clean(d.hsn_code),clean(d.unit)||"PCS",stock,stock,num(d.minimum_stock),num(d.purchase_price),num(d.selling_price),num(d.gst_rate)]);res.status(201).json({success:true,item:await db.get("SELECT * FROM items WHERE id=?",[r.lastID])});}catch(e){res.status(400).json({error:e.message});}});
app.post("/api/items/:id/stock",auth,async(req,res)=>{try{const id=num(req.params.id),q=num(req.body.quantity);if(q<=0)throw new Error("Quantity must be greater than zero.");const item=await db.get("SELECT * FROM items WHERE id=? AND business_id=?",[id,req.auth.businessId]);if(!item)return res.status(404).json({error:"Product not found."});await db.run("UPDATE items SET current_stock=current_stock+? WHERE id=?",[q,id]);await db.run("INSERT INTO stock_transactions (business_id,item_id,type,quantity,reason) VALUES (?,?,'IN',?,?)",[req.auth.businessId,id,q,clean(req.body.reason)||"Manual stock addition"]);res.json({success:true,item:await db.get("SELECT * FROM items WHERE id=?",[id])});}catch(e){res.status(400).json({error:e.message});}});
app.delete("/api/items/:id",auth,async(req,res)=>{
  try {
    await db.deleteItem(num(req.params.id), req.auth.businessId);
    res.json({success:true});
  } catch(e) {
    res.status(400).json({error:e.message});
  }
});
app.get("/api/transactions",auth,async(req,res)=>res.json({success:true,transactions:await db.all("SELECT st.*,COALESCE(i.name,'Deleted product #'||st.item_id) item_name FROM stock_transactions st LEFT JOIN items i ON i.id=st.item_id WHERE st.business_id=? ORDER BY st.id DESC",[req.auth.businessId])}));

app.get("/api/senders",auth,async(req,res)=>res.json({success:true,senders:await db.all("SELECT * FROM senders WHERE business_id=? ORDER BY id DESC",[req.auth.businessId])}));
app.post("/api/senders",auth,async(req,res)=>{try{const phone=db.normalizePhone(req.body.phone);if(!phone)return res.status(400).json({error:"Phone number required."});if(await db.get("SELECT id FROM senders WHERE business_id=? AND whatsapp_id=?",[req.auth.businessId,phone]))return res.status(409).json({error:"Sender already exists."});const r=await db.run("INSERT INTO senders (business_id,whatsapp_id,name) VALUES (?,?,?)",[req.auth.businessId,phone,clean(req.body.name)]);res.status(201).json({success:true,sender:await db.get("SELECT * FROM senders WHERE id=?",[r.lastID])});}catch(e){res.status(400).json({error:e.message});}});
app.delete("/api/senders/:id",auth,async(req,res)=>{await db.run("DELETE FROM senders WHERE id=? AND business_id=?",[num(req.params.id),req.auth.businessId]);res.json({success:true});});

app.get("/api/orders",auth,async(req,res)=>res.json({success:true,orders:await db.getOrders().then(x=>x.filter(o=>Number(o.business_id)===Number(req.auth.businessId)))}));
app.get("/api/orders/:id",auth,async(req,res)=>{const o=await db.getOrderById(num(req.params.id));if(!o||Number(o.business_id)!==Number(req.auth.businessId))return res.status(404).json({error:"Order not found."});res.json({success:true,order:o});});

app.get("/api/customers",auth,async(req,res)=>res.json({success:true,customers:await db.listCustomers(req.auth.businessId)}));
app.post("/api/customers",auth,async(req,res)=>{try{if(!clean(req.body.name))return res.status(400).json({error:"Customer name is required."});res.status(201).json({success:true,customer:await db.createCustomer(req.auth.businessId,req.body)});}catch(e){res.status(400).json({error:e.message});}});

function invoiceMath(items,business,customer){
  const same=sameState(customer.state_code||customer.state,business.state_code||business.state);
  let subtotal=0,cgst=0,sgst=0,igst=0;
  const out=(items||[]).map(x=>{const qty=num(x.quantity),rate=num(x.rate),gst=num(x.gst_rate),tax=qty*rate;let a=0,b=0,c=0;if(same){a=tax*gst/200;b=a;}else c=tax*gst/100;subtotal+=tax;cgst+=a;sgst+=b;igst+=c;return {...x,quantity:qty,rate, gst_rate:gst,taxable_value:tax,cgst:a,sgst:b,igst:c,line_total:tax+a+b+c};});
  return {items:out,subtotal,cgst,sgst,igst,total_tax:cgst+sgst+igst,grand_total:subtotal+cgst+sgst+igst};
}
app.get("/api/invoices",auth,async(req,res)=>res.json({success:true,invoices:await db.listInvoices(req.auth.businessId)}));
app.get("/api/invoices/:id",auth,async(req,res)=>{const x=await db.getInvoice(num(req.params.id),req.auth.businessId);if(!x)return res.status(404).json({error:"Invoice not found."});res.json({success:true,invoice:x,business:await db.getBusiness(req.auth.businessId)});});
app.post("/api/invoices",auth,async(req,res)=>{try{const business=await db.getBusiness(req.auth.businessId);const d=req.body||{},customer=d.customer||{};const calc=invoiceMath(d.items||[],business,customer);const inv=await db.createInvoice(req.auth.businessId,{...d,customer_name:customer.name||d.customer_name||"Cash Customer",customer_address:customer.address||d.customer_address,customer_phone:customer.phone||d.customer_phone,customer_gstin:customer.gstin||d.customer_gstin,customer_state:customer.state||d.customer_state,customer_state_code:customer.state_code||d.customer_state_code,...calc});res.status(201).json({success:true,invoice:inv,business});}catch(e){res.status(400).json({error:e.message});}});
app.post("/api/invoices/:id/finalize",auth,async(req,res)=>{try{res.json({success:true,invoice:await db.finalizeInvoice(num(req.params.id),req.auth.businessId)});}catch(e){res.status(400).json({error:e.message});}});
app.post("/api/invoices/:id/cancel",auth,async(req,res)=>{try{res.json({success:true,invoice:await db.cancelInvoice(num(req.params.id),req.auth.businessId)});}catch(e){res.status(400).json({error:e.message});}});

async function extractText(buffer,mime){if(mime==="application/pdf"){const parsed=await pdfParse(buffer);return parsed.text||"";}const result=await Tesseract.recognize(buffer,"eng");return result.data.text||"";}
function parsePurchaseText(text){
  const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),items=[];
  for(const line of lines){
    const m=line.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*(NOS|PCS|PC|KG|KGS|BOX|SET|MTR|LTR|UNIT)?\s+(\d+(?:\.\d+)?)$/i);
    if(m)items.push({name:m[1].replace(/^\d+[.)-]?\s*/,"").trim(),quantity:num(m[2]),unit:(m[3]||"PCS").toUpperCase(),purchase_price:num(m[4])});
  }
  return items.slice(0,200);
}
app.post("/api/purchase-bills/extract",auth,upload.single("bill"),async(req,res)=>{
  try{
    if(!req.file)return res.status(400).json({error:"Upload a PDF or image."});
    const text=await extractText(req.file.buffer,req.file.mimetype);
    const fileHash=crypto.createHash("sha256").update(req.file.buffer).digest("hex");
    const old=await db.get("SELECT id FROM purchase_bills WHERE business_id=? AND file_hash=?",[req.auth.businessId,fileHash]);if(old)return res.status(409).json({error:"This bill was already uploaded.",bill_id:old.id});
    const bill=await db.createPurchaseBill({business_id:req.auth.businessId,original_filename:req.file.originalname,file_type:req.file.mimetype,file_hash:fileHash,raw_text:text});
    const extracted=parsePurchaseText(text);
    for(const x of extracted){const match=await db.get("SELECT id FROM items WHERE business_id=? AND name=? COLLATE NOCASE",[req.auth.businessId,x.name]);await db.addPurchaseBillItem({purchase_bill_id:bill.id,extracted_name:x.name,matched_item_id:match?.id,quantity:x.quantity,unit:x.unit,purchase_price:x.purchase_price,is_new_item:!match});}
    res.json({success:true,bill:await db.getPurchaseBill(bill.id,req.auth.businessId),raw_text:text});
  }catch(e){console.error(e);res.status(400).json({error:e.message||"Bill extraction failed."});}
});
app.get("/api/purchase-bills",auth,async(req,res)=>res.json({success:true,bills:await db.all("SELECT * FROM purchase_bills WHERE business_id=? ORDER BY id DESC",[req.auth.businessId])}));
app.get("/api/purchase-bills/:id",auth,async(req,res)=>{const b=await db.getPurchaseBill(num(req.params.id),req.auth.businessId);if(!b)return res.status(404).json({error:"Purchase bill not found."});res.json({success:true,bill:b});});
app.post("/api/purchase-bills/:id/confirm",auth,async(req,res)=>{try{const b=await db.confirmPurchaseBill(num(req.params.id),req.auth.businessId,req.body.items||[]);res.json({success:true,bill:b});}catch(e){res.status(400).json({error:e.message});}});

app.use((err,req,res,next)=>{console.error(err);res.status(400).json({error:err.message||"Request failed."});});
app.use((req,res)=>res.sendFile(path.join(PUBLIC_DIR,"index.html")));

app.listen(PORT,"0.0.0.0",()=>console.log(`DELIVERY MANAGEMENT WEBSITE\nDashboard: http://localhost:${PORT}`));
