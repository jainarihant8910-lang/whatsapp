// ============================================================
// database.js
// SQLite database for WhatsApp Delivery System
// ONE WHATSAPP MESSAGE = ONE ORDER
// ============================================================

const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

// ============================================================
// DATABASE PATH
// ============================================================

const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "delivery.db");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
        recursive: true
    });
}

// ============================================================
// DATABASE
// ============================================================

const db = new sqlite3.Database(DB_PATH);

// ============================================================
// PROMISIFIED SQLITE HELPERS
// ============================================================

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (error) {
            if (error) {
                reject(error);
                return;
            }

            resolve({
                lastID: this.lastID,
                changes: this.changes
            });
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (error, row) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(row);
        });
    });
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(rows || []);
        });
    });
}

// ============================================================
// DATABASE INITIALIZATION
// ============================================================

async function initializeDatabase() {
    await run(`PRAGMA foreign_keys = ON`);

    await run(`
        CREATE TABLE IF NOT EXISTS businesses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            business_id TEXT UNIQUE NOT NULL,
            firm_name TEXT NOT NULL,
            gstin TEXT DEFAULT '',
            address TEXT DEFAULT '',
            state TEXT DEFAULT '',
            state_code TEXT DEFAULT '',
            phone TEXT DEFAULT '',
            email TEXT DEFAULT '',
            logo_data TEXT,
            invoice_prefix TEXT DEFAULT 'INV',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            business_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            password_salt TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'OWNER',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(business_id, email),
            FOREIGN KEY(business_id) REFERENCES businesses(id) ON DELETE CASCADE
        )
    `);
    await run(`
        CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            business_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            phone TEXT DEFAULT '',
            address TEXT DEFAULT '',
            gstin TEXT DEFAULT '',
            email TEXT DEFAULT '',
            state TEXT DEFAULT '',
            state_code TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(business_id) REFERENCES businesses(id) ON DELETE CASCADE
        )
    `);
    await run(`
        CREATE TABLE IF NOT EXISTS invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            business_id INTEGER NOT NULL,
            invoice_number TEXT NOT NULL,
            invoice_date TEXT NOT NULL,
            customer_id INTEGER,
            customer_name TEXT NOT NULL,
            customer_address TEXT DEFAULT '',
            customer_phone TEXT DEFAULT '',
            customer_gstin TEXT DEFAULT '',
            customer_state TEXT DEFAULT '',
            customer_state_code TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'DRAFT',
            payment_status TEXT NOT NULL DEFAULT 'UNPAID',
            payment_method TEXT DEFAULT '',
            paid_amount REAL NOT NULL DEFAULT 0,
            subtotal REAL NOT NULL DEFAULT 0,
            cgst REAL NOT NULL DEFAULT 0,
            sgst REAL NOT NULL DEFAULT 0,
            igst REAL NOT NULL DEFAULT 0,
            total_tax REAL NOT NULL DEFAULT 0,
            grand_total REAL NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            finalized_at TEXT,
            UNIQUE(business_id, invoice_number),
            FOREIGN KEY(business_id) REFERENCES businesses(id) ON DELETE CASCADE,
            FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE SET NULL
        )
    `);
    await run(`
        CREATE TABLE IF NOT EXISTS invoice_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_id INTEGER NOT NULL,
            item_id INTEGER,
            product_name TEXT NOT NULL,
            hsn_code TEXT DEFAULT '',
            unit TEXT DEFAULT 'PCS',
            quantity REAL NOT NULL,
            rate REAL NOT NULL,
            gst_rate REAL NOT NULL DEFAULT 0,
            taxable_value REAL NOT NULL,
            cgst REAL NOT NULL DEFAULT 0,
            sgst REAL NOT NULL DEFAULT 0,
            igst REAL NOT NULL DEFAULT 0,
            line_total REAL NOT NULL,
            FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
            FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE SET NULL
        )
    `);
    await run(`
        CREATE TABLE IF NOT EXISTS purchase_bills (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            business_id INTEGER NOT NULL,
            original_filename TEXT NOT NULL,
            file_type TEXT NOT NULL,
            file_hash TEXT NOT NULL,
            supplier_name TEXT DEFAULT '',
            supplier_gstin TEXT DEFAULT '',
            supplier_address TEXT DEFAULT '',
            invoice_number TEXT DEFAULT '',
            invoice_date TEXT DEFAULT '',
            raw_text TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'REVIEW',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            confirmed_at TEXT,
            UNIQUE(business_id, file_hash),
            FOREIGN KEY(business_id) REFERENCES businesses(id) ON DELETE CASCADE
        )
    `);
    await run(`
        CREATE TABLE IF NOT EXISTS purchase_bill_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            purchase_bill_id INTEGER NOT NULL,
            extracted_name TEXT NOT NULL,
            matched_item_id INTEGER,
            quantity REAL NOT NULL DEFAULT 0,
            unit TEXT DEFAULT 'PCS',
            purchase_price REAL NOT NULL DEFAULT 0,
            gst_rate REAL NOT NULL DEFAULT 0,
            hsn_code TEXT DEFAULT '',
            is_new_item INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY(purchase_bill_id) REFERENCES purchase_bills(id) ON DELETE CASCADE,
            FOREIGN KEY(matched_item_id) REFERENCES items(id) ON DELETE SET NULL
        )
    `);
    await run(`
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            business_id INTEGER,
            user_id INTEGER,
            action TEXT NOT NULL,
            details TEXT DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    let business = await get(`SELECT id FROM businesses ORDER BY id LIMIT 1`);
    if (!business) {
        await run(`INSERT INTO businesses (business_id,firm_name,invoice_prefix) VALUES ('DEFAULT','My Business','INV')`);
        business = await get(`SELECT id FROM businesses ORDER BY id LIMIT 1`);
    }

    // Legacy tables are created below before their compatibility migrations run.

    await run(`
        CREATE TABLE IF NOT EXISTS senders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            whatsapp_id TEXT UNIQUE NOT NULL,
            name TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE COLLATE NOCASE NOT NULL,
            opening_stock REAL NOT NULL DEFAULT 0,
            current_stock REAL NOT NULL DEFAULT 0,
            minimum_stock REAL NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            date TEXT,
            time TEXT,

            delivered_to TEXT,

            sender_id INTEGER,

            whatsapp_message_id TEXT UNIQUE NOT NULL,
            whatsapp_from TEXT,

            total_items INTEGER NOT NULL DEFAULT 0,
            accepted_items INTEGER NOT NULL DEFAULT 0,
            rejected_items INTEGER NOT NULL DEFAULT 0,

            status TEXT NOT NULL DEFAULT 'PENDING',

            confirmation_sent INTEGER NOT NULL DEFAULT 0,
            confirmation_message_id TEXT,

            created_at TEXT DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY(sender_id)
                REFERENCES senders(id)
                ON DELETE SET NULL
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            order_id INTEGER NOT NULL,

            item_name TEXT NOT NULL,

            requested_quantity REAL NOT NULL,

            accepted_quantity REAL NOT NULL DEFAULT 0,

            rejected_quantity REAL NOT NULL DEFAULT 0,

            status TEXT NOT NULL,

            rejection_reason TEXT,

            created_at TEXT DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY(order_id)
                REFERENCES orders(id)
                ON DELETE CASCADE
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS stock_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            item_id INTEGER NOT NULL,

            type TEXT NOT NULL
                CHECK(type IN ('IN', 'OUT')),

            quantity REAL NOT NULL,

            reason TEXT,

            order_id INTEGER,

            order_item_id INTEGER,

            created_at TEXT DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY(item_id)
                REFERENCES items(id)
                ON DELETE CASCADE,

            FOREIGN KEY(order_id)
                REFERENCES orders(id)
                ON DELETE SET NULL,

            FOREIGN KEY(order_item_id)
                REFERENCES order_items(id)
                ON DELETE SET NULL
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS processed_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            message_id TEXT UNIQUE NOT NULL,

            whatsapp_from TEXT,

            sender_phone TEXT,

            body TEXT,

            processed_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS whatsapp_lid_map (
            lid TEXT PRIMARY KEY,

            phone TEXT NOT NULL,

            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    async function addColumnIfMissing(tableName, columnName, definition) {
        const columns = await all(`PRAGMA table_info(${tableName})`);
        if (!columns.some(c => c.name === columnName)) {
            await run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
        }
    }

    for (const table of ['senders','items','orders','order_items','stock_transactions','processed_messages','whatsapp_lid_map']) {
        await addColumnIfMissing(table, 'business_id', 'INTEGER NOT NULL DEFAULT 1');
    }
    await addColumnIfMissing('items', 'sku', "TEXT DEFAULT ''");
    await addColumnIfMissing('items', 'hsn_code', "TEXT DEFAULT ''");
    await addColumnIfMissing('items', 'unit', "TEXT DEFAULT 'PCS'");
    await addColumnIfMissing('items', 'purchase_price', 'REAL NOT NULL DEFAULT 0');
    await addColumnIfMissing('items', 'selling_price', 'REAL NOT NULL DEFAULT 0');
    await addColumnIfMissing('items', 'gst_rate', 'REAL NOT NULL DEFAULT 0');

    for (const table of ['senders','items','orders','order_items','stock_transactions','processed_messages','whatsapp_lid_map']) {
        await run(`UPDATE ${table} SET business_id=? WHERE business_id IS NULL OR business_id=0`, [business.id]);
    }

    await run(`CREATE INDEX IF NOT EXISTS idx_orders_business ON orders(business_id,id DESC)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_items_business ON items(business_id,name)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_customers_business ON customers(business_id,id DESC)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_invoices_business ON invoices(business_id,id DESC)`);
}

initializeDatabase()
    .then(() => {
        console.log("SQLite database initialized.");
    })
    .catch((error) => {
        console.error(
            "Database initialization failed:",
            error
        );
    });

// ============================================================
// PHONE NORMALIZATION
// ============================================================

function normalizePhone(phone) {
    let value = String(phone || "").trim();

    value = value.replace(/\D/g, "");

    if (!value) {
        return "";
    }

    return value;
}

// ============================================================
// SENDERS
// ============================================================

async function findSenderByPhone(phone, businessId = null) {
    const normalized = normalizePhone(phone);

    if (businessId !== null && businessId !== undefined) {
        return get(
            `SELECT * FROM senders
             WHERE whatsapp_id = ? AND business_id = ?
             LIMIT 1`,
            [normalized, businessId]
        );
    }

    return get(
        `SELECT * FROM senders
         WHERE whatsapp_id = ?
         LIMIT 1`,
        [normalized]
    );
}

async function isSenderAllowed(phone, businessId = null) {
    const sender = await findSenderByPhone(phone, businessId);

    return !!sender;
}

async function addSender(phone, name = "") {
    const normalized = normalizePhone(phone);

    if (!normalized) {
        throw new Error(
            "Invalid WhatsApp phone number."
        );
    }

    const result = await run(
        `
        INSERT INTO senders
        (
            whatsapp_id,
            name
        )
        VALUES (?, ?)
        `,
        [
            normalized,
            String(name || "").trim()
        ]
    );

    return get(
        `
        SELECT *
        FROM senders
        WHERE id = ?
        `,
        [result.lastID]
    );
}

async function removeSender(id) {
    return run(
        `
        DELETE FROM senders
        WHERE id = ?
        `,
        [id]
    );
}

async function getSenders() {
    return all(
        `
        SELECT *
        FROM senders
        ORDER BY id DESC
        `
    );
}

// ============================================================
// LID ↔ PHONE
// ============================================================

async function getPhoneFromLid(lid) {
    const row = await get(
        `
        SELECT phone
        FROM whatsapp_lid_map
        WHERE lid = ?
        LIMIT 1
        `,
        [lid]
    );

    return row?.phone || null;
}

async function saveLidPhone(lid, phone) {
    return run(
        `
        INSERT INTO whatsapp_lid_map
        (
            lid,
            phone,
            updated_at
        )
        VALUES (?, ?, CURRENT_TIMESTAMP)

        ON CONFLICT(lid)
        DO UPDATE SET
            phone = excluded.phone,
            updated_at = CURRENT_TIMESTAMP
        `,
        [
            String(lid),
            normalizePhone(phone)
        ]
    );
}

// ============================================================
// ITEMS
// ============================================================

async function findItemByName(name) {
    return get(
        `
        SELECT *
        FROM items
        WHERE name = ?
        COLLATE NOCASE
        LIMIT 1
        `,
        [String(name || "").trim()]
    );
}

async function addItem(
    name,
    openingStock = 0,
    minimumStock = 0
) {
    const cleanName = String(name || "").trim();

    const opening = Number(openingStock);
    const minimum = Number(minimumStock);

    if (!cleanName) {
        throw new Error(
            "Item name is required."
        );
    }

    if (!Number.isFinite(opening) || opening < 0) {
        throw new Error(
            "Opening stock must be non-negative."
        );
    }

    if (!Number.isFinite(minimum) || minimum < 0) {
        throw new Error(
            "Minimum stock must be non-negative."
        );
    }

    const result = await run(
        `
        INSERT INTO items
        (
            name,
            opening_stock,
            current_stock,
            minimum_stock
        )
        VALUES (?, ?, ?, ?)
        `,
        [
            cleanName,
            opening,
            opening,
            minimum
        ]
    );

    return get(
        `
        SELECT *
        FROM items
        WHERE id = ?
        `,
        [result.lastID]
    );
}

// ============================================================
// MANUAL STOCK ADDITION
// ============================================================

async function updateStock(
    itemId,
    quantity,
    reason = "Manual stock addition"
) {
    const amount = Number(quantity);

    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(
            "Stock quantity must be greater than zero."
        );
    }

    const item = await get(
        `
        SELECT *
        FROM items
        WHERE id = ?
        `,
        [itemId]
    );

    if (!item) {
        throw new Error(
            "Item not found."
        );
    }

    await run(
        `
        UPDATE items
        SET current_stock =
            current_stock + ?
        WHERE id = ?
        `,
        [
            amount,
            itemId
        ]
    );

    await run(
        `
        INSERT INTO stock_transactions
        (
            item_id,
            type,
            quantity,
            reason
        )
        VALUES (?, 'IN', ?, ?)
        `,
        [
            itemId,
            amount,
            reason
        ]
    );

    return get(
        `
        SELECT *
        FROM items
        WHERE id = ?
        `,
        [itemId]
    );
}

async function getItems(businessId = null) {
    const where = businessId === null || businessId === undefined
        ? ""
        : "WHERE business_id = ?";
    const params = businessId === null || businessId === undefined
        ? []
        : [businessId];

    return all(
        `SELECT *, CASE WHEN current_stock <= minimum_stock THEN 1 ELSE 0 END AS low_stock
         FROM items ${where}
         ORDER BY name COLLATE NOCASE ASC`,
        params
    );
}

async function deleteItem(id, businessId = null) {
    const item = businessId === null || businessId === undefined
        ? await get("SELECT * FROM items WHERE id = ?", [id])
        : await get("SELECT * FROM items WHERE id = ? AND business_id = ?", [id, businessId]);

    if (!item) throw new Error("Product not found.");
    if (Number(item.current_stock) !== 0) {
        throw new Error("A product can only be deleted when its stock is exactly zero.");
    }

    return businessId === null || businessId === undefined
        ? run("DELETE FROM items WHERE id = ?", [id])
        : run("DELETE FROM items WHERE id = ? AND business_id = ?", [id, businessId]);
}

// ============================================================
// MESSAGE DUPLICATE PROTECTION
// ============================================================

async function claimConfirmation(orderId) {
    const result = await run(
        `UPDATE orders SET confirmation_sent = 2
         WHERE id = ? AND confirmation_sent = 0`,
        [orderId]
    );
    return result.changes === 1;
}

async function isMessageProcessed(messageId) {
    const row = await get(
        `
        SELECT *
        FROM processed_messages
        WHERE message_id = ?
        LIMIT 1
        `,
        [messageId]
    );

    return !!row;
}

async function saveProcessedMessage(
    messageId,
    whatsappFrom = "",
    senderPhone = "",
    body = ""
) {
    return run(
        `
        INSERT OR IGNORE INTO processed_messages
        (
            message_id,
            whatsapp_from,
            sender_phone,
            body
        )
        VALUES (?, ?, ?, ?)
        `,
        [
            messageId,
            whatsappFrom,
            senderPhone,
            body
        ]
    );
}

// ============================================================
// ORDER STATUS CALCULATOR
// ============================================================

function calculateFinalStatus(
    acceptedItems,
    rejectedItems
) {
    if (
        acceptedItems > 0 &&
        rejectedItems === 0
    ) {
        return "SUCCESS";
    }

    if (
        acceptedItems > 0 &&
        rejectedItems > 0
    ) {
        return "PARTIAL";
    }

    return "REJECTED";
}

// ============================================================
// CREATE ONE COMPLETE ORDER
// ============================================================
//
// IMPORTANT:
// One WhatsApp message creates exactly ONE orders row.
//
// Example:
// rahul
// 10 bolt
// 5 nut
// 20 washer
//
// = ONE order
// + THREE order_items
//
// ============================================================

async function createOrder({
    date,
    time,
    deliveredTo,
    senderId,
    whatsappMessageId,
    whatsappFrom,
    body = "",
    senderPhone = "",
    businessId = 1,
    items
}) {
    if (!whatsappMessageId) {
        throw new Error(
            "WhatsApp message ID is required."
        );
    }

    if (
        !Array.isArray(items) ||
        items.length === 0
    ) {
        throw new Error(
            "Order must contain at least one item."
        );
    }

    // --------------------------------------------------------
    // Duplicate protection
    // --------------------------------------------------------

    const existing = await get(
        `
        SELECT *
        FROM orders
        WHERE whatsapp_message_id = ?
        LIMIT 1
        `,
        [whatsappMessageId]
    );

    if (existing) {
        return getOrderById(existing.id);
    }

    // --------------------------------------------------------
    // BEGIN TRANSACTION
    // --------------------------------------------------------

    await run(
        `BEGIN IMMEDIATE TRANSACTION`
    );

    try {
        // Recheck after transaction begins.
        const duplicate = await get(
            `
            SELECT *
            FROM orders
            WHERE whatsapp_message_id = ?
            LIMIT 1
            `,
            [whatsappMessageId]
        );

        if (duplicate) {
            await run(`ROLLBACK`);

            return getOrderById(
                duplicate.id
            );
        }

        // ----------------------------------------------------
        // ONE orders row
        // ----------------------------------------------------

        const orderResult = await run(
            `
            INSERT INTO orders
            (
                business_id,
                date,
                time,
                delivered_to,
                sender_id,
                whatsapp_message_id,
                whatsapp_from,
                total_items,
                accepted_items,
                rejected_items,
                status,
                confirmation_sent
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'PENDING', 0)
            `,
            [
                businessId,
                date || "",
                time || "",
                deliveredTo || "Unknown",
                senderId || null,
                whatsappMessageId,
                whatsappFrom || "",
                items.length
            ]
        );

        const orderId =
            orderResult.lastID;

        let acceptedCount = 0;
        let rejectedCount = 0;

        // ----------------------------------------------------
        // PROCESS EACH ITEM
        // ----------------------------------------------------

        for (const inputItem of items) {
            const itemName =
                String(
                    inputItem.item ??
                    inputItem.item_name ??
                    inputItem.name ??
                    ""
                ).trim();

            const requestedQuantity =
                Number(
                    inputItem.quantity ??
                    inputItem.requested_quantity
                );

            // ----------------------------------------------
            // Invalid item
            // ----------------------------------------------

            if (
                !itemName ||
                !Number.isFinite(
                    requestedQuantity
                ) ||
                requestedQuantity <= 0
            ) {
                await run(
                    `
                    INSERT INTO order_items
                    (
                        order_id,
                        item_name,
                        requested_quantity,
                        accepted_quantity,
                        rejected_quantity,
                        status,
                        rejection_reason
                    )
                    VALUES (?, ?, ?, 0, ?, 'REJECTED', ?)
                    `,
                    [
                        orderId,
                        itemName || "UNKNOWN",
                        Number.isFinite(
                            requestedQuantity
                        )
                            ? requestedQuantity
                            : 0,
                        Number.isFinite(
                            requestedQuantity
                        )
                            ? requestedQuantity
                            : 0,
                        "INVALID ITEM OR QUANTITY"
                    ]
                );

                rejectedCount++;

                continue;
            }

            // ----------------------------------------------
            // Find existing stock item
            // ----------------------------------------------

            const stockItem =
                await get(
                    `
                    SELECT *
                    FROM items
                    WHERE business_id = ?
                      AND name = ?
                    COLLATE NOCASE
                    LIMIT 1
                    `,
                    [businessId, itemName]
                );

            // ----------------------------------------------
            // Item does not exist
            // ----------------------------------------------

            if (!stockItem) {
                await run(
                    `
                    INSERT INTO order_items
                    (
                        order_id,
                        item_name,
                        requested_quantity,
                        accepted_quantity,
                        rejected_quantity,
                        status,
                        rejection_reason
                    )
                    VALUES (?, ?, ?, 0, ?, 'REJECTED', ?)
                    `,
                    [
                        orderId,
                        itemName,
                        requestedQuantity,
                        requestedQuantity,
                        "ITEM NOT IN STOCK"
                    ]
                );

                rejectedCount++;

                continue;
            }

            // ----------------------------------------------
            // No stock
            // ----------------------------------------------

            if (
                Number(
                    stockItem.current_stock
                ) <= 0
            ) {
                await run(
                    `
                    INSERT INTO order_items
                    (
                        order_id,
                        item_name,
                        requested_quantity,
                        accepted_quantity,
                        rejected_quantity,
                        status,
                        rejection_reason
                    )
                    VALUES (?, ?, ?, 0, ?, 'REJECTED', ?)
                    `,
                    [
                        orderId,
                        itemName,
                        requestedQuantity,
                        requestedQuantity,
                        "STOCK EXHAUSTED"
                    ]
                );

                rejectedCount++;

                continue;
            }

            // ----------------------------------------------
            // Insufficient stock
            //
            // NEVER partially fulfill.
            // ----------------------------------------------

            if (
                Number(
                    stockItem.current_stock
                ) < requestedQuantity
            ) {
                await run(
                    `
                    INSERT INTO order_items
                    (
                        order_id,
                        item_name,
                        requested_quantity,
                        accepted_quantity,
                        rejected_quantity,
                        status,
                        rejection_reason
                    )
                    VALUES (?, ?, ?, 0, ?, 'REJECTED', ?)
                    `,
                    [
                        orderId,
                        itemName,
                        requestedQuantity,
                        requestedQuantity,
                        "INSUFFICIENT STOCK"
                    ]
                );

                rejectedCount++;

                continue;
            }

            // ----------------------------------------------
            // ACCEPT ITEM
            // ----------------------------------------------

            const orderItemResult =
                await run(
                    `
                    INSERT INTO order_items
                    (
                        order_id,
                        item_name,
                        requested_quantity,
                        accepted_quantity,
                        rejected_quantity,
                        status,
                        rejection_reason
                    )
                    VALUES (?, ?, ?, ?, 0, 'ACCEPTED', NULL)
                    `,
                    [
                        orderId,
                        itemName,
                        requestedQuantity,
                        requestedQuantity
                    ]
                );

            const orderItemId =
                orderItemResult.lastID;

            // Deduct stock.
            await run(
                `
                UPDATE items
                SET current_stock =
                    current_stock - ?
                WHERE id = ?
                `,
                [
                    requestedQuantity,
                    stockItem.id
                ]
            );

            // Record stock movement.
            await run(
                `
                INSERT INTO stock_transactions
                (
                    business_id,
                    item_id,
                    type,
                    quantity,
                    reason,
                    order_id,
                    order_item_id
                )
                VALUES (?, ?, 'OUT', ?, ?, ?, ?)
                `,
                [
                    businessId,
                    stockItem.id,
                    requestedQuantity,
                    `WhatsApp Order #${orderId}`,
                    orderId,
                    orderItemId
                ]
            );

            acceptedCount++;
        }

        // ----------------------------------------------------
        // UPDATE COUNTS
        //
        // Status intentionally remains PENDING.
        // It changes only after WhatsApp confirmation succeeds.
        // ----------------------------------------------------

        await run(
            `
            UPDATE orders
            SET
                accepted_items = ?,
                rejected_items = ?,
                status = 'PENDING'
            WHERE id = ?
            `,
            [
                acceptedCount,
                rejectedCount,
                orderId
            ]
        );

        // ----------------------------------------------------
        // Save processed message atomically.
        // ----------------------------------------------------

        await run(
            `
            INSERT OR IGNORE INTO processed_messages
            (
                message_id,
                whatsapp_from,
                sender_phone,
                body
            )
            VALUES (?, ?, ?, ?)
            `,
            [
                whatsappMessageId,
                whatsappFrom || "",
                senderPhone || "",
                body || ""
            ]
        );

        await run(
            `COMMIT`
        );

        return getOrderById(orderId);
    } catch (error) {
        try {
            await run(`ROLLBACK`);
        } catch (_) {}

        throw error;
    }
}

// ============================================================
// GET COMPLETE ORDER
// ============================================================

async function getOrderById(orderId) {
    const order = await get(
        `
        SELECT
            o.*,
            s.name AS sender_name,
            s.whatsapp_id AS sender_phone
        FROM orders o
        LEFT JOIN senders s
            ON s.id = o.sender_id
        WHERE o.id = ?
        LIMIT 1
        `,
        [orderId]
    );

    if (!order) {
        return null;
    }

    const items = await all(
        `
        SELECT *
        FROM order_items
        WHERE order_id = ?
        ORDER BY id ASC
        `,
        [orderId]
    );

    return {
        ...order,
        confirmation_sent:
            Boolean(order.confirmation_sent),
        items
    };
}

// ============================================================
// GET ALL ORDERS
// ============================================================

async function getOrders() {
    const orders = await all(
        `
        SELECT
            o.*,
            s.name AS sender_name,
            s.whatsapp_id AS sender_phone
        FROM orders o
        LEFT JOIN senders s
            ON s.id = o.sender_id
        ORDER BY
            o.id DESC
        `
    );

    return orders.map((order) => ({
        ...order,
        confirmation_sent:
            Boolean(order.confirmation_sent)
    }));
}

// ============================================================
// CONFIRMATION SUCCESS
// ============================================================

async function markConfirmationSent(
    orderId,
    confirmationMessageId = ""
) {
    const order = await get(
        `
        SELECT *
        FROM orders
        WHERE id = ?
        LIMIT 1
        `,
        [orderId]
    );

    if (!order) {
        throw new Error(
            "Order not found."
        );
    }

    const finalStatus =
        calculateFinalStatus(
            Number(order.accepted_items),
            Number(order.rejected_items)
        );

    await run(
        `
        UPDATE orders
        SET
            confirmation_sent = 1,
            confirmation_message_id = ?,
            status = ?
        WHERE id = ?
        `,
        [
            confirmationMessageId || "",
            finalStatus,
            orderId
        ]
    );

    return getOrderById(orderId);
}

// ============================================================
// CONFIRMATION FAILED
// ============================================================

async function markConfirmationPending(
    orderId
) {
    await run(
        `
        UPDATE orders
        SET
            confirmation_sent = 0,
            status = 'PENDING'
        WHERE id = ?
        `,
        [orderId]
    );

    return getOrderById(orderId);
}

// ============================================================
// STOCK TRANSACTIONS
// ============================================================

async function getStockTransactions() {
    return all(
        `
        SELECT
            st.*,
            i.name AS item_name
        FROM stock_transactions st
        LEFT JOIN items i
            ON i.id = st.item_id
        ORDER BY
            st.id DESC
        `
    );
}


async function getBusinessByCode(code) { return get(`SELECT * FROM businesses WHERE business_id=? LIMIT 1`,[String(code||'').trim().toUpperCase()]); }
async function createBusiness(d) { const r=await run(`INSERT INTO businesses (business_id,firm_name,gstin,address,state,state_code,phone,email,invoice_prefix) VALUES (?,?,?,?,?,?,?,?,?)`,[String(d.business_id).trim().toUpperCase(),d.firm_name,d.gstin||'',d.address||'',d.state||'',d.state_code||'',d.phone||'',d.email||'',d.invoice_prefix||'INV']); return get(`SELECT * FROM businesses WHERE id=?`,[r.lastID]); }
async function getBusiness(id) { return get(`SELECT * FROM businesses WHERE id=?`,[id]); }
async function updateBusiness(id,d) { await run(`UPDATE businesses SET firm_name=?,gstin=?,address=?,state=?,state_code=?,phone=?,email=?,logo_data=?,invoice_prefix=? WHERE id=?`,[d.firm_name||'',d.gstin||'',d.address||'',d.state||'',d.state_code||'',d.phone||'',d.email||'',d.logo_data||null,d.invoice_prefix||'INV',id]); return getBusiness(id); }
async function getUserByEmail(businessId,email) { return get(`SELECT * FROM users WHERE business_id=? AND lower(email)=lower(?) LIMIT 1`,[businessId,String(email).trim()]); }
async function createUser(d) { const r=await run(`INSERT INTO users (business_id,name,email,password_hash,password_salt,role) VALUES (?,?,?,?,?,?)`,[d.business_id,d.name,d.email,d.password_hash,d.password_salt,d.role||'OWNER']); return get(`SELECT id,business_id,name,email,role FROM users WHERE id=?`,[r.lastID]); }
async function listCustomers(businessId) { return all(`SELECT * FROM customers WHERE business_id=? ORDER BY name COLLATE NOCASE`,[businessId]); }
async function createCustomer(businessId,d) { const r=await run(`INSERT INTO customers (business_id,name,phone,address,gstin,email,state,state_code,notes) VALUES (?,?,?,?,?,?,?,?,?)`,[businessId,d.name,d.phone||'',d.address||'',d.gstin||'',d.email||'',d.state||'',d.state_code||'',d.notes||'']); return get(`SELECT * FROM customers WHERE id=?`,[r.lastID]); }
async function listInvoices(businessId) { return all(`SELECT * FROM invoices WHERE business_id=? ORDER BY id DESC`,[businessId]); }
async function getInvoice(id,businessId) { const invoice=await get(`SELECT * FROM invoices WHERE id=? AND business_id=?`,[id,businessId]); if(!invoice)return null; invoice.items=await all(`SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY id`,[id]); return invoice; }
async function nextInvoiceNumber(businessId) { const b=await getBusiness(businessId); const prefix=b?.invoice_prefix||'INV'; const year=new Date().getFullYear(); const row=await get(`SELECT COUNT(*) n FROM invoices WHERE business_id=? AND invoice_number LIKE ?`,[businessId,prefix+'-'+year+'-%']); return prefix+'-'+year+'-'+String(Number(row.n||0)+1).padStart(4,'0'); }
async function createInvoice(businessId,d) {
    const number=d.invoice_number||await nextInvoiceNumber(businessId);
    const r=await run(`INSERT INTO invoices (business_id,invoice_number,invoice_date,customer_id,customer_name,customer_address,customer_phone,customer_gstin,customer_state,customer_state_code,status,payment_status,payment_method,paid_amount,subtotal,cgst,sgst,igst,total_tax,grand_total) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[businessId,number,d.invoice_date||new Date().toISOString().slice(0,10),d.customer_id||null,d.customer_name||'',d.customer_address||'',d.customer_phone||'',d.customer_gstin||'',d.customer_state||'',d.customer_state_code||'',d.status||'DRAFT',d.payment_status||'UNPAID',d.payment_method||'',Number(d.paid_amount||0),Number(d.subtotal||0),Number(d.cgst||0),Number(d.sgst||0),Number(d.igst||0),Number(d.total_tax||0),Number(d.grand_total||0)]);
    for(const x of d.items||[]) await run(`INSERT INTO invoice_items (invoice_id,item_id,product_name,hsn_code,unit,quantity,rate,gst_rate,taxable_value,cgst,sgst,igst,line_total) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,[r.lastID,x.item_id||null,x.product_name,x.hsn_code||'',x.unit||'PCS',Number(x.quantity),Number(x.rate),Number(x.gst_rate||0),Number(x.taxable_value),Number(x.cgst||0),Number(x.sgst||0),Number(x.igst||0),Number(x.line_total)]);
    return getInvoice(r.lastID,businessId);
}
async function finalizeInvoice(id,businessId) {
    const inv=await getInvoice(id,businessId); if(!inv)throw new Error('Invoice not found'); if(inv.status==='FINALIZED')return inv;
    await run(`BEGIN IMMEDIATE TRANSACTION`);
    try {
      for(const x of inv.items){ if(!x.item_id)continue; const item=await get(`SELECT * FROM items WHERE id=? AND business_id=?`,[x.item_id,businessId]); if(!item)throw new Error('Product not found: '+x.product_name); if(Number(item.current_stock)<Number(x.quantity))throw new Error('Insufficient stock for '+x.product_name); await run(`UPDATE items SET current_stock=current_stock-? WHERE id=?`,[x.quantity,x.item_id]); await run(`INSERT INTO stock_transactions (business_id,item_id,type,quantity,reason) VALUES (? ,?,'OUT',?,?)`,[businessId,x.item_id,x.quantity,'Invoice '+inv.invoice_number]); }
      await run(`UPDATE invoices SET status='FINALIZED',finalized_at=CURRENT_TIMESTAMP WHERE id=? AND business_id=?`,[id,businessId]); await run(`COMMIT`);
    } catch(e){try{await run(`ROLLBACK`)}catch(_){}throw e;} return getInvoice(id,businessId);
}
async function cancelInvoice(id,businessId) {
    const inv=await getInvoice(id,businessId); if(!inv)throw new Error('Invoice not found'); if(inv.status==='CANCELLED')return inv;
    if(inv.status==='FINALIZED') for(const x of inv.items){if(x.item_id){await run(`UPDATE items SET current_stock=current_stock+? WHERE id=? AND business_id=?`,[x.quantity,x.item_id,businessId]); await run(`INSERT INTO stock_transactions (business_id,item_id,type,quantity,reason) VALUES (? ,?,'IN',?,?)`,[businessId,x.item_id,x.quantity,'Invoice cancellation '+inv.invoice_number]);}}
    await run(`UPDATE invoices SET status='CANCELLED' WHERE id=? AND business_id=?`,[id,businessId]); return getInvoice(id,businessId);
}
async function createPurchaseBill(d) {
    const old=await get(`SELECT * FROM purchase_bills WHERE business_id=? AND file_hash=?`,[d.business_id,d.file_hash]); if(old)return old;
    const r=await run(`INSERT INTO purchase_bills (business_id,original_filename,file_type,file_hash,supplier_name,supplier_gstin,supplier_address,invoice_number,invoice_date,raw_text,status) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[d.business_id,d.original_filename,d.file_type,d.file_hash,d.supplier_name||'',d.supplier_gstin||'',d.supplier_address||'',d.invoice_number||'',d.invoice_date||'',d.raw_text||'','REVIEW']); return get(`SELECT * FROM purchase_bills WHERE id=?`,[r.lastID]);
}
async function addPurchaseBillItem(d) { const r=await run(`INSERT INTO purchase_bill_items (purchase_bill_id,extracted_name,matched_item_id,quantity,unit,purchase_price,gst_rate,hsn_code,is_new_item) VALUES (?,?,?,?,?,?,?,?,?)`,[d.purchase_bill_id,d.extracted_name,d.matched_item_id||null,Number(d.quantity||0),d.unit||'PCS',Number(d.purchase_price||0),Number(d.gst_rate||0),d.hsn_code||'',d.is_new_item?1:0]); return get(`SELECT * FROM purchase_bill_items WHERE id=?`,[r.lastID]); }
async function getPurchaseBill(id,businessId) { const b=await get(`SELECT * FROM purchase_bills WHERE id=? AND business_id=?`,[id,businessId]); if(!b)return null; b.items=await all(`SELECT p.*,i.name matched_name FROM purchase_bill_items p LEFT JOIN items i ON i.id=p.matched_item_id WHERE p.purchase_bill_id=?`,[id]); return b; }
async function confirmPurchaseBill(id,businessId,items) {
    const bill=await getPurchaseBill(id,businessId); if(!bill)throw new Error('Purchase bill not found'); if(bill.status==='CONFIRMED')return bill; await run(`BEGIN IMMEDIATE TRANSACTION`);
    try {
      for(const x of items){const qty=Number(x.quantity),price=Number(x.purchase_price||0);if(!x.name||!Number.isFinite(qty)||qty<=0)throw new Error('Invalid purchase item');let item=x.item_id?await get(`SELECT * FROM items WHERE id=? AND business_id=?`,[x.item_id,businessId]):await get(`SELECT * FROM items WHERE business_id=? AND name=? COLLATE NOCASE`,[businessId,x.name.trim()]);if(item){await run(`UPDATE items SET current_stock=current_stock+?,purchase_price=?,gst_rate=?,hsn_code=?,unit=? WHERE id=?`,[qty,price,Number(x.gst_rate||0),x.hsn_code||'',x.unit||'PCS',item.id]);}else{const r=await run(`INSERT INTO items (business_id,name,opening_stock,current_stock,minimum_stock,purchase_price,selling_price,gst_rate,hsn_code,unit) VALUES (?,?,?,?,?,?,?,?,?,?)`,[businessId,x.name.trim(),0,qty,0,price,Number(x.selling_price||0),Number(x.gst_rate||0),x.hsn_code||'',x.unit||'PCS']);item={id:r.lastID};}await run(`INSERT INTO stock_transactions (business_id,item_id,type,quantity,reason) VALUES (?,?,'IN',?,?)`,[businessId,item.id,qty,'Purchase bill #'+id]);}
      await run(`UPDATE purchase_bills SET status='CONFIRMED',confirmed_at=CURRENT_TIMESTAMP WHERE id=?`,[id]); await run(`COMMIT`);
    }catch(e){try{await run(`ROLLBACK`)}catch(_){}throw e;} return getPurchaseBill(id,businessId);
}

// ============================================================
// CLOSE DATABASE
// ============================================================

function closeDatabase() {
    return new Promise((resolve, reject) => {
        db.close((error) => {
            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    db,

    normalizePhone,

    run,
    get,
    all,

    findSenderByPhone,
    isSenderAllowed,

    addSender,
    removeSender,
    getSenders,

    getPhoneFromLid,
    saveLidPhone,

    findItemByName,
    addItem,
    updateStock,
    getItems,
    deleteItem,

    isMessageProcessed,
    saveProcessedMessage,

    createOrder,
    getOrderById,
    getOrders,

    markConfirmationSent,
    claimConfirmation,
    markConfirmationPending,

    getStockTransactions,

    closeDatabase,
    getBusinessByCode, createBusiness, getBusiness, updateBusiness,
    getUserByEmail, createUser, listCustomers, createCustomer,
    listInvoices, getInvoice, createInvoice, finalizeInvoice, cancelInvoice, nextInvoiceNumber,
    createPurchaseBill, addPurchaseBillItem, getPurchaseBill, confirmPurchaseBill
};