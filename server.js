// ============================================================
// server.js
// Delivery Management Website
// ============================================================

require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const crypto = require("crypto");
const pdfParse = require("pdf-parse");
const Tesseract = require("tesseract.js");
const db = require("./database");

const app = express();
// ============================================================
// PURCHASE BILL UPLOAD
// ============================================================

const purchaseUpload = multer({
    storage: multer.memoryStorage(),

    limits: {
        fileSize: 10 * 1024 * 1024
    },

    fileFilter: (
        req,
        file,
        callback
    ) => {
        const allowedTypes = [
            "application/pdf",
            "image/jpeg",
            "image/png",
            "image/webp"
        ];

        if (
            allowedTypes.includes(
                file.mimetype
            )
        ) {
            callback(
                null,
                true
            );
        } else {
            callback(
                new Error(
                    "Only PDF, JPG, PNG and WEBP files are allowed."
                )
            );
        }
    }
});
const PORT =
    Number(process.env.PORT) || 3000;

const PUBLIC_DIR =
    path.join(
        __dirname,
        "public"
    );

const STATUS_FILE =
    path.join(
        __dirname,
        "data",
        "whatsapp-status.json"
    );

// ============================================================
// EXPRESS
// ============================================================

app.use(
    express.json({
        limit: "2mb"
    })
);

app.use(
    express.urlencoded({
        extended: true
    })
);

// Static website
app.use(
    express.static(
        PUBLIC_DIR
    )
);

// ============================================================
// HELPERS
// ============================================================

function clean(value) {
    return String(
        value ?? ""
    ).trim();
}
// ============================================================
// PURCHASE BILL OCR HELPERS
// ============================================================

function calculateFileHash(buffer) {
    return crypto
        .createHash("sha256")
        .update(buffer)
        .digest("hex");
}


// ------------------------------------------------------------
// PDF TEXT EXTRACTION
// ------------------------------------------------------------

async function extractPdfText(buffer) {
    const result =
        await pdfParse(buffer);

    return String(
        result.text || ""
    ).trim();
}


// ------------------------------------------------------------
// IMAGE OCR
// ------------------------------------------------------------

async function extractImageText(buffer) {
    const result =
        await Tesseract.recognize(
            buffer,
            "eng",
            {
                logger: info => {
                    if (
                        info.status ===
                        "recognizing text"
                    ) {
                        console.log(
                            `OCR progress: ${Math.round(
                                (info.progress || 0) * 100
                            )}%`
                        );
                    }
                }
            }
        );

    return String(
        result.data.text || ""
    ).trim();
}


// ------------------------------------------------------------
// GENERAL BILL TEXT EXTRACTION
// ------------------------------------------------------------

async function extractBillText(
    buffer,
    mimetype
) {
    if (
        mimetype ===
        "application/pdf"
    ) {
        let text = "";

        try {
            text =
                await extractPdfText(
                    buffer
                );
        } catch (error) {
            console.error(
                "PDF text extraction failed:",
                error.message
            );
        }

        /*
         * If the PDF is a scanned PDF,
         * normal PDF extraction may return
         * almost nothing.
         *
         * We don't OCR the PDF directly yet.
         * The user can upload the page/image
         * as JPG/PNG for OCR.
         */

        return text;
    }

    return extractImageText(
        buffer
    );
}
// ============================================================
// PURCHASE ITEM EXTRACTION
// ============================================================

function parsePurchaseItems(text) {
    const lines = String(
        text || ""
    )
        .split(/\r?\n/)
        .map(line =>
            line
                .replace(/\t+/g, " ")
                .replace(/\s+/g, " ")
                .trim()
        )
        .filter(Boolean);
// ============================================================
// MATCH PURCHASE ITEMS WITH STOCK
// ============================================================

async function matchPurchaseItems(
    items
) {
    const results = [];

    for (
        const item of items
    ) {
        const existing =
            await db.findItemByName(
                item.name
            );

        results.push({
            ...item,

            item_id:
                existing
                    ? existing.id
                    : null,

            existing_item:
                !!existing,

            current_stock:
                existing
                    ? Number(
                        existing.current_stock
                    )
                    : 0,

            is_new_item:
                !existing
        });
    }

    return results;
}
    const results = [];

    for (
        const line of lines
    ) {
        /*
         * Examples it can recognize:
         *
         * Bolt 100 PCS 8
         * Nut 50 5
         * Washer 200 PCS 3
         *
         * It intentionally requires
         * a quantity so that random
         * bill text isn't treated as stock.
         */

        const match =
            line.match(
                /^(.+?)\s+(\d+(?:\.\d+)?)\s*(PCS|PC|NOS|BOX|KG|G|LTR|L|M|SET|PACK|UNITS?)?\s+(?:₹|Rs\.?|INR)?\s*(\d+(?:\.\d+)?)$/i
            );

        if (!match) {
            continue;
        }

        const name =
            match[1]
                .trim()
                .replace(
                    /^[-•*]+/,
                    ""
                )
                .trim();

        const quantity =
            Number(
                match[2]
            );

        const unit =
            (
                match[3] ||
                "PCS"
            ).toUpperCase();

        const purchasePrice =
            Number(
                match[4]
            );

        if (
            !name ||
            !Number.isFinite(
                quantity
            ) ||
            quantity <= 0
        ) {
            continue;
        }

        results.push({
            name,
            quantity,
            unit,
            purchase_price:
                purchasePrice,
            gst_rate: 0,
            hsn_code: ""
        });
    }

    return results;
}
function readWhatsAppStatus() {
    try {
        if (
            !fs.existsSync(
                STATUS_FILE
            )
        ) {
            return {
                status: "DISCONNECTED",
                message:
                    "WhatsApp is not connected.",
                qr: null
            };
        }

        return JSON.parse(
            fs.readFileSync(
                STATUS_FILE,
                "utf8"
            )
        );
    } catch (error) {
        return {
            status: "ERROR",
            message:
                "Could not read WhatsApp status.",
            qr: null
        };
    }
}

// ============================================================
// HEALTH
// ============================================================

app.get(
    "/api/health",
    async (req, res) => {
        try {
            await db.get(
                "SELECT 1 AS ok"
            );

            res.json({
                success: true,
                server: true,
                database: true
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                server: true,
                database: false,
                error:
                    error.message
            });
        }
    }
);

// ============================================================
// DASHBOARD
// ============================================================

app.get(
    "/api/dashboard",
    async (req, res) => {
        try {
            const totalOrders =
                await db.get(`
                    SELECT COUNT(*) AS count
                    FROM orders
                `);

            const todayOrders =
                await db.get(`
                    SELECT COUNT(*) AS count
                    FROM orders
                    WHERE date =
                        date('now', 'localtime')
                `);

            const pendingOrders =
                await db.get(`
                    SELECT COUNT(*) AS count
                    FROM orders
                    WHERE status = 'PENDING'
                `);

            const successOrders =
                await db.get(`
                    SELECT COUNT(*) AS count
                    FROM orders
                    WHERE status = 'SUCCESS'
                `);

            const partialOrders =
                await db.get(`
                    SELECT COUNT(*) AS count
                    FROM orders
                    WHERE status = 'PARTIAL'
                `);

            const rejectedOrders =
                await db.get(`
                    SELECT COUNT(*) AS count
                    FROM orders
                    WHERE status = 'REJECTED'
                `);

            const errorOrders =
                await db.get(`
                    SELECT COUNT(*) AS count
                    FROM orders
                    WHERE status = 'ERROR'
                `);

            const totalStockItems =
                await db.get(`
                    SELECT COUNT(*) AS count
                    FROM items
                `);

            const lowStockItems =
                await db.get(`
                    SELECT COUNT(*) AS count
                    FROM items
                    WHERE current_stock <= minimum_stock
                `);

            res.json({
                success: true,

                totalOrders:
                    totalOrders?.count || 0,

                todayOrders:
                    todayOrders?.count || 0,

                pendingOrders:
                    pendingOrders?.count || 0,

                successOrders:
                    successOrders?.count || 0,

                partialOrders:
                    partialOrders?.count || 0,

                rejectedOrders:
                    rejectedOrders?.count || 0,

                errorOrders:
                    errorOrders?.count || 0,

                totalStockItems:
                    totalStockItems?.count || 0,

                lowStockItems:
                    lowStockItems?.count || 0
            });
        } catch (error) {
            console.error(
                "Dashboard error:",
                error
            );

            res.status(500).json({
                error:
                    "Failed to load dashboard."
            });
        }
    }
);

// ============================================================
// ORDERS
// ============================================================

app.get(
    "/api/orders",
    async (req, res) => {
        try {
            const orders =
                await db.getOrders();

            res.json({
                success: true,
                orders
            });
        } catch (error) {
            console.error(
                "Orders error:",
                error
            );

            res.status(500).json({
                error:
                    "Failed to load orders."
            });
        }
    }
);

// Single complete order
app.get(
    "/api/orders/:id",
    async (req, res) => {
        try {
            const id =
                Number(
                    req.params.id
                );

            if (
                !Number.isInteger(id) ||
                id <= 0
            ) {
                return res.status(400).json({
                    error:
                        "Invalid order ID."
                });
            }

            const order =
                await db.getOrderById(
                    id
                );

            if (!order) {
                return res.status(404).json({
                    error:
                        "Order not found."
                });
            }

            res.json({
                success: true,
                order
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                error:
                    "Failed to load order."
            });
        }
    }
);

// ============================================================
// DELIVERY API
//
// This endpoint exists so your website does NOT receive 404
// when it accesses /api/whatsapp/delivery.
//
// New index.js writes directly to SQLite, but this route is
// retained for compatibility.
// ============================================================

app.get(
    "/api/whatsapp/delivery",
    async (req, res) => {
        try {
            const orders =
                await db.getOrders();

            res.json({
                success: true,
                orders
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                error:
                    "Failed to load delivery records."
            });
        }
    }
);

// ============================================================
// STOCK
// ============================================================

app.get(
    "/api/items",
    async (req, res) => {
        try {
            const items =
                await db.getItems();

            res.json({
                success: true,
                items
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                error:
                    "Failed to load stock."
            });
        }
    }
);

// Add stock item
app.post(
    "/api/items",
    async (req, res) => {
        try {
            const name =
                clean(req.body.name);

            const opening =
                Number(
                    req.body.opening_stock ??
                    req.body.openingStock ??
                    0
                );

            const minimum =
                Number(
                    req.body.minimum_stock ??
                    req.body.minimumStock ??
                    0
                );

            if (!name) {
                return res.status(400).json({
                    error:
                        "Item name is required."
                });
            }

            if (
                !Number.isFinite(opening) ||
                opening < 0
            ) {
                return res.status(400).json({
                    error:
                        "Opening stock must be non-negative."
                });
            }

            if (
                !Number.isFinite(minimum) ||
                minimum < 0
            ) {
                return res.status(400).json({
                    error:
                        "Minimum stock must be non-negative."
                });
            }

            const existing =
                await db.findItemByName(
                    name
                );

            if (existing) {
                return res.status(409).json({
                    error:
                        "Item already exists."
                });
            }

            const item =
                await db.addItem(
                    name,
                    opening,
                    minimum
                );

            res.status(201).json({
                success: true,
                item
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                error:
                    "Failed to add stock item."
            });
        }
    }
);

// Add stock
app.post(
    "/api/items/:id/stock",
    async (req, res) => {
        try {
            const id =
                Number(
                    req.params.id
                );

            const quantity =
                Number(
                    req.body.quantity
                );

            const reason =
                clean(
                    req.body.reason
                ) ||
                "Manual stock addition";

            if (
                !Number.isInteger(id) ||
                id <= 0
            ) {
                return res.status(400).json({
                    error:
                        "Invalid item ID."
                });
            }

            if (
                !Number.isFinite(quantity) ||
                quantity <= 0
            ) {
                return res.status(400).json({
                    error:
                        "Quantity must be greater than zero."
                });
            }

            const item =
                await db.get(
                    `
                    SELECT *
                    FROM items
                    WHERE id = ?
                    `,
                    [id]
                );

            if (!item) {
                return res.status(404).json({
                    error:
                        "Item not found."
                });
            }

            const updated =
                await db.updateStock(
                    id,
                    quantity,
                    reason
                );

            res.json({
                success: true,
                item: updated
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                error:
                    "Failed to update stock."
            });
        }
    }
);

// Delete stock item
app.delete(
    "/api/items/:id",
    async (req, res) => {
        try {
            const id =
                Number(
                    req.params.id
                );

            if (
                !Number.isInteger(id) ||
                id <= 0
            ) {
                return res.status(400).json({
                    error:
                        "Invalid item ID."
                });
            }

            await db.deleteItem(
                id
            );

            res.json({
                success: true
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                error:
                    "Failed to delete item."
            });
        }
    }
);

// ============================================================
// TRANSACTIONS
// ============================================================

app.get(
    "/api/transactions",
    async (req, res) => {
        try {
            const transactions =
                await db.getStockTransactions();

            res.json({
                success: true,
                transactions
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                error:
                    "Failed to load transactions."
            });
        }
    }
);

// ============================================================
// SENDERS
// ============================================================

app.get(
    "/api/senders",
    async (req, res) => {
        try {
            const senders =
                await db.getSenders();

            res.json({
                success: true,
                senders
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                error:
                    "Failed to load senders."
            });
        }
    }
);

app.post(
    "/api/senders",
    async (req, res) => {
        try {
            const name =
                clean(req.body.name);

            const phone =
                db.normalizePhone(
                    req.body.phone ??
                    req.body.whatsapp_id
                );

            if (!phone) {
                return res.status(400).json({
                    error:
                        "WhatsApp phone number is required."
                });
            }

            const existing =
                await db.findSenderByPhone(
                    phone
                );

            if (existing) {
                return res.status(409).json({
                    error:
                        "This number is already allowed."
                });
            }

            const sender =
                await db.addSender(
                    phone,
                    name
                );

            res.status(201).json({
                success: true,
                sender
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                error:
                    "Failed to add sender."
            });
        }
    }
);

app.delete(
    "/api/senders/:id",
    async (req, res) => {
        try {
            const id =
                Number(
                    req.params.id
                );

            await db.removeSender(
                id
            );

            res.json({
                success: true
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                error:
                    "Failed to remove sender."
            });
        }
    }
);

// ============================================================
// WHATSAPP STATUS
// ============================================================

app.get(
    "/api/whatsapp/status",
    (req, res) => {
        res.json(
            readWhatsAppStatus()
        );
    }
);

app.get(
    "/api/whatsapp/qr",
    (req, res) => {
        const status =
            readWhatsAppStatus();

        res.json({
            success: true,
            qr:
                status.qr || null
        });
    }
);
// ============================================================
// PURCHASE BILL API
// ============================================================

// ------------------------------------------------------------
// UPLOAD + OCR
// ------------------------------------------------------------

app.post(
    "/api/purchase-bills/extract",
    purchaseUpload.single("bill"),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    error:
                        "Please upload a PDF or image bill."
                });
            }

            console.log(
                "Purchase bill received:",
                req.file.originalname
            );

            const fileHash =
                calculateFileHash(
                    req.file.buffer
                );

            // -----------------------------------------------
            // DUPLICATE FILE CHECK
            // -----------------------------------------------

            const existing =
                await db.get(
                    `
                    SELECT *
                    FROM purchase_bills
                    WHERE file_hash = ?
                    LIMIT 1
                    `,
                    [fileHash]
                );

            if (existing) {
                const existingBill =
                    await db.getPurchaseBillById(
                        existing.id
                    );

                return res.status(409).json({
                    error:
                        "This exact bill file has already been uploaded.",
                    duplicate: true,
                    bill:
                        existingBill
                });
            }

            // -----------------------------------------------
            // EXTRACT TEXT
            // -----------------------------------------------

            const rawText =
                await extractBillText(
                    req.file.buffer,
                    req.file.mimetype
                );

            if (!rawText) {
                return res.status(422).json({
                    error:
                        "No readable text was found in this bill. Try a clearer image or upload the PDF/image again."
                });
            }

            console.log(
                "Extracted bill text:"
            );

            console.log(
                rawText
            );

            // -----------------------------------------------
            // PARSE PRODUCTS
            // -----------------------------------------------

            const detectedItems =
                parsePurchaseItems(
                    rawText
                );

            const matchedItems =
                await matchPurchaseItems(
                    detectedItems
                );

            // -----------------------------------------------
            // SAVE BILL
            // -----------------------------------------------

            const created =
                await db.createPurchaseBill({
                    originalFilename:
                        req.file.originalname,

                    fileType:
                        req.file.mimetype,

                    fileHash,

                    rawText
                });

            if (
                created.duplicate
            ) {
                return res.status(409).json({
                    error:
                        "This bill has already been uploaded.",
                    bill:
                        created.bill
                });
            }

            const billId =
                created.bill.id;

            // -----------------------------------------------
            // SAVE DETECTED ITEMS
            // -----------------------------------------------

            for (
                const item
                of matchedItems
            ) {
                await db.addPurchaseBillItem({
                    purchaseBillId:
                        billId,

                    extractedName:
                        item.name,

                    matchedItemId:
                        item.item_id,

                    quantity:
                        item.quantity,

                    unit:
                        item.unit,

                    purchasePrice:
                        item.purchase_price,

                    gstRate:
                        item.gst_rate,

                    hsnCode:
                        item.hsn_code,

                    isNewItem:
                        item.is_new_item
                });
            }

            const bill =
                await db.getPurchaseBillById(
                    billId
                );

            res.status(201).json({
                success: true,

                bill,

                extractedText:
                    rawText,

                detectedItems:
                    matchedItems,

                message:
                    detectedItems.length
                        ? "Bill processed. Review the detected items before adding stock."
                        : "Bill text was extracted, but no product lines were confidently detected."
            });

        } catch (error) {
            console.error(
                "Purchase bill extraction error:",
                error
            );

            res.status(500).json({
                error:
                    error.message ||
                    "Failed to process purchase bill."
            });
        }
    }
);


// ------------------------------------------------------------
// GET PURCHASE BILL
// ------------------------------------------------------------

app.get(
    "/api/purchase-bills/:id",
    async (req, res) => {
        try {
            const id =
                Number(
                    req.params.id
                );

            if (
                !Number.isInteger(id) ||
                id <= 0
            ) {
                return res.status(400).json({
                    error:
                        "Invalid purchase bill ID."
                });
            }

            const bill =
                await db.getPurchaseBillById(
                    id
                );

            if (!bill) {
                return res.status(404).json({
                    error:
                        "Purchase bill not found."
                });
            }

            res.json({
                success: true,
                ...bill
            });

        } catch (error) {
            console.error(
                error
            );

            res.status(500).json({
                error:
                    "Failed to load purchase bill."
            });
        }
    }
);


// ------------------------------------------------------------
// CONFIRM PURCHASE BILL
// ------------------------------------------------------------

app.post(
    "/api/purchase-bills/:id/confirm",
    async (req, res) => {
        try {
            const id =
                Number(
                    req.params.id
                );

            if (
                !Number.isInteger(id) ||
                id <= 0
            ) {
                return res.status(400).json({
                    error:
                        "Invalid purchase bill ID."
                });
            }

            const items =
                req.body.items;

            if (
                !Array.isArray(items) ||
                items.length === 0
            ) {
                return res.status(400).json({
                    error:
                        "No purchase items supplied."
                });
            }

            const confirmed =
                await db.confirmPurchaseBill(
                    id,
                    items
                );

            res.json({
                success: true,

                message:
                    "Purchase confirmed. Stock has been updated.",

                ...confirmed
            });

        } catch (error) {
            console.error(
                "Purchase confirmation error:",
                error
            );

            res.status(400).json({
                error:
                    error.message ||
                    "Failed to confirm purchase."
            });
        }
    }
);
// ============================================================
// PURCHASE BILL HISTORY
// ============================================================

app.get(
    "/api/purchase-bills",
    async (req, res) => {
        try {
            const bills =
                await db.all(
                    `
                    SELECT
                        *
                    FROM purchase_bills
                    ORDER BY
                        id DESC
                    `
                );

            res.json({
                success: true,
                bills
            });

        } catch (error) {
            console.error(
                error
            );

            res.status(500).json({
                error:
                    "Failed to load purchase bills."
            });
        }
    }
);
// ============================================================
// SPA FALLBACK
//
// Express 5 syntax.
// ============================================================

app.get(
    "/{*splat}",
    (req, res) => {
        const indexPath =
            path.join(
                PUBLIC_DIR,
                "index.html"
            );

        if (
            !fs.existsSync(indexPath)
        ) {
            return res.status(404).send(
                `
                <h1>404</h1>
                <p>public/index.html was not found.</p>
                `
            );
        }

        res.sendFile(
            indexPath
        );
    }
);

// ============================================================
// START
// ============================================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log("");
        console.log(
            "=========================================="
        );
        console.log(
            " DELIVERY MANAGEMENT SYSTEM"
        );
        console.log(
            "=========================================="
        );
        console.log(
            `Port: ${PORT}`
        );
        console.log(
            `Dashboard: http://localhost:${PORT}`
        );
        console.log(
            "One WhatsApp message = one order"
        );
        console.log(
            "SQLite database connected"
        );
        console.log(
            "=========================================="
        );
        console.log("");
    }
);